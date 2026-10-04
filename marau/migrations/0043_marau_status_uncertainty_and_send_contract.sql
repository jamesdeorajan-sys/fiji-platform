-- Marau Stage 1 (PREVIEW/TEST ONLY) - pilot readiness: (1) operational-status uncertainty on a mirrored leg and a staff verification
-- path; (2) the manual-send timing contract (staleness, pre-send check, honest outcome flags); (3) the booking total at the time a
-- credit was applied. All additive; nothing is rebuilt.
--
-- STATUS UNCERTAINTY. A source booking marked 'completed' that still holds an UPCOMING return is ambiguous: the source has one
-- booking-level status, so 'completed' could mean the outbound only, or the whole trip. Marau keeps the return leg VISIBLE, marks it
-- status_uncertainty, shows it as pending (never confirmed), and infers neither fulfilment nor redemption eligibility. A named staff
-- member can record evidence (append-only marau_leg_status_verifications); the verification is tied to a BASIS (source status +
-- return pickup time) so a later change to those facts puts the uncertainty back. The source is never written.
ALTER TABLE marau_test_bookings ADD COLUMN status_uncertainty TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN status_verified_by TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN status_verified_at TEXT;
ALTER TABLE marau_test_bookings ADD COLUMN status_verification_evidence TEXT;
CREATE TABLE IF NOT EXISTS marau_leg_status_verifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES marau_test_bookings(id),
  verdict    TEXT NOT NULL CHECK (verdict IN ('return_upcoming', 'return_not_going_ahead')),
  evidence   TEXT NOT NULL,
  actor      TEXT NOT NULL,
  basis      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marau_leg_status_verifications_booking ON marau_leg_status_verifications(booking_id, basis);

-- MANUAL-SEND CONTRACT. The app cannot technically prevent an external manual send; it can refuse to hand out a message when the
-- facts say do not send, invalidate stale prepared entries, and record what actually happened (flagging a send made contrary to
-- eligibility instead of hiding or refusing to record it).
ALTER TABLE marau_edition_sends ADD COLUMN offers_basis TEXT;
ALTER TABLE marau_edition_sends ADD COLUMN stale_reason TEXT;
ALTER TABLE marau_edition_sends ADD COLUMN stale_at TEXT;
ALTER TABLE marau_edition_sends ADD COLUMN checked_at TEXT;
ALTER TABLE marau_edition_sends ADD COLUMN checked_by TEXT;
ALTER TABLE marau_edition_sends ADD COLUMN message_copied_at TEXT;
ALTER TABLE marau_edition_sends ADD COLUMN sent_eligibility TEXT CHECK (sent_eligibility IS NULL OR sent_eligibility IN ('eligible', 'contrary_to_eligibility'));
ALTER TABLE marau_edition_sends ADD COLUMN sent_eligibility_reasons TEXT;

-- The booking total at the moment a credit landed, so a later source re-quote is shown rather than hidden.
ALTER TABLE marau_booking_adjustments ADD COLUMN booking_total_at_apply_cents INTEGER;
