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
UPDATE zones SET lat = -17.5333, lng = 177.6667, remote_multiplier = 1.33 WHERE name = 'Ba';
UPDATE zones SET lat = -17.3667, lng = 178.1667, remote_multiplier = 1.33 WHERE name = 'Rakiraki';
UPDATE zones SET lat = -18.1416, lng = 178.4419 WHERE name = 'Suva';
UPDATE zones SET lat = -18.0233, lng = 178.5561 WHERE name = 'Nausori';

INSERT INTO pricing_rules (vehicle_type, distance_min_km, distance_max_km, base_rate_fjd_per_km, flagfall_fjd) VALUES
  ('sedan',   0,   15,  3.20, 10),
  ('sedan',   15,  35,  2.60, 15),
  ('sedan',   35,  70,  1.85, 20),
  ('sedan',   70,  160, 1.20, 25),
  ('sedan',   160, 300, 1.45, 50),
  ('minivan', 0,   15,  4.16, 13),
  ('minivan', 15,  35,  3.38, 19.5),
  ('minivan', 35,  70,  2.405,26),
  ('minivan', 70,  160, 1.56, 32.5),
  ('minivan', 160, 300, 1.885,65),
  ('minibus', 0,   15,  5.44, 17),
  ('minibus', 15,  35,  4.42, 25.5),
  ('minibus', 35,  70,  3.145,34),
  ('minibus', 70,  160, 2.04, 42.5),
  ('minibus', 160, 300, 2.465,85);

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
  created_at TEXT DEFAULT (datetime('now'))
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
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'geocode_failed', 'needs_manual_confirmation', 'wallet_dispute', 'app_issue', 'other'
  )),
  context TEXT,
  booking_id INTEGER REFERENCES bookings(id),
  driver_id INTEGER REFERENCES drivers(id),
  created_at TEXT DEFAULT (datetime('now')),
  resolved INTEGER NOT NULL DEFAULT 0
);
