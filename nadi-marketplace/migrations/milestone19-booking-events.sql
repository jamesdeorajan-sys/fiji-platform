-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 19: booking_events audit trail.
--
-- Additive only - the existing bookings table (real guests, wallet
-- transactions, escalations, vehicles all foreign-keyed to it) is
-- completely unchanged. This is a new, separate table logged to
-- alongside existing status-transition points already in worker.js,
-- not a replacement or restructuring of anything.
--
-- event_type is deliberately NOT a CHECK-constrained enum (unlike
-- escalations.trigger_type) - the real event types emitted today are
-- 'created', 'accepted', 'en_route', 'completed', 'escalated', but
-- this is an audit log, not a strict state machine, and locking the
-- column down would need a migration every time a new event type is
-- added. 'cancelled' is intentionally NOT emitted anywhere yet - no
-- cancellation flow exists in this codebase currently, so nothing
-- would ever produce that row; the column can carry it the moment a
-- real cancellation path is built.
--
-- actor is a free-text label ('guest', 'admin', 'system', or
-- 'driver:<id>') rather than a foreign key - it needs to represent
-- non-driver actors (guest, admin, system) that have no row in any
-- existing table to reference.

CREATE TABLE booking_events (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  event_type TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  actor TEXT,
  metadata TEXT, -- JSON, optional context
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_booking_events_booking_id ON booking_events(booking_id);
