const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await req.app.locals.db.query(
      `SELECT h.*,
        (SELECT json_agg(m ORDER BY m.event_date DESC)
         FROM horse_medical m WHERE m.horse_id = h.id) AS medical
       FROM horses h ORDER BY h.name`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await req.app.locals.db.query(
      `SELECT h.*,
        (SELECT json_agg(m ORDER BY m.event_date DESC)
         FROM horse_medical m WHERE m.horse_id = h.id) AS medical
       FROM horses h WHERE h.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name, breed, birth_year, color, chip_number,
          passport_number, owner, photo_url, notes } = req.body;
  try {
    const { rows } = await req.app.locals.db.query(
      `INSERT INTO horses (name, breed, birth_year, color, chip_number,
         passport_number, owner, photo_url, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, breed, birth_year || null, color, chip_number,
       passport_number, owner, photo_url || null, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { name, breed, birth_year, color, chip_number,
          passport_number, owner, photo_url, notes } = req.body;
  try {
    const { rows } = await req.app.locals.db.query(
      `UPDATE horses SET name=$1, breed=$2, birth_year=$3, color=$4,
         chip_number=$5, passport_number=$6, owner=$7,
         photo_url=$8, notes=$9
       WHERE id=$10 RETURNING *`,
      [name, breed, birth_year || null, color, chip_number,
       passport_number, owner, photo_url || null, notes, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await req.app.locals.db.query(`DELETE FROM horses WHERE id=$1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/medical', async (req, res) => {
  const { record_type, event_date, next_date, description, performed_by } = req.body;
  try {
    const { rows } = await req.app.locals.db.query(
      `INSERT INTO horse_medical (horse_id, record_type, event_date, next_date, description, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, record_type, event_date, next_date || null, description, performed_by]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/medical/:medId', async (req, res) => {
  try {
    await req.app.locals.db.query(
      `DELETE FROM horse_medical WHERE id=$1 AND horse_id=$2`,
      [req.params.medId, req.params.id]
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