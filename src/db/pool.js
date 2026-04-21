const { Pool } = require('pg')

const RAILWAY_DB = 'postgresql://postgres:iWibibHTZePhXImUhilCUVlRUMNXFogx@shinkansen.proxy.rlwy.net:37332/railway'

function getPool() {
  const connStr = process.env.DATABASE_URL || process.env.PG_URL || 
    (process.env.NODE_ENV === 'production' ? RAILWAY_DB : null)
  
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