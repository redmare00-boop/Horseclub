const { Pool } = require('pg')

console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'есть' : 'нет')

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
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