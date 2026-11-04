-- STAGING ONLY. New isolated D1 database; never run against existing NAT/FijiDash D1.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS bb_slots (
 id TEXT PRIMARY KEY,
 operator_id TEXT NOT NULL,
 listing_id TEXT NOT NULL,
 starts_at TEXT NOT NULL,
 capacity INTEGER NOT NULL CHECK(capacity > 0),
 reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= capacity),
 price_fjd_cents INTEGER NOT NULL CHECK(price_fjd_cents > 0),
 UNIQUE(id, operator_id, listing_id)
);
CREATE TABLE IF NOT EXISTS bb_bookings (
 id TEXT PRIMARY KEY,
 idempotency_key TEXT NOT NULL UNIQUE,
 request_fingerprint TEXT NOT NULL,
 slot_id TEXT NOT NULL,
 operator_id TEXT NOT NULL,
 listing_id TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 currency TEXT NOT NULL DEFAULT 'FJD' CHECK(currency = 'FJD'),
 total_fjd_cents INTEGER NOT NULL CHECK(total_fjd_cents > 0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','cancelled','completed','expired')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 is_test INTEGER NOT NULL DEFAULT 0 CHECK(is_test IN (0,1)),
 FOREIGN KEY(slot_id,operator_id,listing_id) REFERENCES bb_slots(id,operator_id,listing_id)
);
CREATE TABLE IF NOT EXISTS bb_booking_events (
 id TEXT PRIMARY KEY,
 booking_id TEXT NOT NULL REFERENCES bb_bookings(id),
 event_type TEXT NOT NULL,
 actor_type TEXT NOT NULL,
 occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bb_outbox (
 id TEXT PRIMARY KEY,
 booking_id TEXT NOT NULL REFERENCES bb_bookings(id),
 event_type TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','delivered','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bb_booking_operator ON bb_bookings(operator_id,created_at);
CREATE INDEX IF NOT EXISTS idx_bb_outbox_state ON bb_outbox(state,created_at);
-- SQLite triggers run inside the same write transaction, protecting capacity on concurrent inserts.
CREATE TRIGGER IF NOT EXISTS bb_booking_capacity_guard
BEFORE INSERT ON bb_bookings
BEGIN
 SELECT CASE WHEN (SELECT capacity-reserved FROM bb_slots WHERE id=NEW.slot_id AND operator_id=NEW.operator_id AND listing_id=NEW.listing_id) < NEW.quantity
 THEN RAISE(ABORT,'slot_capacity_exceeded') END;
END;
CREATE TRIGGER IF NOT EXISTS bb_booking_reserve
AFTER INSERT ON bb_bookings
BEGIN
 UPDATE bb_slots SET reserved=reserved+NEW.quantity WHERE id=NEW.slot_id AND operator_id=NEW.operator_id AND listing_id=NEW.listing_id;
END;
-- Release inventory exactly once on a live-to-terminal transition.
CREATE TRIGGER IF NOT EXISTS bb_booking_release
AFTER UPDATE OF status ON bb_bookings
WHEN OLD.status IN ('pending','accepted') AND NEW.status IN ('declined','cancelled','expired')
BEGIN
 UPDATE bb_slots SET reserved=reserved-OLD.quantity WHERE id=OLD.slot_id;
END;
-- Prevent changes to critical quote/inventory fields after insertion.
CREATE TRIGGER IF NOT EXISTS bb_booking_immutable
BEFORE UPDATE OF id,idempotency_key,request_fingerprint,slot_id,operator_id,listing_id,quantity,currency,total_fjd_cents,created_at ON bb_bookings
BEGIN SELECT RAISE(ABORT,'immutable_booking_fields'); END;
