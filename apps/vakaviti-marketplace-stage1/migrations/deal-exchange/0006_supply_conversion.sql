-- VAKAVITI POWER LAUNCH - Supply Conversion, CORRECTED (2026-08-25).
-- DEPENDS_ON_PR_22 / NOT_INDEPENDENTLY_MERGEABLE / DO_NOT_MERGE_BEFORE_PR_22 - this migration
-- references deal_exchange_offers, which only exists after PR #22's own migrations 0001-0005.
-- This branch (ceo/vakaviti-product-extraction-v2) is stacked on PR #22's current HEAD for
-- exactly this reason - it is not independently mergeable onto production.
--
-- Superseded migration: the original 0006_supply_conversion.sql on branch
-- ceo/vakaviti-product-extraction (based directly on production HEAD, before this correction)
-- is preserved as historical evidence, not deleted or force-pushed over. That branch's migration
-- would fail if ever applied to a database that doesn't already have deal_exchange_offers - this
-- was the exact defect this migration corrects.
--
-- CEO correction (2026-08-25): the original version of this migration stored 20 ordinary/private
-- THIRD-PARTY PRODUCT rows inside deal_exchange_offers. That table is for DEAL OPPORTUNITIES
-- (time-bound specials, seller packages, private deal leads) - an ordinary bookable product is
-- valuable launch supply but is never a deal, and conflating the two tables risks a product row
-- someday being miscounted as a deal simply because it lives in the same database. This version
-- creates a genuinely separate table instead.

-- Classification/cross-sell columns for rows that ARE deal-shaped (specials, seller packages,
-- private deal opportunities) - unchanged from the original migration, this part was correct.
-- Applied only if not already present (idempotent against the already-mutated preview DB).
ALTER TABLE deal_exchange_offers ADD COLUMN classification TEXT;
-- Allowed values: GENUINE_CURRENT_SPECIAL, PRIVATE_DEAL_OPPORTUNITY, INCOMPLETE_OR_CONTRADICTORY.
-- ORDINARY_BOOKABLE and LIVE_QUOTE product classifications belong in
-- deal_exchange_product_candidates below, never here.
ALTER TABLE deal_exchange_offers ADD COLUMN classification_reason TEXT;

-- Fiji Flights cross-sell metadata (CEO directive item 12, truth-corrected item 5): only ever
-- populated from a source-evidenced operating window. cross_sell_travel_months_json holds months
-- the OFFICIAL SOURCE itself states as valid/operating - never a traveller's selected trip
-- months (that's a separate, request-time concept that doesn't belong in stored evidence at
-- all) and never a planning recommendation dressed up as a fact. NULL means
-- AVAILABILITY_NOT_ESTABLISHED - the application layer must render that explicitly, never blank.
ALTER TABLE deal_exchange_offers ADD COLUMN suitable_arrival_airport TEXT;
ALTER TABLE deal_exchange_offers ADD COLUMN cross_sell_travel_months_json TEXT;

