const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const pool = require('../db/pool')
const { requireAuth } = require('../middleware/auth')

const { config } = require('../config')

async function adminExists() {
  const result = await pool.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`)
  return result.rows.length > 0
}

router.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body

    const result = await pool.query(
      'SELECT * FROM users WHERE login = $1',
      [login]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Неверный логин или пароль' })
    }

    const user = result.rows[0]
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