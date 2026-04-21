const express = require('express')
const cors = require('cors')
const path = require('path')
const http = require('http')
const { Server } = require('socket.io')

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}

const pool = require('./db/pool')
const bookingsRouter = require('./routes/bookings')
const authRouter = require('./routes/auth')
const chatRouter = require('./routes/chat')
const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*' }
})

const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '../public')))

app.use('/api/bookings', bookingsRouter)
app.use('/api/auth', authRouter)
app.use('/api/chat', chatRouter)
app.get('/api/ping', (req, res) => {
  res.json({ message: 'Сервер работает!' })
})

io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id)

  socket.on('join', (userId) => {
    socket.join(`user:${userId}`)
    socket.join('general')
    console.log(`Пользователь ${userId} вошёл в чат`)
  })

  socket.on('message:send', async (data) => {
    const { channel_id, content, sender_id, sender_name } = data
    try {
      const result = await pool.query(
        `INSERT INTO messages (channel_id, sender_id, content)
         VALUES ($1, $2, $3) RETURNING *`,
        [channel_id, sender_id, content]
      )
      const message = {
        ...result.rows[0],
        sender_name
      }
      io.to(`channel:${channel_id}`).emit('message:new', message)
    } catch (err) {
      console.error('Ошибка сохранения сообщения:', err.message)
    }
  })

  socket.on('channel:join', (channelId) => {
    socket.join(`channel:${channelId}`)
  })

  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id)
  })
})

app.set('io', io)

server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`)
})