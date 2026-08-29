-- Phase 2 (CEO incident correction, 2026-08-29): per-service due-check ledger. Replaces branching
-- on event.cron string equality (the old design, now removed - three overlapping cron expressions
-- each compared via strict `===` against event.cron, a fragile pattern that could silently no-op
-- on any mismatch between the registered and delivered string) with ONE native cron
-- ("*/10 * * * *") whose handler calls runDueAgentTicks(), which independently asks each service
-- "are you due yet" based on its OWN last-successful-run timestamp - decoupled entirely from how
-- often the underlying cron fires, as long as it fires at least as often as the fastest service
-- needs.
CREATE TABLE IF NOT EXISTS service_tick_log (
  id TEXT PRIMARY KEY,
  scheduled_event_time TEXT NOT NULL,   -- from controller.scheduledTime, epoch ms as delivered
  controller_cron TEXT NOT NULL,        -- from controller.cron, recorded RAW/verbatim - never compared via string equality for dispatch
  service_name TEXT NOT NULL CHECK (service_name IN ('DiscoveryAgent','FreshnessAgent','OperationsSupervisorAgent')),
  idempotency_key TEXT NOT NULL UNIQUE,
  is_due INTEGER NOT NULL,
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  outcome_json TEXT,
  next_due_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_service_tick_log_service ON service_tick_log (service_name, started_at);
