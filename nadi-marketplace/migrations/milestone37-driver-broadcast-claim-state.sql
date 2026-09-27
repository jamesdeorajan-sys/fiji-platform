-- Nadi Airport Transfers — Milestone 37: durable, per-driver claim state for the driver broadcast (issue #59).
--
-- CONFIRMED GAPS, reported by Codex against ceo/p0-notification-reconcile @ 87816a5:
--   1. Partial broadcast interruption: sweepDriverBroadcasts() only recovered drivers who had a recorded
--      driver_broadcast_failed event. A driver the Worker never even attempted (the isolate died mid-broadcast,
--      after driver A's send resolved but before B and C were attempted) had NO event at all, so the sweep's
--      "retry the drivers who failed" logic never selected B or C — they were permanently un-notified.
--   2. Driver recovery batch starvation: the sweep's SQL fetched `ORDER BY id LIMIT 10` pending/unassigned
--      bookings and treated every fetched row as consuming one of the 10 recovery slots, even when a booking's
--      broadcast was already fully complete (nothing left to do). Ten older, fully-done-but-still-pending
--      bookings therefore permanently occupied the query window and an eleventh booking that genuinely needed
--      its initial broadcast was never reached, including after repeated sweeps.
--   3. (found while fixing the above) Nothing made two concurrent sweep ticks, or a sweep tick overlapping the
--      booking's own creation-time broadcast, safe from sending the same driver the same message twice — the old
--      "read booking_events, decide who's missing, send" sequence has no atomicity across two Worker isolates.
--
-- This table gives each (booking, driver) broadcast attempt the SAME durable, race-safe claim contract
-- admin_notification_state (milestone36) already gives the admin alert: an atomic UPDATE ... RETURNING claim,
-- monotonic SENT, and a per-attempt fencing token, so gap 1 and gap 3 are structurally impossible, not merely
-- less likely. Gap 2 is fixed separately, in worker.js's sweepDriverBroadcasts() (a completed/no-op booking is
-- skipped without consuming a recovery slot), and does not need a schema change.
--
--   NOT_ATTEMPTED    — this driver has never had a send attempted for this booking.
--   ATTEMPTING       — a send is in flight right now (claimed via claimDriverBroadcastAttempt(), worker.js).
--   FAILED_RETRYABLE — the most recent attempt did not reach a provider-confirmed success; eligible to be
--                       claimed and retried again, up to DRIVER_BROADCAST_MAX_TRIES (worker.js).
--   SENT             — a provider-confirmed successful send. Never re-claimed (the claim's WHERE clause only
--                       matches NOT_ATTEMPTED/FAILED_RETRYABLE); a stale-claim reclaim or an overlapping sweep
--                       cannot re-send once this state is reached (completion is itself `WHERE state != 'SENT'`).
--
-- (booking_id, driver_id) is the primary key — one row per driver per booking, never per attempt.
-- Purely additive: a new table, zero changes to bookings, booking_events, drivers or admin_notification_state.
-- Idempotent on retry (IF NOT EXISTS on both statements).

CREATE TABLE IF NOT EXISTS driver_broadcast_attempts (
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  state TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_provider_status INTEGER,
  last_outcome TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (booking_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_broadcast_attempts_booking ON driver_broadcast_attempts(booking_id);
