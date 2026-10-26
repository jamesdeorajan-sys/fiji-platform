-- Additive only. Do not apply to production without approval.
CREATE TABLE IF NOT EXISTS openai_ads_outbox (
  event_id TEXT PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL UNIQUE,
  pixel_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('validate', 'live')),
  payload TEXT NOT NULL,
  event_time_ms INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_ms INTEGER NOT NULL DEFAULT 0,
  lease_until_ms INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  last_http_status INTEGER
);
CREATE INDEX IF NOT EXISTS openai_ads_outbox_due ON openai_ads_outbox(state, next_attempt_ms);
