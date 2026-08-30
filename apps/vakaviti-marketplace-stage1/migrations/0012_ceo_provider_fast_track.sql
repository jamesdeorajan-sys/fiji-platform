PRAGMA foreign_keys = ON;

-- P1.3A: CEO-confirmed provider fast-track onboarding. Fully additive - one new table only.
-- No existing table (operators, products, offers, candidate_operators, deal_sources,
-- deal_offer_candidates) is touched by this migration. Pilot Partner status is deliberately NOT
-- a cached column on operators - it is derived live, on every read, from whether an unrevoked
-- row exists here (same "recompute, never trust a cached flag" discipline as
-- isPubliclyEligible() in src/deals.ts), so it can never drift out of sync with a revocation.

CREATE TABLE IF NOT EXISTS provider_ceo_confirmations (
  id TEXT PRIMARY KEY,
  operator_id TEXT,                          -- filled in once the operator record exists (identity engine step)
  canonical_provider_name TEXT NOT NULL,
  official_domain TEXT NOT NULL,
  canonical_domain TEXT NOT NULL,             -- normalized form used for duplicate detection
  date_spoken TEXT NOT NULL,
  provider_contact_name TEXT,
  provider_contact_role TEXT,
  participation_confirmed INTEGER NOT NULL CHECK (participation_confirmed IN (0,1)),
  scope_website_content_allowed INTEGER NOT NULL DEFAULT 0 CHECK (scope_website_content_allowed IN (0,1)),
  scope_deals_allowed INTEGER NOT NULL DEFAULT 0 CHECK (scope_deals_allowed IN (0,1)),
  scope_images_allowed INTEGER NOT NULL DEFAULT 0 CHECK (scope_images_allowed IN (0,1)),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'CEO_CONFIRMED_PILOT' CHECK (status IN ('CEO_CONFIRMED_PILOT','REVOKED')),
  actor TEXT NOT NULL,
  authorization_source TEXT NOT NULL DEFAULT 'CEO_VERBAL_CONFIRMATION',
  reason TEXT,
  onboarding_summary_json TEXT,               -- what the bounded engines actually did (candidate/operator/product/deal ids created)
  revoked_at TEXT,
  revoked_by TEXT,
  revocation_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operator_id) REFERENCES operators(id)
);
CREATE INDEX IF NOT EXISTS idx_provider_ceo_confirmations_operator ON provider_ceo_confirmations(operator_id);
CREATE INDEX IF NOT EXISTS idx_provider_ceo_confirmations_domain ON provider_ceo_confirmations(canonical_domain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_ceo_confirmations_active_domain
  ON provider_ceo_confirmations(canonical_domain) WHERE revoked_at IS NULL;
