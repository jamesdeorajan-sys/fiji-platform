PRAGMA foreign_keys = ON;

-- Deal Intelligence pilot: fully additive, fully isolated from the existing marketplace tables
-- (operators/products/offers/evidence/enquiries/places). Every table is prefixed `deal_` to
-- avoid any name collision with the existing candidate_* operator-onboarding pipeline, which is
-- a different subsystem. Nothing here is read by any existing public marketplace route.

CREATE TABLE IF NOT EXISTS deal_sources (
  id TEXT PRIMARY KEY,
  provider_candidate_id TEXT,
  source_url TEXT NOT NULL UNIQUE,
  canonical_domain TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'PROVIDER_WEBSITE',
  provider_control_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  source_approval_status TEXT NOT NULL DEFAULT 'PENDING_SOURCE_REVIEW' CHECK (source_approval_status IN (
    'PENDING_SOURCE_REVIEW','APPROVED','REJECTED','PAUSED','ACCESS_RESTRICTED','SOURCE_UNREACHABLE'
  )),
  robots_or_access_status TEXT,
  terms_warning TEXT,
  scan_frequency TEXT NOT NULL DEFAULT 'DAILY',
  last_scan_at TEXT,
  next_scan_at TEXT,
  last_http_status INTEGER,
  content_fingerprint TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  backoff_until TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deal_offer_candidates (
  id TEXT PRIMARY KEY,
  provider_candidate_id TEXT,
  source_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_page_title TEXT,
  source_checked_at TEXT,
  source_fingerprint TEXT,
  proposed_offer_name TEXT,
  factual_summary TEXT,
  category TEXT,
  fiji_location TEXT,
  advertised_price TEXT,
  reference_price TEXT,
  currency TEXT,
  price_basis TEXT,
  explicit_discount TEXT,
  calculated_discount TEXT,
  calculation_inputs TEXT,
  promo_code TEXT,
  booking_deadline TEXT,
  travel_from TEXT,
  travel_until TEXT,
  offer_expires_at TEXT,
  expiry_status TEXT NOT NULL DEFAULT 'EXPIRY_UNKNOWN' CHECK (expiry_status IN (
    'EXPIRY_UNKNOWN','ACTIVE','EXPIRING_SOON','EXPIRED'
  )),
  blackout_dates TEXT,
  minimum_stay TEXT,
  minimum_group_size TEXT,
  eligibility TEXT,
  inclusions TEXT,
  exclusions TEXT,
  cancellation_terms TEXT,
  booking_route TEXT,
  seller_or_marketer TEXT,
  fulfilment_operator TEXT,
  evidence_state TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (evidence_state IN ('CANDIDATE','CURRENT','STALE')),
  extraction_confidence REAL,
  provider_permission_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  content_rights_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (content_rights_status IN ('UNKNOWN','APPROVED','DENIED')),
  image_rights_status TEXT NOT NULL DEFAULT 'NO_IMAGE' CHECK (image_rights_status IN ('NO_IMAGE','APPROVED','DENIED')),
  response_owner TEXT,
  missing_fields TEXT,
  contradictions TEXT,
  duplicate_fingerprint TEXT,
  duplicate_of_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK (review_status IN (
    'DISCOVERED','SOURCE_REVIEW_REQUIRED','SOURCE_APPROVED','EVIDENCE_EXTRACTED',
    'NEEDS_HUMAN_REVIEW','VAKAVITI_HUMAN_REVIEWED','PROVIDER_APPROVAL_PENDING',
    'PROVIDER_APPROVED','PUBLICATION_APPROVED','PUBLISHED','MATERIAL_CHANGE_DETECTED',
    'QUARANTINED','EXPIRED','WITHDRAWN','REJECTED','DISPUTED','ARCHIVED'
  )),
  human_review_approved_at TEXT,
  human_review_approved_by TEXT,
  provider_approved_at TEXT,
  provider_approved_by TEXT,
  publication_approved_at TEXT,
  publication_approved_by TEXT,
  source_fingerprint_at_approval TEXT,
  created_by TEXT NOT NULL DEFAULT 'AI_AGENT' CHECK (created_by IN ('AI_AGENT','HUMAN')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES deal_sources(id),
  FOREIGN KEY (duplicate_of_id) REFERENCES deal_offer_candidates(id)
);

-- Append-only governed approval ledger. Every approve/reject/quarantine/withdraw/revoke action
-- on a source or offer candidate is recorded here, whether the actor is a human or (for
-- discovery-stage-only actions) the agent - see the actor_type CHECK, which structurally
-- prevents an AI-attributed row from ever being tagged as a HUMAN decision.
CREATE TABLE IF NOT EXISTS deal_approvals (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('SOURCE','OFFER_CANDIDATE')),
  entity_id TEXT NOT NULL,
  approval_type TEXT NOT NULL CHECK (approval_type IN (
    'SOURCE_APPROVAL','SOURCE_REJECTION','SOURCE_PAUSE','HUMAN_REVIEW','CORRECTION',
    'PROVIDER_APPROVAL','PROVIDER_WITHDRAWAL','PUBLICATION_APPROVAL','PUBLICATION_REVOCATION',
    'REJECTION','QUARANTINE'
  )),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('HUMAN','ASSISTANT_ACTING_UNDER_CEO_AUTHORIZATION')),
  actor_identity TEXT NOT NULL,
  actor_authority TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  reason TEXT,
  fields_approved TEXT,
  evidence_cited TEXT,
  source_fingerprint TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  approval_expiry TEXT,
  audit_metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deal_change_events (
  id TEXT PRIMARY KEY,
  offer_candidate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (offer_candidate_id) REFERENCES deal_offer_candidates(id)
);

-- One row per scan attempt (source-level) and one row per daily run, giving idempotency keys
-- for "source scan" and covering the run-level idempotency/overlap-prevention requirement.
CREATE TABLE IF NOT EXISTS deal_scan_runs (
  id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL DEFAULT 'DAILY_DISCOVERY',
  idempotency_key TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED')),
  sources_scanned INTEGER NOT NULL DEFAULT 0,
  sources_failed INTEGER NOT NULL DEFAULT 0,
  candidates_created INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT
);

CREATE TABLE IF NOT EXISTS deal_source_scans (
  id TEXT PRIMARY KEY,
  scan_run_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  http_status INTEGER,
  classification TEXT NOT NULL,
  content_fingerprint TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (scan_run_id) REFERENCES deal_scan_runs(id),
  FOREIGN KEY (source_id) REFERENCES deal_sources(id)
);

CREATE INDEX IF NOT EXISTS idx_deal_sources_status ON deal_sources(source_approval_status);
CREATE INDEX IF NOT EXISTS idx_deal_offer_candidates_source ON deal_offer_candidates(source_id);
CREATE INDEX IF NOT EXISTS idx_deal_offer_candidates_status ON deal_offer_candidates(review_status);
CREATE INDEX IF NOT EXISTS idx_deal_offer_candidates_expiry ON deal_offer_candidates(offer_expires_at);
CREATE INDEX IF NOT EXISTS idx_deal_approvals_entity ON deal_approvals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_deal_change_events_candidate ON deal_change_events(offer_candidate_id);
CREATE INDEX IF NOT EXISTS idx_deal_source_scans_run ON deal_source_scans(scan_run_id);
