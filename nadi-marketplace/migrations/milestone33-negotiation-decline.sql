-- Guest-comfort spec (2026-08-07): admin needs a real, active decline
-- action for a negotiation request. SQLite has no ALTER TABLE ... DROP/ADD
-- CONSTRAINT, so this is the same standard rebuild-and-swap already used
-- in milestone14b-escalation-trigger-type-fix.sql - same columns, same
-- data, wider CHECK allowlist (adds 'declined').

CREATE TABLE negotiation_requests_new (
  id INTEGER PRIMARY KEY,
  guest_name TEXT,
  guest_phone TEXT NOT NULL,
  pickup_zone TEXT NOT NULL,
  destination_zone TEXT NOT NULL,
  distance_km REAL,
  vehicle_type TEXT NOT NULL,
  passengers INTEGER,
  pickup_datetime TEXT,
  reference_fare_fjd REAL NOT NULL,
  guest_proposed_amount_fjd REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'expired', 'cancelled', 'declined')),
  booking_id INTEGER REFERENCES bookings(id),
  source_ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO negotiation_requests_new (id, guest_name, guest_phone, pickup_zone, destination_zone, distance_km,
    vehicle_type, passengers, pickup_datetime, reference_fare_fjd, guest_proposed_amount_fjd, status, booking_id,
    source_ip, created_at)
SELECT id, guest_name, guest_phone, pickup_zone, destination_zone, distance_km,
    vehicle_type, passengers, pickup_datetime, reference_fare_fjd, guest_proposed_amount_fjd, status, booking_id,
    source_ip, created_at
FROM negotiation_requests;

DROP TABLE negotiation_requests;
ALTER TABLE negotiation_requests_new RENAME TO negotiation_requests;

INSERT INTO platform_settings (key, value) VALUES ('negotiation_expiry_minutes', '5')
ON CONFLICT(key) DO UPDATE SET value = '5';
