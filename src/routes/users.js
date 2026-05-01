const express = require('express')
const router = express.Router()
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const crypto = require('crypto')
const pool = require('../db/pool')
const { requireAuth } = require('../middleware/auth')

const columnCache = new Map() // key: "table.column" -> boolean
async function hasColumn(table, column) {
  const key = `${table}.${column}`
  if (columnCache.has(key)) return columnCache.get(key)
  const r = await pool.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [table, column]
  )
  const ok = r.rows.length > 0
  columnCache.set(key, ok)
  return ok
}

function pickStatus(raw) {
  const v = String(raw ?? '').trim().toLowerCase()
  const allowed = new Set(['', 'коневладелец', 'тренер', 'руководитель клуба', 'ветврач', 'конюх', 'администратор'])
  return allowed.has(v) ? v : ''
}

// ---- Directory: all users (for "Люди" page) ----
router.get('/', requireAuth, async (req, res) => {
  try {
    const hasNickname = await hasColumn('users', 'nickname')
    const hasAvatar = await hasColumn('users', 'avatar_url')
    const hasStatus = await hasColumn('users', 'status')
    const hasPhone = await hasColumn('users', 'phone')
    const hasDeletedAt = await hasColumn('users', 'deleted_at')

    const deletedSql = hasDeletedAt ? `COALESCE((u.deleted_at IS NOT NULL), false)` : `false`
    const nicknameSql = hasNickname ? `COALESCE(NULLIF(btrim(u.nickname), ''), '')` : `''`
    const avatarSql = hasAvatar
      ? (hasDeletedAt ? `CASE WHEN u.deleted_at IS NOT NULL THEN '' ELSE COALESCE(u.avatar_url, '') END` : `COALESCE(u.avatar_url, '')`)
      : `''`
    const statusSql = hasStatus
      ? (hasDeletedAt ? `CASE WHEN u.deleted_at IS NOT NULL THEN '' ELSE COALESCE(u.status, '') END` : `COALESCE(u.status, '')`)
      : `''`
    const phoneSql = hasPhone
      ? (hasDeletedAt ? `CASE WHEN u.deleted_at IS NOT NULL THEN '' ELSE COALESCE(u.phone, '') END` : `COALESCE(u.phone, '')`)
      : `''`

    const r = await pool.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.login,
        ${nicknameSql} as nickname,
        ${avatarSql} as avatar_url,
        ${statusSql} as status,
        ${phoneSql} as phone,
        ${deletedSql} as deleted
      FROM users u
      ORDER BY
        ${deletedSql} ASC,
        COALESCE(NULLIF(btrim(${nicknameSql}), ''), u.full_name) ASC,
        u.id ASC
      `
    )

    const out = r.rows.map((u) => {
      if (u.deleted) {
        return {
          ...u,
          full_name: 'Удаленный аккаунт',
          nickname: '',
          avatar_url: '',
          status: '',
          phone: ''
        }
      }
      return u
    })
    res.json({ data: out })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---- My profile (me) ----
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(String(req.user.id), 10)
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'Необходима авторизация' })

    const hasNickname = await hasColumn('users', 'nickname')
    const hasAvatar = await hasColumn('users', 'avatar_url')
    const hasStatus = await hasColumn('users', 'status')
    const hasPhone = await hasColumn('users', 'phone')
    const hasDeletedAt = await hasColumn('users', 'deleted_at')

    const nicknameSql = hasNickname ? `COALESCE(NULLIF(btrim(u.nickname), ''), u.login)` : `u.login`
    const avatarSql = hasAvatar ? `COALESCE(u.avatar_url, '')` : `''`
    const statusSql = hasStatus ? `COALESCE(u.status, '')` : `''`
    const phoneSql = hasPhone ? `COALESCE(u.phone, '')` : `''`
    const deletedSql = hasDeletedAt ? `COALESCE((u.deleted_at IS NOT NULL), false)` : `false`

    const u = await pool.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.login,
        ${nicknameSql} as nickname,
        ${avatarSql} as avatar_url,
        ${statusSql} as status,
        ${phoneSql} as phone,
        ${deletedSql} as deleted
      FROM users u
      WHERE u.id = $1
      `,
      [userId]
    )
    if (u.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' })

    res.json({ data: u.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.put('/me', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(String(req.user.id), 10)
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'Необходима авторизация' })

    const hasNickname = await hasColumn('users', 'nickname')
    const hasStatus = await hasColumn('users', 'status')
    const hasPhone = await hasColumn('users', 'phone')
    if (!hasNickname && !hasStatus && !hasPhone) {
      return res.status(400).json({ error: 'Профиль пока не поддерживает редактирование (нужно обновить базу)' })
    }

    const nickname = String(req.body?.nickname ?? '').trim()
    const phone = String(req.body?.phone ?? '').trim()
    const status = pickStatus(req.body?.status)

    const sets = []
    const params = []
    let idx = 1
    if (hasNickname) { sets.push(`nickname = $${idx++}`); params.push(nickname || null) }
    if (hasStatus) { sets.push(`status = $${idx++}`); params.push(status || null) }
    if (hasPhone) { sets.push(`phone = $${idx++}`); params.push(phone || null) }
    params.push(userId)

    const updated = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id`,
      params
    )
    if (!updated.rows.length) return res.status(404).json({ error: 'Пользователь не найден' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Avatar upload for self (7MB)
const avatarDir = path.join(__dirname, '../../public/uploads/avatars')
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true })
function safeExt(originalname) {
  const ext = path.extname(originalname || '').toLowerCase()
  if (!ext) return ''
  if (ext.length > 12) return ''
  return ext.replace(/[^a-z0-9.]/g, '')
}
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    const id = crypto.randomBytes(16).toString('hex')
    cb(null, `${Date.now()}-${id}${safeExt(file.originalname)}`)
  }
})
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 7 * 1024 * 1024, files: 1 }
})

router.post('/me/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  try {
    const userId = parseInt(String(req.user.id), 10)
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'Необходима авторизация' })
    if (!req.file) return res.status(400).json({ error: 'Файл не выбран' })

    const hasAvatar = await hasColumn('users', 'avatar_url')
    if (!hasAvatar) return res.status(400).json({ error: 'Аватар пока не поддерживается (нужно обновить базу)' })

    const mime = String(req.file.mimetype || '')
    if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Нужен файл изображения' })

    const url = `/uploads/avatars/${req.file.filename}`
    await pool.query(`UPDATE users SET avatar_url = $2 WHERE id = $1`, [userId, url])
    res.status(201).json({ data: { avatar_url: url } })
  } catch (err) {
    const msg = String(err?.message || '')
    if (msg.toLowerCase().includes('file too large')) {
      return res.status(413).json({ error: 'Файл слишком большой (максимум 7 МБ)' })
    }
    res.status(500).json({ error: err.message })
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10)
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Некорректный запрос' })

    const hasNickname = await hasColumn('users', 'nickname')
    const hasAvatar = await hasColumn('users', 'avatar_url')
    const hasStatus = await hasColumn('users', 'status')
    const hasPhone = await hasColumn('users', 'phone')
    const hasDeletedAt = await hasColumn('users', 'deleted_at')

    const nicknameSql = hasNickname ? `COALESCE(NULLIF(btrim(u.nickname), ''), u.login)` : `u.login`
    const avatarSql = hasAvatar ? `COALESCE(u.avatar_url, '')` : `''`
    const statusSql = hasStatus ? `COALESCE(u.status, '')` : `''`
    const phoneSql = hasPhone ? `COALESCE(u.phone, '')` : `''`
    const deletedSql = hasDeletedAt ? `COALESCE((u.deleted_at IS NOT NULL), false)` : `false`

    const u = await pool.query(
      `
      SELECT
        u.id,
        u.full_name,
        u.login,
        ${nicknameSql} as nickname,
        ${avatarSql} as avatar_url,
        ${statusSql} as status,
        ${phoneSql} as phone,
        ${deletedSql} as deleted
      FROM users u
      WHERE u.id = $1
      `,
      [userId]
    )
    if (u.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' })

    const isDeleted = !!u.rows[0].deleted
    const hasOwnerUserId = await hasColumn('horses', 'owner_user_id')
    let horsesRes
    if (hasOwnerUserId) {
      horsesRes = await pool.query(
        `
        SELECT name
        FROM horses
        WHERE owner_user_id = $1
        ORDER BY name
        `,
        [userId]
      )
    } else {
      // fallback for old DBs: match by owner text = user's full_name
      horsesRes = await pool.query(
        `
        SELECT h.name
        FROM horses h
        WHERE COALESCE(NULLIF(btrim(h.owner), ''), '') <> ''
          AND h.owner ILIKE $1
        ORDER BY h.name
        `,
        [u.rows[0].full_name]
      )
    }

    const out = { ...u.rows[0], horses: horsesRes.rows.map((r) => r.name) }
    if (isDeleted) {
      out.full_name = 'Удаленный аккаунт'
      out.nickname = ''
      out.avatar_url = ''
      out.status = ''
      out.phone = '' // phone hidden for deleted accounts
      out.horses = []
    }
    res.json({ data: out })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

