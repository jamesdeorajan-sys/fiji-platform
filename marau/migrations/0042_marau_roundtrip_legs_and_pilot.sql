-- Marau Stage 1 (PREVIEW/TEST ONLY) - the real booking path (round-trip legs), explicit return value, provenance, and the human-led
-- deals pilot. All additive: nullable columns, new tables, no rebuild of any referenced table.
--
-- LEG MODEL. The real source holds a round trip as ONE booking (return_date / return_time / return_pickup_location on the same row,
-- ONE quoted amount, no separate return amount, no link between bookings). Marau represents the two legs as two marau_test_bookings
-- rows of the SAME source booking: the claim-guarded 'arrival' row (source_sync_owned = 1) and a derived 'return' row
-- (source_sync_owned = 0). Identity = (source_booking_ref, leg_key), unique, so repeated sync can never duplicate a leg.
--
-- RETURN VALUE. The return leg's value is NEVER the whole quote and NEVER an arbitrary share. leg_value_status is 'unresolved' until an
-- explicitly APPROVED allocation rule resolves it (marau_return_allocation_rules). The original booking total and the operator-side
-- figures are preserved verbatim in cents (source_total_cents, source_settlement_fjd_cents, source_commission_base_fjd_cents).
--
-- PROVENANCE. source_kind / source_origin / source_authenticated record HOW a row reached Marau. test_data is an OUTPUT of provenance
-- (set to 0 only for an authenticated source on an approved integration path), never an input a person can flip to gain eligibility.

ALTER TABLE marau_test_bookings ADD COLUMN leg_key TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN parent_booking_id INTEGER;
ALTER TABLE marau_test_bookings ADD COLUMN pickup_basis TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN return_leg_state TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN leg_note TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN source_total_cents INTEGER;
ALTER TABLE marau_test_bookings ADD COLUMN source_currency TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN source_settlement_fjd_cents INTEGER;
ALTER TABLE marau_test_bookings ADD COLUMN source_commission_base_fjd_cents INTEGER;
ALTER TABLE marau_test_bookings ADD COLUMN leg_value_status TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN leg_value_cents INTEGER;
ALTER TABLE marau_test_bookings ADD COLUMN leg_value_rule_id TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN source_kind TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN source_origin TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN source_authenticated INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_marau_bookings_leg_identity ON marau_test_bookings(source_booking_ref, leg_key) WHERE leg_key IS NOT NULL;

-- Explicit return-value allocation. 'proposed' does nothing. 'approved' resolves return legs. The API can only ever record a
-- 'synthetic_preview' approval, which never resolves a record that arrived through an authenticated source; an 'owner' approval
-- (real records) cannot be set through any API in this codebase.
CREATE TABLE IF NOT EXISTS marau_return_allocation_rules (
  rule_id        TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('percent_of_total', 'fixed_return_fjd')),
  value          INTEGER NOT NULL CHECK (value > 0),   -- basis points for percent_of_total (1..9999); cents for fixed_return_fjd
  status         TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'retired')),
  proposed_by    TEXT NOT NULL,
  proposed_at    TEXT NOT NULL,
  approved_by    TEXT,
  approved_at    TEXT,
  approval_basis TEXT CHECK (approval_basis IS NULL OR approval_basis IN ('synthetic_preview', 'owner')),
  approval_note  TEXT,
  retired_by     TEXT,
  retired_at     TEXT
);

-- The synthetic source mirrors the REAL bookings schema's itinerary and amount fields.
ALTER TABLE marau_synthetic_source_bookings ADD COLUMN return_date TEXT;
ALTER TABLE marau_synthetic_source_bookings ADD COLUMN return_time TEXT;
ALTER TABLE marau_synthetic_source_bookings ADD COLUMN return_pickup_location TEXT;
ALTER TABLE marau_synthetic_source_bookings ADD COLUMN quoted_currency TEXT;
ALTER TABLE marau_synthetic_source_bookings ADD COLUMN settlement_amount_fjd REAL;
ALTER TABLE marau_synthetic_source_bookings ADD COLUMN commission_base_fjd REAL;

-- Human-led deals pilot: a staff review of a published edition, and a manual send/outcome log. NOTHING here sends anything.
CREATE TABLE IF NOT EXISTS marau_edition_reviews (
  edition_id    TEXT PRIMARY KEY REFERENCES marau_deal_editions(edition_id),
  decision      TEXT NOT NULL CHECK (decision IN ('approved_for_manual_send', 'needs_changes')),
  reviewed_by   TEXT NOT NULL,
  reviewed_at   TEXT NOT NULL,
  note          TEXT,
  availability_snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS marau_edition_sends (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  edition_id       TEXT NOT NULL REFERENCES marau_deal_editions(edition_id),
  guest_session_id TEXT NOT NULL REFERENCES guest_sessions(session_id),
  channel          TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email', 'phone')),
  status           TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'sent_manually', 'not_sent', 'replied', 'bounced', 'opted_out')),
  prepared_by      TEXT NOT NULL,
  prepared_at      TEXT NOT NULL,
  updated_by       TEXT,
  updated_at       TEXT,
  note             TEXT,
  UNIQUE (edition_id, guest_session_id)
);
CREATE TABLE IF NOT EXISTS marau_edition_send_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  send_id     INTEGER NOT NULL REFERENCES marau_edition_sends(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor       TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL
);
