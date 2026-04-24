const express = require('express')
const router = express.Router()
const pool = require('../db/pool')
const { requireAuth } = require('../middleware/auth')

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
    const result = await pool.query(
      `
      SELECT
        c.id,
        c.type,
        c.created_at,
        CASE
          WHEN c.type = 'direct' THEN COALESCE(
            (
              SELECT u.full_name
              FROM channel_members cm
              JOIN users u ON u.id = cm.user_id
              WHERE cm.channel_id = c.id AND cm.user_id <> $1
              LIMIT 1
            ),
            ''
          )
          ELSE COALESCE(c.name, '')
        END AS name,
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
      ORDER BY c.created_at
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
      const other = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [user_id])
      return res.json({ data: { ...row, name: other.rows[0]?.full_name || '' } })
    }

    const channel = await pool.query(
      `INSERT INTO channels (type, name) VALUES ('direct', '') RETURNING *`
    )
    const channelId = channel.rows[0].id

    await pool.query(
      `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [channelId, req.user.id, user_id]
    )

    const other = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [user_id])
    res.status(201).json({ data: { ...channel.rows[0], name: other.rows[0]?.full_name || '' } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Удалить чат (кроме общего). Для direct: доступно только участникам.
router.delete('/channels/:id', requireAuth, async (req, res) => {
  try {
    const channelId = parseInt(req.params.id, 10)
    const actorUserId = parseInt(String(req.user.id), 10)
    if (!Number.isFinite(channelId) || !Number.isFinite(actorUserId)) {
      return res.status(400).json({ error: 'Некорректный запрос' })
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
    const result = await pool.query(`
      SELECT m.*, u.full_name as sender_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.channel_id = $1 AND m.is_deleted = false
      ORDER BY m.created_at ASC
      LIMIT 50
    `, [req.params.id])
    res.json({ data: result.rows })
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
    const shouldPin = !!pinned
    const actorUserId = parseInt(String(req.user.id), 10)
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

module.exports = router