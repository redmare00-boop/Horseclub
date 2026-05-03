const express = require('express')
const crypto = require('crypto')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const pool = require('../db/pool')
const { requireAuth } = require('../middleware/auth')

const { config } = require('../config')

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex')
}

function publicBaseUrl(req) {
  const fixed = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '')
  if (fixed) return fixed
  const xfProto = req.get('x-forwarded-proto')
  const xfHost = req.get('x-forwarded-host')
  const host = xfHost || req.get('host')
  const proto = xfProto || (req.secure ? 'https' : 'http')
  if (host) return `${proto}://${host}`
  return ''
}

async function sendPasswordResetEmail(to, resetUrl) {
  const host = String(process.env.SMTP_HOST || '').trim()
  if (!host) return false
  const nodemailer = require('nodemailer')
  const port = Number(process.env.SMTP_PORT || 587)
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true'
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS || ''
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined
  })
  const from = process.env.MAIL_FROM || user || 'noreply@localhost'
  await transporter.sendMail({
    from,
    to,
    subject: 'Восстановление пароля — Horseclub',
    text:
      `Перейдите по ссылке, чтобы задать новый пароль (действует 1 час):\n${resetUrl}\n\nЕсли вы не запрашивали сброс, проигнорируйте письмо.`,
    html: `<p>Перейдите по ссылке, чтобы задать новый пароль (действует 1 час):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Если вы не запрашивали сброс, проигнорируйте письмо.</p>`
  })
  return true
}

async function adminExists() {
  const result = await pool.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`)
  return result.rows.length > 0
}

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body
    const loginNorm = String(login ?? '').trim()

    const result = await pool.query(
      `
      SELECT * FROM users
      WHERE lower(btrim(login)) = lower(btrim($1::text))
      LIMIT 2
      `,
      [loginNorm]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Неверный логин или пароль' })
    }
    if (result.rows.length > 1) {
      return res.status(400).json({
        error: 'Найдено несколько логинов, отличающихся регистром. Обратитесь к администратору.'
      })
    }

    const user = result.rows[0]

    if (user.archived_at != null) {
      return res.status(401).json({ error: 'Аккаунт в архиве. Обратитесь к администратору.' })
    }
    if (user.deleted_at != null) {
      return res.status(401).json({ error: 'Аккаунт недоступен.' })
    }

    const valid = await bcrypt.compare(password, user.password_hash)

    if (!valid) {
      return res.status(401).json({ error: 'Неверный логин или пароль' })
    }

    const token = jwt.sign(
      { id: user.id, login: user.login, role: user.role },
      config.jwtSecret,
      { expiresIn: '7d' }
    )

    res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        role: user.role,
        must_change_password: user.must_change_password
      }
    })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { old_password, new_password } = req.body

    if (!new_password) {
      return res.status(400).json({ error: 'Введите новый пароль' })
    }
    if (String(new_password).length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' })
    }

    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' })
    }

    const user = result.rows[0]
    const hasOld = typeof old_password === 'string' && old_password.length > 0

    if (!user.must_change_password) {
      if (!hasOld) {
        return res.status(400).json({ error: 'Введите текущий пароль' })
      }
      const validOld = await bcrypt.compare(old_password, user.password_hash)
      if (!validOld) {
        return res.status(401).json({ error: 'Текущий пароль неверный' })
      }
    }

    const password_hash = await bcrypt.hash(new_password, 10)
    await pool.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = false
       WHERE id = $2`,
      [password_hash, req.user.id]
    )

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/forgot-password', async (req, res) => {
  try {
    const login = String(req.body?.login ?? '').trim()
    const generic = { ok: true }
    if (!login) {
      return res.json(generic)
    }

    const result = await pool.query(
      `
      SELECT * FROM users
      WHERE lower(btrim(login)) = lower(btrim($1::text))
      LIMIT 1
      `,
      [login]
    )
    if (result.rows.length === 0) {
      return res.json(generic)
    }

    const user = result.rows[0]
    if (user.archived_at != null || user.deleted_at != null) {
      return res.json(generic)
    }

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = sha256Hex(rawToken)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

    await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [user.id])
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    )

    const base = publicBaseUrl(req)
    const resetUrl = base ? `${base}/password-reset.html?token=${encodeURIComponent(rawToken)}` : ''

    const email = String(user.email || '').trim()
    const smtpReady = !!String(process.env.SMTP_HOST || '').trim()

    if (smtpReady && email && resetUrl) {
      try {
        await sendPasswordResetEmail(email, resetUrl)
        return res.json({ ok: true, mail_sent: true })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[forgot-password] SMTP failed:', e?.message || e)
        return res.json({ ok: true, mail_sent: false, mail_error: true })
      }
    }

    if (smtpReady && email && !resetUrl) {
      return res.json({
        ok: true,
        mail_sent: false,
        config_error: true
      })
    }

    return res.json({ ok: true, mail_sent: false })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[forgot-password]', err?.message || err)
    if (String(err.message || '').includes('password_reset_tokens')) {
      return res.status(503).json({
        error:
          'Таблица сброса пароля не создана. Запустите npm run db:schema на сервере или обновите базу.'
      })
    }
    const msg = String(err.message || '')
    if (msg.includes('password authentication failed') || err.code === '28P01') {
      return res.status(503).json({
        error:
          'Сервер не подключился к базе данных (часто неверный пароль или строка DATABASE_URL в .env / Railway). Это настройка сервера, а не ваш пароль от аккаунта.'
      })
    }
    res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Временная ошибка сервера. Попробуйте позже.'
          : msg || 'Ошибка сервера'
    })
  }
})

