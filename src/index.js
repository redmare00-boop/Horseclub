const express = require('express')
const cors = require('cors')
const path = require('path')
require('dotenv').config()

const pool = require('./db/pool')
const bookingsRouter = require('./routes/bookings')

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '../public')))

app.use('/api/bookings', bookingsRouter)

app.get('/api/ping', (req, res) => {
  res.json({ message: 'Сервер работает!' })
})

app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`)
})