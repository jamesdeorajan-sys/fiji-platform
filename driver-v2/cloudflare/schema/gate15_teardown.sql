-- Gate 1.5 TEARDOWN for the ISOLATED D1 ONLY (driver-v2-gate15-isolated-20261103): returns it to an empty database.
-- Run only against that database after the proof window. Never against any other database.
DROP TRIGGER IF EXISTS gate15_fault_assign;
DROP TABLE IF EXISTS gate15_probe;
DROP TABLE IF EXISTS gate15_capture;
DROP TABLE IF EXISTS gate15_meta;
DROP TABLE IF EXISTS wallet_transactions;
DROP TABLE IF EXISTS wallets;
DROP TABLE IF EXISTS driver_evidence;
DROP TABLE IF EXISTS dispatch_escalations;
DROP TABLE IF EXISTS dispatch_runs;
DROP TABLE IF EXISTS driver_offers;
DROP TABLE IF EXISTS driver_broadcast_attempts;
DROP TABLE IF EXISTS booking_events;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS driver_sessions;
DROP TABLE IF EXISTS drivers;
DROP TABLE IF EXISTS gate15_identity;
