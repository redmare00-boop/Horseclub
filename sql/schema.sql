-- Horseclub database schema (minimal, for local dev)
-- You can safely re-run: it uses IF NOT EXISTS where possible.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  full_name     TEXT NOT NULL,
  login         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If the table existed earlier with fewer columns, add missing ones.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS invites (
  id           SERIAL PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  full_name    TEXT NOT NULL,
  login        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'user',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invites_by_login ON invites (login);

CREATE TABLE IF NOT EXISTS venues (
  id                        SERIAL PRIMARY KEY,
  name                      TEXT NOT NULL UNIQUE,
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  slot_granularity_minutes  INTEGER NOT NULL DEFAULT 30,
  max_total_per_slot        INTEGER NULL,
  max_per_user_per_slot     INTEGER NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS venues_active ON venues (is_active);

CREATE TABLE IF NOT EXISTS bookings (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  horse_name   TEXT NOT NULL,
  venue        TEXT NOT NULL,
  venue_id     INTEGER REFERENCES venues(id) ON DELETE SET NULL,
  discipline   TEXT NOT NULL,
  booking_date DATE NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bookings_by_date ON bookings (booking_date);

CREATE TABLE IF NOT EXISTS horses (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  breed           TEXT,
  birth_year      INTEGER,
  color           TEXT,
  chip_number     TEXT,
  passport_number TEXT,
  owner           TEXT,
  photo_url       TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If the table existed earlier with fewer columns, add missing ones.
ALTER TABLE horses ADD COLUMN IF NOT EXISTS breed TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS birth_year INTEGER;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS chip_number TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS passport_number TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS horse_medical (
  id           SERIAL PRIMARY KEY,
  horse_id     INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  record_type  TEXT NOT NULL,
  event_date   DATE NOT NULL,
  next_date    DATE,
  description  TEXT,
  performed_by TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS horse_medical_by_horse ON horse_medical (horse_id, event_date DESC);

CREATE TABLE IF NOT EXISTS channels (
  id         SERIAL PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('general', 'direct')),
  name       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id   INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content    TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_by_channel ON messages (channel_id, created_at);

-- Create default "general" channel
INSERT INTO channels (type, name)
SELECT 'general', 'Общий чат'
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE type = 'general'
);

-- Legacy: таблица bookings могла существовать без venue_id
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS venue_id INTEGER REFERENCES venues(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS bookings_venue_id ON bookings (venue_id);

-- Площадки по умолчанию (один клуб) + лимиты
INSERT INTO venues (name, is_active, max_total_per_slot, max_per_user_per_slot) VALUES
  ('Манеж', true, NULL, 3),
  ('Предманежник', true, 1, NULL),
  ('Бочка', true, 1, NULL),
  ('Верхний плац', true, NULL, NULL),
  ('Нижний плац', true, NULL, NULL)
ON CONFLICT (name) DO UPDATE SET
  is_active = EXCLUDED.is_active,
  max_total_per_slot = EXCLUDED.max_total_per_slot,
  max_per_user_per_slot = EXCLUDED.max_per_user_per_slot;

UPDATE bookings b
SET venue_id = v.id
FROM venues v
WHERE b.venue = v.name
  AND b.venue_id IS NULL;
