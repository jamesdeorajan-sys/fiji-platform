-- Nadi Airport Transfers — Driver Marketplace
-- Pricing refit: replaces Milestone 9's eyeballed band values with a real
-- least-squares regression (price = flagfall + rate*km) fitted
-- independently per vehicle type and per distance band against all 35
-- live ROUTES_DATA routes (ftt-booking-site/src/app.js, read-only).
-- Full derivation, R^2 per band, remote-multiplier ratios, and the full
-- 35-route x 3-vehicle live-vs-formula comparison were reviewed and
-- approved by James before this was written (see nadi-marketplace/README.md
-- for the real evidence and the flagged anomalies below).
--
-- Ba/Rakiraki excluded from the base-curve fit; their real premium is
-- captured separately via zones.remote_multiplier (1.33 -> 1.37).
-- Momi Bay's minibus datapoint ($79, cheaper than its own $99 sedan price
-- at the same route - physically nonsensical) excluded from the minibus
-- 35-70km fit as a known live-table data-entry error, not a real signal.
--
-- Known, accepted anomalies (not fixed here, flagged in the review):
--   - Tanoa International/Tokatoka (2km) is the only route under 5km and
--     anchors the 0-15km line alone; real minivan/minibus prices jump
--     76-96% over the next 3km that a single slope can't fit
--     (sedan -15.0%, minivan +36.3%, minibus +32.1% vs. live).
--   - The 160-300km band rests on only 2 distinct real km values (198,
--     225) - exact fit for the 3 known Suva/Nausori routes, unvalidated
--     for anything between 226-300km.
--   - Coral Coast (72-150km) has real non-monotonic pricing a single
--     slope smooths over (Shangri-La Yanuca undershoots up to -16.2%,
--     Robinson Crusoe/Outrigger overshoot 11-13%).

-- SEDAN
UPDATE pricing_rules SET flagfall_fjd = 5.57,   base_rate_fjd_per_km = 3.592 WHERE id = 1;  -- 0-15km
UPDATE pricing_rules SET flagfall_fjd = 44.19,  base_rate_fjd_per_km = 1.568 WHERE id = 2;  -- 15-35km
UPDATE pricing_rules SET flagfall_fjd = 38.75,  base_rate_fjd_per_km = 1.438 WHERE id = 3;  -- 35-70km
UPDATE pricing_rules SET flagfall_fjd = 33.65,  base_rate_fjd_per_km = 1.120 WHERE id = 4;  -- 70-160km
UPDATE pricing_rules SET flagfall_fjd = -47.67, base_rate_fjd_per_km = 1.852 WHERE id = 5;  -- 160-300km

-- MINIVAN
UPDATE pricing_rules SET flagfall_fjd = 26.91,   base_rate_fjd_per_km = 3.581 WHERE id = 6;  -- 0-15km
UPDATE pricing_rules SET flagfall_fjd = 43.54,   base_rate_fjd_per_km = 2.622 WHERE id = 7;  -- 15-35km
UPDATE pricing_rules SET flagfall_fjd = 128.92,  base_rate_fjd_per_km = 0.479 WHERE id = 8;  -- 35-70km
UPDATE pricing_rules SET flagfall_fjd = 6.22,    base_rate_fjd_per_km = 1.764 WHERE id = 9;  -- 70-160km
UPDATE pricing_rules SET flagfall_fjd = -584.33, base_rate_fjd_per_km = 4.815 WHERE id = 10; -- 160-300km

-- MINIBUS (35-70km fit excludes Momi Bay's anomalous datapoint)
UPDATE pricing_rules SET flagfall_fjd = 51.17,  base_rate_fjd_per_km = 4.133 WHERE id = 11; -- 0-15km
UPDATE pricing_rules SET flagfall_fjd = 73.54,  base_rate_fjd_per_km = 2.622 WHERE id = 12; -- 15-35km
UPDATE pricing_rules SET flagfall_fjd = 139.00, base_rate_fjd_per_km = 0.956 WHERE id = 13; -- 35-70km
UPDATE pricing_rules SET flagfall_fjd = 66.96,  base_rate_fjd_per_km = 1.576 WHERE id = 14; -- 70-160km
UPDATE pricing_rules SET flagfall_fjd = 132.33, base_rate_fjd_per_km = 1.852 WHERE id = 15; -- 160-300km

-- Remote multiplier: real ratio (actual/predicted) averaged 1.365x across
-- the 3 real sedan data points (Ba/Rakiraki), landing inside James's
-- requested 1.35-1.4x range. True average across all 6 zone x vehicle
-- ratios is only 1.292x (minivan/minibus ratios run lower, 1.22-1.28x) -
-- zones.remote_multiplier is a single column, not per-vehicle, so one
-- value has to serve all three; 1.37 means minivan/minibus trips to
-- Ba/Rakiraki come out 7-12% above their real historical price, a known,
-- reviewed tradeoff, not an oversight.
UPDATE zones SET remote_multiplier = 1.37 WHERE name IN ('Ba', 'Rakiraki');
