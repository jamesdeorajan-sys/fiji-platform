-- Issue #54 Stage 1 (SHADOW MODE) — canonical route-price contract.
-- Documented so all three storefronts can eventually read from this single
-- table instead of holding their own fare copies. Not connected to any
-- live storefront UI in Stage 1 — see docs/ROUTE_PRICE_TRUTH_CONTRACT.md.

CREATE TABLE IF NOT EXISTS route_price_truth (
  route_id           TEXT PRIMARY KEY,
  origin_zone        TEXT NOT NULL,
  destination_zone   TEXT NOT NULL,
  vehicle_class      TEXT NOT NULL,
  standard_price     REAL,
  acquisition_price  REAL,
  return_lock_price  REAL,
  smart_match_price  REAL,
  live_fill_price    REAL,
  operator_payout    REAL,
  absolute_floor     REAL,
  currency           TEXT NOT NULL DEFAULT 'AUD',
  last_verified_at   TEXT,
  pricing_reason     TEXT,
  offer_expiry       TEXT,
  test_data          INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_route_price_truth_route
  ON route_price_truth(origin_zone, destination_zone, vehicle_class);
