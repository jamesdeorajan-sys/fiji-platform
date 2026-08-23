PRAGMA foreign_keys = ON;

-- VAKAVITI SUPPLY OPERATIONS ACTIVATION - Phase 1, root-cause fix.
--
-- Bug found during Phase 0/1 reconciliation of the incomplete 7-source bootstrap
-- (idempotency_key='supply-bootstrap-p1.5-2026-08-21', run id d29ab605-84a6-43b4-be74-e1a4eb516b1e):
--
-- The bootstrap correctly processed its first batch of 3 sources (bluelagooncruises.com,
-- matangiisland.com, savasiisland.com - see supply_sprint_scans for this run) and correctly
-- updated next_batch_offset to 3, leaving status='RUNNING' to wait for the next Cron tick 4
-- hours later (wrangler.toml: "0 */4 * * *"). But recoverStuckSprints() in both
-- src/supply-scheduler.ts and src/supply-sprint-ui.ts marks ANY row with
-- status='RUNNING' AND started_at older than 10 minutes as FAILED - which is true of
-- EVERY multi-tick run within seconds of its first batch finishing, since the next tick is
-- always hours away. The watchdog was measuring "time since the run first started"
-- (appropriate for detecting a genuinely hung single batch) but applying it as if it meant
-- "time since the run was last touched" - the two are only the same thing for a run that
-- finishes in one tick. Any run needing more than one tick (this 7-source bootstrap needs
-- 3, at MAX_SOURCES_PER_TICK=3) was structurally guaranteed to be killed by the watchdog
-- before Cron ever got a chance to continue it - runSupplyBootstrap() also only ever
-- continues a run whose status is still 'RUNNING', so once mis-marked FAILED, nothing in
-- the existing code could ever resume it automatically.
--
-- Fix: replace the single started_at check with two explicit markers around each batch -
-- last_batch_started_at (set the moment a batch begins) and last_batch_completed_at (set
-- the moment it finishes writing its results). A run is only genuinely stuck when a batch
-- STARTED but never completed, for longer than the existing 10-minute threshold - not
-- simply because time has passed since the run began. This preserves the exact same
-- protection against a real hung batch while no longer misfiring on the ordinary gap
-- between Cron ticks.
--
-- This migration also performs one, exactly-justified data correction: run
-- d29ab605-84a6-43b4-be74-e1a4eb516b1e was marked FAILED at a moment when it was not
-- genuinely stuck - its last batch had completed cleanly (all 3 scans in that batch have
-- real outcomes: FETCH_FAILED/ACCESS_DENIED for bluelagooncruises.com, and
-- CANDIDATE_CREATED-but-gate_not_eligible for matangiisland.com and savasiisland.com - see
-- supply_sprint_scans, created_at 08:00:44 through 08:01:16 on 2026-08-23) and
-- next_batch_offset was correctly advanced to 3/7. No scan record, candidate, product, or
-- offer is touched, deleted, or fabricated by this correction - only the run's own
-- status/completed_at/last_batch_* bookkeeping is restored to what it should already have
-- read. The remaining 4 sources (serenitysands.com.fj, captaincookcruisesfiji.com,
-- fiji.intercontinental.com, plantationisland.com) will be processed by the next real Cron
-- tick, in the normal bounded batch of up to 3, using the run's own pre-existing
-- idempotency keys - nothing is rescanned.

ALTER TABLE supply_sprint_runs ADD COLUMN last_batch_started_at TEXT;
ALTER TABLE supply_sprint_runs ADD COLUMN last_batch_completed_at TEXT;

-- Backfill: for the one run that exists, its last real batch is fully evidenced by its own
-- scan rows - use their timestamps rather than guessing.
UPDATE supply_sprint_runs
SET
  last_batch_started_at = '2026-08-23 08:00:42',
  last_batch_completed_at = '2026-08-23 08:01:17',
  status = 'RUNNING',
  completed_at = NULL,
  summary_json = json_set(
    COALESCE(summary_json, '{}'),
    '$.watchdog_correction',
    'Reset from FAILED (false-positive: watchdog measured time-since-start, not time-since-last-batch) back to RUNNING on 2026-08-24 during Phase 1 of VAKAVITI SUPPLY OPERATIONS ACTIVATION. See migration 0019 for full evidence. next_batch_offset (3) and all prior scan/candidate records are unchanged.'
  )
WHERE id = 'd29ab605-84a6-43b4-be74-e1a4eb516b1e' AND status = 'FAILED';
