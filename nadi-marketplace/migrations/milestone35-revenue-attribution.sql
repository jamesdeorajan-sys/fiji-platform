-- Milestone 35 — revenue attribution metadata for completed-booking reporting.
-- Metadata only: these fields must never affect fare calculation, dispatch,
-- idempotency, booking confirmation, or customer-facing booking truth.

ALTER TABLE bookings ADD COLUMN first_source TEXT;
ALTER TABLE bookings ADD COLUMN first_medium TEXT;
ALTER TABLE bookings ADD COLUMN first_campaign TEXT;
ALTER TABLE bookings ADD COLUMN first_content TEXT;
ALTER TABLE bookings ADD COLUMN first_term TEXT;
ALTER TABLE bookings ADD COLUMN first_referrer TEXT;
ALTER TABLE bookings ADD COLUMN first_landing_path TEXT;
ALTER TABLE bookings ADD COLUMN first_seen_at TEXT;

ALTER TABLE bookings ADD COLUMN last_source TEXT;
ALTER TABLE bookings ADD COLUMN last_medium TEXT;
ALTER TABLE bookings ADD COLUMN last_campaign TEXT;
ALTER TABLE bookings ADD COLUMN last_content TEXT;
ALTER TABLE bookings ADD COLUMN last_term TEXT;
ALTER TABLE bookings ADD COLUMN last_referrer TEXT;
ALTER TABLE bookings ADD COLUMN last_landing_path TEXT;

ALTER TABLE bookings ADD COLUMN attribution_source TEXT;

CREATE INDEX IF NOT EXISTS idx_bookings_attribution_source
  ON bookings(attribution_source);
