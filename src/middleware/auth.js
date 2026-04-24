const jwt = require('jsonwebtoken')

const { config } = require('../config')

function requireAuth(req, res, next) {
  const header = req.headers.authorization

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Необходима авторизация' })
  }

  const token = header.split(' ')[1]

  try {
    const decoded = jwt.verify(token, config.jwtSecret)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Токен недействителен' })
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Необходима авторизация' })
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' })
  }
  next()
}

module.exports = { requireAuth, requireAdmin }