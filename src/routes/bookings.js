const express = require('express')
const router = express.Router()
const pool = require('../db/pool')
const { requireAuth } = require('../middleware/auth')

const bookingSelect = `
  SELECT b.*,
         u.full_name AS user_name,
         COALESCE(v.name, b.venue) AS venue_name
  FROM bookings b
  LEFT JOIN users u ON u.id = b.user_id
  LEFT JOIN venues v ON v.id = b.venue_id
`

async function resolveActiveVenue({ venue_id, venue }) {
  if (venue_id != null && venue_id !== '') {
    const id = parseInt(venue_id, 10)
    if (!Number.isFinite(id)) return null
    const r = await pool.query('SELECT * FROM venues WHERE id = $1 AND is_active = true', [id])
    return r.rows[0] || null
  }
  if (venue && String(venue).trim()) {
    const r = await pool.query('SELECT * FROM venues WHERE name = $1 AND is_active = true', [String(venue).trim()])
    return r.rows[0] || null
  }
  return null
}

router.get('/', async (req, res) => {
  try {
    const { date, venue, venue_id } = req.query
    if (!date) return res.status(400).json({ error: 'date is required' })

    let result
    if (venue_id != null && venue_id !== '') {
      const id = parseInt(venue_id, 10)
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid venue_id' })
      result = await pool.query(
        `${bookingSelect} WHERE b.booking_date = $1 AND b.venue_id = $2 ORDER BY b.start_time`,
        [date, id]
      )
    } else if (venue) {
      result = await pool.query(
        `${bookingSelect}
         WHERE b.booking_date = $1
           AND (b.venue = $2 OR b.venue_id = (SELECT id FROM venues WHERE name = $2 LIMIT 1))
         ORDER BY b.start_time`,
        [date, venue]
      )
    } else {
      result = await pool.query(
        `${bookingSelect} WHERE b.booking_date = $1 ORDER BY b.start_time`,
        [date]
      )
    }
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', requireAuth, async (req, res) => {
  try {
    const { horse_name, venue, venue_id, discipline, booking_date, start_time, end_time } = req.body
    if (!horse_name || !discipline || !booking_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'Заполните все поля' })
    }

    const v = await resolveActiveVenue({ venue_id, venue })
    if (!v) {
      return res.status(400).json({ error: 'Укажите площадку (venue_id) или существующую площадку' })
    }

    if (v.max_total_per_slot != null) {
      const check = await pool.query(
        `SELECT COUNT(*)::int AS c FROM bookings
         WHERE venue_id = $1
           AND booking_date = $2
           AND (start_time, end_time) OVERLAPS ($3::time, $4::time)`,
        [v.id, booking_date, start_time, end_time]
      )
      if (check.rows[0].c >= v.max_total_per_slot) {
        return res.status(409).json({
          error: `На площадке «${v.name}» на это время достигнут лимит записей`
        })
      }
    }

    if (v.max_per_user_per_slot != null) {
      const check = await pool.query(
        `SELECT COUNT(*)::int AS c FROM bookings
         WHERE venue_id = $1
           AND user_id = $2
           AND booking_date = $3
           AND (start_time, end_time) OVERLAPS ($4::time, $5::time)`,
        [v.id, req.user.id, booking_date, start_time, end_time]
      )
      if (check.rows[0].c >= v.max_per_user_per_slot) {
        return res.status(409).json({
          error: `Ваш лимит лошадей на это время на площадке «${v.name}» исчерпан`
        })
      }
    }

    const result = await pool.query(
      `INSERT INTO bookings (user_id, horse_name, venue, venue_id, discipline, booking_date, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.id, horse_name, v.name, v.id, discipline, booking_date, start_time, end_time]
    )
    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { horse_name, discipline } = req.body
    if (!horse_name || !discipline) {
      return res.status(400).json({ error: 'Заполните все поля' })
    }

    const existing = await pool.query('SELECT * FROM bookings WHERE id = $1', [req.params.id])
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Не найдено' })

    const booking = existing.rows[0]
    const isAdmin = req.user.role === 'admin'
    const isOwner = booking.user_id === req.user.id
    if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Недостаточно прав' })

    const updated = await pool.query(
      `UPDATE bookings SET horse_name = $1, discipline = $2 WHERE id = $3 RETURNING *`,
      [horse_name, discipline, req.params.id]
    )
    res.json({ data: updated.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const existing = await pool.query('SELECT user_id FROM bookings WHERE id = $1', [req.params.id])
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Не найдено' })

    const booking = existing.rows[0]
    const isAdmin = req.user.role === 'admin'
    const isOwner = booking.user_id === req.user.id
    if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Недостаточно прав' })

    await pool.query('DELETE FROM bookings WHERE id = $1', [req.params.id])
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
