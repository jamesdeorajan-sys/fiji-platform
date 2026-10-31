-- PROPOSED (not applied anywhere). Promotional credit + inventory reservation.
-- Atomicity: every multi-row transition is ONE D1 batch (transaction). CHECK constraints make an impossible
-- result (negative stock, negative balance, balance that does not add up) abort and roll back the WHOLE batch;
-- bula_assert turns a zero-row guarded UPDATE into the same rollback.
CREATE TABLE IF NOT EXISTS bula_assert (ok INTEGER NOT NULL CHECK (ok = 1));

CREATE TABLE IF NOT EXISTS bula_credit_accounts (
  party_key        TEXT PRIMARY KEY,            -- explicit trip/party key; never merged by phone alone
  granted_cents    INTEGER NOT NULL CHECK (granted_cents >= 0),
  available_cents  INTEGER NOT NULL CHECK (available_cents >= 0),
  reserved_cents   INTEGER NOT NULL CHECK (reserved_cents >= 0),
  redeemed_cents   INTEGER NOT NULL CHECK (redeemed_cents >= 0),
  expired_cents    INTEGER NOT NULL CHECK (expired_cents >= 0),
  expires_at       INTEGER,                     -- epoch ms; NULL = no expiry (a policy decision for James)
  policy_version   TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CHECK (available_cents + reserved_cents + redeemed_cents + expired_cents = granted_cents)
);
CREATE TABLE IF NOT EXISTS bula_credit_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  party_key TEXT NOT NULL, type TEXT NOT NULL
    CHECK (type IN ('granted','reserved','redeemed','released','expired_hold','restored','forfeited','grant_expired')),
  amount_cents INTEGER NOT NULL, hold_id TEXT, booking_ref TEXT,
  actor TEXT NOT NULL, source TEXT NOT NULL, policy_version TEXT NOT NULL, at INTEGER NOT NULL,
  UNIQUE (hold_id, type)     -- a hold can be reserved/redeemed/released/restored at most once
);
CREATE TABLE IF NOT EXISTS bula_offers (
  offer_id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','scheduled','published','expired','withdrawn')),
  title TEXT NOT NULL, operator_id TEXT NOT NULL,
  service_date TEXT NOT NULL,            -- Fiji calendar date YYYY-MM-DD
  service_start_utc INTEGER NOT NULL,    -- epoch ms of the service start
  pickup_zones TEXT NOT NULL,            -- comma list
  pricing_basis TEXT NOT NULL CHECK (pricing_basis IN ('person','party','vehicle')),
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  max_credit_cents INTEGER NOT NULL CHECK (max_credit_cents >= 0),
  capacity_unit TEXT NOT NULL, capacity_total INTEGER NOT NULL CHECK (capacity_total > 0),
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  booking_cutoff_utc INTEGER NOT NULL,
  inclusions TEXT NOT NULL, exclusions TEXT NOT NULL DEFAULT '',
  min_spend_cents INTEGER NOT NULL DEFAULT 0,
  cancellation_terms TEXT NOT NULL,      -- human text shown to the guest
  credit_restore_hours_before INTEGER,   -- NULL = credit never restored on cancellation
  inventory_restore_hours_before INTEGER,
  funding_party TEXT NOT NULL CHECK (funding_party IN ('operator','vakaviti','shared')),
  operator_payout_cents INTEGER NOT NULL CHECK (operator_payout_cents >= 0),
  instant_confirm INTEGER NOT NULL DEFAULT 0 CHECK (instant_confirm IN (0,1)),
  operator_contract_id TEXT,             -- required when instant_confirm = 1
  approved_by TEXT, approved_at INTEGER, published_at INTEGER, withdrawn_by TEXT, withdrawn_at INTEGER,
  test_data INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  CHECK (remaining <= capacity_total),
  CHECK (instant_confirm = 0 OR operator_contract_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS bula_holds (
  hold_id TEXT PRIMARY KEY, party_key TEXT NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  offer_id TEXT NOT NULL REFERENCES bula_offers(offer_id), qty INTEGER NOT NULL CHECK (qty > 0),
  state TEXT NOT NULL CHECK (state IN ('held','confirmed','released','expired','cancelled')),
  settled INTEGER NOT NULL DEFAULT 0,    -- 1 once inventory/credit of a released/expired hold were given back
  credit_cents INTEGER NOT NULL CHECK (credit_cents >= 0), price_cents INTEGER NOT NULL, net_cents INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
  booking_ref TEXT, confirmed_at INTEGER, confirmed_by_kind TEXT, confirmed_by_ref TEXT,
  cancelled_at INTEGER, cancelled_by_kind TEXT, cancelled_by_ref TEXT, credit_restored INTEGER, inventory_restored INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (party_key, idem_key)           -- idempotency keys are scoped to the authenticated party
);
CREATE INDEX IF NOT EXISTS idx_bula_holds_state ON bula_holds(state, expires_at);
CREATE TABLE IF NOT EXISTS bula_editions (
  service_date TEXT PRIMARY KEY, published_at INTEGER NOT NULL, offer_count INTEGER NOT NULL, run_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bula_audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL, detail TEXT
);
