const { Pool } = require('pg')

console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'есть' : 'нет')
console.log('PG_URL:', process.env.PG_URL ? 'есть' : 'нет')
console.log('NODE_ENV:', process.env.NODE_ENV)

const connStr = process.env.DATABASE_URL || process.env.PG_URL

const pool = new Pool(
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

pool.connect()
  .then(() => console.log('База данных подключена'))
  .catch(err => console.error('Ошибка подключения к БД:', err.message))

module.exports = pool