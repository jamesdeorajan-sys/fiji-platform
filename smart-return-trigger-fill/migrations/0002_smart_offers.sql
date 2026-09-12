-- Issue #54 Stage 1 (SHADOW MODE) — trigger-fill offer inventory.
-- One offer is shared by all three storefronts so the same vehicle/time
-- slot cannot be sold twice. Status transitions are enforced in
-- src/offers.js via compare-and-swap UPDATE statements, never a plain
-- SET — see docs/CEO_RELEASE_REPORT.md "Atomic hold design".

CREATE TABLE IF NOT EXISTS smart_offers (
  offer_id             TEXT PRIMARY KEY,
  source_movement_id   TEXT NOT NULL REFERENCES movements(movement_id),
  origin_zone          TEXT NOT NULL,
  destination_zone     TEXT NOT NULL,
  corridor_aliases     TEXT,
  earliest_pickup      TEXT NOT NULL,
  latest_pickup        TEXT NOT NULL,
  vehicle_class        TEXT NOT NULL,
  capacity             INTEGER NOT NULL DEFAULT 1,
  standard_price       REAL NOT NULL,
  smart_match_price    REAL,
  absolute_floor       REAL,
  expires_at           TEXT NOT NULL,
  inventory_count      INTEGER NOT NULL DEFAULT 1 CHECK (inventory_count >= 0),
  status               TEXT NOT NULL DEFAULT 'DISCOVERED'
    CHECK (status IN ('DISCOVERED', 'VALIDATED', 'ACTIVE', 'HELD', 'FILLED', 'EXPIRED')),
  test_data            INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_offers_status ON smart_offers(status);
CREATE INDEX IF NOT EXISTS idx_offers_movement ON smart_offers(source_movement_id);
CREATE INDEX IF NOT EXISTS idx_offers_expires_at ON smart_offers(expires_at);
