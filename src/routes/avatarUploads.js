const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const crypto = require('crypto')
const pool = require('../db/pool')
const { requireAuth, requireAdmin } = require('../middleware/auth')

const router = express.Router()

const uploadDir = path.join(__dirname, '../../public/uploads/avatars')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

function safeExt(originalname) {
  const ext = path.extname(originalname || '').toLowerCase()
  if (!ext) return ''
  if (ext.length > 12) return ''
  return ext.replace(/[^a-z0-9.]/g, '')
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(16).toString('hex')
    cb(null, `${Date.now()}-${id}${safeExt(file.originalname)}`)
  }
})

const upload = multer({
  storage,
  limits: {
    fileSize: 7 * 1024 * 1024, // 7MB
    files: 1
  }
})

// POST /api/admin/users/:id/avatar (multipart/form-data: avatar=<file>)
router.post('/users/:id/avatar', requireAuth, requireAdmin, upload.single('avatar'), async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10)
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Некорректный запрос' })
    if (!req.file) return res.status(400).json({ error: 'Файл не выбран' })

    const mime = String(req.file.mimetype || '')
    if (!mime.startsWith('image/')) {
      return res.status(400).json({ error: 'Нужен файл изображения' })
    }

    const url = `/uploads/avatars/${req.file.filename}`
    const updated = await pool.query(
      `UPDATE users SET avatar_url = $2 WHERE id = $1 RETURNING id, avatar_url`,
      [userId, url]
    )
    if (!updated.rows.length) return res.status(404).json({ error: 'Пользователь не найден' })
    res.status(201).json({ data: updated.rows[0] })
  } catch (err) {
    // multer limit errors are thrown as regular errors
    const msg = String(err?.message || '')
    if (msg.toLowerCase().includes('file too large')) {
      return res.status(413).json({ error: 'Файл слишком большой (максимум 7 МБ)' })
    }
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

