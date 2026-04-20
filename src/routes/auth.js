const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const pool = require('../db/pool')

const SECRET = 'horseclub_secret_key'

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
      SECRET,
      { expiresIn: '7d' }
    )

    res.json({
      token,
      user: { id: user.id, full_name: user.full_name, role: user.role }
    })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/register', async (req, res) => {
  try {
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
      'INSERT INTO users (full_name, login, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name, role',
      [full_name, login, password_hash]
    )

    res.status(201).json({ user: result.rows[0] })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router