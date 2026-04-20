const { Pool } = require('pg')

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'horseclub',
  password: 'Rapsodia01',
  port: 5432,
})

pool.connect()
  .then(() => console.log('База данных подключена'))
  .catch(err => console.error('Ошибка подключения к БД:', err.message))

module.exports = pool