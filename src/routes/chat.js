const express = require('express')
const router = express.Router()
const pool = require('../db/pool')
const { requireAuth } = require('../middleware/auth')

const columnCache = new Map() // key: "table.column" -> boolean
async function hasColumn(table, column) {
  const key = `${table}.${column}`
  if (columnCache.has(key)) return columnCache.get(key)
  const r = await pool.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [table, column]
  )
  const ok = r.rows.length > 0
  columnCache.set(key, ok)
  return ok
}

async function ensureUserScopedTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_hidden (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hidden_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS message_hidden_by_user ON message_hidden (user_id, hidden_at DESC)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_pins (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pinned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS message_pins_by_user ON message_pins (user_id, pinned_at DESC)`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_hidden (
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      hidden_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (channel_id, user_id)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS channel_hidden_by_user ON channel_hidden (user_id, hidden_at DESC)`)
}

function canAccessChannelSql() {
  // user can access general, or is a member
  return `
    (c.type = 'general')
    OR EXISTS (
      SELECT 1 FROM channel_members cm
      WHERE cm.channel_id = c.id AND cm.user_id = $2
    )
  `
}

router.get('/channels', requireAuth, async (req, res) => {
  try {
    await ensureUserScopedTables()
    const hasDeletedAt = await hasColumn('users', 'deleted_at')
    const hasAvatar = await hasColumn('users', 'avatar_url')
    const otherDeletedSql = hasDeletedAt ? `COALESCE((u.deleted_at IS NOT NULL), false)` : `false`
    const otherNameSql = hasDeletedAt
      ? `CASE WHEN u.deleted_at IS NOT NULL THEN 'Удаленный аккаунт' ELSE COALESCE(u.full_name, '') END`
      : `COALESCE(u.full_name, '')`
    const otherAvatarSql = hasAvatar
      ? (hasDeletedAt ? `CASE WHEN u.deleted_at IS NOT NULL THEN '' ELSE COALESCE(u.avatar_url, '') END` : `COALESCE(u.avatar_url, '')`)
      : `''`

    const result = await pool.query(
      `
      SELECT
        c.id,
        c.type,
        c.created_at,
        CASE
          WHEN c.type = 'direct' THEN (
            SELECT cm.user_id
            FROM channel_members cm
            WHERE cm.channel_id = c.id AND cm.user_id <> $1
            LIMIT 1
          )
          ELSE NULL
        END AS other_user_id,
        CASE
          WHEN c.type = 'direct' THEN COALESCE((
            SELECT ${otherNameSql}
            FROM channel_members cm
            LEFT JOIN users u ON u.id = cm.user_id
            WHERE cm.channel_id = c.id AND cm.user_id <> $1
            LIMIT 1
          ), '')
          ELSE COALESCE(c.name, '')
        END AS name,
        CASE
          WHEN c.type = 'direct' THEN COALESCE((
            SELECT ${otherDeletedSql}
            FROM channel_members cm
            LEFT JOIN users u ON u.id = cm.user_id
            WHERE cm.channel_id = c.id AND cm.user_id <> $1
            LIMIT 1
          ), false)
          ELSE false
        END AS other_deleted,
        CASE
          WHEN c.type = 'direct' THEN COALESCE((
            SELECT ${otherAvatarSql}
            FROM channel_members cm
            LEFT JOIN users u ON u.id = cm.user_id
            WHERE cm.channel_id = c.id AND cm.user_id <> $1
            LIMIT 1
          ), '')
          ELSE ''
        END AS other_avatar_url,
        (SELECT COUNT(*) FROM messages m
         WHERE m.channel_id = c.id
         AND m.created_at > COALESCE(
           (SELECT last_read_at FROM channel_members
            WHERE channel_id = c.id AND user_id = $1),
           '1970-01-01'
         )
        ) as unread_count
      FROM channels c
      WHERE c.type = 'general'
         OR c.id IN (SELECT channel_id FROM channel_members WHERE user_id = $1)
      AND NOT EXISTS (
        SELECT 1 FROM channel_hidden ch
        WHERE ch.channel_id = c.id AND ch.user_id = $1
      )
      ORDER BY
        COALESCE((SELECT MAX(m2.created_at) FROM messages m2 WHERE m2.channel_id = c.id), c.created_at) DESC
      `,
      [req.user.id]
    )
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/channels', requireAuth, async (req, res) => {
  try {
    const { user_id } = req.body
    const existing = await pool.query(`
      SELECT c.* FROM channels c
      JOIN channel_members cm1 ON cm1.channel_id = c.id AND cm1.user_id = $1
      JOIN channel_members cm2 ON cm2.channel_id = c.id AND cm2.user_id = $2
      WHERE c.type = 'direct'
    `, [req.user.id, user_id])

    if (existing.rows.length > 0) {
      const row = existing.rows[0]
      // If user previously hid this dialog, unhide it for them.
      await ensureUserScopedTables()
      await pool.query(`DELETE FROM channel_hidden WHERE channel_id = $1 AND user_id = $2`, [row.id, req.user.id])
      const hasDeletedAt = await hasColumn('users', 'deleted_at')
      const hasAvatar = await hasColumn('users', 'avatar_url')
      const nameSql = hasDeletedAt ? `CASE WHEN deleted_at IS NOT NULL THEN 'Удаленный аккаунт' ELSE full_name END` : `full_name`
      const deletedSql = hasDeletedAt ? `COALESCE((deleted_at IS NOT NULL), false) as deleted` : `false as deleted`
      const avatarSql = hasAvatar
        ? (hasDeletedAt ? `CASE WHEN deleted_at IS NOT NULL THEN '' ELSE COALESCE(avatar_url, '') END as avatar_url` : `COALESCE(avatar_url, '') as avatar_url`)
        : `'' as avatar_url`
      const other = await pool.query(`SELECT ${nameSql} as name, ${deletedSql}, ${avatarSql} FROM users WHERE id = $1`, [user_id])
      return res.json({
        data: {
          ...row,
          name: other.rows[0]?.name || '',
          other_user_id: user_id,
          other_deleted: !!other.rows[0]?.deleted,
          other_avatar_url: other.rows[0]?.avatar_url || ''
        }
      })
    }

    const channel = await pool.query(
      `INSERT INTO channels (type, name) VALUES ('direct', '') RETURNING *`
    )
    const channelId = channel.rows[0].id

    await pool.query(
      `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [channelId, req.user.id, user_id]
    )

    await ensureUserScopedTables()
    await pool.query(`DELETE FROM channel_hidden WHERE channel_id = $1 AND user_id = $2`, [channelId, req.user.id])

    const hasDeletedAt = await hasColumn('users', 'deleted_at')
    const hasAvatar = await hasColumn('users', 'avatar_url')
    const nameSql = hasDeletedAt ? `CASE WHEN deleted_at IS NOT NULL THEN 'Удаленный аккаунт' ELSE full_name END` : `full_name`
    const deletedSql = hasDeletedAt ? `COALESCE((deleted_at IS NOT NULL), false) as deleted` : `false as deleted`
    const avatarSql = hasAvatar
      ? (hasDeletedAt ? `CASE WHEN deleted_at IS NOT NULL THEN '' ELSE COALESCE(avatar_url, '') END as avatar_url` : `COALESCE(avatar_url, '') as avatar_url`)
      : `'' as avatar_url`
    const other = await pool.query(`SELECT ${nameSql} as name, ${deletedSql}, ${avatarSql} FROM users WHERE id = $1`, [user_id])
    res.status(201).json({
      data: {
        ...channel.rows[0],
        name: other.rows[0]?.name || '',
        other_user_id: user_id,
        other_deleted: !!other.rows[0]?.deleted,
        other_avatar_url: other.rows[0]?.avatar_url || ''
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Удалить чат (кроме общего). Для direct: доступно только участникам.
router.delete('/channels/:id', requireAuth, async (req, res) => {
  try {
    const channelId = parseInt(req.params.id, 10)
    const actorUserId = parseInt(String(req.user.id), 10)
    const scope = String(req.body?.scope || req.query?.scope || 'all')
    if (!Number.isFinite(channelId) || !Number.isFinite(actorUserId)) {
      return res.status(400).json({ error: 'Некорректный запрос' })
    }

    if (scope === 'me') {
      // Hide dialog for current user only.
      await ensureUserScopedTables()
      const ok = await pool.query(
        `
        SELECT 1
        FROM channels c
        WHERE c.id = $1
          AND (c.type = 'general' OR EXISTS (
            SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = $2
          ))
        `,
        [channelId, actorUserId]
      )
      if (!ok.rows.length) return res.status(404).json({ error: 'Чат не найден' })
      await pool.query(
        `INSERT INTO channel_hidden (channel_id, user_id) VALUES ($1, $2) ON CONFLICT (channel_id, user_id) DO UPDATE SET hidden_at = NOW()`,
        [channelId, actorUserId]
      )
      return res.status(204).send()
    }

    const ch = await pool.query(
      `
      SELECT c.id, c.type
      FROM channels c
      WHERE c.id = $1
        AND c.type = 'direct'
        AND EXISTS (
          SELECT 1 FROM channel_members cm
          WHERE cm.channel_id = c.id AND cm.user_id = $2
        )
      `,
      [channelId, actorUserId]
    )

    if (ch.rows.length === 0) {
      return res.status(404).json({ error: 'Чат не найден' })
    }

    // Hard delete with explicit cleanup (works even if FK constraints were created without ON DELETE CASCADE).
    await pool.query('BEGIN')
    await pool.query('DELETE FROM messages WHERE channel_id = $1', [channelId])
    await pool.query('DELETE FROM channel_members WHERE channel_id = $1', [channelId])
    await pool.query(`DELETE FROM channels WHERE id = $1 AND type = 'direct'`, [channelId])
    await pool.query('COMMIT')
    res.status(204).send()
  } catch (err) {
    try {
      await pool.query('ROLLBACK')
    } catch {}
    res.status(500).json({ error: err.message })
  }
})

router.get('/channels/:id/messages', requireAuth, async (req, res) => {
  try {
    const channelId = parseInt(req.params.id, 10)
    const beforeId = req.query.before ? parseInt(String(req.query.before), 10) : null
    const actorUserId = parseInt(String(req.user.id), 10)
    const params = [channelId]
    const beforeSql = Number.isFinite(beforeId) ? 'AND m.id < $2' : ''
    if (Number.isFinite(beforeId)) params.push(beforeId)

    await ensureUserScopedTables()
    const actorIdx = params.length + 1
    const hasDeletedAt = await hasColumn('users', 'deleted_at')
    const hasAvatar = await hasColumn('users', 'avatar_url')
    const senderDeletedSql = hasDeletedAt ? `COALESCE((u.deleted_at IS NOT NULL), false)` : `false`
    const senderNameSql = hasDeletedAt
      ? `CASE WHEN u.deleted_at IS NOT NULL THEN 'Удаленный аккаунт' ELSE COALESCE(u.full_name, '') END`
      : `COALESCE(u.full_name, '')`
    const senderAvatarSql = hasAvatar
      ? (hasDeletedAt ? `CASE WHEN u.deleted_at IS NOT NULL THEN '' ELSE COALESCE(u.avatar_url, '') END` : `COALESCE(u.avatar_url, '')`)
      : `''`

    const result = await pool.query(
      `
      SELECT
        m.*,
        ${senderNameSql} as sender_name,
        ${senderDeletedSql} as sender_deleted,
        ${senderAvatarSql} as sender_avatar_url,
        EXISTS (
          SELECT 1 FROM message_pins mp
          WHERE mp.message_id = m.id AND mp.user_id = $${actorIdx}
        ) as my_pinned
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.channel_id = $1 AND m.is_deleted = false
        AND NOT EXISTS (
          SELECT 1 FROM message_hidden mh
          WHERE mh.message_id = m.id AND mh.user_id = $${actorIdx}
        )
      ${beforeSql}
      ORDER BY m.created_at DESC
      LIMIT 50
      `,
      [...params, actorUserId]
    )
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Редактировать сообщение: только автор или админ. Нельзя редактировать пересланные.
router.put('/messages/:id', requireAuth, async (req, res) => {
  const io = req.app.get('io')
  try {
    const messageId = parseInt(req.params.id, 10)
    const actorUserId = parseInt(String(req.user.id), 10)
    const { content } = req.body || {}
    const newContent = String(content ?? '').trim()

    if (!Number.isFinite(messageId) || !Number.isFinite(actorUserId)) {
      return res.status(400).json({ error: 'Некорректный запрос' })
    }
    if (!newContent) {
      return res.status(400).json({ error: 'Текст не должен быть пустым' })
    }

    const access = await pool.query(
      `
      SELECT m.id, m.channel_id, m.sender_id, m.content, c.type
      FROM messages m
      JOIN channels c ON c.id = m.channel_id
      WHERE m.id = $1 AND m.is_deleted = false AND (${canAccessChannelSql()})
      `,
      [messageId, actorUserId]
    )
    if (access.rows.length === 0) {
      return res.status(404).json({ error: 'Сообщение не найдено' })
    }

    const row = access.rows[0]
    const isAdmin = req.user.role === 'admin'
    if (!isAdmin && Number(row.sender_id) !== actorUserId) {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }
    if (String(row.content || '').trim().startsWith('↪')) {
      return res.status(400).json({ error: 'Пересланные сообщения нельзя редактировать' })
    }

    const updated = await pool.query(
      `
      UPDATE messages
      SET content = $2,
          edited_at = NOW(),
          edited_by = $3::int
      WHERE id = $1
      RETURNING *
      `,
      [messageId, newContent, actorUserId]
    )

    const out = updated.rows[0]
    io?.to(`channel:${out.channel_id}`).emit('message:edit', {
      id: out.id,
      channel_id: out.channel_id,
      content: out.content,
      edited_at: out.edited_at,
      edited_by: out.edited_by
    })

    res.json({ data: out })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Удалить сообщение (мягко): только автор сообщения или админ
router.delete('/messages/:id', requireAuth, async (req, res) => {
  const io = req.app.get('io')
  try {
    const messageId = parseInt(req.params.id, 10)
    const actorUserId = parseInt(String(req.user.id), 10)
    const scope = String(req.body?.scope || req.query?.scope || 'all')
    if (!Number.isFinite(messageId)) {
      return res.status(400).json({ error: 'Некорректный запрос' })
    }
    if (!Number.isFinite(actorUserId)) {
      return res.status(401).json({ error: 'Необходима авторизация' })
    }

    const access = await pool.query(
      `
      SELECT m.id, m.channel_id, m.sender_id, c.type
      FROM messages m
      JOIN channels c ON c.id = m.channel_id
      WHERE m.id = $1 AND (${canAccessChannelSql()})
      `,
      [messageId, actorUserId]
    )

    if (access.rows.length === 0) {
      return res.status(404).json({ error: 'Сообщение не найдено' })
    }

    const row = access.rows[0]
    const isAdmin = req.user.role === 'admin'
    if (!isAdmin && Number(row.sender_id) !== actorUserId) {
      return res.status(403).json({ error: 'Недостаточно прав' })
    }

    // Delete for me: hide only for current user (keep message for others)
    if (scope === 'me') {
      await ensureUserScopedTables()
      await pool.query(
        `INSERT INTO message_hidden (message_id, user_id) VALUES ($1, $2)
         ON CONFLICT (message_id, user_id) DO UPDATE SET hidden_at = NOW()`,
        [messageId, actorUserId]
      )
      return res.status(200).json({ data: { id: messageId, channel_id: row.channel_id, scope: 'me' } })
    }

    const updated = await pool.query(
      `
      UPDATE messages
      SET
        is_deleted = true,
        is_pinned = false,
        pinned_at = NULL,
        pinned_by = NULL
      WHERE id = $1
      RETURNING id, channel_id
      `,
      [messageId]
    )

    const out = updated.rows[0]
    io?.to(`channel:${out.channel_id}`).emit('message:delete', { id: out.id, channel_id: out.channel_id })
    res.status(200).json({ data: out })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Закрепить / открепить сообщение
router.post('/messages/:id/pin', requireAuth, async (req, res) => {
  const io = req.app.get('io')
  try {
    const messageId = parseInt(req.params.id, 10)
    const { pinned } = req.body || {}
    const scope = String(req.body?.scope || 'all')
    const shouldPin = !!pinned
    const actorUserId = parseInt(String(req.user.id), 10)
    if (!Number.isFinite(messageId)) {
      return res.status(400).json({ error: 'Некорректный запрос' })
    }
    if (!Number.isFinite(actorUserId)) {
      return res.status(401).json({ error: 'Необходима авторизация' })
    }

    // Check access: message's channel must be available to current user.
    const access = await pool.query(
      `
      SELECT m.id, m.channel_id, c.type
      FROM messages m
      JOIN channels c ON c.id = m.channel_id
      WHERE m.id = $1 AND (${canAccessChannelSql()})
      `,
      [messageId, req.user.id]
    )

    if (access.rows.length === 0) {
      return res.status(404).json({ error: 'Сообщение не найдено' })
    }

    const channelId = access.rows[0].channel_id
    const channelType = access.rows[0].type
    if (channelType === 'general' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Закреплять в общем чате может только админ' })
    }

    // Pin for me: store in message_pins (visible only to current user)
    if (scope === 'me') {
      await ensureUserScopedTables()
      if (shouldPin) {
        await pool.query(
          `INSERT INTO message_pins (message_id, user_id) VALUES ($1, $2)
           ON CONFLICT (message_id, user_id) DO UPDATE SET pinned_at = NOW()`,
          [messageId, actorUserId]
        )
      } else {
        await pool.query(`DELETE FROM message_pins WHERE message_id = $1 AND user_id = $2`, [messageId, actorUserId])
      }
      return res.json({ data: { id: messageId, channel_id: channelId, my_pinned: shouldPin, scope: 'me' } })
    }

    const updated = await pool.query(
      `
      UPDATE messages
      SET
        is_pinned = $2,
        pinned_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
        pinned_by = CASE WHEN $2 THEN $3::int ELSE NULL END
      WHERE id = $1
      RETURNING *
      `,
      [messageId, shouldPin, actorUserId]
    )

    const row = updated.rows[0]
    io?.to(`channel:${channelId}`).emit('message:pin', {
      id: row.id,
      channel_id: row.channel_id,
      is_pinned: row.is_pinned,
      pinned_at: row.pinned_at,
      pinned_by: row.pinned_by
    })

    res.json({ data: row })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/channels/:id/read', requireAuth, async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO channel_members (channel_id, user_id, last_read_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (channel_id, user_id) 
      DO UPDATE SET last_read_at = NOW()
    `, [req.params.id, req.user.id])
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/users', requireAuth, async (req, res) => {
  try {
    const { search } = req.query
    const result = await pool.query(`
      SELECT id, full_name FROM users
      WHERE full_name ILIKE $1 AND id != $2
      ORDER BY full_name
      LIMIT 50
    `, [`%${search || ''}%`, req.user.id])
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Global search like messenger: users first, then message contents
router.get('/search', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim()
    if (!q) return res.json({ data: { users: [], messages: [] } })

    const like = `%${q}%`

    const usersRes = await pool.query(
      `
      SELECT id, full_name
      FROM users
      WHERE id <> $2 AND full_name ILIKE $1
      ORDER BY full_name
      LIMIT 20
      `,
      [like, req.user.id]
    )

    const msgRes = await pool.query(
      `
      SELECT
        m.id,
        m.channel_id,
        m.content,
        m.created_at,
        u.full_name as sender_name,
        CASE
          WHEN c.type = 'direct' THEN COALESCE(
            (
              SELECT u2.full_name
              FROM channel_members cm
              JOIN users u2 ON u2.id = cm.user_id
              WHERE cm.channel_id = c.id AND cm.user_id <> $2
              LIMIT 1
            ),
            ''
          )
          ELSE COALESCE(c.name, '')
        END AS channel_name
      FROM messages m
      JOIN channels c ON c.id = m.channel_id
      JOIN users u ON u.id = m.sender_id
      WHERE m.is_deleted = false
        AND m.content ILIKE $1
        AND (${canAccessChannelSql()})
      ORDER BY m.created_at DESC
      LIMIT 20
      `,
      [like, req.user.id]
    )

    res.json({ data: { users: usersRes.rows, messages: msgRes.rows } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router