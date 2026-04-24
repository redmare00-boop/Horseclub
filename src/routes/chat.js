const express = require('express')
const router = express.Router()
const pool = require('../db/pool')
const { requireAuth } = require('../middleware/auth')

router.get('/channels', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, 
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
      OR c.id IN (
        SELECT channel_id FROM channel_members WHERE user_id = $1
      )
      ORDER BY c.created_at
    `, [req.user.id])
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
      return res.json({ data: existing.rows[0] })
    }

    const channel = await pool.query(
      `INSERT INTO channels (type, name) VALUES ('direct', '') RETURNING *`
    )
    const channelId = channel.rows[0].id

    await pool.query(
      `INSERT INTO channel_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [channelId, req.user.id, user_id]
    )

    res.status(201).json({ data: channel.rows[0] })
  } catch (err) {
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
    `, [`%${search || ''}%`, req.user.id])
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router