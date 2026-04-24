const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const pool = require('../db/pool')

const router = express.Router()

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

router.get('/:token', async (req, res) => {
  try {
    const token = req.params.token
    const tokenHash = hashToken(token)

    const result = await pool.query(
      `SELECT id, full_name, login, role, expires_at, used_at
       FROM invites
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Приглашение не найдено' })
    }

    const invite = result.rows[0]
    if (invite.used_at) {
      return res.status(410).json({ error: 'Приглашение уже использовано' })
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'Срок приглашения истёк' })
    }

    res.json({
      data: {
        full_name: invite.full_name,
        login: invite.login,
        role: invite.role,
        expires_at: invite.expires_at
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/:token/accept', async (req, res) => {
  try {
    const token = req.params.token
    const { password } = req.body
    if (!password) {
      return res.status(400).json({ error: 'Введите пароль' })
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' })
    }

    const tokenHash = hashToken(token)

    await pool.query('BEGIN')

    const locked = await pool.query(
      `SELECT id, full_name, login, role, expires_at, used_at
       FROM invites
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    )

    if (locked.rows.length === 0) {
      await pool.query('ROLLBACK')
      return res.status(404).json({ error: 'Приглашение не найдено' })
    }

    const invite = locked.rows[0]
    if (invite.used_at) {
      await pool.query('ROLLBACK')
      return res.status(410).json({ error: 'Приглашение уже использовано' })
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await pool.query('ROLLBACK')
      return res.status(410).json({ error: 'Срок приглашения истёк' })
    }

    const password_hash = await bcrypt.hash(password, 10)

    try {
      const created = await pool.query(
        `INSERT INTO users (full_name, login, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4, false)
         RETURNING id`,
        [invite.full_name, invite.login, password_hash, invite.role]
      )

      await pool.query(
        `UPDATE invites SET used_at = NOW() WHERE id = $1`,
        [invite.id]
      )

      await pool.query('COMMIT')
      res.status(201).json({ success: true, user_id: created.rows[0].id })
    } catch (err) {
      await pool.query('ROLLBACK')
      if (err && err.code === '23505') {
        return res.status(400).json({ error: 'Логин уже занят. Попросите админа создать новое приглашение.' })
      }
      throw err
    }
  } catch (err) {
    try {
      await pool.query('ROLLBACK')
    } catch (_) {}
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
