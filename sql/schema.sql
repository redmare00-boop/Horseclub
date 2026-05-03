-- Horseclub database schema (minimal, for local dev)
-- You can safely re-run: it uses IF NOT EXISTS where possible.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  full_name     TEXT NOT NULL,
  login         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  nickname      TEXT,
  avatar_url    TEXT,
  status        TEXT,
  phone         TEXT,
  deleted_at    TIMESTAMPTZ,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If the table existed earlier with fewer columns, add missing ones.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- Password reset tokens (forgot password → link with token, optional email delivery)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_hash_uidx ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS invites (
  id           SERIAL PRIMARY KEY,
  token        TEXT,
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

-- Backward-compatible: store plain invite token so admins can re-copy the link later.
ALTER TABLE invites ADD COLUMN IF NOT EXISTS token TEXT;

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

-- Club profile (single row, managed by admin)
CREATE TABLE IF NOT EXISTS club (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT 'Конный клуб',
  logo_url   TEXT,
  address    TEXT,
  coords     TEXT,
  mercury_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE club ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE club ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE club ADD COLUMN IF NOT EXISTS coords TEXT;
ALTER TABLE club ADD COLUMN IF NOT EXISTS mercury_id TEXT;
ALTER TABLE club ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
INSERT INTO club (id, name)
VALUES (1, 'Конный клуб')
ON CONFLICT (id) DO NOTHING;

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
  sex             TEXT,
  chip_number     TEXT,
  passport_number TEXT,
  owner           TEXT,
  owner_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  photo_url       TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- If the table existed earlier with fewer columns, add missing ones.
ALTER TABLE horses ADD COLUMN IF NOT EXISTS breed TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS birth_year INTEGER;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS sex TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS chip_number TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS passport_number TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE horses ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS horse_medical (
  id           SERIAL PRIMARY KEY,
  horse_id     INTEGER NOT NULL REFERENCES horses(id) ON DELETE CASCADE,
  record_type  TEXT NOT NULL,
  record_subtype TEXT,
  event_date   DATE NOT NULL,
  next_date    DATE,
  description  TEXT,
  performed_by TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE horse_medical ADD COLUMN IF NOT EXISTS record_subtype TEXT;

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
  attachments JSONB NOT NULL DEFAULT '[]',
  is_pinned  BOOLEAN NOT NULL DEFAULT FALSE,
  pinned_at  TIMESTAMPTZ,
  pinned_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  edited_at  TIMESTAMPTZ,
  edited_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_by_channel ON messages (channel_id, created_at);

-- Per-user message actions ("у меня"): hide message / pin message
CREATE TABLE IF NOT EXISTS message_hidden (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_hidden_by_user ON message_hidden (user_id, hidden_at DESC);

CREATE TABLE IF NOT EXISTS message_pins (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_pins_by_user ON message_pins (user_id, pinned_at DESC);

-- Per-user channel action ("у меня"): hide dialog
CREATE TABLE IF NOT EXISTS channel_hidden (
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS channel_hidden_by_user ON channel_hidden (user_id, hidden_at DESC);

-- Ensure FK constraints have ON DELETE CASCADE (older DBs may have been created without it)
ALTER TABLE channel_members DROP CONSTRAINT IF EXISTS channel_members_channel_id_fkey;
ALTER TABLE channel_members
  ADD CONSTRAINT channel_members_channel_id_fkey
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_channel_id_fkey;
ALTER TABLE messages
  ADD CONSTRAINT messages_channel_id_fkey
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;

-- Backward-compatible adds (if table existed earlier)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Create default "general" channel
INSERT INTO channels (type, name)
SELECT 'general', 'Общий чат'
WHERE NOT EXISTS (
  SELECT 1 FROM channels WHERE type = 'general'
);

-- Ensure the general channel has the expected display name
UPDATE channels
SET name = 'Общий чат'
WHERE type = 'general' AND (name IS NULL OR btrim(name) = '' OR name ILIKE '%klub%');

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
