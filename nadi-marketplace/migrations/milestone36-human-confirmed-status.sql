-- Nadi Airport Transfers — Milestone 36: authoritative human-confirmed
-- booking state.
--
-- CORRECTED 2026-09-14 per CEO P0 review of the original version of this
-- migration (which repurposed bookings.status = 'human_confirmed'). That
-- design was rejected: bookings.status is load-bearing for the existing
-- operational driver-accept flow — handleDriverAcceptBooking() and
-- handleAdminManualAssign() (worker.js) both do
-- `UPDATE bookings SET assigned_driver_id = ?, status = 'accepted'
--  WHERE id = ? AND assigned_driver_id IS NULL AND status = 'pending'`.
-- Any booking whose status had been overwritten to 'human_confirmed' would
-- silently fail that WHERE clause forever — no driver could ever accept a
-- human-confirmed booking. That is a P0 state-machine conflict, not a
-- cosmetic issue.
--
-- CORRECTED DESIGN: human confirmation is orthogonal to operational status.
-- bookings.status keeps its existing, unmodified lifecycle end to end:
--   pending -> accepted -> en_route -> completed
--   (-> cancelled reachable from most non-terminal states, unchanged)
-- "Has a real staff member checked this booking is genuinely happening" is
-- recorded as two new nullable columns instead, set exactly once and never
-- read by, or interfering with, any existing status-driven query:
--
--   bookings.human_confirmed_at  TEXT NULL  — ISO-8601 UTC timestamp, set
--     once by POST /admin/bookings/:id/human-confirm (worker.js).
--   bookings.human_confirmed_by  TEXT NULL  — always the literal 'admin'
--     (see handleAdminHumanConfirm(); this state can only be created by an
--     authenticated admin action, never a driver, guest, or cron/system
--     process — there is no route or code path that sets a different
--     value).
--
-- Both are ADDITIVE ALTER TABLE ADD COLUMN statements — SQLite adds a
-- nullable column to every existing row without rewriting or touching any
-- of that row's other data. Every existing pending/accepted/en_route/
-- completed/cancelled row is completely unaffected: it simply gains these
-- two columns, both NULL, exactly as if the columns had always existed and
-- had never been set for that row.
--
-- CONTRACT for the human_confirmed booking_events row this endpoint writes
-- alongside setting the two columns above (never a status column change):
--   booking_events.event_type      = 'human_confirmed'
--   booking_events.previous_status = <bookings.status at confirm time>
--   booking_events.new_status      = NULL (no operational transition
--     occurred — human confirmation does not change bookings.status, so
--     there is nothing to record as a "new" status; previous_status alone
--     is the audit record of what the operational status was at the time)
--   booking_events.actor           = 'admin' (always)
--
-- Smart Return's trigger condition (production_adapter.js) requires ALL of:
--   bookings.human_confirmed_at IS NOT NULL
--   a booking_events row for the same booking_id with
--     event_type = 'human_confirmed' AND actor = 'admin'
-- It must never be keyed off bookings.status, assigned_driver_id, or any
-- notification-sent signal.
--
-- Indexes: bookings.status and booking_events.event_type currently have no
-- index at all (only booking_events.booking_id does - see
-- idx_booking_events_booking_id). Smart Return's read-only export query
-- filters on human_confirmed_at IS NOT NULL and booking_events.event_type -
-- these will do a full table scan without indexes. Purely additive, zero
-- risk to existing rows or queries.

ALTER TABLE bookings ADD COLUMN human_confirmed_at TEXT NULL;
ALTER TABLE bookings ADD COLUMN human_confirmed_by TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_human_confirmed_at ON bookings(human_confirmed_at);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_booking_events_event_type ON booking_events(event_type);
