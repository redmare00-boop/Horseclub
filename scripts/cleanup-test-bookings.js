const db = require('../src/db/pool')

async function main() {
  const patterns = ['H%', 'P%', 'B%', 'U%', 'ZZ%']
  const date = new Date().toISOString().slice(0, 10)
  const where = patterns.map((_, i) => `horse_name LIKE $${i + 2}`).join(' OR ')

  const sql = `
    DELETE FROM bookings
    WHERE booking_date = $1
      AND (${where})
    RETURNING id, horse_name, venue, start_time
  `

  const res = await db.query(sql, [date, ...patterns])
  console.log(`deleted: ${res.rowCount}`)
  for (const r of res.rows.slice(0, 50)) {
    console.log(`${r.id}\t${r.horse_name}\t${r.venue}\t${String(r.start_time).slice(0, 5)}`)
  }
  if (res.rowCount > 50) console.log('...')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

