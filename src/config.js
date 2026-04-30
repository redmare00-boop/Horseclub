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
  jwtSecret: process.env.JWT_SECRET || '',
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
  // DATABASE_URL is critical in production.
  required('DATABASE_URL', process.env.DATABASE_URL)

  // JWT_SECRET should be set in production, but don't hard-crash the whole service:
  // Railway sometimes doesn't inject variables as expected on first deploy.
  // If missing, generate a temporary secret (tokens will reset on restart) and warn loudly.
  if (!process.env.JWT_SECRET) {
    const crypto = require('crypto')
    config.jwtSecret = crypto.randomBytes(32).toString('hex')
    // eslint-disable-next-line no-console
    console.warn('[config] JWT_SECRET is missing in production; using a temporary secret. Set JWT_SECRET in Railway Variables ASAP.')
  } else {
    config.jwtSecret = process.env.JWT_SECRET
  }
} else {
  config.jwtSecret = process.env.JWT_SECRET || 'dev_insecure_secret_change_me'
}

module.exports = { config }
