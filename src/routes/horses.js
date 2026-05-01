const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth')

async function ensureArchiveSupport(db) {
  // for older DBs
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`)
  await db.query(`ALTER TABLE horses ADD COLUMN IF NOT EXISTS sex TEXT`)
  // Some older DBs had only horses.owner (text) without a FK to users.
  await db.query(`ALTER TABLE horses ADD COLUMN IF NOT EXISTS owner_user_id INTEGER`)
  // best-effort FK (won't fail if already exists)
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_type = 'FOREIGN KEY'
          AND table_schema = 'public'
          AND table_name = 'horses'
          AND constraint_name = 'horses_owner_user_id_fkey'
      ) THEN
        ALTER TABLE horses
          ADD CONSTRAINT horses_owner_user_id_fkey
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END$$;
  `)
  await db.query(`ALTER TABLE horse_medical ADD COLUMN IF NOT EXISTS record_subtype TEXT`)
}

async function horseAccess(db, horseId) {
  const { rows } = await db.query(
    `SELECT id, owner_user_id FROM horses WHERE id = $1`,
    [horseId]
  )
  return rows[0] || null
}

function canEditHorse(reqUser, horseRow) {
  if (!reqUser || !horseRow) return false
  if (reqUser.role === 'admin') return true
  return Number(horseRow.owner_user_id) === Number(reqUser.id)
}

