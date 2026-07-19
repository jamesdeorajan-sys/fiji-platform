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
