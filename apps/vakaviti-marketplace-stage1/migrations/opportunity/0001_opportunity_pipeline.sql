PRAGMA foreign_keys = ON;

-- VAKAVITI DEAL OPPORTUNITY PIPELINE (Lane A - private only). Applied to the isolated
-- vakaviti-opportunity-pipeline-preview-db, NEVER to the production Stage 1 D1. This database
-- has no operators/products/deal_offer_candidates tables of its own - the preview Worker reads
-- that existing evidence read-only from the production DB binding (env.DB) and writes
-- opportunity data only here (env.OPPORTUNITY_DB), so production D1 receives zero writes from
-- this entire feature.

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  provider_name TEXT,
  provider_domain TEXT NOT NULL,
  canonical_source_url TEXT NOT NULL,
  source_id TEXT,
  source_scan_id TEXT,
  detected_title TEXT,
  detected_offer_text TEXT,
  region TEXT,
  locality TEXT,
  category TEXT,
  price_amount TEXT,
  currency TEXT,
  price_basis TEXT,
  booking_deadline TEXT,
  travel_start TEXT,
  travel_end TEXT,
  expiry TEXT,
  inclusions_json TEXT,
  exclusions_json TEXT,
  occupancy_basis TEXT,
  minimum_stay TEXT,
  booking_route TEXT,
  provider_contact_route TEXT,
  evidence_excerpt TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  first_detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  missing_fields_json TEXT NOT NULL DEFAULT '[]',
  contradiction_flags_json TEXT NOT NULL DEFAULT '[]',
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  opportunity_score INTEGER NOT NULL DEFAULT 0,
  score_components_json TEXT NOT NULL DEFAULT '{}',
  -- Lifecycle is intentionally a superset of Class A/B language so a human never has to guess
  -- which stage something is in; PUBLISHED here means "the linked deal candidate was published
  -- through the existing Class B path" - this table itself has no publish action of its own.
  lifecycle_status TEXT NOT NULL DEFAULT 'DETECTED' CHECK (lifecycle_status IN (
    'DETECTED','OUTREACH_READY','CONTACTED','PROVIDER_REPLIED','NEEDS_CLARIFICATION',
    'PROVIDER_CONFIRMED','PUBLICATION_REVIEW','PUBLISHED','REJECTED','EXPIRED','WITHDRAWN','DUPLICATE'
  )),
  assigned_to TEXT,
  contacted_at TEXT,
  provider_replied_at TEXT,
  provider_confirmation_basis TEXT,
  -- Never inferred - see opportunity-gate.ts. NOT_REQUESTED is the only value any automated path
  -- may ever write; REQUESTED/GRANTED/DECLINED are human-entered only, matching deal_offer_candidates'
  -- own provider_permission_status discipline in the production schema.
  provider_permission_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (provider_permission_status IN (
    'NOT_REQUESTED','REQUESTED','GRANTED','DECLINED'
  )),
  image_rights_status TEXT NOT NULL DEFAULT 'NO_IMAGE' CHECK (image_rights_status IN ('NO_IMAGE','APPROVED','UNKNOWN')),
  linked_deal_candidate_id TEXT,
  -- Explicit, queryable marker distinguishing real captured evidence from demo/backfill fixture
  -- data - required so a synthetic Phase 9 backfill record can never be mistaken for (or
  -- accidentally converted as if it were) a real provider-source capture. Not part of the CEO's
  -- named field list; added because "no fabricated commercial claims presented as real" needs a
  -- structural guarantee, not just a convention.
  is_test_fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Canonical provider/source/offer identity dedup - see computeOpportunityFingerprint() in
  -- opportunity-gate.ts, which follows the same normalization discipline as deal-quality.ts's
  -- computeDealIdentity() (source + canonical URL + normalized title + normalized material facts).
  UNIQUE(evidence_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_opportunities_region_category ON opportunities(region, category);
CREATE INDEX IF NOT EXISTS idx_opportunities_score ON opportunities(opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_provider_domain ON opportunities(provider_domain);

-- Append-only by construction: application code only ever INSERTs here, and the two triggers
-- below make that a hard database guarantee, not just a convention any future code change could
-- silently violate.
CREATE TABLE IF NOT EXISTS opportunity_lifecycle_events (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  prior_status TEXT,
  new_status TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('AI','HUMAN','SYSTEM')),
  actor_identity TEXT,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_opp_events_opportunity ON opportunity_lifecycle_events(opportunity_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_opp_events_no_update
BEFORE UPDATE ON opportunity_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'opportunity_lifecycle_events is append-only - no update permitted');
END;

CREATE TRIGGER IF NOT EXISTS trg_opp_events_no_delete
BEFORE DELETE ON opportunity_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'opportunity_lifecycle_events is append-only - no delete permitted');
END;

-- Provider-reply evidence (Phase 6) - kept as its own table rather than overloading
-- opportunities.provider_confirmation_basis, so the original pasted/summarized reply text is
-- preserved verbatim (evidence retention) separately from whatever fields a human later confirms
-- extracting from it onto the opportunity row itself.
CREATE TABLE IF NOT EXISTS opportunity_provider_replies (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
  raw_reply_text TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  proposed_fields_json TEXT NOT NULL DEFAULT '{}',
  contradiction_flags_json TEXT NOT NULL DEFAULT '[]',
  human_confirmed INTEGER NOT NULL DEFAULT 0,
  confirmed_by TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_opp_replies_opportunity ON opportunity_provider_replies(opportunity_id);

-- Isolated test mirror only - shaped like production's deal_offer_candidates table (a small
-- subset of its columns, the ones convertOpportunityToDealCandidate() actually writes) so the
-- governed conversion function's write path can be exercised for real without ever touching the
-- production Stage 1 D1. Never referenced by any code path other than tests/console-preview
-- calls that explicitly pass targetTable='test_deal_offer_candidates_mirror'.
CREATE TABLE IF NOT EXISTS test_deal_offer_candidates_mirror (
  id TEXT PRIMARY KEY,
  proposed_offer_name TEXT,
  factual_summary TEXT,
  category TEXT,
  fiji_location TEXT,
  advertised_price TEXT,
  currency TEXT,
  price_basis TEXT,
  booking_deadline TEXT,
  travel_from TEXT,
  travel_until TEXT,
  inclusions TEXT,
  minimum_stay TEXT,
  booking_route TEXT,
  seller_or_marketer TEXT,
  review_status TEXT,
  source_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
