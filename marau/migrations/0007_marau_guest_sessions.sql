-- Marau Stage 1 (PREVIEW/TEST ONLY) — guest identity and secure trip access.
-- Additive. Not applied to any real database by this change; James approves
-- the exact SQL below before it runs against even the isolated test D1.
--
-- One row per guest identity (keyed by phone — the same identifier Lagi
-- and the real dispatch Worker already use), NOT per booking, so one
-- guest with several bookings still has exactly one session/access link
-- (see docs/MARAU_STAGE1_REVIEW_PACKAGE.md "guest identity" section).
-- access_token is opaque and revocable — revoking it (access_token_revoked)
-- is how "secure/revocable trip access" is proven without deleting the
-- guest's own booking history.
CREATE TABLE IF NOT EXISTS guest_sessions (
  session_id            TEXT PRIMARY KEY,
  guest_contact_key      TEXT NOT NULL,      -- normalized phone; cross-booking identity key
  guest_email            TEXT NOT NULL,
  guest_phone            TEXT NOT NULL,
  whatsapp_available     INTEGER,            -- 1 / 0 / NULL (unknown) — never blocks booking
  access_token           TEXT NOT NULL UNIQUE,
  access_token_revoked   INTEGER NOT NULL DEFAULT 0,
  test_data              INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL,
  last_accessed_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_contact_key ON guest_sessions(guest_contact_key);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_access_token ON guest_sessions(access_token);
