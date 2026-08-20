PRAGMA foreign_keys = ON;

-- P1.2: candidate-quality gate, page classification, URL canonicalization, and deal-identity
-- audit trail. Fully additive - twelve nullable columns on the existing deal_source_scans
-- table (native ADD COLUMN, no CHECK-constraint change, no table rebuild), nothing else. Every
-- scan already gets exactly one deal_source_scans row (see deal-agent.ts's runDailyDiscovery) -
-- these columns record what the deterministic quality gate in src/deal-quality.ts decided about
-- that scan, so complete scan evidence is preserved regardless of whether a candidate was
-- created. No existing table, column, or CHECK constraint is touched; deal_offer_candidates and
-- deal_change_events need no schema change at all - MATERIAL_CHANGE_DETECTED already exists in
-- deal_offer_candidates.review_status's CHECK constraint, and deal_change_events.event_type is
-- already free text, both from the original 0008 migration.

ALTER TABLE deal_source_scans ADD COLUMN canonical_url TEXT;
ALTER TABLE deal_source_scans ADD COLUMN deal_identity_hash TEXT;
ALTER TABLE deal_source_scans ADD COLUMN page_classification TEXT;
ALTER TABLE deal_source_scans ADD COLUMN quality_decision TEXT;
ALTER TABLE deal_source_scans ADD COLUMN quality_gates_passed TEXT;
ALTER TABLE deal_source_scans ADD COLUMN quality_gates_failed TEXT;
ALTER TABLE deal_source_scans ADD COLUMN quality_missing_fields TEXT;
ALTER TABLE deal_source_scans ADD COLUMN quality_contradiction_flags TEXT;
ALTER TABLE deal_source_scans ADD COLUMN quality_confidence REAL;
ALTER TABLE deal_source_scans ADD COLUMN quality_rejection_reason TEXT;
ALTER TABLE deal_source_scans ADD COLUMN resulted_candidate_id TEXT;
ALTER TABLE deal_source_scans ADD COLUMN resulted_outcome TEXT;

CREATE INDEX IF NOT EXISTS idx_deal_source_scans_outcome ON deal_source_scans(resulted_outcome, created_at);
CREATE INDEX IF NOT EXISTS idx_deal_source_scans_identity ON deal_source_scans(deal_identity_hash);
