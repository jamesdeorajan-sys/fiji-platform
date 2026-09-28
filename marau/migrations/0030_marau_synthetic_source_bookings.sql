-- Marau Stage 1 (PREVIEW/TEST ONLY) — round 19. A D1-backed synthetic
-- "authoritative real source" for the HOSTED demonstration of the round
-- 17/18 real-booking-sync design (worker/real_booking_sync.js). This is
-- NOT a copy of, or a binding to, the real `bookings` table — it is a
-- test-only stand-in ops can seed/mutate over HTTP (admin-token gated)
-- to demonstrate the sync module's injected-`reader` contract against
-- the live, isolated preview Worker/D1, the same way the local test
-- suite's in-memory synthetic source does. No production database
-- binding of any kind is introduced by this table.
CREATE TABLE IF NOT EXISTS marau_synthetic_source_bookings (
  source_booking_ref  TEXT PRIMARY KEY,
  source_id            INTEGER NOT NULL,
  guest_email          TEXT NOT NULL,
  guest_phone          TEXT NOT NULL,
  whatsapp_available   INTEGER,
  pickup_zone          TEXT NOT NULL,
  destination_zone     TEXT NOT NULL,
  vehicle_type         TEXT NOT NULL,
  pickup_date          TEXT NOT NULL,
  pickup_time          TEXT NOT NULL,
  quoted_amount        REAL,
  assigned_driver_id   TEXT,
  status               TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
