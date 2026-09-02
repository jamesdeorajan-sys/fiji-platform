CREATE TABLE drivers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  zones TEXT NOT NULL,
  online INTEGER NOT NULL DEFAULT 0,
  online_since TEXT,
  max_hours_cap INTEGER DEFAULT 12,
  license_photo_url TEXT,
  insurance_photo_url TEXT,
  custom_rate_enabled INTEGER DEFAULT 0,
  custom_rate_fjd_per_km REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE vehicles (
  id INTEGER PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  type TEXT NOT NULL,
  plate TEXT NOT NULL,
  photo_url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE zones (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE fuel_index (
  id INTEGER PRIMARY KEY,
  fuel_price_fjd_per_litre REAL NOT NULL,
  effective_from TEXT NOT NULL,
  multiplier REAL NOT NULL DEFAULT 1.0,
  order_reference TEXT,
  updated_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE fuel_index_pending (
  id INTEGER PRIMARY KEY,
  fuel_price_fjd_per_litre REAL NOT NULL,
  effective_from TEXT NOT NULL,
  order_reference TEXT,
  detected_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'pending'
);

CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE pricing_rules (
  id INTEGER PRIMARY KEY,
  vehicle_type TEXT NOT NULL,
  distance_min_km REAL NOT NULL,
  distance_max_km REAL,
  base_rate_fjd_per_km REAL NOT NULL,
  flagfall_fjd REAL NOT NULL,
  active INTEGER DEFAULT 1
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  guest_name TEXT,
  guest_phone TEXT,
  pickup_zone TEXT NOT NULL,
  destination_zone TEXT NOT NULL,
  distance_km REAL,
  vehicle_type TEXT NOT NULL,
  quoted_currency TEXT NOT NULL,
  quoted_amount REAL NOT NULL,
  fx_rate_at_booking REAL NOT NULL,
  settlement_amount_fjd REAL NOT NULL,
  fuel_multiplier_applied REAL NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_driver_id INTEGER REFERENCES drivers(id),
  commission_rate REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE wallets (
  driver_id INTEGER PRIMARY KEY REFERENCES drivers(id),
  balance_fjd REAL NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE wallet_transactions (
  id INTEGER PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  booking_id INTEGER REFERENCES bookings(id),
  amount_fjd REAL NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO platform_settings (key, value) VALUES ('fuel_auto_apply', 'false');
INSERT INTO platform_settings (key, value) VALUES ('fuel_confirmed_accurate_count', '0');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 2 additions — not part of spec Section 2, added for
-- driver PWA magic-link login support (Section 3/4 dependency).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE driver_login_tokens (
  id INTEGER PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Zones seeded from the real, live ftt-booking-site/src/app.js ROUTES_DATA
-- `area` field (16 distinct values, source-file order) — the actual data
-- behind nadiairporttransfers.com's live routes table.
INSERT INTO zones (name) VALUES ('Nadi');
INSERT INTO zones (name) VALUES ('Nadi Airport');
INSERT INTO zones (name) VALUES ('Wailoaloa');
INSERT INTO zones (name) VALUES ('Denarau');
INSERT INTO zones (name) VALUES ('Sonaisali');
INSERT INTO zones (name) VALUES ('Vuda Point');
INSERT INTO zones (name) VALUES ('Lautoka');
INSERT INTO zones (name) VALUES ('Momi Bay');
INSERT INTO zones (name) VALUES ('Natadola');
INSERT INTO zones (name) VALUES ('Sigatoka');
INSERT INTO zones (name) VALUES ('Coral Coast');
INSERT INTO zones (name) VALUES ('Pacific Harbour');
INSERT INTO zones (name) VALUES ('Ba');
INSERT INTO zones (name) VALUES ('Rakiraki');
INSERT INTO zones (name) VALUES ('Suva');
INSERT INTO zones (name) VALUES ('Nausori');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 4 additions — wallet lockout + max-hours cap (spec
-- Section 4 remainder). See migrations/milestone4-schema.sql for the
-- migration actually run against the live database; this block keeps
-- schema.sql (the from-scratch reference) in sync with it.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE drivers ADD COLUMN forced_offline_until TEXT;

INSERT INTO platform_settings (key, value) VALUES ('wallet_lockout_threshold_fjd', '-150');
INSERT INTO platform_settings (key, value) VALUES ('max_hours_rest_gap_hours', '8');
INSERT INTO platform_settings (key, value) VALUES ('default_commission_rate', '0.15');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 5 additions — fuel index automation (spec Section 7). See
-- migrations/milestone5-schema.sql for the migration actually run against
-- the live database, including sourcing and rationale for the real seeded
-- baseline price below.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO fuel_index (fuel_price_fjd_per_litre, effective_from, multiplier, order_reference, updated_by)
VALUES (3.39, '2026-07-01', 1.0, 'LN 89/26 - Petroleum Prices (No. 6) Order 2026 - Schedule 1, Gasoil (diesoline), Retail, Bulk Sale', 'Claude Code - seeded from real FCCC PDF, no prior baseline existed');

INSERT INTO platform_settings (key, value) VALUES ('fuel_index_last_seen_order', 'LN-89-FCCC-Price-Control-Petroleum-Prices-No.-6-Order-2026.pdf');
INSERT INTO platform_settings (key, value) VALUES ('admin_alert_phone', '');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 6 additions — public POST /bookings endpoint. See
-- migrations/milestone6-schema.sql for the migration actually run.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE bookings ADD COLUMN source_ip TEXT;

INSERT INTO platform_settings (key, value) VALUES ('guest_booking_rate_limit_max', '5');
INSERT INTO platform_settings (key, value) VALUES ('guest_booking_rate_limit_window_minutes', '10');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 7 additions — dynamic destinations system. See
-- migrations/milestone7-schema.sql for the migration actually run,
-- including the full rationale for type categorization and the real
-- ftt-booking-site/src/app.js ROUTES_DATA source this was seeded from
-- (read-only — that file was never modified).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE destinations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- hotel / airport / port / town / custom
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Nadi Town Centre', 'town', (SELECT id FROM zones WHERE name = 'Nadi'), 1);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Tanoa International / Tokatoka', 'hotel', (SELECT id FROM zones WHERE name = 'Nadi Airport'), 2);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Mercure / Tradewinds Hotel', 'hotel', (SELECT id FROM zones WHERE name = 'Nadi'), 3);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Wailoaloa Beach Hotels', 'hotel', (SELECT id FROM zones WHERE name = 'Wailoaloa'), 4);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Crowne Plaza / Smugglers / Ramada', 'hotel', (SELECT id FROM zones WHERE name = 'Wailoaloa'), 5);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Hilton / Sheraton / Westin Denarau', 'hotel', (SELECT id FROM zones WHERE name = 'Denarau'), 6);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Sofitel / Radisson / Wyndham', 'hotel', (SELECT id FROM zones WHERE name = 'Denarau'), 7);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Port Denarau Marina (Yasawa Flyer)', 'port', (SELECT id FROM zones WHERE name = 'Denarau'), 8);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('DoubleTree Sonaisali Island', 'hotel', (SELECT id FROM zones WHERE name = 'Sonaisali'), 9);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('First Landing Beach Resort', 'hotel', (SELECT id FROM zones WHERE name = 'Vuda Point'), 10);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Vuda Marina (Yacht Haven)', 'port', (SELECT id FROM zones WHERE name = 'Vuda Point'), 11);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Lautoka City Centre', 'town', (SELECT id FROM zones WHERE name = 'Lautoka'), 12);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Tanoa Waterfront / Cathay Lautoka', 'hotel', (SELECT id FROM zones WHERE name = 'Lautoka'), 13);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Lautoka Cruise Terminal', 'port', (SELECT id FROM zones WHERE name = 'Lautoka'), 14);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Fiji Marriott Resort Momi Bay', 'hotel', (SELECT id FROM zones WHERE name = 'Momi Bay'), 15);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('InterContinental Natadola / Yatule', 'hotel', (SELECT id FROM zones WHERE name = 'Natadola'), 16);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Robinson Crusoe Island (Likuri)', 'custom', (SELECT id FROM zones WHERE name = 'Natadola'), 17);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Sigatoka Town / Sand Dunes', 'town', (SELECT id FROM zones WHERE name = 'Sigatoka'), 18);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Bedarra / Gecko''s / Sandy Point', 'hotel', (SELECT id FROM zones WHERE name = 'Sigatoka'), 19);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Kula Wild Adventure Park', 'custom', (SELECT id FROM zones WHERE name = 'Sigatoka'), 20);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Shangri-La Yanuca Island', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 21);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Hideaway Resort / Tambua Sands', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 22);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Crusoe''s Retreat / Mango Bay', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 23);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Outrigger Fiji Beach Resort', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 24);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('The Warwick / The Naviti', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 25);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('The Beachouse Fiji', 'hotel', (SELECT id FROM zones WHERE name = 'Coral Coast'), 26);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Pacific Harbour Arts Village', 'custom', (SELECT id FROM zones WHERE name = 'Pacific Harbour'), 27);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Pearl South Pacific Resort', 'hotel', (SELECT id FROM zones WHERE name = 'Pacific Harbour'), 28);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Uprising Beach Resort', 'hotel', (SELECT id FROM zones WHERE name = 'Pacific Harbour'), 29);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Nanuku Resort Fiji (Auberge)', 'hotel', (SELECT id FROM zones WHERE name = 'Pacific Harbour'), 30);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Ba Town', 'town', (SELECT id FROM zones WHERE name = 'Ba'), 31);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Volivoli / Wananavu Beach Resort', 'hotel', (SELECT id FROM zones WHERE name = 'Rakiraki'), 32);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Grand Pacific Hotel Suva', 'hotel', (SELECT id FROM zones WHERE name = 'Suva'), 33);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Tanoa Plaza / Holiday Inn Suva', 'hotel', (SELECT id FROM zones WHERE name = 'Suva'), 34);
INSERT INTO destinations (name, type, zone_id, display_order) VALUES ('Nausori Airport (SUV)', 'airport', (SELECT id FROM zones WHERE name = 'Nausori'), 35);

