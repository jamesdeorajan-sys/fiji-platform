-- Issue #54 Stage 1 (SHADOW MODE) — AU$50 Fiji Experience Credit eligibility.
-- `issued` is never set by any code path in Stage 1 — this table only
-- records whether a completed itinerary *would* qualify, for CEO review.
-- `min_spend_threshold` is intentionally nullable: the real minimum spend /
-- product-margin rule is not yet CEO-approved (see docs/CEO_RELEASE_REPORT.md
-- item 16). While it is null, eligibility always resolves to false with
-- reason 'POLICY_UNCONFIGURED'.

CREATE TABLE IF NOT EXISTS experience_credit_eligibility (
  eligibility_id        TEXT PRIMARY KEY,
  itinerary_id          TEXT NOT NULL,
  outbound_movement_id  TEXT NOT NULL REFERENCES movements(movement_id),
  return_movement_id    TEXT NOT NULL REFERENCES movements(movement_id),
  days_before_travel    INTEGER NOT NULL,
  eligible              INTEGER NOT NULL,
  credit_count          INTEGER NOT NULL DEFAULT 0 CHECK (credit_count IN (0, 1, 2)),
  credit_value_each     REAL NOT NULL DEFAULT 25,
  issued                INTEGER NOT NULL DEFAULT 0,
  min_spend_threshold   REAL,
  reason                TEXT,
  test_data             INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_eligibility_itinerary ON experience_credit_eligibility(itinerary_id);
