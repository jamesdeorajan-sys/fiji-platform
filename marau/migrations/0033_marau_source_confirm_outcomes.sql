-- Marau Stage 1 (PREVIEW/TEST ONLY) — round 27: the next bounded
-- integration slice against a synthetic SOURCE API CLIENT (not a direct
-- table UPDATE the way marau_synthetic_source_bookings's existing
-- confirm workflow, rounds 19-22, already proved). worker/source_confirm.js's
-- own header explains why this table exists: a real cross-system HTTP
-- call can commit a write and then lose its response on the way back —
-- a failure mode a same-process D1 UPDATE cannot exercise. This table
-- is the durable, LOCAL record of the outcome for a given
-- source_booking_ref, written EXACTLY ONCE ever (UNIQUE), so a retry —
-- however many times, from whatever caller — reads the original
-- decision back instead of re-deciding, re-notifying, or re-attributing
-- it to a different operator.
CREATE TABLE IF NOT EXISTS marau_source_confirm_outcomes (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  source_booking_ref    TEXT NOT NULL UNIQUE,
  outcome               TEXT NOT NULL CHECK (outcome IN ('confirmed', 'conflict')),
  intended_driver_id    TEXT NOT NULL,
  confirmed_driver_id   TEXT,
  operator              TEXT,
  recovered_via_readback INTEGER NOT NULL DEFAULT 0,
  decided_at            TEXT NOT NULL
);
