const express = require('express')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const crypto = require('crypto')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

const uploadDir = path.join(__dirname, '../../public/uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

function safeExt(originalname) {
  const ext = path.extname(originalname || '').toLowerCase()
  // keep a small allowlist of extensions, otherwise drop extension
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
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 5
  }
})

// POST /api/chat/upload
router.post('/upload', requireAuth, upload.array('files', 5), async (req, res) => {
  const files = req.files || []
  const out = files.map((f) => ({
    url: `/uploads/${f.filename}`,
    name: f.originalname,
    mime: f.mimetype,
    size: f.size
  }))
  res.status(201).json({ data: out })
})

module.exports = router

