const express = require('express')
const router = express.Router()
const pool = require('../db/pool')
const { requireAuth } = require('../middleware/auth')

router.get('/', async (req, res) => {
  try {
    const { date } = req.query
    const result = await pool.query(
      'SELECT * FROM bookings WHERE booking_date = $1 ORDER BY start_time',
      [date]
    )
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', requireAuth, async (req, res) => {
  try {
    const { horse_name, venue, discipline, booking_date, start_time, end_time } = req.body

    if (venue === 'Манеж') {
      const check = await pool.query(
        `SELECT COUNT(*) FROM bookings 
         WHERE venue = 'Манеж' 
         AND booking_date = $1
         AND (start_time, end_time) OVERLAPS ($2::time, $3::time)`,
        [booking_date, start_time, end_time]
      )
      if (parseInt(check.rows[0].count) >= 3) {
        return res.status(409).json({ error: 'Вы уже записали 3 лошади в манеж на это время' })
      }
    }

    const result = await pool.query(
      `INSERT INTO bookings (horse_name, venue, discipline, booking_date, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [horse_name, venue, discipline, booking_date, start_time, end_time]
    )
    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM bookings WHERE id = $1', [req.params.id])
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router