-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 24: admin PIN login.
--
-- Additive only - every existing table (including admin_login_tokens
-- itself, Milestone 23) is completely unchanged. No new table needed -
-- a PIN system for exactly one admin is three scalar values, which
-- platform_settings already exists to hold (same pattern as
-- admin_alert_phone, wallet_lockout_threshold_fjd, every rate-limit
-- setting, etc).
--
-- admin_pin_hash: empty string means "no PIN set yet" - James sets his
-- own via POST /admin/set-pin (itself gated by the existing
-- requireAdmin(), using either the static ADMIN_TOKEN or a magic-link
-- session he already has - no chicken-and-egg problem). Stored as
-- "pbkdf2$<iterations>$<saltHex>$<hashHex>", a self-describing format
-- so a future iteration-count change never has to guess how an old
-- value was produced. The assistant building this never sees or
-- chooses the real PIN value, per instruction.
--
-- admin_pin_failed_attempts / admin_pin_locked_until: a global (not
-- per-IP) lockout counter - deliberate, since there is exactly one
-- admin and one PIN, a global throttle is simpler than per-IP tracking
-- and is actually more protective (an attacker spreading guesses across
-- many IPs still hits the same global limit). See PIN_MAX_ATTEMPTS /
-- PIN_LOCKOUT_MINUTES in worker.js for the real numbers.
INSERT INTO platform_settings (key, value) VALUES ('admin_pin_hash', '');
INSERT INTO platform_settings (key, value) VALUES ('admin_pin_failed_attempts', '0');
INSERT INTO platform_settings (key, value) VALUES ('admin_pin_locked_until', '');
