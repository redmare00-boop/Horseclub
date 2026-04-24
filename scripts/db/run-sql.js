const fs = require('fs')
const path = require('path')

require('../../src/config')
const pool = require('../../src/db/pool')
const { config } = require('../../src/config')

function splitSqlStatements(sql) {
  // Simple splitter: good for our schema.sql (no exotic cases)
  return sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)
}

async function main() {
  if (!config.databaseUrl && !process.env.PGPASSWORD) {
    console.error(
      'Database is not configured.\n' +
      '- Set DATABASE_URL in .env (example: postgres://postgres:password@localhost:5432/horseclub)\n' +
      '  OR set PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD.\n' +
      '- If you see DATABASE_URL=${{ Postgres.DATABASE_URL }}, replace it with a real local URL.'
    )
    process.exit(1)
  }

  const fileArg = process.argv[2]
  if (!fileArg) {
    console.error('Usage: node scripts/db/run-sql.js <path-to-sql-file>')
    process.exit(1)
  }

  const absPath = path.isAbsolute(fileArg)
    ? fileArg
    : path.join(process.cwd(), fileArg)

  const sql = fs.readFileSync(absPath, 'utf8')
  const statements = splitSqlStatements(sql)

  for (const stmt of statements) {
    await pool.query(stmt)
  }

  console.log(`OK: executed ${statements.length} statements from ${fileArg}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('SQL run failed:', err)
  process.exit(1)
})
