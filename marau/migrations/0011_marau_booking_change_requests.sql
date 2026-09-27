-- Marau Stage 1 (PREVIEW/TEST ONLY) — requested changes to a booking stay
-- separate from the booking itself until an authenticated ops action
-- approves them (mission requirement: "Requested changes remain separate
-- from the original booking until approved"). Nothing in worker.js ever
-- writes requested_fields_json onto marau_test_bookings directly.
CREATE TABLE IF NOT EXISTS booking_change_requests (
  change_request_id    TEXT PRIMARY KEY,
  booking_id           INTEGER NOT NULL REFERENCES marau_test_bookings(id),
  requested_fields_json TEXT NOT NULL,   -- proposed diff only, e.g. {"pickup_datetime": "..."}
  status               TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  decided_by           TEXT,
  created_at           TEXT NOT NULL,
  decided_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_booking_change_requests_booking ON booking_change_requests(booking_id);
