-- VAKAVITI POWER LAUNCH - Supply Conversion (2026-08-25), applied to the ISOLATED preview
-- database only (vakaviti-live-deal-exchange-preview-db, 3f9a36c7-829c-4f9d-8af0-bb5332860f4b).
-- Never applied to production. Extends deal_exchange_offers rather than creating a parallel
-- table, since the CEO's own required fields for an extracted "product candidate" (title,
-- category, locality, price, price basis, booking route, source, checked timestamp) are already
-- nearly all present on this table - the only real gap was a commercial classification distinct
-- from publication eligibility (an ordinary bookable product is valuable supply but is not a
-- "deal", and must never be labelled as one).

-- Classification is orthogonal to publication_decision: publication_decision controls WHETHER a
-- row is ever shown publicly at all; classification controls WHICH surface/label it would use if
-- it were shown. A row can be classification=GENUINE_CURRENT_SPECIAL and still
-- publication_decision=NOT_ELIGIBLE if it fails some other gate - the two are independent facts.
ALTER TABLE deal_exchange_offers ADD COLUMN classification TEXT;
-- Allowed values (enforced at application level, matching deal_exchange_owned_products'
-- existing taxonomy): ORDINARY_BOOKABLE, GENUINE_CURRENT_SPECIAL, LIVE_QUOTE,
-- PRIVATE_DEAL_OPPORTUNITY, INCOMPLETE_OR_CONTRADICTORY.
ALTER TABLE deal_exchange_offers ADD COLUMN classification_reason TEXT;

-- Fiji Flights cross-sell metadata (CEO directive item 12) - non-PII, prepared now so a future
-- Fiji Flights integration never needs to duplicate the Deal Exchange's own evidence data. This
-- branch does NOT build or deploy the flight site - these columns are storage only.
ALTER TABLE deal_exchange_offers ADD COLUMN suitable_arrival_airport TEXT;
ALTER TABLE deal_exchange_offers ADD COLUMN cross_sell_travel_months_json TEXT;

-- Rejected/deferred deal research log (CEO directive item 4) - "record exact reasons, do not
-- discard the historical evidence." A lead that didn't clear the gates is still worth keeping,
-- both so it isn't re-researched from scratch later and so a stale/contradictory provider page
-- can be flagged back to them eventually.
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

-- Security incident log (CEO directive item 5) - prompt-injection and similar findings from
-- automated page fetches. Preserves a hash + short excerpt for audit without needing to re-fetch
-- the (potentially hostile) page again. resolved=0 means fail-closed: no automatic promotion of
-- any data from that source until a human resolves the origin question.
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

-- Entity/corporate-group dedup review (CEO directive item 6) - explicitly NOT an automatic merge.
-- Records shared evidence (e.g. identical phone/email across two nominally distinct candidates)
-- for human resolution, while keeping both candidate rows independently intact until resolved.
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
