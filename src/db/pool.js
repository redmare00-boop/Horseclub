const pg = require('pg');
require('dotenv').config();

const { Pool } = pg;

if (!process.env.DATABASE_URL && !process.env.PGHOST) {
  throw new Error('❌ Нет настроек базы данных. Создай .env файл!');
}

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host: process.env.PGHOST,
        port: process.env.PGPORT || 5432,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
      }
);

module.exports = { query: (...args) => pool.query(...args) };