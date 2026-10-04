-- Marau Stage 1 (PREVIEW/TEST ONLY) - human sales and contact (October revenue slice 4).
--
-- Applied only to the isolated preview database.
--
-- Three separate facts about a guest, never conflated (see worker/contact_policy.js):
--   1. whatsapp_available (already on guest_sessions): recorded, never required.
--   2. follow-up OWNER: a NAMED staff member responsible when WhatsApp is not an option (email fallback), so a guest
--      without WhatsApp cannot fall through a gap.
--   3. marketing_consent: PROMOTIONAL messages only. Essential trip communication never depends on it. Never assumed:
--      the default is 'unknown', which does NOT permit promotional sends.

ALTER TABLE guest_sessions ADD COLUMN marketing_consent TEXT NOT NULL DEFAULT 'unknown' CHECK (marketing_consent IN ('unknown', 'granted', 'withheld'));
ALTER TABLE guest_sessions ADD COLUMN marketing_consent_at TEXT;
ALTER TABLE guest_sessions ADD COLUMN marketing_consent_source TEXT;

-- Append-only history of every consent change (who/what changed it, and when), so consent can be evidenced.
CREATE TABLE IF NOT EXISTS marau_consent_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_session_id TEXT NOT NULL REFERENCES guest_sessions(session_id),
  from_value       TEXT NOT NULL,
  to_value         TEXT NOT NULL,
  source           TEXT NOT NULL,
  actor            TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marau_consent_events_guest ON marau_consent_events(guest_session_id);

-- One named staff owner per guest for follow-up. The owner must be a real staff identity (enforced in code).
CREATE TABLE IF NOT EXISTS marau_follow_up_owners (
  guest_session_id TEXT PRIMARY KEY REFERENCES guest_sessions(session_id),
  owner            TEXT NOT NULL,
  assigned_by      TEXT NOT NULL,
  assigned_at      TEXT NOT NULL
);
