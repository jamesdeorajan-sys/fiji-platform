-- Issue #54 Stage 1 (SHADOW MODE) — centralized movement ledger.
-- This table is written to by the ingestion adapters documented in
-- docs/ROUTE_PRICE_TRUTH_CONTRACT.md. It must never be the write target of
-- the live NadiAirportTransfers.com booking UI in Stage 1 — ingestion is a
-- side-effect record of a booking that already happened on its own site.

CREATE TABLE IF NOT EXISTS movements (
  movement_id                TEXT PRIMARY KEY,
  idempotency_key             TEXT NOT NULL UNIQUE,
  booking_reference           TEXT NOT NULL,
  source_site                 TEXT NOT NULL
    CHECK (source_site IN ('nadiairporttransfers.com', 'bookfijitransfers.com', 'book.fijidash.com')),
  source_page                 TEXT,
  attribution                 TEXT,
  itinerary_id                TEXT,
  linked_return_movement_id   TEXT REFERENCES movements(movement_id),
  origin                      TEXT NOT NULL,
  pickup_zone                 TEXT NOT NULL,
  destination                 TEXT NOT NULL,
  dropoff_zone                TEXT NOT NULL,
  pickup_datetime              TEXT NOT NULL,
  earliest_safe_pickup         TEXT NOT NULL,
  latest_safe_pickup           TEXT NOT NULL,
  arrival_or_departure         TEXT NOT NULL CHECK (arrival_or_departure IN ('arrival', 'departure')),
  flight_number                TEXT,
  passenger_count               INTEGER NOT NULL CHECK (passenger_count > 0),
  luggage_count                  INTEGER NOT NULL DEFAULT 0,
  vehicle_class                   TEXT NOT NULL,
  customer_price                   REAL NOT NULL,
  operator_payout                   REAL,
  absolute_floor                    REAL,
  booking_status                    TEXT NOT NULL DEFAULT 'CONFIRMED'
    CHECK (booking_status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED')),
  human_confirmation_status         TEXT NOT NULL DEFAULT 'UNCONFIRMED'
    CHECK (human_confirmation_status IN ('UNCONFIRMED', 'CONFIRMED', 'REJECTED')),
  assigned_vehicle                  TEXT,
  assigned_operator                 TEXT,
  test_data                         INTEGER NOT NULL DEFAULT 0,
  created_at                        TEXT NOT NULL,
  updated_at                        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movements_pickup_datetime ON movements(pickup_datetime);
CREATE INDEX IF NOT EXISTS idx_movements_zones ON movements(pickup_zone, dropoff_zone);
CREATE INDEX IF NOT EXISTS idx_movements_itinerary ON movements(itinerary_id);
CREATE INDEX IF NOT EXISTS idx_movements_source_site ON movements(source_site);
CREATE INDEX IF NOT EXISTS idx_movements_test_data ON movements(test_data);
