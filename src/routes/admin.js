const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const pool = require('../db/pool')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const router = express.Router()

router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, login, role, created_at
       FROM users
       ORDER BY created_at DESC, id DESC`
    )
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { full_name, login, password, role } = req.body

    if (!full_name || !login || !password) {
      return res.status(400).json({ error: 'Заполните все поля' })
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' })
    }

    const userRole = role === 'admin' ? 'admin' : 'user'
    const password_hash = await bcrypt.hash(password, 10)

    const created = await pool.query(
      `INSERT INTO users (full_name, login, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, role`,
      [full_name, login, password_hash, userRole]
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
    const { full_name, login, role } = req.body
    if (!full_name || !login) {
      return res.status(400).json({ error: 'Заполните имя и логин' })
    }

    const userRole = role === 'admin' ? 'admin' : 'user'
    const temp_password = generateTempPassword()
    const password_hash = await bcrypt.hash(temp_password, 10)

    const created = await pool.query(
      `INSERT INTO users (full_name, login, password_hash, role, must_change_password)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, full_name, role`,
      [full_name, login, password_hash, userRole]
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

    const created = await pool.query(
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
    const result = await pool.query(
      `SELECT id, full_name, login, role, expires_at, used_at, created_at
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
      [password_hash, req.params.id]
    )

    if (updated.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
