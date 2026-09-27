-- Marau Stage 1 (PREVIEW/TEST ONLY) — the real vehicle/time exclusivity
-- guard.
--
-- FIX for a P0 Codex finding: `vehicle_time_claims` (0010) has a PRIMARY
-- KEY on `source_movement_id`, which prevents the SAME movement being
-- claimed twice — it says nothing about two DIFFERENT movements assigned
-- to the SAME real vehicle with OVERLAPPING time windows, which the
-- mission's own reproduction showed both confirming (200/200). This table
-- is the actual guard for that case. It applies to BOTH a deal-request
-- confirmation and an ordinary booking confirmation, whichever one
-- consumes a vehicle's time first wins; the other is rejected — see
-- worker.js's shared claimVehicleAllocation()/releaseVehicleAllocation().
--
-- The exclusivity mechanism is a single INSERT ... SELECT ... WHERE NOT
-- EXISTS statement (see worker.js) rather than a UNIQUE/PRIMARY KEY,
-- because the conflict condition is a TIME-RANGE OVERLAP, not equality,
-- and SQLite/D1 have no exclusion-constraint feature. Executing the
-- existence check and the insert as one statement is what makes it
-- atomic: SQLite evaluates a single statement under its own internal
-- write lock, so no other writer can interleave between the NOT EXISTS
-- check and the INSERT within that one statement — the same atomicity
-- guarantee `casOfferStatus`'s single conditional UPDATE relies on,
-- applied to a range condition instead of an equality condition.
CREATE TABLE IF NOT EXISTS vehicle_allocations (
  allocation_id  TEXT PRIMARY KEY,
  vehicle_id     TEXT NOT NULL,
  window_start   TEXT NOT NULL,
  window_end     TEXT NOT NULL,
  subject_type   TEXT NOT NULL CHECK (subject_type IN ('DEAL_REQUEST', 'BOOKING')),
  subject_id     TEXT NOT NULL,     -- deal_requests.request_id, or marau_test_bookings.id as text
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicle_allocations_vehicle ON vehicle_allocations(vehicle_id);
