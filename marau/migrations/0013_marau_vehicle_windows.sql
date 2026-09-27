-- Marau Stage 1 (PREVIEW/TEST ONLY) — records which real vehicle, and
-- during what window, a movement (shadow-leg source) or an ordinary
-- booking is assigned to. This does NOT exist anywhere in Issue #54's own
-- schema (movements has no vehicle identifier at all — consistent with
-- that issue's own long-standing gap: "vehicle/driver identity,
-- availability... none in practice"). It is Marau-scoped and additive: it
-- does not alter `movements` or `smart_offers`.
--
-- In a real system this would be populated from ops-verified dispatch
-- assignment data (the same missing input Issue #54 has been asking for
-- since 2026-09-14). In this preview it is set directly by fixtures/ops,
-- standing in for that data source.
--
-- A movement or booking with NO row here has UNKNOWN vehicle/availability
-- — worker.js's confirm handlers treat that as a hard block, never as
-- "assume fine" (mission: "Unknown vehicle/availability must block
-- confirmation").
CREATE TABLE IF NOT EXISTS vehicle_windows (
  subject_type  TEXT NOT NULL CHECK (subject_type IN ('MOVEMENT', 'BOOKING')),
  subject_id    TEXT NOT NULL,       -- movements.movement_id, or marau_test_bookings.id as text
  vehicle_id    TEXT NOT NULL,
  window_start  TEXT NOT NULL,
  window_end    TEXT NOT NULL,
  test_data     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_windows_vehicle ON vehicle_windows(vehicle_id);
