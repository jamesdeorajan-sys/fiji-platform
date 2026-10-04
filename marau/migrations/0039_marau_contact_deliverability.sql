-- Marau Stage 1 (PREVIEW/TEST ONLY) - suppression records, so "may we send this" can honour them when sending is built.
--
-- Collecting a VALID phone/email is not proof of DELIVERABILITY: nothing here (or anywhere in Marau yet) verifies that an
-- address receives mail or a number receives WhatsApp. Suppressions record what we have been TOLD (a bounce, an opt-out)
-- so a future sender cannot ignore it. Nothing in this schema sends anything.
CREATE TABLE IF NOT EXISTS marau_suppressions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_session_id TEXT NOT NULL REFERENCES guest_sessions(session_id),
  channel          TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email', 'phone')),
  kind             TEXT NOT NULL CHECK (kind IN ('delivery_failure', 'marketing_opt_out')),
  reason           TEXT,
  recorded_by      TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  lifted_at        TEXT,
  lifted_by        TEXT
);
CREATE INDEX IF NOT EXISTS idx_marau_suppressions_guest ON marau_suppressions(guest_session_id, lifted_at);