-- ═══════════════════════════════════════════════════════════════
-- Milestone 8 additions — health monitoring + D1 backups. No new tables;
-- backups live in a dedicated R2 bucket (nadi-marketplace-db-backups),
-- not D1. See migrations/milestone8-schema.sql.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO platform_settings (key, value) VALUES ('health_check_last_status', 'healthy');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 9 additions — geocode + real-distance pricing for unlisted
-- addresses. Full derivation methodology, real evidence, and rationale
-- in migrations/milestone9-schema.sql — this block keeps schema.sql (the
-- from-scratch reference) in sync with it.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE zones ADD COLUMN lat REAL;
ALTER TABLE zones ADD COLUMN lng REAL;
ALTER TABLE zones ADD COLUMN remote_multiplier REAL NOT NULL DEFAULT 1.0;

UPDATE zones SET lat = -17.8033, lng = 177.4145 WHERE name = 'Nadi';
UPDATE zones SET lat = -17.7554, lng = 177.4432 WHERE name = 'Nadi Airport';
UPDATE zones SET lat = -17.7717, lng = 177.4083 WHERE name = 'Wailoaloa';
UPDATE zones SET lat = -17.7746, lng = 177.3814 WHERE name = 'Denarau';
UPDATE zones SET lat = -17.8225, lng = 177.3634 WHERE name = 'Sonaisali';
UPDATE zones SET lat = -17.6725, lng = 177.3505 WHERE name = 'Vuda Point';
UPDATE zones SET lat = -17.6053, lng = 177.4503 WHERE name = 'Lautoka';
UPDATE zones SET lat = -17.9308, lng = 177.2678 WHERE name = 'Momi Bay';
UPDATE zones SET lat = -18.2264, lng = 177.3792 WHERE name = 'Natadola';
UPDATE zones SET lat = -18.1416, lng = 177.5049 WHERE name = 'Sigatoka';
UPDATE zones SET lat = -18.2000, lng = 177.7000 WHERE name = 'Coral Coast';
UPDATE zones SET lat = -18.2333, lng = 178.0500 WHERE name = 'Pacific Harbour';
-- remote_multiplier revised 1.33 -> 1.37 in the pricing refit (real
-- ratio derivation, migrations/milestone9-pricing-refit.sql)
UPDATE zones SET lat = -17.5333, lng = 177.6667, remote_multiplier = 1.37 WHERE name = 'Ba';
UPDATE zones SET lat = -17.3667, lng = 178.1667, remote_multiplier = 1.37 WHERE name = 'Rakiraki';
UPDATE zones SET lat = -18.1416, lng = 178.4419 WHERE name = 'Suva';
UPDATE zones SET lat = -18.0233, lng = 178.5561 WHERE name = 'Nausori';

