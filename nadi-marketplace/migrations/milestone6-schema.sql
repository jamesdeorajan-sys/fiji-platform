-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 6: public POST /bookings endpoint (the missing piece
-- cutover-plan.md flagged — the guest widget has no booking API to
-- swap to today).
--
-- Verified live `bookings` schema via PRAGMA before writing this — no
-- source_ip or rate-limit tracking existed. This endpoint is the first
-- public, unauthenticated write endpoint on this Worker (every other
-- write endpoint is admin- or driver-token-gated), so it needs its own
-- abuse guard that nothing else here required.

ALTER TABLE bookings ADD COLUMN source_ip TEXT;

-- Configurable without a redeploy, same pattern as every other tunable in
-- this build. Defaults: 5 submissions per IP per 10 minutes — generous
-- enough for a real guest to retry a typo'd booking, tight enough to blunt
-- naive scripted spam. Documented limits in the Milestone 6 report — this
-- is IP-based only, not a full bot-management solution.
INSERT INTO platform_settings (key, value) VALUES ('guest_booking_rate_limit_max', '5');
INSERT INTO platform_settings (key, value) VALUES ('guest_booking_rate_limit_window_minutes', '10');
