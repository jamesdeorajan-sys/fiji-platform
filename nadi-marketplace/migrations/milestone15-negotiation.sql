-- Milestone 15: guest price negotiation, in-house drivers only (FTT's own
-- registered drivers - opening this to outside companies stays a
-- documented future phase, not this build).
--
-- Two new tables, not a bookings.status value: a bookings row has exactly
-- one assigned_driver_id and a state machine that assumes a single
-- committed job. An open negotiation can have multiple drivers
-- independently responding to the same guest request before anything is
-- committed - that doesn't fit one row with one driver column. A real
-- bookings row only gets created once the guest actually accepts an offer
-- (see handleNegotiationAcceptOffer in worker.js), via the same
-- createBookingRecord() path a normal fixed-fare booking already uses.

CREATE TABLE negotiation_requests (
  id INTEGER PRIMARY KEY,
  guest_name TEXT,
  guest_phone TEXT NOT NULL,
  pickup_zone TEXT NOT NULL,
  destination_zone TEXT NOT NULL,
  distance_km REAL,
  vehicle_type TEXT NOT NULL,          -- road only (sedan/minivan/minibus) - a boat fare is a real third-party bundled price FTT doesn't set, so negotiating it doesn't make sense
  passengers INTEGER,
  pickup_datetime TEXT,
  -- Both client-supplied, same trust level quoted_amount already has on
  -- POST /bookings (the guest widget computed/fetched reference_fare_fjd
  -- via the existing quote flow before ever reaching this endpoint) -
  -- informational context for the driver deciding whether to counter, not
  -- re-derived server-side.
  reference_fare_fjd REAL NOT NULL,
  guest_proposed_amount_fjd REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'expired', 'cancelled')),
  booking_id INTEGER REFERENCES bookings(id),
  source_ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE negotiation_offers (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES negotiation_requests(id),
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  offer_type TEXT NOT NULL CHECK (offer_type IN ('accept', 'counter')),
  offer_amount_fjd REAL NOT NULL,      -- accept: mirrors guest_proposed_amount_fjd at response time; counter: driver's own number
  guest_decision TEXT NOT NULL DEFAULT 'pending' CHECK (guest_decision IN ('pending', 'accepted', 'declined')),
  created_at TEXT DEFAULT (datetime('now')),
  -- Enforces "one accept or one counter per driver, no multi-round
  -- back-and-forth" at the database level, not just in application code.
  UNIQUE(request_id, driver_id)
);

INSERT INTO platform_settings (key, value) VALUES ('negotiation_expiry_minutes', '20');
INSERT INTO platform_settings (key, value) VALUES ('negotiation_rate_limit_max_per_day', '5');
INSERT INTO platform_settings (key, value) VALUES ('negotiation_rate_limit_window_minutes', '10');
