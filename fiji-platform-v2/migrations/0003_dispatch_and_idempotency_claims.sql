-- A unique booking claim turns a lost dispatch race into a constraint failure,
-- causing D1/SQLite to roll back every statement in the atomic batch.
CREATE TABLE dispatch_claims (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
  offer_id TEXT NOT NULL UNIQUE REFERENCES dispatch_offers(id),
  driver_id TEXT NOT NULL REFERENCES drivers(id),
  claimed_at TEXT NOT NULL
);
CREATE TRIGGER validate_dispatch_claim
BEFORE INSERT ON dispatch_claims
WHEN NOT EXISTS (
  SELECT 1
  FROM dispatch_offers offer
  JOIN bookings booking ON booking.id = offer.booking_id
  WHERE offer.id = NEW.offer_id
    AND offer.booking_id = NEW.booking_id
    AND offer.driver_id = NEW.driver_id
    AND offer.state = 'offered'
    AND offer.expires_at > NEW.claimed_at
    AND booking.state = 'dispatching'
    AND booking.assigned_driver_id IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'invalid dispatch claim');
END;

-- A reservation retained alongside its result ensures only one concurrent
-- request executes a mutation. Cleanup removes claim and evidence together.
CREATE TABLE idempotency_claims (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY(scope, idempotency_key)
);
