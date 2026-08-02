-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 23: admin phone-number magic-link login.
--
-- Additive only - every existing table (bookings, escalations, drivers,
-- driver_login_tokens, etc.) is completely unchanged.
--
-- Mirrors driver_login_tokens (Milestone 2) exactly, minus a foreign key
-- to an "admins" table - there isn't one. The system has exactly one
-- authorized admin phone number, hardcoded in worker.js as
-- ADMIN_LOGIN_PHONE (+61413335007) rather than stored in this table or
-- in platform_settings - an admin-editable setting can't be the thing
-- gating who is allowed to become an admin in the first place (a
-- logged-in admin could otherwise repoint it to their own number).
--
-- A row here is a real, issued login session, not a request record -
-- one row is inserted only after the requesting phone number is
-- confirmed to match ADMIN_LOGIN_PHONE exactly; every other number gets
-- the same generic "if authorized, a link has been sent" response with
-- no row written at all, the same privacy-by-default posture
-- handleDriverLogin already uses.
CREATE TABLE admin_login_tokens (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
