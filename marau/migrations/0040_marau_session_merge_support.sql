-- Marau Stage 1 (PREVIEW/TEST ONLY) - a guest's rewards must survive the verified session merge.
--
-- A real return transfer reaches Marau as a NEW session (the mirror gives every booking its own session); the guest then
-- links it to their earlier session through the verified-link flow, which moves their bookings and revokes the old session.
-- Marau-owned records (credits, offer purchases, suppressions, ...) are re-pointed at the new session inside that same
-- atomic merge. The PUBLIC referral code is different: it is already shared, it is unique per session, and other tables
-- reference it, so it stays where it is and this lineage table records that the old session now belongs to the new one.
-- A code is resolved to its CURRENT owner through this table; the guest keeps the same link and QR.
CREATE TABLE IF NOT EXISTS marau_session_merges (
  from_session_id TEXT PRIMARY KEY REFERENCES guest_sessions(session_id),
  to_session_id   TEXT NOT NULL REFERENCES guest_sessions(session_id),
  link_request_id TEXT,
  merged_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marau_session_merges_to ON marau_session_merges(to_session_id);
