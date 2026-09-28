-- PREVIEW/TEST ONLY. Durable resource ownership is separate from recovery ownership.
ALTER TABLE smart_offers ADD COLUMN marau_attempt_id TEXT;
-- Only recover journal identities with direct evidence. Do not guess an offer
-- owner for legacy HELD/FILLED resources: reconciliation retains those claims
-- for manual investigation instead of undoing unproven ownership.
UPDATE deal_decision_claims SET journal_attempt_id = attempt_token
WHERE journal_attempt_id IS NULL AND EXISTS (
  SELECT 1 FROM confirmation_attempts a
  WHERE a.attempt_id = deal_decision_claims.attempt_token
    AND a.request_id = deal_decision_claims.request_id
);
