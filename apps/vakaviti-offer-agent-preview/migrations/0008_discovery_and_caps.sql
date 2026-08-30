-- Vakaviti Offer Agent Preview - discovery staging + publication cap counters.

-- DISCOVER step output: a candidate URL proposed by any of the six discovery providers, before it
-- has been fetched/extracted/gated. authority is always 'DISCOVERY_ONLY' at insert time - enforced
-- in application code by sanitizeDiscoveredCandidate() (discovery-providers.ts), mirrored here as a
-- CHECK constraint so a stray write path can never persist anything else.
CREATE TABLE IF NOT EXISTS discovered_candidates (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  discovered_via TEXT NOT NULL,
  authority TEXT NOT NULL DEFAULT 'DISCOVERY_ONLY' CHECK (authority = 'DISCOVERY_ONLY'),
  source_family_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','QUEUED','PROCESSED','SKIPPED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (url)
);
CREATE INDEX IF NOT EXISTS idx_discovered_candidates_status ON discovered_candidates (status);

-- One row per (source_family_id, UTC date) - the atomic counter behind the 10/source-family/day
-- cap. A second row per day-per-family is structurally impossible (UNIQUE), so the increment
-- itself (an UPSERT with a bounds check in application code) is the enforcement point, not a
-- separate lock.
CREATE TABLE IF NOT EXISTS daily_publication_counters (
  source_family_id TEXT NOT NULL,
  publication_date TEXT NOT NULL, -- 'YYYY-MM-DD', UTC
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_family_id, publication_date)
);

-- The global 30/day counter, same shape with a fixed sentinel key so it reuses the exact same
-- table/index pattern rather than a bespoke single-row table.
CREATE TABLE IF NOT EXISTS daily_global_publication_counter (
  publication_date TEXT PRIMARY KEY, -- 'YYYY-MM-DD', UTC
  count INTEGER NOT NULL DEFAULT 0
);