-- Rejected/deferred deal research log - unchanged from the original migration.
CREATE TABLE IF NOT EXISTS deal_exchange_rejected_evidence (
  id TEXT PRIMARY KEY,
  subject_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  category TEXT,
  rejection_reason TEXT NOT NULL,
  evidence_json TEXT,
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Security incident log - unchanged. Append-only by convention (application layer must never
-- UPDATE or DELETE a row here - only resolved can flip 0->1 via a dedicated, audited action).
-- excerpt_snippet is untrusted content: the application layer MUST HTML-escape it on every render
-- surface, MUST NEVER interpolate it into an AI/system prompt, and MUST NEVER treat it as
-- executable/instructional - this is a data-handling contract this migration cannot enforce by
-- itself, recorded here so it isn't lost before the admin surface that reads this table is built.
CREATE TABLE IF NOT EXISTS deal_exchange_security_incidents (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  incident_type TEXT NOT NULL,
  excerpt_snippet TEXT,
  excerpt_sha256 TEXT,
  detected_at TEXT NOT NULL,
  containment_action TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Entity/corporate-group dedup review - unchanged. Never an automatic merge; both candidate rows
-- stay independently intact until a human resolves review_status.
CREATE TABLE IF NOT EXISTS deal_exchange_entity_review (
  id TEXT PRIMARY KEY,
  entity_a_name TEXT NOT NULL,
  entity_a_ref TEXT,
  entity_b_name TEXT NOT NULL,
  entity_b_ref TEXT,
  shared_evidence_json TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'HUMAN_ENTITY_RESOLUTION_REQUIRED',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- NEW, CORRECTED: ordinary/candidate THIRD-PARTY products live here, never in
-- deal_exchange_offers. Distinct from:
--   - candidate_operators (production Stage1 DB) - the PROVIDER-level candidate record.
--   - product_candidates (production Stage1 DB) - inspected before writing this migration;
--     not reused directly because it lacks locality/region, booking_route, inclusions/exclusions
--     and evidence-bundle fields this table needs, and is tied to operator_id/operator_candidate_id
--     foreign keys into PRODUCTION tables, which an isolated preview table must never reference
--     directly. operator_candidate_ref below is a soft, cross-database text reference only - no
--     FK, no join, no assumption the referenced row still exists or is unchanged.
--   - deal_exchange_owned_products - Vakaviti's OWN (Fiji Tour Transfers) inventory, unrelated.
--   - deal_exchange_offers - DEAL opportunities only, never ordinary products.
-- Future integration contract (Track E): when this table's rows are promoted, they map onto
-- Stage1's product_candidates shape (canonical_name<-product_name, source_url<-source_url,
-- source_observed_at<-checked_at, pricing_basis<-price_basis) via an explicit promotion step -
-- never an implicit join, and never before gate_status='PASSES_USABLE_PRODUCT_GATE'.
CREATE TABLE IF NOT EXISTS deal_exchange_product_candidates (
  id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL,
  operator_candidate_ref TEXT,
  product_name TEXT NOT NULL,
  category TEXT,
  locality TEXT,
  region TEXT,
  duration_minutes INTEGER,
  nights INTEGER,
  price_amount TEXT,
  currency TEXT,
  is_from_price INTEGER NOT NULL DEFAULT 0,
  price_basis TEXT CHECK (price_basis IS NULL OR price_basis IN ('PER_PERSON','PER_ROOM','PER_FAMILY','TOTAL','PER_NIGHT')),
  booking_route TEXT,
  inclusions TEXT,
  exclusions TEXT,
  source_url TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  extraction_method TEXT NOT NULL DEFAULT 'AGENT_RESEARCH',
  -- CANDIDATE = named/sourced but not yet fully evidenced; PARTIAL = some required fields still
  -- missing; CONFIRMED = every required field independently resolved from an accepted authority.
  evidence_status TEXT NOT NULL DEFAULT 'CANDIDATE' CHECK (evidence_status IN ('CANDIDATE','PARTIAL','CONFIRMED')),
  review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING','APPROVED','REJECTED')),
  -- gate_status defaults to NOT_EVALUATED and MUST stay that way until a real deterministic
  -- usable-product gate function exists and actually runs - no product here counts toward any
  -- "usable products" launch total while gate_status='NOT_EVALUATED'.
  gate_status TEXT NOT NULL DEFAULT 'NOT_EVALUATED' CHECK (gate_status IN ('NOT_EVALUATED','PASSES_USABLE_PRODUCT_GATE','FAILS_USABLE_PRODUCT_GATE')),
  suitable_arrival_airport TEXT,
  -- NULL unless the source page itself states an operating/validity window. The application
  -- layer must render null as "AVAILABILITY_NOT_ESTABLISHED", never as blank or as "any month".
  operating_months_evidenced_json TEXT,
  is_test_fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
