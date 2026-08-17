PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  website_url TEXT,
  facebook_url TEXT,
  instagram_url TEXT,
  whatsapp TEXT,
  email TEXT,
  phone TEXT,
  locality TEXT,
  region TEXT,
  country_code TEXT NOT NULL DEFAULT 'FJ',
  latitude REAL,
  longitude REAL,
  discovery_status TEXT NOT NULL DEFAULT 'PUBLICLY_LISTED',
  claim_status TEXT NOT NULL DEFAULT 'UNCLAIMED',
  verification_status TEXT NOT NULL DEFAULT 'NOT_VERIFIED',
  commercial_status TEXT NOT NULL DEFAULT 'INACTIVE',
  verification_level INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  last_public_check_at TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT,
  destination_id TEXT,
  duration_minutes INTEGER,
  booking_relationship TEXT NOT NULL DEFAULT 'UNKNOWN',
  verification_status TEXT NOT NULL DEFAULT 'NOT_VERIFIED',
  commercial_status TEXT NOT NULL DEFAULT 'INACTIVE',
  transport_attachable INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operator_id) REFERENCES operators(id)
);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'FJD',
  amount_minor INTEGER,
  pricing_basis TEXT NOT NULL DEFAULT 'UNKNOWN',
  deposit_minor INTEGER,
  balance_payment_method TEXT,
  cancellation_policy TEXT,
  pickup_policy TEXT,
  availability_mode TEXT NOT NULL DEFAULT 'REQUEST_ONLY',
  source_url TEXT,
  source_observed_at TEXT,
  operator_confirmed_at TEXT,
  verified_at TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_name TEXT,
  source_type TEXT NOT NULL,
  source_url TEXT,
  observed_value TEXT,
  evidence_status TEXT NOT NULL DEFAULT 'CANDIDATE',
  confidence REAL,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  verified_by TEXT
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  claimant_name TEXT,
  claimant_email TEXT,
  claimant_phone TEXT,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  FOREIGN KEY (operator_id) REFERENCES operators(id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  offer_id TEXT,
  source_domain TEXT,
  source_channel TEXT,
  traveler_name TEXT,
  traveler_email TEXT,
  traveler_phone TEXT,
  service_date TEXT,
  party_size INTEGER,
  booking_state TEXT NOT NULL DEFAULT 'BOOKING_REQUESTED',
  payment_state TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  transport_required INTEGER NOT NULL DEFAULT 0,
  gross_amount_minor INTEGER,
  currency TEXT DEFAULT 'FJD',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (offer_id) REFERENCES offers(id)
);

CREATE INDEX IF NOT EXISTS idx_operators_status ON operators(verification_status, commercial_status);
CREATE INDEX IF NOT EXISTS idx_products_operator ON products(operator_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_evidence_entity ON evidence(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_bookings_state ON bookings(booking_state);
