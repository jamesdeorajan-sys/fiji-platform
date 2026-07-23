-- Nadi Airport Transfers — Driver Marketplace
-- Deep-review fix: POST /escalate had zero rate limiting, unlike every
-- other public write endpoint on this Worker (POST /bookings has
-- checkGuestBookingRateLimit, POST /quote has checkQuoteRateLimit).
-- Escalate is arguably the most sensitive of the three: every real call
-- triggers a real WhatsApp send to James's personal phone
-- (admin_alert_phone), with no cap at all before this fix - a genuine
-- spam/harassment vector against a real human, not just a cost concern.
--
-- source_ip mirrors bookings.source_ip's pattern (column directly on the
-- entity, not a separate log table - unlike geocoded_addresses/
-- quote_requests_log, escalations has no caching concept that would
-- require tracking hits separately from the entity itself).

ALTER TABLE escalations ADD COLUMN source_ip TEXT;

INSERT INTO platform_settings (key, value) VALUES ('escalation_rate_limit_max_per_day', '10');
