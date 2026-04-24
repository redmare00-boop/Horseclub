function required(name, value) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function loadEnv() {
  if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
  }
}

loadEnv()

function looksLikePlaceholder(value) {
  if (!value) return false
  return value.includes('${{') || value.includes('Postgres.DATABASE_URL')
}

const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || 'dev_insecure_secret_change_me',
  databaseUrl: looksLikePlaceholder(process.env.DATABASE_URL)
    ? ''
    : (process.env.DATABASE_URL || process.env.PG_URL || ''),
  pg: {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'horseclub',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || ''
  }
}

if (process.env.NODE_ENV === 'production') {
  required('JWT_SECRET', process.env.JWT_SECRET)
  required('DATABASE_URL', process.env.DATABASE_URL)
}

module.exports = { config }
