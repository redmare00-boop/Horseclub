const { Pool } = require('pg')

console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'есть' : 'нет')

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      user: 'postgres',
      host: 'localhost',
      database: 'horseclub',
      password: 'Rapsodia01',
      port: 5432,
    })