-- Real least-squares fit against all 35 live ROUTES_DATA routes (fitted
-- independently per vehicle type/band, replacing the original eyeballed
-- Milestone 9 values) - see migrations/milestone9-pricing-refit.sql and
-- the Milestone 9 pricing-refit report in README.md for full derivation,
-- R^2 per band, and flagged anomalies (Tanoa International/Tokatoka,
-- Momi Bay minibus, the thin 160-300km band).
INSERT INTO pricing_rules (vehicle_type, distance_min_km, distance_max_km, base_rate_fjd_per_km, flagfall_fjd) VALUES
  ('sedan',   0,   15,  3.592, 5.57),
  ('sedan',   15,  35,  1.568, 44.19),
  ('sedan',   35,  70,  1.438, 38.75),
  ('sedan',   70,  160, 1.120, 33.65),
  ('sedan',   160, 300, 1.852, -47.67),
  ('minivan', 0,   15,  3.581, 26.91),
  ('minivan', 15,  35,  2.622, 43.54),
  ('minivan', 35,  70,  0.479, 128.92),
  ('minivan', 70,  160, 1.764, 6.22),
  ('minivan', 160, 300, 4.815, -584.33),
  ('minibus', 0,   15,  4.133, 51.17),
  ('minibus', 15,  35,  2.622, 73.54),
  ('minibus', 35,  70,  0.956, 139.00),
  ('minibus', 70,  160, 1.576, 66.96),
  ('minibus', 160, 300, 1.852, 132.33);

