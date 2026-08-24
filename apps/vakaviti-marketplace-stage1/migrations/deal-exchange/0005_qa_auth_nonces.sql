-- FINAL INTEGRATION REVIEW, Phase 1 (2026-08-25): single-use nonce ledger for the QA HMAC auth
-- scheme (see verifyQaAuth() in deal-exchange-ui.ts). A signature is only ever valid once - this
-- table is what makes an exact replay of a previously-valid signed request fail. Lives only in
-- the isolated QA database (vakaviti-live-deal-exchange-qa-db) - never applied to the shared
-- preview database or any future production database, since neither of those ever perform QA
-- auth at all.
CREATE TABLE IF NOT EXISTS qa_auth_nonces (
  nonce TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
