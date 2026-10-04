-- milestone38: durable confirmation attempt identity + service-asserted operator (Issue #54 Marau integration).
--
-- NOT APPLIED to any database by this change. Production migrations need James's separate approval.
--
-- Purely additive: three nullable columns on bookings and one partial unique index. No existing column, row,
-- caller or response changes. A booking confirmed by any existing path (driver accept, manual-assign without
-- attempt_id) simply keeps these columns NULL.
--
--   confirmation_attempt_id          caller-chosen id of the one decision that assigned this booking, written in
--                                    the same atomic compare-and-swap UPDATE as the assignment (so it cannot be
--                                    missing for a decision that actually committed).
--   confirmed_operator               the individual staff member the authenticated service caller says it acted for.
--   confirmed_operator_attestation   always 'service-asserted' today - this Worker authenticates the service
--                                    credential, not the individual. Stored so no reader mistakes it for a
--                                    verified per-operator login.
--
-- The unique index makes "one attempt id names exactly one booking" a database guarantee.
--
-- Run ONCE: SQLite has no ADD COLUMN IF NOT EXISTS, so a second run fails on the first statement, harmlessly
-- (nothing is changed by a failed ALTER). The index statement is itself idempotent.
ALTER TABLE bookings ADD COLUMN confirmation_attempt_id TEXT;
ALTER TABLE bookings ADD COLUMN confirmed_operator TEXT;
ALTER TABLE bookings ADD COLUMN confirmed_operator_attestation TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_confirmation_attempt_id
  ON bookings(confirmation_attempt_id) WHERE confirmation_attempt_id IS NOT NULL;
