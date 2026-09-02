-- Milestone 14 follow-up: real bug found live-testing pending boat quotes.
-- worker.js's ESCALATION_TRIGGER_TYPES array was updated to include
-- 'boat_pricing_pending', but the escalations TABLE's own CHECK constraint
-- (a separate, independent enforcement point) was not - every real pending
-- boat /quote call was throwing a genuine D1_ERROR (SQLITE_CONSTRAINT_CHECK)
-- inside createEscalation(), confirmed via `wrangler tail` against a live
-- request, not assumed. SQLite has no ALTER TABLE ... DROP/ADD CONSTRAINT,
-- so this is the standard rebuild-and-swap: same columns, same data, wider
-- CHECK allowlist.

CREATE TABLE escalations_new (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('guest', 'driver')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'geocode_failed', 'needs_manual_confirmation', 'wallet_dispute', 'app_issue', 'other', 'boat_pricing_pending'
  )),
  context TEXT,
  booking_id INTEGER REFERENCES bookings(id),
  driver_id INTEGER REFERENCES drivers(id),
  created_at TEXT DEFAULT (datetime('now')),
  resolved INTEGER NOT NULL DEFAULT 0,
  source_ip TEXT
);

INSERT INTO escalations_new (id, source, trigger_type, context, booking_id, driver_id, created_at, resolved, source_ip)
SELECT id, source, trigger_type, context, booking_id, driver_id, created_at, resolved, source_ip FROM escalations;

DROP TABLE escalations;
ALTER TABLE escalations_new RENAME TO escalations;
