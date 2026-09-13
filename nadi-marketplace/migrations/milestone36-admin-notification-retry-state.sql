-- Nadi Airport Transfers — Milestone 36: durable admin-notification
-- delivery state (P0 retry fix, 2026-09-14).
--
-- CONFIRMED PRODUCTION INCIDENT this fixes: booking #60 (client_booking_ref
-- FD-PYC5VE). 15:13:45 booking created; 15:13:47 the rich admin WhatsApp
-- notification (Issue #53's buildFullBookingAdminSummary, sent via
-- sendHealthAlertWhatsApp) failed - Meta error 132018, "Param text cannot
-- have new-line/tab characters or more than 4 consecutive spaces". 15:15:47
-- a retry (the guest's own retry, replaying the same client_booking_ref)
-- reached the server but logged admin_notification_skipped_idempotent,
-- reason "replay of existing client_booking_ref" - ops was never notified,
-- and never could be for this booking, because BOOKING-level idempotency
-- (client_booking_ref already has a row) was being used as a proxy for
-- NOTIFICATION-level idempotency, with zero regard for whether the first
-- notification attempt had actually succeeded.
--
-- ROOT PROBLEM (verbatim from the mission): a failed provider send must
-- NOT permanently satisfy notification idempotency.
--
-- This table gives the admin notification its own durable delivery state,
-- completely independent of bookings.status and of booking-level
-- client_booking_ref idempotency (createBookingRecord's own idempotency
-- pre-check, Milestone 34, is UNCHANGED and UNTOUCHED by this migration -
-- a booking is still created/deduplicated exactly as before; only whether
-- ops has actually been notified about it is now tracked separately):
--
--   NOT_ATTEMPTED    — booking exists, no send has been attempted yet.
--   ATTEMPTING       — a send is in flight right now (claimed via the
--                       atomic UPDATE ... WHERE state IN (...) in
--                       claimAdminNotificationAttempt(), worker.js) - this
--                       is what makes two concurrent notification attempts
--                       for the same booking safe: only one caller's claim
--                       can ever see changes === 1.
--   FAILED_RETRYABLE — the most recent attempt did not reach a
--                       provider-confirmed success (Meta rejection, network
--                       error, or no admin_alert_phone configured at all).
--                       NEVER treated as SENT anywhere in worker.js - a
--                       booking in this state is eligible to be claimed
--                       and retried again, indefinitely, including via a
--                       guest's own retry replaying the same
--                       client_booking_ref.
--   SENT             — a provider-confirmed successful send (Meta returned
--                       200/ok with a WAMID or an accepting response). Once
--                       here, the row can never be re-claimed
--                       (claimAdminNotificationAttempt's WHERE clause only
--                       matches NOT_ATTEMPTED/FAILED_RETRYABLE) - a further
--                       replay correctly logs admin_notification_skipped_
--                       idempotent with reason "already sent", exactly the
--                       existing, correct behavior for a booking that was
--                       genuinely already delivered.
--
-- booking_id is the primary key (one row per booking, 1:1) and
-- client_booking_ref is carried alongside purely for observability/lookup
-- - the actual identity/authority for this row is always booking_id, never
-- the ref alone.
--
-- Purely additive: a new table, zero changes to bookings, booking_events,
-- or any existing column. Every existing booking simply has no row here
-- until its admin notification is next attempted (treated as
-- NOT_ATTEMPTED by claimAdminNotificationAttempt's own INSERT OR IGNORE).

CREATE TABLE admin_notification_state (
  booking_id INTEGER PRIMARY KEY REFERENCES bookings(id),
  client_booking_ref TEXT,
  state TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_provider_status INTEGER,
  wamid TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_notification_state_client_booking_ref
  ON admin_notification_state(client_booking_ref);
