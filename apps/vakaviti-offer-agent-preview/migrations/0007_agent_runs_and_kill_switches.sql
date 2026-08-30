-- Vakaviti Offer Agent Preview - unified audit surface (agent_runs) and authority state
-- (kill_switches) - isolated preview database only.

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL CHECK (agent_name IN (
    'DiscoveryAgent','OfferProcessingWorkflow','PublicationAgent','FreshnessAgent','OperationsSupervisorAgent'
  )),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED')),
  step TEXT,
  outcome_json TEXT,
  source_family_id TEXT,
  offer_id TEXT,
  queue_message_id TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_name ON agent_runs (agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs (started_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs (status);

-- Every authority transition (authority-model.ts) is also durably recorded here, independent of
-- agent_runs, so the audit trail survives even if a run row's own JSON summary is incomplete.
CREATE TABLE IF NOT EXISTS authority_transitions (
  id TEXT PRIMARY KEY,
  transition_type TEXT NOT NULL CHECK (transition_type IN (
    'GLOBAL_KILL_SWITCH','SOURCE_PAUSE','SOURCE_APPROVE','OFFER_QUARANTINE','RESTORE_HUMAN','RESTORE_CLEAN_REVALIDATION'
  )),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  evidence TEXT,
  prior_state TEXT NOT NULL,
  next_state TEXT NOT NULL,
  subject_id TEXT, -- source family id or offer id, depending on transition_type
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_authority_transitions_subject ON authority_transitions (subject_id);

-- scope_id is NOT NULL (empty string for GLOBAL, since SQLite treats NULL as never-equal-to-NULL
-- in a UNIQUE constraint, which would let a second GLOBAL row slip in) - the UNIQUE(scope,
-- scope_id) pair is what makes "the one global switch" a real, enforced singleton at the DB level,
-- not just an application convention.
CREATE TABLE IF NOT EXISTS kill_switches (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL','SOURCE','OFFER')),
  scope_id TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (scope, scope_id)
);

-- Migration-seeded default row only - never application-INSERTable (only UPDATEable, via
-- setGlobalKillSwitch()'s human-only authority gate, enforced in application code). Starts
-- INACTIVE - the agent system is authorized to run per this CEO directive; this switch is the
-- emergency stop, not the initial gate.
INSERT OR IGNORE INTO kill_switches (id, scope, scope_id, active, reason, set_by, set_at)
VALUES ('global', 'GLOBAL', '', 0, 'Initial deployment default', 'MIGRATION', CURRENT_TIMESTAMP);
