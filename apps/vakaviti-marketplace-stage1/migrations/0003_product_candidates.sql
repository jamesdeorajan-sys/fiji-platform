PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS product_candidates (
  id TEXT PRIMARY KEY,
  operator_candidate_id TEXT,
  operator_id TEXT,
  canonical_name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  destination_text TEXT,
  duration_minutes INTEGER,
  currency TEXT,
  amount_minor INTEGER,
  pricing_basis TEXT NOT NULL DEFAULT 'UNKNOWN',
  availability_mode TEXT NOT NULL DEFAULT 'UNKNOWN',
  pickup_claim TEXT,
  cancellation_claim TEXT,
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'PUBLIC_WEB',
  source_observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ai_confidence REAL,
  transport_attach_score REAL NOT NULL DEFAULT 0,
  commercial_score REAL NOT NULL DEFAULT 0,
  evidence_status TEXT NOT NULL DEFAULT 'CANDIDATE',
  review_status TEXT NOT NULL DEFAULT 'PENDING',
  promoted_product_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS verification_readiness (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  identity_ready INTEGER NOT NULL DEFAULT 0,
  business_ready INTEGER NOT NULL DEFAULT 0,
  compliance_ready INTEGER NOT NULL DEFAULT 0,
  product_ready INTEGER NOT NULL DEFAULT 0,
  price_ready INTEGER NOT NULL DEFAULT 0,
  availability_ready INTEGER NOT NULL DEFAULT 0,
  payout_ready INTEGER NOT NULL DEFAULT 0,
  missing_json TEXT NOT NULL DEFAULT '[]',
  blockers_json TEXT NOT NULL DEFAULT '[]',
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS transport_candidates (
  id TEXT PRIMARY KEY,
  product_candidate_id TEXT NOT NULL,
  origin_text TEXT,
  destination_text TEXT,
  pickup_required INTEGER NOT NULL DEFAULT 0,
  likely_resort_corridor TEXT,
  score REAL NOT NULL DEFAULT 0,
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'CANDIDATE',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_candidate_id) REFERENCES product_candidates(id)
);

CREATE INDEX IF NOT EXISTS idx_product_candidates_review ON product_candidates(review_status, commercial_score DESC);
CREATE INDEX IF NOT EXISTS idx_product_candidates_operator ON product_candidates(operator_candidate_id, operator_id);
CREATE INDEX IF NOT EXISTS idx_transport_candidates_product ON transport_candidates(product_candidate_id);
