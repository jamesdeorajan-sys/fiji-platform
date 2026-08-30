PRAGMA foreign_keys = ON;

-- P1.4A: minimal, sanitized observability for the supply sprint activation flow itself (login ->
-- session check -> CSRF -> Origin -> run creation), as distinct from supply_sprint_runs/
-- supply_sprint_scans (0015), which only ever gain a row once a run has actually started. Before
-- this table, a blocked or failed activation attempt (wrong session, expired CSRF, blocked
-- origin) left ZERO trace anywhere - which is part of why the prior incident (an attempted sprint
-- that never produced a run) could not be diagnosed from D1 alone. Every field here is a boolean
-- or a short fixed code - never a token, cookie, CSRF value, or any extracted provider content.
CREATE TABLE IF NOT EXISTS supply_sprint_activation_log (
  id TEXT PRIMARY KEY,
  request_received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  route TEXT NOT NULL,
  authenticated INTEGER NOT NULL CHECK (authenticated IN (0,1)),
  csrf_valid INTEGER CHECK (csrf_valid IS NULL OR csrf_valid IN (0,1)),
  origin_valid INTEGER CHECK (origin_valid IS NULL OR origin_valid IN (0,1)),
  run_created INTEGER NOT NULL DEFAULT 0 CHECK (run_created IN (0,1)),
  run_id TEXT,
  failure_stage TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_supply_sprint_activation_log_created ON supply_sprint_activation_log(created_at);
