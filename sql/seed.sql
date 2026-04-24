-- Seed data for local development
-- Safe to re-run: uses WHERE NOT EXISTS / ON CONFLICT

-- Users
INSERT INTO users (full_name, login, password_hash, role)
VALUES ('Администратор', 'admin', '$2b$10$BXSF7aXAoS/Io.OJ8X.EPecplAd95eG1boA92QWIXicyHbgbhu9l2', 'admin')
ON CONFLICT (login) DO UPDATE
SET full_name = EXCLUDED.full_name,
    password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role;

INSERT INTO users (full_name, login, password_hash, role)
VALUES ('Тестовый пользователь', 'user', '$2b$10$s8mN3V7ugd5FrC1uewkZPuaVV7jPoG7id9UtWgltpfD.6WBObCyd6', 'user')
ON CONFLICT (login) DO UPDATE
SET full_name = EXCLUDED.full_name,
    password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role;

-- Horses
INSERT INTO horses (name, breed, birth_year, color, owner, notes)
SELECT 'Гром', 'Орловский рысак', 2016, 'вороной', 'Клуб', 'Спокойный, подходит новичкам'
WHERE NOT EXISTS (SELECT 1 FROM horses WHERE name = 'Гром');

INSERT INTO horses (name, breed, birth_year, color, owner, notes)
SELECT 'Искра', 'Будённовская', 2018, 'рыжая', 'Клуб', 'Более энергичная, для уверенных'
WHERE NOT EXISTS (SELECT 1 FROM horses WHERE name = 'Искра');

-- Bookings (today)
INSERT INTO bookings (user_id, horse_name, venue, venue_id, discipline, booking_date, start_time, end_time)
SELECT u.id, 'Гром', 'Манеж', v.id, 'Выездка', CURRENT_DATE, '10:00', '10:30'
FROM users u
CROSS JOIN venues v
WHERE u.login = 'admin'
  AND v.name = 'Манеж'
  AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.booking_date = CURRENT_DATE AND b.venue = 'Манеж' AND b.start_time = '10:00' AND b.horse_name = 'Гром'
  );

INSERT INTO bookings (user_id, horse_name, venue, venue_id, discipline, booking_date, start_time, end_time)
SELECT u.id, 'Искра', 'Манеж', v.id, 'Конкур', CURRENT_DATE, '10:30', '11:00'
FROM users u
CROSS JOIN venues v
WHERE u.login = 'user'
  AND v.name = 'Манеж'
  AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.booking_date = CURRENT_DATE AND b.venue = 'Манеж' AND b.start_time = '10:30' AND b.horse_name = 'Искра'
  );

-- Horse medical records (optional)
INSERT INTO horse_medical (horse_id, record_type, event_date, next_date, description, performed_by)
SELECT h.id, 'вакцинация', CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE + INTERVAL '335 days', 'Плановая вакцинация', 'Ветврач'
FROM horses h
WHERE h.name = 'Гром'
  AND NOT EXISTS (
    SELECT 1 FROM horse_medical m
    WHERE m.horse_id = h.id AND m.record_type = 'вакцинация' AND m.event_date = (CURRENT_DATE - INTERVAL '30 days')::date
  );
