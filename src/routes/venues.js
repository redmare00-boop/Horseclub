const express = require('express')
const pool = require('../db/pool')
const { requireAuth, requireAdmin } = require('../middleware/auth')

function parseIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

const publicRouter = express.Router()

/** Активные площадки для расписания (публично) */
publicRouter.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, slot_granularity_minutes, max_total_per_slot, max_per_user_per_slot
       FROM venues
       WHERE is_active = true
       ORDER BY name`
    )
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const adminRouter = express.Router()
adminRouter.use(requireAuth, requireAdmin)

/** Все площадки (вкл. неактивные) */
adminRouter.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, is_active, slot_granularity_minutes, max_total_per_slot, max_per_user_per_slot, created_at
       FROM venues
       ORDER BY name`
    )
    res.json({ data: result.rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

adminRouter.post('/', async (req, res) => {
  try {
    const {
      name,
      is_active = true,
      slot_granularity_minutes = 30,
      max_total_per_slot,
      max_per_user_per_slot
    } = req.body
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Укажите название площадки' })
    }
    const result = await pool.query(
      `INSERT INTO venues (name, is_active, slot_granularity_minutes, max_total_per_slot, max_per_user_per_slot)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        String(name).trim(),
        Boolean(is_active),
        Number(slot_granularity_minutes) || 30,
        parseIntOrNull(max_total_per_slot),
        parseIntOrNull(max_per_user_per_slot)
      ]
    )
    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(400).json({ error: 'Площадка с таким названием уже есть' })
    }
    res.status(500).json({ error: err.message })
  }
})

adminRouter.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный id' })

    const {
      name,
      is_active,
      slot_granularity_minutes,
      max_total_per_slot,
      max_per_user_per_slot
    } = req.body

    const cur = await pool.query('SELECT * FROM venues WHERE id = $1', [id])
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Не найдено' })
    const row = cur.rows[0]

    const newName = name != null && String(name).trim() ? String(name).trim() : row.name
    const newActive = is_active === undefined ? row.is_active : Boolean(is_active)
    const newGran = slot_granularity_minutes === undefined
      ? row.slot_granularity_minutes
      : (Number(slot_granularity_minutes) || 30)
    const newMaxTotal = max_total_per_slot === undefined ? row.max_total_per_slot : parseIntOrNull(max_total_per_slot)
    const newMaxUser = max_per_user_per_slot === undefined ? row.max_per_user_per_slot : parseIntOrNull(max_per_user_per_slot)

    const result = await pool.query(
      `UPDATE venues SET
         name = $1,
         is_active = $2,
         slot_granularity_minutes = $3,
         max_total_per_slot = $4,
         max_per_user_per_slot = $5
       WHERE id = $6
       RETURNING *`,
      [newName, newActive, newGran, newMaxTotal, newMaxUser, id]
    )

    if (newName !== row.name) {
      await pool.query('UPDATE bookings SET venue = $1 WHERE venue_id = $2', [newName, id])
    }

    res.json({ data: result.rows[0] })
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(400).json({ error: 'Площадка с таким названием уже есть' })
    }
    res.status(500).json({ error: err.message })
  }
})

/** Мягкое удаление: is_active = false, если есть брони; иначе — DELETE */
adminRouter.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Некорректный id' })

    const cnt = await pool.query('SELECT COUNT(*)::int AS c FROM bookings WHERE venue_id = $1', [id])
    if (cnt.rows[0].c > 0) {
      await pool.query('UPDATE venues SET is_active = false WHERE id = $1', [id])
      return res.json({ data: { id, is_active: false, soft: true } })
    }
    await pool.query('DELETE FROM venues WHERE id = $1', [id])
    res.status(204).send()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = { publicRouter, adminRouter }
