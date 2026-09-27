-- Marau Stage 1 (PREVIEW/TEST ONLY) — verified-ownership linking.
--
-- FIX for a P0 Codex finding: POST /preview/bookings used to return an
-- EXISTING guest_session's access token whenever the supplied phone
-- alone matched one, regardless of whether the email matched — a new
-- booking could silently inherit a stranger's session and expose their
-- prior bookings via GET /preview/trip. Every booking submission now
-- ALWAYS gets its own brand-new session/access token (see worker.js).
-- When a phone match against an existing, different, non-revoked
-- session is found, a row is written HERE instead of granting access —
-- linking the new session to the old one's booking history requires the
-- NEW session's holder to prove they can see a verification code that is
-- only ever readable by someone already authenticated as the OLD
-- (candidate) session. That is the "verified ownership" the mission
-- requires, modelled without a real SMS/email provider (mocked delivery
-- — see worker.js's handleListLinkRequests for exactly where the mock
-- boundary is and why the code is never returned to the submitter).
CREATE TABLE IF NOT EXISTS guest_link_requests (
  link_request_id     TEXT PRIMARY KEY,
  new_session_id       TEXT NOT NULL REFERENCES guest_sessions(session_id),
  candidate_session_id TEXT NOT NULL REFERENCES guest_sessions(session_id),
  verification_code    TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VERIFIED', 'EXPIRED', 'REVOKED')),
  expires_at            TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  verified_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_guest_link_requests_candidate ON guest_link_requests(candidate_session_id);
CREATE INDEX IF NOT EXISTS idx_guest_link_requests_new ON guest_link_requests(new_session_id);
