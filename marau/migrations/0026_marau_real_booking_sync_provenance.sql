-- Marau Stage 1 (PREVIEW/TEST ONLY) — round 15, P0 fix (Codex
-- independent review, finding 1): the round-13/14 first-sync recovery
-- path identified "our own prior attempt" by matching `client_booking_ref`
-- alone — a column a GUEST can set directly via the public
-- /preview/bookings endpoint. A guest who predicted the sync's
-- deterministic REAL-SYNC-<source_booking_ref> naming scheme could
-- pre-create a row under that exact ref with their OWN contact details;
-- when the real sync later ran for that source booking (a DIFFERENT
-- guest), the recovery/lost-race logic wrongly treated the guest's row
-- as its own prior attempt, attaching the real source booking's data —
-- and the wrong guest's session — to it. `client_booking_ref`
-- uniqueness was never proof of PROVENANCE (who/what actually created a
-- row), only of uniqueness. This adds the server-only provenance marker
-- the sync module now checks instead, and a database-enforced (not just
-- application-enforced) ownership guarantee.
ALTER TABLE marau_test_bookings ADD COLUMN source_sync_owned INTEGER NOT NULL DEFAULT 0;

-- The actual race-safety/ownership mechanism this round relies on: SQLite
-- itself guarantees at most ONE row may ever be source_sync_owned for a
-- given source_booking_ref (a partial unique index), independent of
-- client_booking_ref's own uniqueness, which is now merely
-- collision-avoidance for the INSERT, never a provenance signal. No
-- existing row can violate this (every pre-round-15 row has
-- source_sync_owned = 0 by the DEFAULT above), so this index creates
-- cleanly with no data migration needed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marau_test_bookings_source_owned
  ON marau_test_bookings(source_booking_ref)
  WHERE source_sync_owned = 1;

-- Round 15, finding 4: the real logBookingEvent() catches its own INSERT
-- failure and only console.warns — a real bookings row save can succeed
-- with NO corresponding booking_events row at all, ever. An event-only
-- sync can therefore permanently miss a booking's creation (no session
-- ever granted) or a later detail change. source_snapshot_sequence
-- tracks a SEPARATE, snapshot-reconciliation-only ordering value —
-- documented in worker/real_booking_sync.js's own header as required to
-- be a durable value the RECONCILIATION OPERATOR supplies (e.g. a
-- persisted reconciliation-run counter), never invented inside this
-- module, and never conflated with the real, event-driven
-- source_event_id.
ALTER TABLE marau_test_bookings ADD COLUMN source_snapshot_sequence INTEGER;