CREATE TABLE geocoded_addresses (
  id INTEGER PRIMARY KEY,
  query_normalized TEXT NOT NULL UNIQUE,
  query_raw TEXT NOT NULL,
  resolved_address TEXT,
  lat REAL,
  lng REAL,
  distance_km REAL,
  duration_text TEXT,
  has_ferry_leg INTEGER NOT NULL DEFAULT 0,
  nearest_zone_id INTEGER REFERENCES zones(id),
  outcome TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  -- Milestone 12: which real trip this cached geocode represents.
  -- 'from_airport' (arriving guest) or 'to_airport' (departing guest).
  -- Folded into query_normalized itself so the same address text never
  -- collides between the two directions.
  direction TEXT NOT NULL DEFAULT 'from_airport'
);

CREATE TABLE quote_requests_log (
  id INTEGER PRIMARY KEY,
  source_ip TEXT NOT NULL,
  query_normalized TEXT NOT NULL,
  cache_hit INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO platform_settings (key, value) VALUES ('quote_rate_limit_max_per_day', '20');

-- Milestone 10: human escalation / "back to base" system
CREATE TABLE escalations (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('guest', 'driver')),
  -- 'boat_pricing_pending' added by milestone14b-escalation-trigger-type-fix.sql -
  -- worker.js's ESCALATION_TRIGGER_TYPES was updated for Milestone 14 but this
  -- CHECK constraint, a separate independent enforcement point, was missed
  -- initially - real live-test caught it (SQLITE_CONSTRAINT_CHECK on every
  -- pending boat quote) before it reached a real guest.
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'geocode_failed', 'needs_manual_confirmation', 'wallet_dispute', 'app_issue', 'other', 'boat_pricing_pending'
  )),
  context TEXT,
  booking_id INTEGER REFERENCES bookings(id),
  driver_id INTEGER REFERENCES drivers(id),
  created_at TEXT DEFAULT (datetime('now')),
  resolved INTEGER NOT NULL DEFAULT 0,
  source_ip TEXT
);

INSERT INTO platform_settings (key, value) VALUES ('escalation_rate_limit_max_per_day', '10');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 13 additions — fixed-fare boat-transfer product for
-- Mamanuca/Yasawa island resorts, distinct pricing path from the
-- road/km/Google-Routes model. See migrations/milestone13-boat-transfer-
-- product.sql for the migration actually run against the live database.
-- ═══════════════════════════════════════════════════════════════

