-- Marau Stage 1 (PREVIEW/TEST ONLY) — the mutual-exclusion gate for
-- confirm vs. decline, decoupled from deal_requests.status itself.
--
-- FIX for a FOURTH independent review finding: Codex made
-- `INSERT INTO confirmation_attempts` itself fail (a SQLite trigger) and
-- found the guest's Trip showing CONFIRMED while the offer was still
-- ACTIVE with zero allocations and zero audit rows — because the
-- previous design's mutual-exclusion write WAS the CAS straight to
-- deal_requests.status = 'CONFIRMED', made BEFORE any of the real work
-- (movement claim, vehicle allocation, offer hold/fill) had happened.
-- Any failure after that CAS — including one this trivial — left the
-- guest-visible status lying about what actually occurred.
--
-- deal_requests.status now STAYS 'REQUESTED' for the entire duration of
-- a confirm attempt and is only ever written to 'CONFIRMED' as the
-- LITERAL LAST statement, after every real side effect (and the durable
-- confirmation_attempts audit row — see 0018) has already succeeded.
-- This table is the new, separate, cheap, first write that actually wins
-- the confirm-vs-decline race: a single INSERT OR IGNORE keyed on
-- request_id. Its lifecycle:
--   - created when confirm or decline first attempts a decision
--   - DELETED if a confirm attempt is cleanly, fully rolled back (making
--     the request retryable and freeing the claim for a future attempt)
--   - left in place (never deleted) once confirm reaches CONFIRMED or
--     decline reaches DECLINED (terminal, matches deal_requests.status)
--   - left in place, deliberately, if a compensating write during
--     rollback itself fails — this is what blocks a further attempt
--     until POST /preview/admin/deal-requests/:id/reconcile-confirmation
--     (the actionable, admin-only recovery path) resolves it.
CREATE TABLE IF NOT EXISTS deal_decision_claims (
  request_id  TEXT PRIMARY KEY REFERENCES deal_requests(request_id),
  decision    TEXT NOT NULL CHECK (decision IN ('CONFIRM', 'DECLINE')),
  claimed_at  TEXT NOT NULL
);
