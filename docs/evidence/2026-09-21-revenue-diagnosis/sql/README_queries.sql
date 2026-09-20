-- ALL QUERIES ARE READ-ONLY (SELECT). Databases: nadi-marketplace-db (0ec1cd84-fcda-4f7f-8337-0fb70fe1a512),
-- vakaviti-funnel-events-preview (47733821-9c36-43ef-8408-75102c652325). Extraction: 2026-09-20 13:00-14:20 UTC.
-- created_at is UTC (datetime('now')). Fiji day = date(created_at,'+12 hours') (Fiji has no DST since 2022).

-- Predicates
-- T (test exclusion; name/phone rules only - unknown internal tests may remain):
--   UPPER(COALESCE(guest_name,'')) LIKE '%CLAUDE%' OR UPPER(COALESCE(guest_name,'')) LIKE '%JAMES DER%'
--   OR UPPER(COALESCE(guest_name,'')) LIKE '%JAMES DEO%' OR COALESCE(guest_phone,'')='<James test phone>'
-- site: CASE WHEN client_booking_ref LIKE 'FTT-%' THEN 'FTT' WHEN client_booking_ref LIKE 'FD-%' THEN 'FD' ELSE 'NOREF' END
--   FTT = on-site nadiairporttransfers.com widget (first row id 69, 2026-09-07 12:19:48 UTC); FD = FijiDash (first id 47, 2026-09-02 03:42:47 UTC)

-- Q1 saved requests per Fiji day and site (non-test)
SELECT date(created_at,'+12 hours') day_fiji, <site> site, COUNT(*) n FROM bookings WHERE NOT (<T>) GROUP BY 1,2 ORDER BY 1;

-- Q2 duplicates (same phone + zone + vehicle within 15 minutes) - later row of each pair dropped in the *_dedup series
SELECT a.id, b.id, ROUND((julianday(b.created_at)-julianday(a.created_at))*1440,1) gap_min, (a.client_booking_ref=b.client_booking_ref) same_ref
FROM bookings a JOIN bookings b ON a.id<b.id AND a.guest_phone=b.guest_phone AND a.destination_zone=b.destination_zone
 AND a.vehicle_type=b.vehicle_type AND (julianday(b.created_at)-julianday(a.created_at))*1440<=15
WHERE a.created_at>='2026-09-01' AND NOT (<T on a>);
-- result: pairs (64,65 FD, 7.2 min), (77,78 FTT, 0.1), (90,91 FTT, 0.1), (106,107 FTT, 10.2); dropped ids 65,78,91,107; none had the same ref.

-- Q3 operator-side receipt evidence (provider acceptance) since the alert pipeline started (first 'sent' event 2026-09-06 15:35:59 UTC)
SELECT COUNT(*) n_created,
       SUM(CASE WHEN EXISTS(SELECT 1 FROM booking_events e WHERE e.booking_id=b.id AND e.event_type='admin_notification_sent') THEN 1 ELSE 0 END) n_with_sent
FROM bookings b WHERE NOT (<T on b>) AND b.created_at>='2026-09-06 15:36:00';            -- 71 / 71
SELECT COUNT(*), MIN((julianday(e.created_at)-julianday(b.created_at))*86400), AVG(...), MAX(...)
FROM bookings b JOIN booking_events e ON e.booking_id=b.id AND e.event_type='admin_notification_sent' WHERE NOT (<T on b>) AND b.created_at>='2026-09-06 15:36:00'; -- n=71, min 2s, avg 3.2s, max 6s
SELECT event_type, COUNT(*) FROM booking_events GROUP BY 1;   -- created 147, admin_notification_sent 98, ..._skipped_idempotent 5, ..._failed 1 (booking 60, 2026-09-06 15:13:47, Meta 132018 template-parameter error)

-- Q4 saved before alerts existed and still upcoming/recent pickup (no automatic alert was ever sent)
--   6 upcoming (pickup 2026-09-24 .. 2026-12-21) + 2 with pickups 19-20 Sep; ids are held privately, not in GitHub.

-- Q5 stored amounts that look server-overwritten (non-integer on the on-site widget; client fares are integers)
SELECT COUNT(*), SUM(CASE WHEN quoted_amount<>CAST(quoted_amount AS INTEGER) THEN 1 ELSE 0 END) FROM bookings WHERE client_booking_ref LIKE 'FTT-%' AND NOT (<T>);  -- 46 / 0
-- FD-: 36 rows, 34 non-integer (FijiDash amounts ARE server formula prices)

-- Q6 FijiDash rows with Nadi attribution (referrer LIKE '%nadiairporttransfers%' OR first_campaign LIKE '%nadi_%')  -> 8 (Sept 1-20)
-- Q7 funnel (vakaviti-funnel-events-preview): SELECT date(created_at) day_utc, platform, event_type, COUNT(*), COUNT(DISTINCT session_id) FROM funnel_events GROUP BY 1,2,3;
--   platform 'nadi' has only 2 events (2026-09-09) -> Nadi on-site starts/attempts are UNKNOWN. Test/tester sessions cannot be excluded from this table.
