const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const pool = require('../db/pool')
const { config } = require('../config')

const router = express.Router()

async function adminExists() {
  const result = await pool.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`)
  return result.rows.length > 0
}

router.get('/status', async (req, res) => {
  try {
    const exists = await adminExists()
    res.json({ needs_setup: !exists })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/create-admin', async (req, res) => {
  try {
    if (await adminExists()) {
      return res.status(409).json({ error: 'Сетап уже выполнен: администратор существует' })
    }

    const { full_name, login, password } = req.body

    if (!full_name || !login || !password) {
      return res.status(400).json({ error: 'Заполните все поля' })
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' })
    }

    const password_hash = await bcrypt.hash(password, 10)

    const created = await pool.query(
      `INSERT INTO users (full_name, login, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       RETURNING id, full_name, role, login`,
      [full_name, login, password_hash]
    )

    const user = created.rows[0]
    const token = jwt.sign(
      { id: user.id, login: user.login, role: user.role },
      config.jwtSecret,
      { expiresIn: '7d' }
    )

    res.status(201).json({
      token,
      user: { id: user.id, full_name: user.full_name, role: user.role }
    })
  } catch (err) {
    // Likely duplicate login
    if (err && err.code === '23505') {
      return res.status(400).json({ error: 'Пользователь с таким логином уже существует' })
    }
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