router.post('/complete-password-reset', async (req, res) => {
  try {
    const rawToken = String(req.body?.token ?? '').trim()
    const new_password = req.body?.new_password
    if (!rawToken) {
      return res.status(400).json({ error: 'Нет токена сброса' })
    }
    if (!new_password || String(new_password).length < 6) {
      return res.status(400).json({ error: 'Новый пароль не менее 6 символов' })
    }

    const tokenHash = sha256Hex(rawToken)
    const found = await pool.query(
      `SELECT user_id, expires_at FROM password_reset_tokens WHERE token_hash = $1`,
      [tokenHash]
    )
    if (found.rows.length === 0) {
      return res.status(400).json({ error: 'Ссылка недействительна или уже использована' })
    }
    const { user_id: userId, expires_at: expiresAt } = found.rows[0]
    if (new Date(expiresAt) < new Date()) {
      await pool.query(`DELETE FROM password_reset_tokens WHERE token_hash = $1`, [tokenHash])
      return res.status(400).json({ error: 'Срок действия ссылки истёк. Запросите сброс снова.' })
    }

    const hash = await bcrypt.hash(String(new_password), 10)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2`,
        [hash, userId]
      )
      await client.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId])
      await client.query('COMMIT')
    } catch (e) {
      try {
        await client.query('ROLLBACK')
      } catch {}
      throw e
    } finally {
      client.release()
    }

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/register', async (req, res) => {
  try {
    const allowPublicRegister = String(process.env.ALLOW_PUBLIC_REGISTER || '').toLowerCase() === 'true'
    if (!allowPublicRegister && (await adminExists())) {
      return res.status(403).json({
        error: 'Регистрация закрыта. Попросите администратора создать вам аккаунт.'
      })
    }

    const { full_name, login, password } = req.body

    const exists = await pool.query(
      'SELECT id FROM users WHERE login = $1',
      [login]
    )

    if (exists.rows.length > 0) {
      return res.status(400).json({ error: 'Пользователь с таким логином уже существует' })
    }

    const password_hash = await bcrypt.hash(password, 10)

    const result = await pool.query(
      'INSERT INTO users (full_name, login, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name, role, must_change_password',
      [full_name, login, password_hash]
    )

    res.status(201).json({ user: result.rows[0] })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router