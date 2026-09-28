-- Marau Stage 1 (PREVIEW/TEST ONLY) — round 14 correction (Codex
-- independent review, finding 2): the round-13 schema's
-- `source_event_ordinal` was fed by a per-test-run invented counter, not
-- a real, durable version. This adds `source_event_id`, meant to be
-- populated from the real `booking_events.id` (an auto-increment PRIMARY
-- KEY in the real schema — see nadi-marketplace/migrations/
-- milestone19-booking-events.sql — genuinely durable and monotonic across
-- retries, unlike a counter invented per sync run). `source_event_ordinal`
-- is left in place, unused going forward, rather than dropped — SQLite
-- can drop a plain column without a table rebuild, but there is no
-- production data to migrate and no reason to risk a rebuild for a
-- preview-only table; see worker/real_booking_sync.js for the one column
-- this module now actually reads/writes for ordering.
ALTER TABLE marau_test_bookings ADD COLUMN source_event_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_marau_test_bookings_source_event_id ON marau_test_bookings(source_event_id);
