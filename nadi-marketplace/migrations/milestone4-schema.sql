-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 4: wallet lockout + max-hours cap (spec Section 4 remainder)
--
-- Verified against a live PRAGMA table_info(drivers)/table_info(wallets)/
-- table_info(wallet_transactions) dump on nadi-marketplace-db before writing
-- this file. wallets.balance_fjd and wallet_transactions.amount_fjd/type
-- already exist from Milestone 1's schema.sql — no CREATE needed for those.
-- The only real schema gap for Milestone 4 is tracking the mandatory rest
-- gap after a max-hours-cap forced offline, which nothing in Milestones 1-3
-- covers.

ALTER TABLE drivers ADD COLUMN forced_offline_until TEXT;

-- Configurable at runtime via platform_settings (no redeploy needed to
-- change these), same pattern as fuel_auto_apply / fuel_confirmed_accurate_count
-- from Milestone 1.
INSERT INTO platform_settings (key, value) VALUES ('wallet_lockout_threshold_fjd', '-150');
INSERT INTO platform_settings (key, value) VALUES ('max_hours_rest_gap_hours', '8');
INSERT INTO platform_settings (key, value) VALUES ('default_commission_rate', '0.15');
