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
