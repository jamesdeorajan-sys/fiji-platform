CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(scope, idempotency_key)
);
CREATE INDEX idempotency_records_expiry ON idempotency_records(expires_at);
ALTER TABLE audit_events ADD COLUMN metadata_json TEXT;
ALTER TABLE audit_events ADD COLUMN context_reference TEXT;