// All horses of active users (directory)
router.get('/', requireAuth, async (req, res) => {
  try {
    await ensureArchiveSupport(req.app.locals.db)
    const hasArchivedAt = await req.app.locals.db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='archived_at' LIMIT 1`
    )
    const archivedFilter = hasArchivedAt.rows.length ? `AND (h.owner_user_id IS NULL OR u.archived_at IS NULL)` : ``

    const { rows } = await req.app.locals.db.query(
      `SELECT
        h.*,
        u.full_name as owner_full_name,
        u.login as owner_login,
        COALESCE((u.deleted_at IS NOT NULL), false) as owner_deleted,
        ${hasArchivedAt.rows.length ? `COALESCE((u.archived_at IS NOT NULL), false)` : `false`} as owner_archived,
        (SELECT json_agg(m ORDER BY m.event_date DESC)
         FROM horse_medical m WHERE m.horse_id = h.id) AS medical
       FROM horses h
       LEFT JOIN users u ON u.id = h.owner_user_id
       WHERE (h.owner_user_id IS NULL OR u.deleted_at IS NULL)
       ${archivedFilter}
       ORDER BY h.name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// List horses for current owner (for "актуальные данные" / quick refresh)
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const userId = parseInt(String(req.user.id), 10)
    if (!Number.isFinite(userId)) return res.status(401).json({ error: 'Необходима авторизация' })
    const { rows } = await req.app.locals.db.query(
      `SELECT id, name
       FROM horses
       WHERE owner_user_id = $1
       ORDER BY name`,
      [userId]
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Buy / Sell: owner can claim or release their horse
router.post('/:id/owner', requireAuth, async (req, res) => {
  try {
    const horseId = parseInt(req.params.id, 10)
    const userId = parseInt(String(req.user.id), 10)
    const { action } = req.body || {}
    if (!Number.isFinite(horseId) || !Number.isFinite(userId)) return res.status(400).json({ error: 'Некорректный запрос' })

    const a = String(action || '').trim()
    if (a !== 'buy' && a !== 'sell') return res.status(400).json({ error: 'Некорректное действие' })

    if (a === 'buy') {
      const { rows } = await req.app.locals.db.query(
        `
        UPDATE horses
        SET owner_user_id = $2
        WHERE id = $1 AND owner_user_id IS NULL
        RETURNING id, name, owner_user_id
        `,
        [horseId, userId]
      )
      if (!rows.length) return res.status(409).json({ error: 'Лошадь уже принадлежит другому владельцу' })
      return res.json({ data: rows[0] })
    }

    // sell
    const { rows } = await req.app.locals.db.query(
      `
      UPDATE horses
      SET owner_user_id = NULL
      WHERE id = $1 AND owner_user_id = $2
      RETURNING id, name, owner_user_id
      `,
      [horseId, userId]
    )
    if (!rows.length) return res.status(403).json({ error: 'Можно продать только свою лошадь' })
    return res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:id', async (req, res) => {
  try {
    await ensureArchiveSupport(req.app.locals.db)
    const { rows } = await req.app.locals.db.query(
      `SELECT h.*,
        u.full_name as owner_full_name,
        u.login as owner_login,
        COALESCE((u.deleted_at IS NOT NULL), false) as owner_deleted,
        COALESCE((u.archived_at IS NOT NULL), false) as owner_archived,
        (SELECT json_agg(m ORDER BY m.event_date DESC)
         FROM horse_medical m WHERE m.horse_id = h.id) AS medical
       FROM horses h
       LEFT JOIN users u ON u.id = h.owner_user_id
       WHERE h.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create horse (owner adds their horse). Admin can also create.
router.post('/', requireAuth, async (req, res) => {
  const { name, breed, birth_year, color, sex, chip_number,
          passport_number, owner_user_id, owner, photo_url, notes } = req.body;
  try {
    const actorId = parseInt(String(req.user.id), 10)
    if (!Number.isFinite(actorId)) return res.status(401).json({ error: 'Необходима авторизация' })
    await ensureArchiveSupport(req.app.locals.db)

    const horseName = String(name || '').trim()
    const horseColor = String(color || '').trim()
    const horseSex = String(sex || '').trim().toLowerCase()
    const yearNum = birth_year === null || birth_year === undefined || birth_year === '' ? null : Number(birth_year)
    const allowedSex = new Set(['кобыла', 'жеребец', 'мерин'])
    if (!horseName) return res.status(400).json({ error: 'Укажите кличку' })
    if (!horseColor) return res.status(400).json({ error: 'Укажите масть' })
    if (!allowedSex.has(horseSex)) return res.status(400).json({ error: 'Укажите пол (кобыла/жеребец/мерин)' })
    if (!Number.isFinite(yearNum) || yearNum < 1900 || yearNum > 2100) return res.status(400).json({ error: 'Укажите год рождения' })

    const isAdmin = req.user.role === 'admin'
    const ownerId = isAdmin && Number.isFinite(Number(owner_user_id)) ? Number(owner_user_id) : actorId

    const { rows } = await req.app.locals.db.query(
      `INSERT INTO horses (name, breed, birth_year, color, sex, chip_number,
         passport_number, owner, owner_user_id, photo_url, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [horseName, breed, yearNum, horseColor, horseSex, chip_number,
       passport_number, owner, ownerId, photo_url || null, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  const { name, breed, birth_year, color, sex, chip_number,
          passport_number, owner_user_id, owner, photo_url, notes } = req.body;
  try {
    const horseId = parseInt(req.params.id, 10)
    if (!Number.isFinite(horseId)) return res.status(400).json({ error: 'Некорректный запрос' })
    await ensureArchiveSupport(req.app.locals.db)
    const row = await horseAccess(req.app.locals.db, horseId)
    if (!row) return res.status(404).json({ error: 'Не найдено' })
    if (!canEditHorse(req.user, row)) return res.status(403).json({ error: 'Недостаточно прав' })

    const horseName = String(name || '').trim()
    const horseColor = String(color || '').trim()
    const horseSex = String(sex || '').trim().toLowerCase()
    const yearNum = birth_year === null || birth_year === undefined || birth_year === '' ? null : Number(birth_year)
    const allowedSex = new Set(['кобыла', 'жеребец', 'мерин'])
    if (!horseName) return res.status(400).json({ error: 'Укажите кличку' })
    if (!horseColor) return res.status(400).json({ error: 'Укажите масть' })
    if (!allowedSex.has(horseSex)) return res.status(400).json({ error: 'Укажите пол (кобыла/жеребец/мерин)' })
    if (!Number.isFinite(yearNum) || yearNum < 1900 || yearNum > 2100) return res.status(400).json({ error: 'Укажите год рождения' })

    const isAdmin = req.user.role === 'admin'
    const nextOwnerId = isAdmin && Number.isFinite(Number(owner_user_id)) ? Number(owner_user_id) : row.owner_user_id

    const { rows } = await req.app.locals.db.query(
      `UPDATE horses SET name=$1, breed=$2, birth_year=$3, color=$4, sex=$5,
         chip_number=$6, passport_number=$7, owner=$8, owner_user_id=$9,
         photo_url=$10, notes=$11
       WHERE id=$12 RETURNING *`,
      [horseName, breed, yearNum, horseColor, horseSex, chip_number,
       passport_number, owner, nextOwnerId, photo_url || null, notes, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const horseId = parseInt(req.params.id, 10)
    if (!Number.isFinite(horseId)) return res.status(400).json({ error: 'Некорректный запрос' })
    const row = await horseAccess(req.app.locals.db, horseId)
    if (!row) return res.status(404).json({ error: 'Не найдено' })
    if (!canEditHorse(req.user, row)) return res.status(403).json({ error: 'Недостаточно прав' })

    await req.app.locals.db.query(`DELETE FROM horses WHERE id=$1`, [horseId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/medical', requireAuth, async (req, res) => {
  const { record_type, record_subtype, event_date, next_date, description, performed_by } = req.body;
  try {
    const horseId = parseInt(req.params.id, 10)
    if (!Number.isFinite(horseId)) return res.status(400).json({ error: 'Некорректный запрос' })
    await ensureArchiveSupport(req.app.locals.db)
    const row = await horseAccess(req.app.locals.db, horseId)
    if (!row) return res.status(404).json({ error: 'Лошадь не найдена' })
    if (!canEditHorse(req.user, row)) return res.status(403).json({ error: 'Недостаточно прав' })

    const type = String(record_type || '').trim()
    const date = String(event_date || '').trim()
    const desc = String(description || '').trim()
    const subtype = String(record_subtype || '').trim()

    const allowed = new Set(['vaccination', 'deworming', 'hoof_care'])
    if (!allowed.has(type)) return res.status(400).json({ error: 'Некорректный тип' })
    if (!date) return res.status(400).json({ error: 'Укажите дату' })
    if ((type === 'vaccination' || type === 'deworming') && !desc) {
      return res.status(400).json({ error: 'Заполните описание' })
    }
    if (type === 'hoof_care') {
      const allowedSub = new Set(['trim', 'shoeing'])
      if (!allowedSub.has(subtype)) return res.status(400).json({ error: 'Укажите: расчистка или ковка' })
    }

    const { rows } = await req.app.locals.db.query(
      `INSERT INTO horse_medical (horse_id, record_type, record_subtype, event_date, next_date, description, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [horseId, type, subtype || null, date, next_date || null, desc || null, performed_by || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/medical/:medId', requireAuth, async (req, res) => {
  try {
    const horseId = parseInt(req.params.id, 10)
    const medId = parseInt(req.params.medId, 10)
    if (!Number.isFinite(horseId) || !Number.isFinite(medId)) return res.status(400).json({ error: 'Некорректный запрос' })
    const row = await horseAccess(req.app.locals.db, horseId)
    if (!row) return res.status(404).json({ error: 'Лошадь не найдена' })
    if (!canEditHorse(req.user, row)) return res.status(403).json({ error: 'Недостаточно прав' })
    await req.app.locals.db.query(
      `DELETE FROM horse_medical WHERE id=$1 AND horse_id=$2`,
      [medId, horseId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Загрузка фото — сохраняем base64 прямо в БД
router.post('/:id/photo', async (req, res) => {
  const { photo_base64 } = req.body;
  if (!photo_base64) return res.status(400).json({ error: 'Нет фото' });
  try {
    const { rows } = await req.app.locals.db.query(
      `UPDATE horses SET photo_url=$1 WHERE id=$2 RETURNING id`,
      [photo_base64, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;