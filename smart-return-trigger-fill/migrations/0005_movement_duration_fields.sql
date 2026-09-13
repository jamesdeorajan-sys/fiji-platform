-- Issue #54 Stage 1 (SHADOW MODE) — CEO fix 2026-09-13.
-- Chronological match feasibility must be based on when the source
-- movement's own trip actually finishes, not a raw pickup-to-pickup gap.
-- Both columns are nullable: while both are null for a movement, every
-- match candidate computed against it resolves to HOLD_UNKNOWN_TIMING
-- rather than a guessed feasibility verdict (see src/matcher.js).

ALTER TABLE movements ADD COLUMN estimated_duration_minutes INTEGER;
ALTER TABLE movements ADD COLUMN planned_dropoff_datetime TEXT;
