-- Milestone 13: fixed-fare boat-transfer product for Mamanuca/Yasawa
-- island resorts, distinct from the road/per-km pricing model.
--
-- Real fares for these routes are not published as a static price list by
-- any operator (confirmed against 5 official pages) - they're generated
-- per-booking through the operator's own reservation engine. Fares here
-- are captured by live-querying that engine per property (boat_fare_sourced_at
-- / boat_fare_source_note record when/how), same discipline as fuel_index -
-- a real, dated, operator-set figure expected to need periodic review, not
-- a permanent constant.
--
-- transfer_type separates the pricing path cleanly: 'road' (existing
-- zone/km/Google-Routes model, untouched) vs 'boat' (fixed fare read
-- directly off this row, never geocoded, never billed against the Routes API).

ALTER TABLE destinations ADD COLUMN transfer_type TEXT NOT NULL DEFAULT 'road';
ALTER TABLE destinations ADD COLUMN boat_adult_fare_fjd REAL;
ALTER TABLE destinations ADD COLUMN boat_child_fare_fjd REAL;
-- Confirmed with James: Fiji Tour Transfers bundles and collects the full
-- boat-operator fare (a real resale arrangement), not just the land leg.
-- boat_land_leg_fare_fjd is the portion actually earned by an FTT driver -
-- kept separate so a future commission pass can exclude the boat
-- operator's pass-through portion rather than paying/charging driver
-- commission on money that was never the driver's to begin with.
ALTER TABLE destinations ADD COLUMN boat_land_leg_fare_fjd REAL;
ALTER TABLE destinations ADD COLUMN boat_operator_name TEXT;
ALTER TABLE destinations ADD COLUMN boat_fare_sourced_at TEXT;
ALTER TABLE destinations ADD COLUMN boat_fare_source_note TEXT;

-- Same reasoning as above, applied to actual booking rows: null preserves
-- existing behaviour for every current (road) booking untouched; set only
-- for boat bookings so commission accrual has the correct base to use
-- once that logic is wired (not this milestone - accrueCommission() still
-- reads settlement_amount_fjd only; flagged in the Milestone 13 report).
ALTER TABLE bookings ADD COLUMN commission_base_fjd REAL;

INSERT INTO zones (name) VALUES ('Mamanuca Islands');
INSERT INTO zones (name) VALUES ('Yasawa Islands');
