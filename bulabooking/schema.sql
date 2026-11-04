-- D1 design draft; not applied to any database.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS operators (
 id TEXT PRIMARY KEY, legal_name TEXT NOT NULL, display_name TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','suspended','rejected')),
 contact_email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS experiences (
 id TEXT PRIMARY KEY, operator_id TEXT NOT NULL REFERENCES operators(id),
 slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL,
 price_fjd_cents INTEGER NOT NULL CHECK(price_fjd_cents>=0),
 capacity INTEGER NOT NULL CHECK(capacity>0),
 pay_later INTEGER NOT NULL DEFAULT 0 CHECK(pay_later IN (0,1)),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','published','paused')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_experiences_operator ON experiences(operator_id);
CREATE TABLE IF NOT EXISTS bookings (
 id TEXT PRIMARY KEY, experience_id TEXT NOT NULL REFERENCES experiences(id),
 operator_id TEXT NOT NULL REFERENCES operators(id),
 idempotency_key TEXT NOT NULL UNIQUE, guest_contact_ciphertext TEXT NOT NULL,
 guests INTEGER NOT NULL CHECK(guests>0), service_date TEXT NOT NULL,
 quoted_total_fjd_cents INTEGER NOT NULL CHECK(quoted_total_fjd_cents>=0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','cancelled','completed','expired')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookings_operator_status ON bookings(operator_id,status);
CREATE TABLE IF NOT EXISTS booking_events (
 id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id),
 actor_type TEXT NOT NULL, actor_id TEXT, event_type TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Must implement authenticated tenant-scoped access in Worker; D1 has no built-in row-level security.
-- Inventory locking, encryption/key management, notifications, retention and state transitions are NOT implemented.
