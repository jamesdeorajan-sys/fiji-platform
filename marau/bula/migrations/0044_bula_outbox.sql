-- PROPOSED (not applied anywhere). Bula Happiness durable email outbox. Additive only; no existing table is altered.
-- Job identity is STABLE: source_event_key = 'saved-booking:<client_booking_ref>' (never a random per-delivery event id),
-- so a replayed save or a re-sent event cannot create a second job. No message body, token or link is stored here:
-- the body and the private link are rendered at send time from the live booking + session rows.
CREATE TABLE IF NOT EXISTS bula_outbox (
  job_key             TEXT PRIMARY KEY,                -- source_event_key|recipient_kind|template_version
  source_event_key    TEXT NOT NULL,
  booking_ref         TEXT NOT NULL,
  session_id          TEXT NOT NULL,
  recipient_kind      TEXT NOT NULL CHECK (recipient_kind IN ('guest','staff')),
  recipient_address   TEXT NOT NULL,
  recipient_version   INTEGER NOT NULL DEFAULT 1,
  template            TEXT NOT NULL,
  template_version    TEXT NOT NULL,
  state               TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','sending','accepted','failed','ambiguous','blocked','dead')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  lease_owner         TEXT,
  lease_until         INTEGER,
  provider_id         TEXT,
  last_error          TEXT,
  blocked_reason      TEXT,
  provider_accepted_at INTEGER,   -- provider acceptance, NOT delivery
  delivered_at        INTEGER,    -- provider webhook evidence only
  bounced_at          INTEGER,
  human_ack_at        INTEGER,    -- a named staff member acknowledged
  human_ack_by        TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (source_event_key, recipient_kind, template_version)
);
CREATE INDEX IF NOT EXISTS idx_bula_outbox_state ON bula_outbox(state, lease_until);
CREATE TABLE IF NOT EXISTS bula_outbox_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, job_key TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT
);
CREATE TABLE IF NOT EXISTS bula_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
