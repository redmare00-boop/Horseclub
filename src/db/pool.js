const { Pool } = require('pg')

function getPool() {
  const connStr = process.env.DATABASE_URL || process.env.PG_URL
  return new Pool(
    connStr
      ? {
          connectionString: connStr,
          ssl: { rejectUnauthorized: false }
        }
      : {
          user: 'postgres',
          host: 'localhost',
          database: 'horseclub',
          password: 'Rapsodia01',
          port: 5432,
        }
  )
}

module.exports = { query: (...args) => getPool().query(...args) }