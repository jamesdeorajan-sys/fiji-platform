-- Milestone 14: pricing_status for boat destinations, real-time-confirm
-- flow for the not-yet-sourced ones. Real problem this solves: only 5 of
-- the ~30 real Mamanuca/Yasawa/Beqa boat properties have a sourced fare
-- (South Sea Cruises' booking engine is currently blocked - real 403,
-- confirmed repeatedly this session). Holding all 30 back from the guest
-- widget until every fare is sourced means the other 25 stay invisible to
-- guests indefinitely with no ETA. Adding them now as real, findable
-- destinations - just flagged 'pending' instead of 'sourced' - lets a
-- guest searching for their actual resort find it today, and instead of a
-- fabricated or missing price, gets routed into the same real
-- escalation/WhatsApp-concierge flow Milestone 10 already built for
-- unresolvable addresses. No new UI concept, no fake price, no dead end.
--
-- NULL means "not a boat destination" (every existing road row, and any
-- future boat row that hasn't been explicitly classified yet - the admin
-- endpoint now requires an explicit value whenever transfer_type='boat',
-- so NULL should only ever appear on road rows going forward).
ALTER TABLE destinations ADD COLUMN pricing_status TEXT;

-- Backfill: the 5 properties already carrying a real sourced fare.
UPDATE destinations SET pricing_status = 'sourced'
WHERE transfer_type = 'boat' AND boat_adult_fare_fjd IS NOT NULL;

-- Beqa Lagoon is a real, distinct boat-transfer region (Royal Davui) - not
-- part of the Mamanuca/Yasawa South Sea Cruises network, and not the same
-- as the existing 'Pacific Harbour' zone (that's the mainland road zone
-- drivers already service; this is an island boat transfer off it).
INSERT INTO zones (name) VALUES ('Beqa Lagoon');
