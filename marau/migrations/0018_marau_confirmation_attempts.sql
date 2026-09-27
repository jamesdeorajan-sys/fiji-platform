-- Marau Stage 1 (PREVIEW/TEST ONLY) — a durable audit trail for a deal
-- request's confirm attempt, spanning its own request-status CAS, the
-- vehicle/movement claims, and the offer's own hold/fill transitions.
--
-- FIX for a THIRD independent review finding: "Compensating writes alone
-- do not establish atomicity... Prove interruption/rollback-failure
-- handling and safe retry." The round-2 rollback() compensated the
-- offer/allocation/claim state on failure, but had no durable record of
-- WHAT it was attempting or whether the compensation itself fully
-- succeeded — if a compensating write also failed, the resulting state
-- was indistinguishable from "nothing happened," and nothing prevented
-- an automatic retry from running against a half-compensated state.
--
-- Every confirm attempt that gets past the request-status CAS (see
-- worker.js#handleAdminConfirmDealRequest) now writes one row here first
-- and updates its `phase` as it proceeds. If confirmation fails and
-- rollback fully succeeds, phase becomes ROLLED_BACK and the request is
-- safely retryable (status reverted to REQUESTED). If a compensating
-- write ITSELF fails, phase becomes ROLLBACK_FAILED with the detail
-- recorded — the request is deliberately NOT reverted to REQUESTED in
-- that case (its true state can't be safely assumed), and this row is
-- the durable, human-reviewable signal that manual reconciliation is
-- needed, surfaced via GET /preview/admin/deal-requests.
CREATE TABLE IF NOT EXISTS confirmation_attempts (
  attempt_id   TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES deal_requests(request_id),
  offer_id     TEXT NOT NULL,
  phase        TEXT NOT NULL
    CHECK (phase IN ('STARTED', 'CLAIMING_MOVEMENT', 'CLAIMING_VEHICLE', 'HOLDING_OFFER', 'FILLING_OFFER', 'DONE', 'ROLLED_BACK', 'ROLLBACK_FAILED')),
  error_detail TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_confirmation_attempts_request ON confirmation_attempts(request_id);
CREATE INDEX IF NOT EXISTS idx_confirmation_attempts_phase ON confirmation_attempts(phase);