-- transfer_type separates the pricing path cleanly: 'road' (existing
-- zone/km/Google-Routes model, untouched) vs 'boat' (fixed fare read
-- directly off these columns, never geocoded, never billed against the
-- Routes API). Real fares are not published as a static price list by any
-- operator (confirmed against 5 official pages) - they're captured by
-- live-querying the operator's own booking engine per property, same
-- discipline as fuel_index: a real, dated, operator-set figure expected
-- to need periodic review, not a permanent constant.
ALTER TABLE destinations ADD COLUMN transfer_type TEXT NOT NULL DEFAULT 'road';
ALTER TABLE destinations ADD COLUMN boat_adult_fare_fjd REAL;
ALTER TABLE destinations ADD COLUMN boat_child_fare_fjd REAL;
-- Fiji Tour Transfers bundles and collects the full boat-operator fare (a
-- real resale arrangement), not just the land leg. boat_land_leg_fare_fjd
-- is the portion actually earned by an FTT driver - kept separate so a
-- future commission pass can exclude the boat operator's pass-through
-- portion rather than paying/charging driver commission on money that was
-- never the driver's to begin with.
ALTER TABLE destinations ADD COLUMN boat_land_leg_fare_fjd REAL;
ALTER TABLE destinations ADD COLUMN boat_operator_name TEXT;
ALTER TABLE destinations ADD COLUMN boat_fare_sourced_at TEXT;
ALTER TABLE destinations ADD COLUMN boat_fare_source_note TEXT;

-- Same reasoning as above, applied to actual booking rows: null preserves
-- existing behaviour for every current (road) booking untouched; set only
-- for boat bookings so commission accrual has the correct base to use
-- once that logic is wired (not this milestone - accrueCommission() still
-- reads settlement_amount_fjd only).
ALTER TABLE bookings ADD COLUMN commission_base_fjd REAL;

INSERT INTO zones (name) VALUES ('Mamanuca Islands');
INSERT INTO zones (name) VALUES ('Yasawa Islands');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 14 additions — pricing_status for boat destinations, so a
-- resort can be added as a real, guest-findable destination the moment
-- its identity/zone is known, before its fare is sourced. See
-- migrations/milestone14-boat-pricing-status.sql for the migration
-- actually run against the live database.
-- ═══════════════════════════════════════════════════════════════

-- NULL = not a boat destination (every existing road row). 'sourced' =
-- boat_adult_fare_fjd etc. are real and usable. 'pending' = a real,
-- identified boat destination with no fare yet - /quote routes these into
-- the Milestone 10 escalation/WhatsApp flow instead of computing a price.
ALTER TABLE destinations ADD COLUMN pricing_status TEXT;

