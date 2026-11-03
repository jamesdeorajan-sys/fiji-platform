-- Gate 1.5 additions (isolated D1 only). Appended to schema/gate1_isolated_schema.sql by scripts/build_schema.mjs.

-- Identity marker: the Worker refuses to serve unless this row exists with the exact values (protects against a wrong/production binding).
CREATE TABLE gate15_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  marker TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO gate15_identity (id, marker, worker_name, created_at)
VALUES (1, 'driver-v2-gate15-isolated-20261103', 'driver-v2-gate15-isolated', 'schema-build');

CREATE TABLE gate15_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- Capture-only "outbox": every notification INTENT is recorded here and nothing is sent. The CHECKs make a recorded real send structurally impossible.
CREATE TABLE gate15_capture (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  channel TEXT,
  booking_id INTEGER,
  offer_id TEXT,
  to_role TEXT,
  to_driver_id INTEGER,
  delivered INTEGER NOT NULL DEFAULT 0,
  suppressed INTEGER NOT NULL DEFAULT 1 CHECK (suppressed = 1),
  real_send INTEGER NOT NULL DEFAULT 0 CHECK (real_send = 0),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_gate15_capture_once ON gate15_capture(kind, booking_id)
  WHERE kind IN ('STAFF_FALLBACK', 'GUEST_DRIVER_ASSIGNED', 'ADMIN_DRIVER_ASSIGNED');

-- Scratch table for the D1 primitive probes (rollback, partial unique index, INSERT OR IGNORE ... SELECT, json_extract).
CREATE TABLE gate15_probe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grp TEXT NOT NULL,
  tag TEXT,
  n INTEGER,
  payload TEXT
);
CREATE UNIQUE INDEX uq_gate15_probe_partial ON gate15_probe(grp, tag) WHERE n = 1;
