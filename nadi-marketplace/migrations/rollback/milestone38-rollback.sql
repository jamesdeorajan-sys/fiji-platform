-- Rollback for milestone38-email-followups.sql. Run ONLY after the Worker that uses the table has been rolled back (or accept that /email-followup then reports not-recorded).
-- Removes the follow-up table and its two settings. Nothing else is touched: bookings, booking_events and escalations (including the escalation rows that mirrored
-- follow-ups, which stay as ordinary staff-visible escalations) are left exactly as they are. EXPORT the table first if any real requests exist (read-only):
--   wrangler d1 execute nadi-marketplace-db --remote --command "SELECT * FROM email_followups"
DROP TABLE IF EXISTS email_followups;
DELETE FROM platform_settings WHERE key IN ('email_followup_owner', 'email_followup_inbox');
