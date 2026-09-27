-- Marau Stage 1 (PREVIEW/TEST ONLY) — widens confirmation_attempts.phase
-- to add two fencing/ownership-transfer phases: 'RECONCILING' and
-- 'ROLLING_BACK'.
--
-- FIX for a FIFTH independent review finding ("Fix confirmation/
-- reconciliation concurrency"): Codex paused a confirm attempt
-- immediately after its vehicle_allocations INSERT committed but before
-- the awaited call returned, called reconcile-confirmation, then resumed
-- the original — reconcile returned ROLLED_BACK_TO_REQUESTED while the
-- ORIGINAL attempt, unaware anything had changed underneath it, went on
-- to complete normally and wrote deal_requests.status = 'CONFIRMED'.
-- Result: a FILLED offer, a CONFIRMED request, and ZERO allocations/
-- movement claims — a resource-safety violation, because admin
-- authentication on the reconcile call was mistaken for exclusive
-- ownership of that specific in-flight attempt, which it is not.
--
-- Fix: every forward-progress phase transition the confirm handler makes
-- (worker.js#handleAdminConfirmDealRequest) is now itself a CAS
-- (`UPDATE ... WHERE attempt_id = ? AND phase = <expected current
-- phase>`), and reconcile-confirmation must WIN an identical CAS
-- (`phase = <the phase it just read> -> 'RECONCILING'`) before it is
-- allowed to inspect or touch any real state. Whichever side's CAS
-- commits first exclusively owns that attempt from that point on — the
-- loser aborts immediately, writing nothing further, rather than racing
-- ahead on stale assumptions. 'ROLLING_BACK' is the same fencing device
-- used by the confirm handler's OWN self-triggered rollback() (a normal
-- business-conflict rejection, not an external reconcile), so a
-- concurrent reconcile call can never race a same-attempt self-rollback
-- either.
--
-- SQLite cannot ALTER a CHECK constraint in place, so the table is
-- recreated with the widened constraint and its data copied across —
-- the same _new/rename technique already used once in this schema's
-- history. No rows exist yet in any real deployment of this preview-only
-- table, so this is a no-op in practice; done properly regardless.
CREATE TABLE confirmation_attempts_new (
  attempt_id   TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES deal_requests(request_id),
  offer_id     TEXT NOT NULL,
  phase        TEXT NOT NULL
    CHECK (phase IN ('STARTED', 'CLAIMING_MOVEMENT', 'CLAIMING_VEHICLE', 'HOLDING_OFFER', 'FILLING_OFFER', 'DONE', 'ROLLED_BACK', 'ROLLBACK_FAILED', 'RECONCILING', 'ROLLING_BACK')),
  error_detail TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

INSERT INTO confirmation_attempts_new SELECT * FROM confirmation_attempts;
DROP TABLE confirmation_attempts;
ALTER TABLE confirmation_attempts_new RENAME TO confirmation_attempts;

CREATE INDEX IF NOT EXISTS idx_confirmation_attempts_request ON confirmation_attempts(request_id);
CREATE INDEX IF NOT EXISTS idx_confirmation_attempts_phase ON confirmation_attempts(phase);
