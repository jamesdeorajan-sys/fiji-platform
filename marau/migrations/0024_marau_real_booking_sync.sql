-- Marau Stage 1 (PREVIEW/TEST ONLY) — schema for the round-13 corrected
-- real-booking sync demonstration. Additive only (plain ADD COLUMN / new
-- table, no CHECK-constraint change), so no table needs to be recreated.
-- Not applied to any real database by this change; synthetic/isolated
-- D1 only, per every round's own isolation constraint. See
-- docs/MARAU_STAGE1_REAL_BOOKING_SYNC.md for the full contract this
-- schema exists to support, and worker/real_booking_sync.js for the code
-- that reads/writes these columns.

-- One row per REAL source booking this preview has ever synced, mapping
-- its stable opaque reference to the Marau session it belongs to. This is
-- the ONLY way real_booking_sync.js ever re-associates a later sync event
-- with an existing session — NEVER a phone-number lookup (see
-- real_booking_sync.js's header for exactly why a phone-keyed lookup was
-- rejected: it would silently hand back an existing session, and every
-- booking in it, to whoever supplies a matching phone number — the exact
-- P0 vulnerability createSessionAndOfferLink already exists to prevent).
CREATE TABLE IF NOT EXISTS marau_real_booking_links (
  source_booking_ref   TEXT PRIMARY KEY,             -- stable opaque id for the real booking (never the raw real DB id)
  guest_session_id     TEXT NOT NULL REFERENCES guest_sessions(session_id),
  marau_booking_id     INTEGER NOT NULL REFERENCES marau_test_bookings(id),
  created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marau_real_booking_links_session ON marau_real_booking_links(guest_session_id);

-- Sync-provenance columns on the existing mirror table. All nullable —
-- a booking created through Marau's own guest-facing form (unrelated to
-- this sync path) simply never has any of these set. `source_status` and
-- `source_assigned_driver_id` are informational facts copied verbatim
-- from the real source event; NEITHER is ever used to choose between
-- Marau's own 'confirmed'/'confirmed_unallocated' status values — that
-- mapping stays exactly what handleAdminDecideBooking already enforces
-- (see worker.js's own "FIX (third independent review, finding 6)"
-- comment: 'confirmed_unallocated' is intentionally never written by
-- any code path pending an explicit operational decision from James).
-- `source_event_ordinal` is a monotonic counter (never a wall-clock
-- comparison alone, which a real system's clock skew or retry could
-- violate) used to reject a stale/duplicate sync event without ever
-- rolling a booking's displayed state backward. `sync_state` distinguishes
-- "not currently present in the latest accepted-booking feed" from any
-- guest-facing status — it is explicitly NEVER read as, or converted
-- into, a cancellation (see real_booking_sync.js's own header).
ALTER TABLE marau_test_bookings ADD COLUMN source_booking_ref TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN source_status TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN source_assigned_driver_id TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN source_event_type TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN source_event_ordinal INTEGER;
ALTER TABLE marau_test_bookings ADD COLUMN source_synced_at TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN sync_state TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN sync_last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_marau_test_bookings_source_ref ON marau_test_bookings(source_booking_ref);
