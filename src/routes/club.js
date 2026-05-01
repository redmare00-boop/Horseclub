const express = require('express')
const pool = require('../db/pool')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

async function ensureClubTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS club (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Конный клуб',
      logo_url TEXT,
      address TEXT,
      coords TEXT,
      mercury_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`ALTER TABLE club ADD COLUMN IF NOT EXISTS logo_url TEXT`)
  await pool.query(`ALTER TABLE club ADD COLUMN IF NOT EXISTS address TEXT`)
  await pool.query(`ALTER TABLE club ADD COLUMN IF NOT EXISTS coords TEXT`)
  await pool.query(`ALTER TABLE club ADD COLUMN IF NOT EXISTS mercury_id TEXT`)
  await pool.query(`ALTER TABLE club ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`)

  // Ensure single row exists (id=1)
  await pool.query(`
    INSERT INTO club (id, name)
    VALUES (1, 'Конный клуб')
    ON CONFLICT (id) DO NOTHING
  `)
}

router.get('/', requireAuth, async (req, res) => {
  try {
    await ensureClubTable()
    const r = await pool.query(
      `SELECT id, name, COALESCE(logo_url,'') as logo_url, COALESCE(address,'') as address,
              COALESCE(coords,'') as coords, COALESCE(mercury_id,'') as mercury_id
       FROM club
       WHERE id = 1`
    )
    res.json({ data: r.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

