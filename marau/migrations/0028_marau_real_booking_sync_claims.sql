-- Marau Stage 1 (PREVIEW/TEST ONLY) — round 17 fix (Codex independent
-- review, "finish source freshness"): rounds 13-16's ordering fixes
-- (per-path counters, then terminal-state stickiness + shared
-- generation fencing) still let a genuinely FRESH, uncontested apply
-- write STALE FIELD DATA — because the module trusted whatever
-- sourceBooking payload the caller happened to attach to an event or a
-- snapshot, rather than re-reading the real, current record. An event
-- that is merely delivered late (its own generation/ordering checks all
-- legitimately pass, since nothing else raced it) can still carry a
-- stale pickup/destination/price snapshot from whenever it was
-- originally captured. See worker/real_booking_sync.js's own header for
-- the two reproduced repros and the corrected design: events and
-- snapshots are now treated as REFRESH SIGNALS, never payload carriers
-- — every apply re-reads the CURRENT authoritative booking through an
-- injected reader function at the moment it is processed.
--
-- `marau_real_booking_sync_claims`: a real, database-enforced per-booking
-- MUTUAL EXCLUSION primitive — "acquire ownership BEFORE reading the
-- source". Only one claim can exist for a given source_booking_ref at a
-- time (the PRIMARY KEY IS the enforcement, not application logic); a
-- second, concurrent claim attempt fails atomically. A claim that has
-- passed its own `expires_at` may be atomically taken over by a new
-- claimant (a crashed/interrupted holder must never permanently block a
-- booking) — but a takeover always leads into the SAME fresh-read path,
-- never a reuse of whatever payload the previous, abandoned attempt was
-- working from.
CREATE TABLE IF NOT EXISTS marau_real_booking_sync_claims (
  source_booking_ref  TEXT PRIMARY KEY,
  claim_token         TEXT NOT NULL,
  claimed_at          TEXT NOT NULL,
  expires_at          TEXT NOT NULL
);
