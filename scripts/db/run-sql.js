const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

require('../../src/config')

function splitSqlStatements(sql) {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)
}

function urlLooksUnresolved(url) {
  if (!url) return false
  return url.includes('${{') || url.includes('Postgres.DATABASE_URL')
}

/** Pool only for migrations: connection timeout so a bad URL does not hang forever. */
function createMigrationPool() {
  const timeoutMs = Number(process.env.PG_CONNECT_TIMEOUT_MS || 25000)

  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: timeoutMs,
      max: 2
    })
  }

  return new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: timeoutMs,
    max: 2
  })
}

async function main() {
  const hasDb = !!(process.env.DATABASE_URL || process.env.PGHOST)
  if (!hasDb) {
    console.error(
      'Database is not configured.\n' +
      '- Set DATABASE_URL in .env or in this shell before npm (example: postgres://...)\n' +
      '  OR set PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD.\n' +
      '- From your PC use the PUBLIC URL from Postgres → Variables (often DATABASE_PUBLIC_URL),\n' +
      '  but assign it as DATABASE_URL in cmd: set DATABASE_URL=...\n' +
      '- If DATABASE_URL contains ${{ ... }}, paste the real connection string from Railway.'
    )
    process.exit(1)
  }

  const connUrl = process.env.DATABASE_URL || process.env.PG_URL || ''
  if (urlLooksUnresolved(connUrl)) {
    console.error(
      'DATABASE_URL looks like an unresolved Railway reference (${{ ... }}).\n' +
      'Copy the full URL from Postgres → Variables (use DATABASE_PUBLIC_URL for running this script on your PC),\n' +
      'then: set DATABASE_URL=paste_here'
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

  console.log(`Applying ${statements.length} SQL statements from ${fileArg} …`)
  console.log(
    '(If this hangs here: check Railway Postgres → Settings → Public Networking / TCP proxy,\n' +
    ' firewall/VPN, and that set DATABASE_URL uses DATABASE_PUBLIC_URL from your PC.)'
  )

  const pool = createMigrationPool()

  try {
    for (let i = 0; i < statements.length; i++) {
      process.stdout.write(`  [${i + 1}/${statements.length}] …\r`)
      await pool.query(statements[i])
    }
    process.stdout.write('\n')
    console.log(`OK: executed ${statements.length} statements from ${fileArg}`)
  } finally {
    await pool.end()
  }

  process.exit(0)
}

main().catch((err) => {
  console.error('\nSQL run failed:', err.message || err)
  if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
    console.error(
      '\nПодключение не успело за ' +
        (process.env.PG_CONNECT_TIMEOUT_MS || '25000') +
        ' ms. Часто причина: нет доступа к хосту с вашего ПК (прокси Railway выключен, файрвол, VPN).'
    )
  }
  process.exit(1)
})
