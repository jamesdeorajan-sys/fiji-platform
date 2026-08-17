PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  input_json TEXT NOT NULL,
  output_json TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  model TEXT,
  confidence REAL,
  requires_human INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS human_gates (
  id TEXT PRIMARY KEY,
  gate_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  recommended_action TEXT,
  evidence_json TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_copilot_sessions (
  id TEXT PRIMARY KEY,
  operator_id TEXT,
  claimant_phone TEXT,
  claimant_email TEXT,
  current_step TEXT NOT NULL DEFAULT 'IDENTITY',
  state_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (operator_id) REFERENCES operators(id)
);

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  suggestion_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  confidence REAL,
  source_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'PROPOSED',
  accepted_by TEXT,
  accepted_at TEXT,
  rejected_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_job_id) REFERENCES ai_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status, job_type);
CREATE INDEX IF NOT EXISTS idx_human_gates_status ON human_gates(status, gate_type);
CREATE INDEX IF NOT EXISTS idx_provider_sessions_operator ON provider_copilot_sessions(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_entity ON ai_suggestions(entity_type, entity_id, status);
