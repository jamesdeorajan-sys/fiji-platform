-- Bula Happiness: installed-app (Home Screen) connection. A one-time pairing code, issued to an authenticated guest (or by staff), is exchanged ONCE for a separate,
-- revocable, expiring DEVICE key bound to the SAME guest session (same party, same wallet). Codes and device keys are stored only as SHA-256 hashes. Additive; safe to apply once.
CREATE TABLE IF NOT EXISTS bula_pairing (
  code_hash   TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES guest_sessions(session_id),
  issued_by   TEXT NOT NULL,                       -- 'guest' | 'staff:<id>'
  created_at  INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  used_at     INTEGER                              -- set exactly once by the redeem batch
);
CREATE INDEX IF NOT EXISTS idx_bula_pairing_session ON bula_pairing(session_id);
CREATE TABLE IF NOT EXISTS bula_devices (
  device_id    TEXT PRIMARY KEY,                   -- public id (shown in the device list), NOT a credential
  token_hash   TEXT NOT NULL UNIQUE,
  session_id   TEXT NOT NULL REFERENCES guest_sessions(session_id),
  label        TEXT NOT NULL,
  created_at   INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bula_devices_session ON bula_devices(session_id);
CREATE TABLE IF NOT EXISTS bula_pair_failures (ip_hash TEXT NOT NULL, at INTEGER NOT NULL);   -- failed redeem attempts, for rate limiting
CREATE INDEX IF NOT EXISTS idx_bula_pair_failures ON bula_pair_failures(ip_hash, at);
