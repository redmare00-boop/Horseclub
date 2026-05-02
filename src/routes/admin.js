const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const pool = require('../db/pool')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const router = express.Router()

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

async function ensureClubTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS club (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Конный клуб',
      logo_url TEXT,
      address TEXT,
      coords TEXT,
      mercury_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE club ADD COLUMN IF NOT EXISTS logo_url TEXT`)
  await pool.query(`ALTER TABLE club ADD COLUMN IF NOT EXISTS address TEXT`)
  await pool.query(`ALTER TABLE club ADD COLUMN IF NOT EXISTS coords TEXT`)
  await pool.query(`ALTER TABLE club ADD COLUMN IF NOT EXISTS mercury_id TEXT`)
  await pool.query(`ALTER TABLE club ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)
  await pool.query(`INSERT INTO club (id, name) VALUES (1, 'Конный клуб') ON CONFLICT (id) DO NOTHING`)
}

router.get('/club', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureClubTable()
    const r = await pool.query(
      `SELECT id, name, COALESCE(logo_url,'') as logo_url, COALESCE(address,'') as address,
              COALESCE(coords,'') as coords, COALESCE(mercury_id,'') as mercury_id
       FROM club
       WHERE id = 1`
    )
    res.json({ data: r.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/club', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureClubTable()
    const name = String(req.body?.name || '').trim() || 'Конный клуб'
    const logo_url = String(req.body?.logo_url || '').trim() || null
    const address = String(req.body?.address || '').trim() || null
    const coords = String(req.body?.coords || '').trim() || null
    const mercury_id = String(req.body?.mercury_id || '').trim() || null

    const r = await pool.query(
      `
      UPDATE club
      SET name = $1,
          logo_url = $2,
          address = $3,
          coords = $4,
          mercury_id = $5,
          updated_at = NOW()
      WHERE id = 1
      RETURNING id, name, COALESCE(logo_url,'') as logo_url, COALESCE(address,'') as address,
                COALESCE(coords,'') as coords, COALESCE(mercury_id,'') as mercury_id
      `,
      [name, logo_url, address, coords, mercury_id]
    )
    res.json({ data: r.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const hasNickname = await hasColumn('users', 'nickname')
    const hasAvatar = await hasColumn('users', 'avatar_url')
    const hasStatus = await hasColumn('users', 'status')
    // Ensure archive support exists even on older DBs.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`)
    columnCache.set('users.archived_at', true)
    const hasArchivedAt = true
    const hasOwnerUserId = await hasColumn('horses', 'owner_user_id')

    const nicknameSql = hasNickname ? `COALESCE(NULLIF(btrim(u.nickname), ''), u.login)` : `u.login`
    const avatarSql = hasAvatar ? `COALESCE(u.avatar_url, '')` : `''`
    const statusSql = hasStatus ? `COALESCE(u.status, '')` : `''`
    const archivedSql = hasArchivedAt ? `COALESCE((u.archived_at IS NOT NULL), false)` : `false`

    const scope = String(req.query.scope || 'active').toLowerCase()
    const whereSql =
      !hasArchivedAt || scope === 'all'
        ? ''
        : (scope === 'archived' ? 'WHERE u.archived_at IS NOT NULL' : 'WHERE u.archived_at IS NULL')

    const horsesWhere = hasOwnerUserId
      ? `
          h.owner_user_id = u.id
          OR (
            h.owner_user_id IS NULL
            AND COALESCE(NULLIF(btrim(h.owner), ''), '') <> ''
            AND h.owner ILIKE u.full_name
          )
        `
      : `
          COALESCE(NULLIF(btrim(h.owner), ''), '') <> ''
          AND h.owner ILIKE u.full_name
        `

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.login,
        u.role,
        ${nicknameSql} as nickname,
        ${avatarSql} as avatar_url,
        ${statusSql} as status,
        ${archivedSql} as archived,
        ${hasArchivedAt ? 'u.archived_at' : 'NULL::timestamptz'} as archived_at,
        u.created_at,
        COALESCE(
          (
            SELECT json_agg(h.name ORDER BY h.name)
            FROM horses h
            WHERE ${horsesWhere}
          ),
          '[]'::json
        ) as horses
      FROM users u
      ${whereSql}
      ORDER BY ${hasArchivedAt ? '(u.archived_at IS NOT NULL) ASC,' : ''} u.created_at DESC, u.id DESC
      `
    )
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { full_name, login, password, role, nickname, avatar_url, status, phone } = req.body

    if (!full_name || !login || !password) {
      return res.status(400).json({ error: 'Заполните все поля' })
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' })
    }

    const userRole = role === 'admin' ? 'admin' : 'user'
    const password_hash = await bcrypt.hash(password, 10)

    const created = await pool.query(
      `INSERT INTO users (full_name, login, password_hash, role, nickname, avatar_url, status, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, full_name, role`,
      [
        full_name,
        login,
        password_hash,
        userRole,
        (String(nickname ?? '').trim() || login),
        String(avatar_url ?? '').trim() || null,
        String(status ?? '').trim() || null,
        String(phone ?? '').trim() || null
      ]
    )

    res.status(201).json({ user: created.rows[0] })
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(400).json({ error: 'Пользователь с таким логином уже существует' })
    }
    res.status(500).json({ error: err.message })
  }
})

function generateTempPassword() {
  // Friendly for manual typing, still random enough for temporary use.
  const raw = crypto.randomBytes(6).toString('base64url') // ~8 chars
  return raw.replaceAll('-', 'A').replaceAll('_', 'B')
}

router.post('/users/invite', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { full_name, login, role, nickname, avatar_url, status, phone } = req.body
    if (!full_name || !login) {
      return res.status(400).json({ error: 'Заполните имя и логин' })
    }

    const userRole = role === 'admin' ? 'admin' : 'user'
    const temp_password = generateTempPassword()
    const password_hash = await bcrypt.hash(temp_password, 10)

    const created = await pool.query(
      `INSERT INTO users (full_name, login, password_hash, role, must_change_password, nickname, avatar_url, status, phone)
       VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8)
       RETURNING id, full_name, role`,
      [
        full_name,
        login,
        password_hash,
        userRole,
        (String(nickname ?? '').trim() || login),
        String(avatar_url ?? '').trim() || null,
        String(status ?? '').trim() || null,
        String(phone ?? '').trim() || null
      ]
    )

    res.status(201).json({ user: created.rows[0], temp_password })
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(400).json({ error: 'Пользователь с таким логином уже существует' })
    }
    res.status(500).json({ error: err.message })
  }
})

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

router.post('/invites', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { full_name, login, role } = req.body
    if (!full_name || !login) {
      return res.status(400).json({ error: 'Заполните имя и логин' })
    }

    const userRole = role === 'admin' ? 'admin' : 'user'
    const token = crypto.randomBytes(24).toString('base64url')
    const token_hash = hashToken(token)

    const hours = Number(process.env.INVITE_TTL_HOURS || 72)
    const ttlHours = Number.isFinite(hours) && hours > 0 ? hours : 72

    let hasInviteToken = await hasColumn('invites', 'token')
    if (!hasInviteToken) {
      // Auto-migrate: allow admins to re-copy links later.
      await pool.query(`ALTER TABLE invites ADD COLUMN IF NOT EXISTS token TEXT`)
      // update cache
      columnCache.set('invites.token', true)
      hasInviteToken = true
    }
    const created = hasInviteToken
      ? await pool.query(
        `INSERT INTO invites (token, token_hash, full_name, login, role, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' hours')::interval)
         RETURNING id, expires_at`,
        [token, token_hash, full_name, login, userRole, req.user.id, String(ttlHours)]
      )
      : await pool.query(
        `INSERT INTO invites (token_hash, full_name, login, role, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::interval)
         RETURNING id, expires_at`,
        [token_hash, full_name, login, userRole, req.user.id, String(ttlHours)]
      )

    // Build absolute link (best effort). For local dev it will be correct.
    const host = req.get('host')
    const invite_url = `${req.protocol}://${host}/invite.html?token=${token}`

    res.status(201).json({
      data: {
        id: created.rows[0].id,
        invite_url,
        token: hasInviteToken ? token : '',
        expires_at: created.rows[0].expires_at
      }
    })
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(400).json({ error: 'Приглашение с таким токеном уже существует. Повторите попытку.' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.get('/invites', requireAuth, requireAdmin, async (req, res) => {
  try {
    let hasInviteToken = await hasColumn('invites', 'token')
    if (!hasInviteToken) {
      await pool.query(`ALTER TABLE invites ADD COLUMN IF NOT EXISTS token TEXT`)
      columnCache.set('invites.token', true)
      hasInviteToken = true
    }
    const tokenSql = hasInviteToken ? `COALESCE(token, '') as token` : `'' as token`
    const result = await pool.query(
      `SELECT id, full_name, login, role, expires_at, used_at, created_at, ${tokenSql}
       FROM invites
       ORDER BY created_at DESC, id DESC
       LIMIT 200`
    )
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/invites/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id
    const deleted = await pool.query(
      `DELETE FROM invites
       WHERE id = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING id`,
      [id]
    )
    if (deleted.rows.length === 0) {
      return res.status(404).json({ error: 'Инвайт не найден или уже использован/истёк' })
    }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10)
    const actorId = parseInt(String(req.user.id), 10)
    if (Number.isFinite(targetId) && Number.isFinite(actorId) && targetId === actorId) {
      return res.status(400).json({
        error: 'Свой пароль меняйте в профиле: «Сменить пароль» (нужен текущий пароль).'
      })
    }

    const { password } = req.body
    if (!password) {
      return res.status(400).json({ error: 'Введите новый пароль' })
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' })
    }

    const password_hash = await bcrypt.hash(password, 10)

    const updated = await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2 RETURNING id`,
      [password_hash, targetId]
    )

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Archive user (admin only). For safety: can't archive yourself.
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10)
    const actorId = parseInt(String(req.user.id), 10)
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Некорректный запрос' })
    if (Number.isFinite(actorId) && userId === actorId) {
      return res.status(400).json({ error: 'Нельзя удалить свой профиль' })
    }

    const exists = await pool.query(`SELECT id FROM users WHERE id = $1`, [userId])
    if (!exists.rows.length) return res.status(404).json({ error: 'Пользователь не найден' })

    // Keep profile fields so admins can contact former club members.
    // Disable further logins by rotating password hash.
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`)
    columnCache.set('users.archived_at', true)
    // Ensure horse ownership column exists on older DBs so we can delete horses.
    await pool.query(`ALTER TABLE horses ADD COLUMN IF NOT EXISTS owner_user_id INTEGER`)

    await pool.query('BEGIN')
    // optional cleanup: remove invites created for this login that are still unused
    await pool.query(`DELETE FROM invites WHERE login = (SELECT login FROM users WHERE id = $1) AND used_at IS NULL`, [userId])
    // Delete user's horses (and medical records via ON DELETE CASCADE).
    await pool.query(`DELETE FROM horses WHERE owner_user_id = $1`, [userId])
    const randomPw = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 10)
    await pool.query(
      `
      UPDATE users
      SET
        archived_at = COALESCE(archived_at, NOW()),
        password_hash = $2,
        must_change_password = false
      WHERE id = $1
      `,
      [userId, randomPw]
    )
    await pool.query('COMMIT')
    res.status(204).send()
  } catch (err) {
    try { await pool.query('ROLLBACK') } catch {}
    res.status(500).json({ error: err.message })
  }
})

// Restore archived user (admin only).
router.post('/users/:id/unarchive', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10)
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Некорректный запрос' })
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`)
    columnCache.set('users.archived_at', true)
    const r = await pool.query(`UPDATE users SET archived_at = NULL WHERE id = $1 RETURNING id`, [userId])
    if (!r.rows.length) return res.status(404).json({ error: 'Пользователь не найден' })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
