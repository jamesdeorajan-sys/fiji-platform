-- Vakaviti Offer Agent Preview - source-family approval registry (Phase A-R item 4 schema
-- proposal, now applied ONLY to this isolated preview database, never to production).
--
-- Domain approval alone never authorizes any path - allowed_path_patterns must be non-empty and
-- explicitly matched; excluded_path_patterns always win. Enforced in application code by
-- isPathAuthorized() (source-family-model.ts), not by this schema - this table only stores the
-- family's own declared patterns.

CREATE TABLE IF NOT EXISTS offer_source_families (
  id TEXT PRIMARY KEY,
  legal_provider_or_seller_identity TEXT NOT NULL,
  approved_domain TEXT NOT NULL,
  allowed_path_patterns_json TEXT NOT NULL,   -- JSON array, e.g. ["/specials","/deals/*"]
  excluded_path_patterns_json TEXT NOT NULL,  -- JSON array
  authoritative_fields_json TEXT NOT NULL,    -- JSON array of MaterialField values
  extraction_profile TEXT NOT NULL CHECK (extraction_profile IN ('STANDARD_HTML','JS_RENDERED','FEED_XML','FEED_JSON')),
  currency_expectations_json TEXT NOT NULL,   -- JSON array of ISO 4217 codes
  permitted_page_types_json TEXT NOT NULL,    -- JSON array
  recheck_schedule_hours INTEGER NOT NULL,
  rate_limit_per_hour INTEGER NOT NULL,
  robots_access_policy TEXT NOT NULL CHECK (robots_access_policy IN ('ROBOTS_TXT_HONORED','EXPLICIT_PERMISSION_ON_FILE')),
  source_approval_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (source_approval_status IN ('PENDING_REVIEW','APPROVED','PAUSED','REJECTED')),
  trust_score INTEGER NOT NULL DEFAULT 50,
  consecutive_anomaly_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  backoff_until TEXT,
  next_scan_at TEXT,
  approval_actor_id TEXT NOT NULL,
  approval_evidence TEXT,
  approved_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_offer_source_families_status ON offer_source_families (source_approval_status);
CREATE INDEX IF NOT EXISTS idx_offer_source_families_domain ON offer_source_families (approved_domain);

-- Traces which source family produced each canonical offer - additive column, nullable so it does
-- not disturb any existing row shape assumption.
ALTER TABLE deal_exchange_offers ADD COLUMN source_family_id TEXT;
