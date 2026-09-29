-- Marau Stage 1 (PREVIEW/TEST ONLY) — round 28: Codex independently
-- verified round 27 (461/461), then reproduced three real defects in
-- worker/source_confirm.js. See that file's own header for the full
-- write-up; this migration provides the durable state the corrected
-- design needs.
--
-- (1) A cancelled reservation that happened to retain a driver id could
--     be read back as a successful confirmation, since the old
--     recovery logic only ever checked "is status still pending?", not
--     "is status actually a genuine confirmed state?".
-- (2) Driver-id equality alone was used to prove "this was MY attempt"
--     during readback recovery — two different attempts (different
--     operators, different callers) could coincidentally target the
--     same driver, and the old design would attribute the outcome to
--     whichever one asked. A durable, source-persisted `attempt_id` is
--     the actual identity now checked, generated and reserved LOCALLY
--     before ever calling the source, then persisted BY the source
--     itself at its own commit boundary alongside the operator name —
--     recoverable from the source's own state even if Marau's local
--     ledger row is never written at all.
-- (3) The single, do-or-die ledger INSERT (recording the whole outcome
--     in one write, AFTER the source call resolved) meant a fault on
--     that one INSERT could lose track of a genuinely successful source
--     confirmation. This is now split, mirroring the already-proven
--     round-22 pattern for the SYNTHETIC-source confirm workflow: a
--     durable PRIMARY row (`marau_source_confirm_outcomes`, reserved
--     UPFRONT, before any source call — this is the row whose identity
--     survives even if everything after it fails) plus a SECONDARY,
--     best-effort audit insert (`marau_source_confirm_decision_log`),
--     never allowed to throw past the caller, repaired on retry from
--     the PRIMARY row's own already-durable values — never re-decided.

CREATE TABLE IF NOT EXISTS marau_staff_identities (
  token         TEXT PRIMARY KEY,
  operator_name TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- The demonstration source client (worker.js's syntheticSourceApiClient)
-- must be able to persist an attempt identity and the authenticated
-- operator AT THE SAME COMMIT as the driver assignment, exactly as a
-- real source with this capability would need to (see
-- worker/source_confirm.js's own "What production does not yet
-- support" note — the REAL nadi-dispatch-api has no equivalent columns
-- today).
ALTER TABLE marau_synthetic_source_bookings ADD COLUMN confirmation_attempt_id TEXT;
ALTER TABLE marau_synthetic_source_bookings ADD COLUMN confirmed_operator_name TEXT;

-- SQLite cannot ALTER a CHECK constraint in place (same limitation
-- already documented at migration 0031) — recreates the table with the
-- corrected shape. This table holds no production data.
CREATE TABLE marau_source_confirm_outcomes_new (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  source_booking_ref      TEXT NOT NULL UNIQUE,
  attempt_id              TEXT NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('reserved', 'confirmed', 'conflict', 'source_cancelled', 'unresolved')),
  intended_driver_id      TEXT NOT NULL,
  operator                TEXT NOT NULL,
  confirmed_driver_id     TEXT,
  recovered_via_readback  INTEGER NOT NULL DEFAULT 0,
  reserved_at             TEXT NOT NULL,
  decided_at              TEXT
);
INSERT INTO marau_source_confirm_outcomes_new (id, source_booking_ref, attempt_id, status, intended_driver_id, operator, confirmed_driver_id, recovered_via_readback, reserved_at, decided_at)
  SELECT id, source_booking_ref, 'legacy-' || id, outcome, intended_driver_id, COALESCE(operator, 'unknown'), confirmed_driver_id, recovered_via_readback, decided_at, decided_at
  FROM marau_source_confirm_outcomes;
DROP TABLE marau_source_confirm_outcomes;
ALTER TABLE marau_source_confirm_outcomes_new RENAME TO marau_source_confirm_outcomes;

CREATE TABLE IF NOT EXISTS marau_source_confirm_decision_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  source_booking_ref  TEXT NOT NULL,
  attempt_id          TEXT NOT NULL,
  status              TEXT NOT NULL,
  logged_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marau_source_confirm_decision_log_ref ON marau_source_confirm_decision_log(source_booking_ref);
