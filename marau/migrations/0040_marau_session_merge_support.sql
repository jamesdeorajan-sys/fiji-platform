-- Marau Stage 1 (PREVIEW/TEST ONLY) - a guest's rewards must survive the verified session merge.
--
-- A real return transfer reaches Marau as a NEW session (the mirror gives every booking its own session); the guest then
-- links it to their earlier session through the verified-link flow, which moves their bookings and revokes the old session.
-- Before this migration a guest could hold only ONE referral code per session (UNIQUE guest_session_id), so a merge into a
-- session that had already generated its own code could not carry the old - already shared - code across. The uniqueness
-- moves from the table to ensureCode's atomic INSERT ... WHERE NOT EXISTS, so a merged session may hold several codes
-- (all of which keep working) while a session can still never receive a second code by racing calls.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE marau_referral_codes_v2 (
  code             TEXT PRIMARY KEY,
  guest_session_id TEXT NOT NULL REFERENCES guest_sessions(session_id),
  created_at       TEXT NOT NULL
);
INSERT INTO marau_referral_codes_v2 (code, guest_session_id, created_at) SELECT code, guest_session_id, created_at FROM marau_referral_codes;
DROP TABLE marau_referral_codes;
ALTER TABLE marau_referral_codes_v2 RENAME TO marau_referral_codes;
CREATE INDEX idx_marau_referral_codes_session ON marau_referral_codes(guest_session_id, created_at);
