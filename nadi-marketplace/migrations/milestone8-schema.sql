-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 8: health monitoring + D1 backups
--
-- No new tables. Backups are stored in a dedicated R2 bucket
-- (nadi-marketplace-db-backups), not D1, so there's no backup-related
-- schema. This is the one new operational setting: tracks the last known
-- health state so runHealthCheckAlert() can alert on state transitions
-- only (edge-triggered), not spam every 5-minute check while a real
-- outage is ongoing. Seeded 'healthy' so a fresh deploy doesn't
-- spuriously alert on its first real check.

INSERT INTO platform_settings (key, value) VALUES ('health_check_last_status', 'healthy');
