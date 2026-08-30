-- Phase 6 (CEO incident correction, 2026-08-29): a proper, structural, queryable marker instead of
-- relying on matching provider_name text. Any row created for a controlled test (DLQ/quarantine
-- simulation, etc.) must be flagged here so every status/reporting query can exclude it by a single
-- WHERE clause, not by string-matching a label that could drift or be spoofed.
ALTER TABLE deal_exchange_offers ADD COLUMN is_synthetic_fixture INTEGER NOT NULL DEFAULT 0;

-- Retroactively mark the one fixture created this session (test-fixture-quarantine-001) - it cannot
-- be deleted (append-only evidence/history + a foreign key from those back to this row - see the
-- Phase 5 return for the confirmed SQLITE_CONSTRAINT_TRIGGER / SQLITE_CONSTRAINT_FOREIGNKEY
-- errors), so it is marked instead.
UPDATE deal_exchange_offers SET is_synthetic_fixture = 1 WHERE id = 'test-fixture-quarantine-001';
