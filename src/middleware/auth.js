const jwt = require('jsonwebtoken')

const SECRET = 'horseclub_secret_key'

function requireAuth(req, res, next) {
  const header = req.headers.authorization

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Необходима авторизация' })
  }

  const token = header.split(' ')[1]

  try {
    const decoded = jwt.verify(token, SECRET)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Токен недействителен' })
  }
}

module.exports = { requireAuth }