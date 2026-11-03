-- Driver PWA v2 — Gate 1 ISOLATED schema fixture (TESTED_NOT_LIVE).
-- Applied ONLY to in-memory / throw-away SQLite databases by the Gate 1 harness.
-- NOT a production migration. Nothing here is authorised for any production D1.
-- The booking_events / drivers / bookings / driver_broadcast_attempts shapes mirror what the recovered
-- production schema already has; only driver_offers, dispatch_runs, dispatch_escalations, driver_evidence
-- and driver_sessions are new concepts, and they are separate tables (bookings is not widened).

CREATE TABLE drivers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,           -- Gate 1: obvious non-production placeholders only
  status TEXT NOT NULL DEFAULT 'pending',
  zones TEXT NOT NULL,                  -- JSON array
  online INTEGER NOT NULL DEFAULT 0,
  forced_offline_until TEXT,
  created_at TEXT
);

CREATE TABLE driver_sessions (
  token TEXT PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  booking_ref TEXT NOT NULL UNIQUE,     -- Gate 1: always 'SYN-GATE1-...'
  guest_name TEXT,
  guest_phone TEXT,
  guest_email TEXT,
  flight_number TEXT,
  pickup_notes TEXT,
  pickup_zone TEXT NOT NULL,
  destination_zone TEXT NOT NULL,
  distance_km REAL,
  vehicle_type TEXT NOT NULL,
  quoted_currency TEXT NOT NULL,
  quoted_amount REAL NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- coarse production model: pending|accepted|en_route|completed|cancelled
  assigned_driver_id INTEGER REFERENCES drivers(id),
  created_at TEXT
);

-- Immutable operational timeline (shape of the production table; event_type has NO CHECK so detailed lifecycle can evolve).
CREATE TABLE booking_events (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  event_type TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  actor TEXT,
  metadata TEXT,                        -- JSON: offer_id, driver_id, reason_code, phase, critical
  created_at TEXT
);
CREATE INDEX idx_booking_events_booking_id ON booking_events(booking_id);
-- Replay-safety: a detailed lifecycle stage / decision / fallback can be recorded at most once per booking.
CREATE UNIQUE INDEX uq_booking_events_lifecycle ON booking_events(booking_id, event_type)
  WHERE event_type IN ('DRIVER_ASSIGNED','EN_ROUTE_PICKUP','ARRIVED_PICKUP','PICKUP_VALIDATED','PASSENGER_ONBOARD',
                       'EN_ROUTE_DESTINATION','ARRIVED_DESTINATION','COMPLETED','REVIEW_REQUESTED','REVIEW_RECEIVED',
                       'HUMAN_FALLBACK_REQUIRED','ASSIGNMENT_PERSISTED');

-- Notification / delivery attempt EVIDENCE only. No decision state lives here.
CREATE TABLE driver_broadcast_attempts (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  offer_id TEXT,                        -- correlation key only
  attempt_no INTEGER NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,                 -- SUPPRESSED_CAPTURED | DELIVERED | FAILED
  provider_reason_code TEXT,
  created_at TEXT
);

-- Offer / decision lifecycle. No guest PII. One decision per offer.
CREATE TABLE driver_offers (
  offer_id TEXT PRIMARY KEY,            -- opaque / unguessable
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  state TEXT NOT NULL CHECK (state IN ('OFFERED','VIEWED','ACCEPTED','DECLINED','TIMED_OUT','SUPERSEDED')),
  dispatch_phase TEXT NOT NULL CHECK (dispatch_phase IN ('PRIORITY','CONNECTIVITY_GRACE','ESCALATED_DISPATCH')),
  offered_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,             -- hard bound = dispatch deadline (run start + 180 s)
  viewed_at TEXT,
  reach_evidence_at TEXT,               -- first proof the driver's device was reachable (delivery / view / session)
  reach_evidence_source TEXT,
  decision_at TEXT,
  decision_reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (booking_id, driver_id)
);
CREATE INDEX idx_driver_offers_booking ON driver_offers(booking_id);
CREATE INDEX idx_driver_offers_driver_state ON driver_offers(driver_id, state);

CREATE TABLE dispatch_runs (
  booking_id INTEGER PRIMARY KEY REFERENCES bookings(id),
  started_at TEXT NOT NULL                -- authoritative server time the 0/60/120/180 s clocks run from
);

CREATE TABLE dispatch_escalations (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  trigger_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL,
  UNIQUE (booking_id, trigger_type)       -- repeated sweeps cannot create duplicate escalations
);

-- Object-storage REFERENCE + metadata only. Never binary in bookings.
CREATE TABLE driver_evidence (
  evidence_id TEXT PRIMARY KEY,
  client_evidence_id TEXT NOT NULL UNIQUE,  -- retry idempotency key supplied by the PWA
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  kind TEXT NOT NULL CHECK (kind IN ('PICKUP','DROPOFF')),
  object_key TEXT NOT NULL,
  sha256 TEXT,
  bytes INTEGER,
  created_at TEXT NOT NULL
);

-- Present ONLY so Gate 1 can assert financial state is untouched.
CREATE TABLE wallets (driver_id INTEGER PRIMARY KEY, balance_fjd REAL NOT NULL);
CREATE TABLE wallet_transactions (
  id INTEGER PRIMARY KEY, driver_id INTEGER NOT NULL, booking_id INTEGER, type TEXT NOT NULL, amount_fjd REAL NOT NULL, created_at TEXT
);
