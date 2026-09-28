-- Marau Stage 1 (PREVIEW/TEST ONLY) — round 22 fix (Codex independent
-- review, reproduced against the real hosted D1): the round-21 staff
-- booking confirmation did three separate writes — the source
-- pending->accepted transition, a guest-Trip sync, and an audit INSERT
-- into marau_staff_decisions — with no atomicity or recovery across
-- them. A real fault injection on the LAST write (the audit INSERT)
-- reproduced exactly: the source transition and sync had ALREADY
-- committed, yet the caller received a 500 (implying failure), and a
-- retry then hit "ALREADY_DECIDED" with the audit row still permanently
-- missing — a genuine confirmation that could never be completed or
-- even discovered as having happened, from the caller's own point of
-- view. See worker/worker.js's own header on handleStaffDecideBooking
-- for the corrected design.
--
-- The fix: the authorised operator and decision timestamp are now
-- persisted DURABLY, in the SAME atomic UPDATE as the source's own
-- pending->accepted transition — never a separate write that could
-- fail independently of the transition it is supposed to be recording.
-- `marau_staff_decisions` (migration 0031) remains as a secondary,
-- best-effort broader audit log; these columns are the actual
-- source of truth a repair pass reads from.
ALTER TABLE marau_synthetic_source_bookings ADD COLUMN confirmed_operator TEXT;
ALTER TABLE marau_synthetic_source_bookings ADD COLUMN confirmed_at TEXT;
ALTER TABLE marau_synthetic_source_bookings ADD COLUMN confirmation_token TEXT;
