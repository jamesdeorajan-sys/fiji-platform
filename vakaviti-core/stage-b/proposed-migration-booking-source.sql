-- PROPOSED ONLY — NOT APPLIED TO ANY DATABASE (production, preview, or
-- otherwise) AS PART OF THIS TASK. This file lives under vakaviti-core/
-- specifically so it never gets mistaken for a live migration -- when this
-- work is separately approved, it would be renamed/relocated to
-- nadi-marketplace/migrations/milestone35-booking-source-attribution.sql
-- on the guest-widget-integration-preview branch (the branch where
-- nadi-marketplace-db's real migration history actually lives), NOT here.
--
-- Fiji Dash / Vakaviti Transfer Core — Issue #38 Step 3: source
-- attribution for the shared bookings table backing storefronts 1+2
-- (nadiairporttransfers.com, book.fijidash.com). Additive-only, per
-- Issue #36 rule 5 (no destructive change bundled with a feature).
--
-- Backfill policy (per CEO instruction, Step 3): historical rows get
-- canonical_source = 'unknown'. This is a DEFAULT applied by the ALTER
-- TABLE itself (SQLite/D1 backfills existing rows with the column
-- default at ALTER time), not a separate guess-based UPDATE statement --
-- no historical row is ever inferred into a specific source value.

ALTER TABLE bookings ADD COLUMN canonical_source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE bookings ADD COLUMN storefront_id TEXT;         -- nullable: 'nadiairporttransfers' | 'fijidash' | NULL for unknown/pre-migration rows
ALTER TABLE bookings ADD COLUMN campaign TEXT;              -- nullable, free text
ALTER TABLE bookings ADD COLUMN referral_code TEXT;         -- nullable, free text (partner/agent id)
ALTER TABLE bookings ADD COLUMN vakaviti_booking_id TEXT;   -- nullable at first: 'VK-XXXXXXXX', backfilled only for NEW rows going forward, never retrofitted onto historical rows (Step 3: "must remain backward compatible")

-- Enforces the canonical_source vocabulary at the database layer, not just
-- in application code — a CHECK constraint, not a UNIQUE index, so it adds
-- validation without creating any new uniqueness requirement that could
-- collide with existing data.
-- (Left as a documented intent rather than an actual constraint clause
-- here: D1's SQLite version support for adding a CHECK via ALTER TABLE
-- post-hoc is inconsistent across engine versions and should be verified
-- against the exact production D1/SQLite version in an isolated preview
-- before being written as a real migration line — flagged rather than
-- guessed at.)
-- Application-layer enum to enforce meanwhile:
--   'nadi_airport_transfers' | 'fijidash' | 'book_fiji_transfers' |
--   'come_to_fiji' | 'partner' | 'agent' | 'direct_api' | 'unknown'

CREATE INDEX IF NOT EXISTS idx_bookings_canonical_source ON bookings(canonical_source);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_vakaviti_booking_id
  ON bookings(vakaviti_booking_id)
  WHERE vakaviti_booking_id IS NOT NULL;