INSERT INTO zones (name) VALUES ('Beqa Lagoon');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 15 additions — guest price negotiation, in-house drivers only.
-- See migrations/milestone15-negotiation.sql for the migration actually
-- run against the live database, including the full rationale for two new
-- tables rather than a bookings.status value.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE negotiation_requests (
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
  -- 'declined' added by milestone33-negotiation-decline.sql - admin's own
  -- active decline action, distinct from the passive 'expired' timeout.
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'expired', 'cancelled', 'declined')),
  booking_id INTEGER REFERENCES bookings(id),
  source_ip TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE negotiation_offers (
  id INTEGER PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES negotiation_requests(id),
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  offer_type TEXT NOT NULL CHECK (offer_type IN ('accept', 'counter')),
  offer_amount_fjd REAL NOT NULL,
  guest_decision TEXT NOT NULL DEFAULT 'pending' CHECK (guest_decision IN ('pending', 'accepted', 'declined')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(request_id, driver_id)
);

-- Value updated to 5 by milestone33-negotiation-decline.sql - this is the
-- fallback for admin not responding in time, not the guest's expected real
-- wait (a human replies on WhatsApp almost immediately in practice).
INSERT INTO platform_settings (key, value) VALUES ('negotiation_expiry_minutes', '5');
INSERT INTO platform_settings (key, value) VALUES ('negotiation_rate_limit_max_per_day', '5');
INSERT INTO platform_settings (key, value) VALUES ('negotiation_rate_limit_window_minutes', '10');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 16 additions — server-side reference fare for the Flexible
-- Fare feature (never trust reference_fare_fjd from the client - see
-- migrations/milestone16-reference-fare-cache.sql for the full rationale).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE zone_distance_cache (
  id INTEGER PRIMARY KEY,
  zone_a TEXT NOT NULL,
  zone_b TEXT NOT NULL,
  distance_km REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(zone_a, zone_b)
);

CREATE TABLE reference_fare_lookups (
  id INTEGER PRIMARY KEY,
  source_ip TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO platform_settings (key, value) VALUES ('reference_fare_rate_limit_max_per_day', '60');
INSERT INTO platform_settings (key, value) VALUES ('reference_fare_rate_limit_window_minutes', '10');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 17 additions — itinerary fields. Bookings previously stored
-- zero itinerary detail for either leg of a trip (only pricing/zone/
-- vehicle/settlement data). Added after a real return-trip booking
-- reached dispatch with no return date, time, or pickup location
-- captured anywhere. See migrations/milestone17-itinerary-fields.sql for
-- the migration actually run against the live database. All nullable —
-- existing rows and the other two createBookingRecord() callers (admin
-- test booking, negotiation accept-offer) are unaffected.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE bookings ADD COLUMN pickup_date TEXT;
ALTER TABLE bookings ADD COLUMN pickup_time TEXT;
ALTER TABLE bookings ADD COLUMN notes TEXT;
ALTER TABLE bookings ADD COLUMN return_date TEXT;
ALTER TABLE bookings ADD COLUMN return_time TEXT;
ALTER TABLE bookings ADD COLUMN return_pickup_location TEXT;

-- ═══════════════════════════════════════════════════════════════
-- Milestone 19 additions — booking_events audit trail. Additive only,
-- the bookings table itself is unchanged. See
-- migrations/milestone19-booking-events.sql for the migration actually
-- run against the live database, including the full rationale for why
-- event_type has no CHECK constraint and why 'cancelled' is a
-- supported-but-currently-unused value.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE booking_events (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  event_type TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  actor TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- Milestone 23 additions — admin phone-number magic-link login.
-- Mirrors driver_login_tokens (Milestone 2) exactly, minus a foreign
-- key to an "admins" table - there isn't one. See
-- migrations/milestone23-admin-login.sql for the migration actually run
-- against the live database, including the full rationale for why the
-- one authorized phone number is hardcoded in worker.js rather than
-- stored anywhere editable.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE admin_login_tokens (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_booking_events_booking_id ON booking_events(booking_id);

-- ═══════════════════════════════════════════════════════════════
-- Milestone 24 additions — admin PIN login, alongside the magic-link
-- flow above. No new table - a PIN system for exactly one admin is
-- three scalar values, which platform_settings already exists to hold.
-- See migrations/milestone24-admin-pin.sql for the migration actually
-- run against the live database, including the full rationale for the
-- self-describing hash format and the global (not per-IP) lockout.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO platform_settings (key, value) VALUES ('admin_pin_hash', '');
INSERT INTO platform_settings (key, value) VALUES ('admin_pin_failed_attempts', '0');
INSERT INTO platform_settings (key, value) VALUES ('admin_pin_locked_until', '');

-- ═══════════════════════════════════════════════════════════════
-- Milestone 25 additions — rate limit for GET /negotiate/:id. See
-- migrations/milestone25-negotiation-status-rate-limit.sql for the
-- migration actually run against the live database, including the
-- full rationale (a real, independently-found PII leak: this endpoint
-- returned full guest PII to any unauthenticated caller for a
-- sequential, guessable ID, with no rate limiting at all).
-- ═══════════════════════════════════════════════════════════════

INSERT INTO platform_settings (key, value) VALUES ('negotiation_status_rate_limit_max', '300');
INSERT INTO platform_settings (key, value) VALUES ('negotiation_status_rate_limit_window_minutes', '10');

CREATE TABLE negotiation_status_lookups (
  id INTEGER PRIMARY KEY,
  source_ip TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- Milestone 28 additions — rate limit for POST /drivers. See
-- migrations/milestone28-driver-submit-rate-limit.sql for the migration
-- actually run against the live database. POST /negotiate/:id/accept-offer
-- was fixed in the same milestone but needed no new table/settings — it
-- reuses the existing checkGuestBookingRateLimit() / guest_booking_rate_limit_*
-- settings already defined above (Milestone 13), since it writes to the
-- same `bookings` table via the same source_ip column.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO platform_settings (key, value) VALUES ('driver_submit_rate_limit_max', '5');
INSERT INTO platform_settings (key, value) VALUES ('driver_submit_rate_limit_window_minutes', '60');

CREATE TABLE driver_submit_lookups (
  id INTEGER PRIMARY KEY,
  source_ip TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════════════════════════════
-- Milestone 29 additions — staleness surfacing for unaccepted bookings,
-- and admin visibility into negotiation_requests (which already had
-- lazy auto-expiry since Milestone 25, but zero admin-facing view). See
-- migrations/milestone29-booking-staleness-and-negotiation-admin-view.sql
-- for the migration actually run against the live database. No new
-- tables needed for the negotiation-visibility half - GET
-- /admin/negotiations reads the existing negotiation_requests table.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO platform_settings (key, value) VALUES ('booking_stale_after_minutes', '30');
