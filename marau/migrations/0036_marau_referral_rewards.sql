-- Marau Stage 1 (PREVIEW/TEST ONLY) - referral reward journey (October revenue slice 3).
--
-- Applied only to the isolated preview database. Rewards are DISABLED by default (mode 'off') and the policy row ships with
-- NO amount and NO cap: the FJ$10 mentioned in the brief was an illustration, not an approved commercial rule. 'live'
-- mode additionally requires an owner approval (live_approved_by) that no API in this codebase can set.
--
-- Separation of concerns, enforced by the schema:
--   * marau_referral_codes: a PUBLIC code, unrelated to the PRIVATE trip-access token. Sharing the code/link/QR reveals
--     nothing about a booking or a guest.
--   * marau_referrals: who referred whom. One attribution per referred guest, ever (UNIQUE referred_session_id).
--   * marau_reward_credits: the ledger. UNIQUE referral_id => at most ONE credit per referred friend, so a credit can never
--     be duplicated by retries, concurrency, or a second purchase. States: pending -> earned -> applied, or reversed.
--   * marau_booking_adjustments: how an applied credit changes the AMOUNT DUE on a return transfer WITHOUT rewriting the
--     original quote or the operator payout. UNIQUE credit_id and UNIQUE booking_id => exactly one adjustment each.

-- Which leg of the holiday a transfer is, so a credit can only be applied to a RETURN transfer.
ALTER TABLE marau_test_bookings ADD COLUMN leg_type TEXT;

CREATE TABLE IF NOT EXISTS marau_referral_codes (
  code             TEXT PRIMARY KEY,
  guest_session_id TEXT NOT NULL UNIQUE REFERENCES guest_sessions(session_id),
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marau_referrals (
  referral_id         TEXT PRIMARY KEY,
  code                TEXT NOT NULL REFERENCES marau_referral_codes(code),
  referrer_session_id TEXT NOT NULL REFERENCES guest_sessions(session_id),
  referred_session_id TEXT NOT NULL UNIQUE REFERENCES guest_sessions(session_id),
  status              TEXT NOT NULL CHECK (status IN ('attributed', 'rejected_self_referral', 'rejected_not_new_guest', 'capped')),
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marau_referrals_referrer ON marau_referrals(referrer_session_id);

CREATE TABLE IF NOT EXISTS marau_reward_policy (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  mode                   TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'preview', 'live')),
  amount_cents           INTEGER CHECK (amount_cents IS NULL OR amount_cents > 0),
  cap_cents_per_referrer INTEGER CHECK (cap_cents_per_referrer IS NULL OR cap_cents_per_referrer > 0),
  min_purchase_cents     INTEGER NOT NULL DEFAULT 0 CHECK (min_purchase_cents >= 0),
  qualify_on             TEXT NOT NULL DEFAULT 'fulfilled' CHECK (qualify_on IN ('confirmed', 'fulfilled')),
  funding_source         TEXT NOT NULL DEFAULT 'marau_marketing_budget',
  live_approved_by       TEXT,
  live_approved_at       TEXT,
  updated_by             TEXT,
  updated_at             TEXT
);
INSERT OR IGNORE INTO marau_reward_policy (id) VALUES (1);

CREATE TABLE IF NOT EXISTS marau_reward_credits (
  credit_id                TEXT PRIMARY KEY,
  referral_id              TEXT NOT NULL UNIQUE REFERENCES marau_referrals(referral_id),
  beneficiary_session_id   TEXT NOT NULL REFERENCES guest_sessions(session_id),
  referred_session_id      TEXT NOT NULL REFERENCES guest_sessions(session_id),
  qualifying_request_id    TEXT NOT NULL UNIQUE REFERENCES marau_offer_requests(request_id),
  amount_cents             INTEGER NOT NULL CHECK (amount_cents > 0),
  status                   TEXT NOT NULL CHECK (status IN ('pending', 'earned', 'applied', 'reversed')),
  funding_source           TEXT NOT NULL,
  policy_snapshot          TEXT NOT NULL,
  created_at               TEXT NOT NULL,
  earned_at                TEXT,
  applied_at               TEXT,
  applied_by               TEXT,
  applied_booking_id       INTEGER,
  applied_cents            INTEGER,
  reversed_at              TEXT,
  reversal_reason          TEXT,
  needs_manual_adjustment  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_marau_reward_credits_beneficiary ON marau_reward_credits(beneficiary_session_id, status);

CREATE TABLE IF NOT EXISTS marau_booking_adjustments (
  adjustment_id            TEXT PRIMARY KEY,
  booking_id               INTEGER NOT NULL UNIQUE,
  credit_id                TEXT NOT NULL UNIQUE REFERENCES marau_reward_credits(credit_id),
  kind                     TEXT NOT NULL DEFAULT 'referral_credit',
  original_quote_cents     INTEGER NOT NULL,
  credit_cents             INTEGER NOT NULL CHECK (credit_cents > 0),
  amount_due_cents         INTEGER NOT NULL CHECK (amount_due_cents >= 0),
  operator_payout_cents    INTEGER,
  operator_payout_unchanged INTEGER NOT NULL DEFAULT 1,
  funded_by                TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reversal_pending_staff')),
  created_by               TEXT NOT NULL,
  created_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marau_share_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_session_id TEXT NOT NULL REFERENCES guest_sessions(session_id),
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marau_share_events_guest ON marau_share_events(guest_session_id);
