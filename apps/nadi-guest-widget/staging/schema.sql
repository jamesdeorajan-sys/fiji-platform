-- nadi-marketplace-staging-db-v2 — schema and synthetic fixtures only.
-- No real customer, booking, driver, vehicle, wallet, phone, email,
-- WhatsApp or payment data. Zone names/coordinates and pricing_rules values
-- are business configuration (already public-facing pricing), not personal
-- data, and are reused as-is so staging behavior matches production
-- exactly for QA purposes.

CREATE TABLE zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  remote_multiplier REAL NOT NULL DEFAULT 1.0
);

CREATE TABLE pricing_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_type TEXT NOT NULL,
  distance_min_km REAL NOT NULL,
  distance_max_km REAL,
  base_rate_fjd_per_km REAL NOT NULL,
  flagfall_fjd REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- Deterministic mock "geocoding" cache — stands in for a real Maps API call.
-- Same purpose as production's geocoded_addresses table, populated only
-- with synthetic fixture addresses, never a real guest-submitted address.
CREATE TABLE geocoded_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_normalized TEXT NOT NULL UNIQUE,
  resolved INTEGER NOT NULL,
  distance_km REAL,
  nearest_zone_id INTEGER REFERENCES zones(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_reference TEXT NOT NULL UNIQUE,
  vehicle_type TEXT NOT NULL,
  trip_type TEXT NOT NULL DEFAULT 'one-way',
  pickup_zone TEXT,
  destination_zone TEXT,
  is_custom_address INTEGER NOT NULL DEFAULT 0,
  custom_address_query TEXT,
  distance_km REAL,
  quoted_amount REAL NOT NULL,
  pricing_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending_confirmation',
  -- Durable idempotency (Phase 3). Nullable so pre-existing/legacy-style
  -- rows without a key remain valid; the partial unique index only
  -- constrains rows that DO have a key.
  idempotency_key TEXT,
  idempotency_fingerprint TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The actual idempotency guarantee: SQLite/D1 enforces this atomically at
-- INSERT time regardless of which edge isolate issued the write, since a
-- D1 database has a single authoritative write location. This is what
-- makes "concurrent requests on different isolates create exactly one
-- booking" true - not any in-memory/global-scope cache.
CREATE UNIQUE INDEX idx_bookings_idempotency_key
  ON bookings (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE manual_quote_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reason_code TEXT NOT NULL,
  vehicle_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Synthetic fixtures ──────────────────────────────────────────────────
INSERT INTO zones (name, lat, lng, remote_multiplier) VALUES
  ('Nadi Airport', -17.75, 177.44, 1.0),
  ('Denarau', -17.77, 177.38, 1.0),
  ('Coral Coast', -18.20, 177.70, 1.1);

INSERT INTO pricing_rules (vehicle_type, distance_min_km, distance_max_km, base_rate_fjd_per_km, flagfall_fjd, active) VALUES
  ('sedan', 0, 15, 3.592, 5.57, 1),
  ('sedan', 15, 35, 1.568, 44.19, 1),
  ('sedan', 35, 70, 1.438, 38.75, 1),
  ('sedan', 70, 160, 1.12, 33.65, 1),
  ('sedan', 160, 300, 1.852, -47.67, 1),
  ('minivan', 0, 15, 3.581, 26.91, 1),
  ('minivan', 15, 35, 2.622, 43.54, 1),
  ('minivan', 35, 70, 0.479, 128.92, 1),
  ('minivan', 70, 160, 1.764, 6.22, 1),
  ('minivan', 160, 300, 4.815, -584.33, 1),
  ('minibus', 0, 15, 4.133, 51.17, 1),
  ('minibus', 15, 35, 2.622, 73.54, 1),
  ('minibus', 35, 70, 0.956, 139.0, 1),
  ('minibus', 70, 160, 1.576, 66.96, 1),
  ('minibus', 160, 300, 1.852, 132.33, 1);

-- Synthetic resolvable fixture address (fabricated, not a real guest address).
INSERT INTO geocoded_addresses (query_normalized, resolved, distance_km, nearest_zone_id)
  VALUES ('from_airport:42 example lane, martintar', 1, 8.4, (SELECT id FROM zones WHERE name = 'Denarau'));

-- One synthetic pre-existing booking WITHOUT an idempotency key, proving
-- Phase 3 requirement 9 (existing keyless bookings remain valid alongside
-- the new unique-index constraint).
INSERT INTO bookings (booking_reference, vehicle_type, trip_type, pickup_zone, destination_zone, is_custom_address, distance_km, quoted_amount, status, idempotency_key, idempotency_fingerprint)
  VALUES ('STG-LEGACY-000001', 'sedan', 'one-way', 'Nadi Airport', 'Denarau', 0, 12, 48.67, 'pending_confirmation', NULL, NULL);
