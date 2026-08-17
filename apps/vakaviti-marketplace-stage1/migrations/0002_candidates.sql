CREATE TABLE IF NOT EXISTS candidate_operators (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  primary_url TEXT,
  website_url TEXT,
  facebook_url TEXT,
  instagram_url TEXT,
  phone TEXT,
  email TEXT,
  whatsapp TEXT,
  locality TEXT,
  region TEXT,
  categories_json TEXT,
  probable_products_json TEXT,
  booking_method TEXT,
  transport_need TEXT,
  digital_maturity_score REAL DEFAULT 0,
  commercial_score REAL DEFAULT 0,
  transport_attach_score REAL DEFAULT 0,
  onboarding_friction_score REAL DEFAULT 0,
  confidence REAL DEFAULT 0,
  workflow_state TEXT NOT NULL DEFAULT 'DISCOVERED',
  duplicate_of_id TEXT,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_enriched_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT
);

CREATE TABLE IF NOT EXISTS candidate_sources (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_title TEXT,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  extracted_json TEXT,
  confidence REAL DEFAULT 0,
  FOREIGN KEY(candidate_id) REFERENCES candidate_operators(id)
);

CREATE TABLE IF NOT EXISTS candidate_claims (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  observed_value TEXT,
  normalized_value TEXT,
  source_id TEXT,
  status TEXT NOT NULL DEFAULT 'CANDIDATE',
  confidence REAL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by TEXT,
  FOREIGN KEY(candidate_id) REFERENCES candidate_operators(id),
  FOREIGN KEY(source_id) REFERENCES candidate_sources(id)
);

CREATE TABLE IF NOT EXISTS review_actions (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_candidate_workflow ON candidate_operators(workflow_state, commercial_score DESC);
CREATE INDEX IF NOT EXISTS idx_candidate_name ON candidate_operators(normalized_name);
CREATE INDEX IF NOT EXISTS idx_candidate_source ON candidate_sources(candidate_id, source_type);
CREATE INDEX IF NOT EXISTS idx_candidate_claim ON candidate_claims(candidate_id, field_name, status);