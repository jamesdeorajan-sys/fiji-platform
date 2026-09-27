-- Marau Stage 1 (PREVIEW/TEST ONLY) — isolated test equivalent of the real
-- nadi-marketplace-db `bookings` flow. This table is NOT the real
-- `bookings` table and lives only in Marau's own isolated test D1 — no
-- migration in this file touches nadi-marketplace-db.
--
-- Mirrors the real table's contact-validation shape closely enough to
-- prove the required behaviour (client_booking_ref idempotency key,
-- guest_email/guest_phone both NOT NULL — server-side enforcement of a
-- rule already client-side-only on the real sites per Issue #59's open
-- item) without being a byte-for-byte copy of production schema.
CREATE TABLE IF NOT EXISTS marau_test_bookings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  client_booking_ref  TEXT NOT NULL UNIQUE,   -- idempotency key; a retried submit returns the same row
  guest_session_id    TEXT NOT NULL REFERENCES guest_sessions(session_id),
  guest_email         TEXT NOT NULL,
  guest_phone         TEXT NOT NULL,
  pickup_zone         TEXT NOT NULL,
  destination_zone    TEXT NOT NULL,
  vehicle_type        TEXT NOT NULL,
  pickup_datetime     TEXT NOT NULL,
  quoted_amount       REAL NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled')),
  test_data           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marau_test_bookings_session ON marau_test_bookings(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_marau_test_bookings_status ON marau_test_bookings(status);
