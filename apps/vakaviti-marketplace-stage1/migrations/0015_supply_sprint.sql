PRAGMA foreign_keys = ON;

-- P1.4: the initial AI supply sprint controller. Two new tables only, both purpose-built for
-- provider-discovery runs specifically - deliberately NOT a reuse of deal_scan_runs/
-- deal_source_scans (those are shaped around deal_offer_candidates outcomes: quality_gates_*,
-- deal_identity_hash, etc. - forcing provider-discovery outcomes through those columns would mean
-- either a schema change to an already-live table or overloading columns with a second meaning).
-- No existing table is touched.

CREATE TABLE IF NOT EXISTS supply_sprint_runs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  source_domains_json TEXT NOT NULL,
  next_batch_offset INTEGER NOT NULL DEFAULT 0,
  sources_processed INTEGER NOT NULL DEFAULT 0,
  sources_failed INTEGER NOT NULL DEFAULT 0,
  candidates_created INTEGER NOT NULL DEFAULT 0,
  candidates_updated INTEGER NOT NULL DEFAULT 0,
  candidates_rejected_weak INTEGER NOT NULL DEFAULT 0,
  product_candidates_created INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per source processed by a sprint run (any run, any batch) - the complete audit trail
-- of what the sprint did to each domain, kept even when the outcome is "nothing created" (a weak
-- page or a fetch failure is exactly as auditable as a successful candidate creation).
CREATE TABLE IF NOT EXISTS supply_sprint_scans (
  id TEXT PRIMARY KEY,
  sprint_run_id TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  http_status INTEGER,
  classification TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'CANDIDATE_CREATED','CANDIDATE_UPDATED','SKIPPED_ALREADY_EXISTS','REJECTED_WEAK','FETCH_FAILED'
  )),
  resulted_candidate_id TEXT,
  missing_fields_json TEXT,
  products_found INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sprint_run_id) REFERENCES supply_sprint_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_supply_sprint_scans_run ON supply_sprint_scans(sprint_run_id);
