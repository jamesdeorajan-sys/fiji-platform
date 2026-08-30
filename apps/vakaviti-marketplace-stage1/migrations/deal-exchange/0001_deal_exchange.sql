-- VAKAVITI LIVE DEAL EXCHANGE - Commercial Truth Model, Milestone 1 (2026-08-24).
-- Additive only - creates new tables, touches nothing existing. Owned entirely by this feature
-- branch; has no relationship to PR #21's opportunity_* tables (separate branch, not merged).

CREATE TABLE IF NOT EXISTS deal_exchange_offers (
  id TEXT PRIMARY KEY,
  offer_owner_type TEXT NOT NULL CHECK (offer_owner_type IN (
    'VAKAVITI_BOOKABLE', 'PROVIDER_DIRECT', 'SELLER_PACKAGE', 'PRICE_CHECK_REQUIRED', 'FLIGHT_QUOTE'
  )),

  -- Entity separation (never collapsed into one "owner" field)
  provider_id TEXT,
  provider_name TEXT,
  seller_id TEXT,
  seller_name TEXT,
  fulfilment_operator_id TEXT,
  fulfilment_operator_name TEXT,
  booking_recipient TEXT,
  enquiry_handler TEXT,

  canonical_source_url TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  identity_key TEXT NOT NULL,

  -- Resolved commercial fields (the OUTPUT of resolveEvidenceBundle(), never hand-edited - see
  -- deal_exchange_evidence for the provenance behind each of these)
  price_amount TEXT,
  currency TEXT,
  is_from_price INTEGER NOT NULL DEFAULT 0,
  price_basis TEXT CHECK (price_basis IS NULL OR price_basis IN ('PER_PERSON','PER_ROOM','PER_FAMILY','TOTAL','PER_NIGHT')),
  occupancy_basis TEXT,
  nights INTEGER,
  departure_city TEXT,
  booking_deadline TEXT,
  travel_start TEXT,
  travel_end TEXT,
  blackout_dates TEXT,
  inclusions TEXT,
  exclusions TEXT,
  taxes_fees_status TEXT CHECK (taxes_fees_status IS NULL OR taxes_fees_status IN ('INCLUDED','EXCLUDED','UNKNOWN')),
  booking_route TEXT,
  locality TEXT,
  region TEXT,
  category TEXT,

  publication_decision TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE' CHECK (publication_decision IN ('ELIGIBLE','NOT_ELIGIBLE','PRIVATE_ONLY')),
  passed_gates_json TEXT NOT NULL DEFAULT '[]',
  failed_gates_json TEXT NOT NULL DEFAULT '[]',
  public_label TEXT,
  duplicate_of_id TEXT REFERENCES deal_exchange_offers(id),

  checked_at TEXT,
  is_test_fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_deal_exchange_offers_identity_key ON deal_exchange_offers (identity_key);
CREATE INDEX IF NOT EXISTS idx_deal_exchange_offers_owner_type ON deal_exchange_offers (offer_owner_type);
CREATE INDEX IF NOT EXISTS idx_deal_exchange_offers_decision ON deal_exchange_offers (publication_decision);
CREATE INDEX IF NOT EXISTS idx_deal_exchange_offers_provider ON deal_exchange_offers (provider_id);

-- Field-level evidence - append-only. A new evidence item for an already-evidenced field is a NEW
-- row, never an UPDATE - "preserve old and new evidence when facts change."
CREATE TABLE IF NOT EXISTS deal_exchange_evidence (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES deal_exchange_offers(id),
  field TEXT NOT NULL,
  value TEXT,
  source_class TEXT NOT NULL,
  source_url TEXT,
  checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deal_exchange_evidence_offer ON deal_exchange_evidence (offer_id);
CREATE INDEX IF NOT EXISTS idx_deal_exchange_evidence_field ON deal_exchange_evidence (offer_id, field);

CREATE TRIGGER IF NOT EXISTS trg_deal_exchange_evidence_no_update
BEFORE UPDATE ON deal_exchange_evidence
BEGIN
  SELECT RAISE(ABORT, 'deal_exchange_evidence is append-only - evidence is never edited, only superseded by a new row.');
END;
CREATE TRIGGER IF NOT EXISTS trg_deal_exchange_evidence_no_delete
BEFORE DELETE ON deal_exchange_evidence
BEGIN
  SELECT RAISE(ABORT, 'deal_exchange_evidence is append-only - evidence is never deleted.');
END;

-- Material-change history - append-only, same discipline as PR #21's opportunity_lifecycle_events.
CREATE TABLE IF NOT EXISTS deal_exchange_offer_history (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES deal_exchange_offers(id),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deal_exchange_offer_history_offer ON deal_exchange_offer_history (offer_id);

CREATE TRIGGER IF NOT EXISTS trg_deal_exchange_history_no_update
BEFORE UPDATE ON deal_exchange_offer_history
BEGIN
  SELECT RAISE(ABORT, 'deal_exchange_offer_history is append-only.');
END;
CREATE TRIGGER IF NOT EXISTS trg_deal_exchange_history_no_delete
BEFORE DELETE ON deal_exchange_offer_history
BEGIN
  SELECT RAISE(ABORT, 'deal_exchange_offer_history is append-only.');
END;

-- test_deal_exchange_offers_mirror: an isolated mirror table for tests/preview QA that need to
-- exercise a write path without ever touching the real deal_exchange_offers table - same pattern
-- as PR #21's test_deal_offer_candidates_mirror.
CREATE TABLE IF NOT EXISTS test_deal_exchange_offers_mirror (
  id TEXT PRIMARY KEY,
  offer_owner_type TEXT NOT NULL,
  provider_name TEXT,
  seller_name TEXT,
  canonical_source_url TEXT,
  public_label TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
