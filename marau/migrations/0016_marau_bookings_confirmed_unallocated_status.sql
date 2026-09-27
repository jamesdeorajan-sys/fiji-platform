-- Marau Stage 1 (PREVIEW/TEST ONLY) — a distinct, honest status for an
-- ordinary booking confirmed with NO known vehicle assignment.
--
-- FIX for a second-review finding: "Enforce the agreed unknown-vehicle
-- rule consistently. Ordinary booking confirmation currently succeeds
-- without allocation... do not silently treat it as allocated/confirmed."
-- worker.js's handleAdminDecideBooking used to write the SAME 'confirmed'
-- status whether or not a vehicle_windows row existed for the booking,
-- so a confirmed-with-no-known-vehicle booking was indistinguishable
-- from a confirmed-and-allocated one. It now writes 'confirmed_unallocated'
-- for that case instead — operational acceptance is preserved (ops can
-- still confirm without a vehicle on record, since Stage 1 does not
-- require every ordinary booking to have a known vehicle), but it is
-- never conflated with a real vehicle/time allocation.
--
-- SQLite cannot ALTER a CHECK constraint in place, so this recreates the
-- table with the widened constraint — the same _new/rename technique
-- already used elsewhere in this codebase for an identical reason (see
-- nadi-marketplace/migrations/milestone14b-escalation-trigger-type-fix.sql
-- and milestone33-negotiation-decline.sql). This table is preview/test
-- data only; there is nothing destructive about recreating it.
CREATE TABLE marau_test_bookings_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  client_booking_ref  TEXT NOT NULL UNIQUE,
  guest_session_id    TEXT NOT NULL REFERENCES guest_sessions(session_id),
  guest_email         TEXT NOT NULL,
  guest_phone         TEXT NOT NULL,
  pickup_zone         TEXT NOT NULL,
  destination_zone    TEXT NOT NULL,
  vehicle_type        TEXT NOT NULL,
  pickup_datetime     TEXT NOT NULL,
  quoted_amount       REAL NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'confirmed_unallocated', 'declined', 'cancelled')),
  test_data           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

INSERT INTO marau_test_bookings_new SELECT * FROM marau_test_bookings;
DROP TABLE marau_test_bookings;
ALTER TABLE marau_test_bookings_new RENAME TO marau_test_bookings;

CREATE INDEX IF NOT EXISTS idx_marau_test_bookings_session ON marau_test_bookings(guest_session_id);
CREATE INDEX IF NOT EXISTS idx_marau_test_bookings_status ON marau_test_bookings(status);
