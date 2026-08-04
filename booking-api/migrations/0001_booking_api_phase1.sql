-- Booking API Phase 1
-- Apply with Wrangler only after the separately authorized staging/production gate.
PRAGMA foreign_keys = ON;

CREATE TABLE fare_quotes (
  id TEXT PRIMARY KEY,
  fare_authority_ref TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'FJD'),
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'ACCEPTED')),
  expires_at TEXT NOT NULL,
  traveler_ref TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  accepted_at TEXT
);

CREATE TABLE fare_quote_lines (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES fare_quotes(id) ON DELETE RESTRICT,
  line_type TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_amount_minor INTEGER NOT NULL,
  total_amount_minor INTEGER NOT NULL,
  source_ref TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (quote_id, position)
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL UNIQUE REFERENCES fare_quotes(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN (
    'BOOKING_CREATED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'ASSIGNED',
    'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  )),
  traveler_ref TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  consent_ref TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancellation_reason TEXT
);

CREATE TABLE booking_passengers (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  passenger_type TEXT NOT NULL CHECK (passenger_type IN ('ADULT', 'CHILD', 'INFANT')),
  display_name TEXT,
  accessibility_notes TEXT,
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (booking_id, position)
);

CREATE TABLE transfer_legs (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  origin_ref TEXT NOT NULL,
  destination_ref TEXT NOT NULL,
  service_at TEXT NOT NULL,
  flight_number TEXT,
  notes TEXT,
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (booking_id, position)
);

CREATE TABLE booking_status_history (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE idempotency_keys (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
);

CREATE TABLE outbox_events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  payload TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

CREATE TABLE communications (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED')),
  provider_ref TEXT,
  template_ref TEXT,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER prevent_terminal_booking_cancellation
BEFORE UPDATE OF status ON bookings
WHEN NEW.status = 'CANCELLED' AND OLD.status IN ('CANCELLED', 'COMPLETED')
BEGIN
  SELECT RAISE(ABORT, 'booking is not cancellable');
END;

CREATE INDEX idx_fare_quotes_expiry ON fare_quotes(status, expires_at);
CREATE INDEX idx_quote_lines_quote ON fare_quote_lines(quote_id);
CREATE INDEX idx_bookings_traveler ON bookings(traveler_ref, created_at);
CREATE INDEX idx_booking_passengers_booking ON booking_passengers(booking_id);
CREATE INDEX idx_transfer_legs_booking ON transfer_legs(booking_id);
CREATE INDEX idx_booking_history_booking ON booking_status_history(booking_id, created_at);
CREATE INDEX idx_outbox_unpublished ON outbox_events(published_at, created_at);
CREATE INDEX idx_communications_booking ON communications(booking_id, created_at);
