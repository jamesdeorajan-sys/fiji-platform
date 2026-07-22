-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 9: geocode + real-distance pricing for unlisted addresses
--
-- Real gap found before writing any of this: pricing_rules (designed in
-- Milestone 1's original schema for exactly this - distance-banded rates)
-- has sat empty for 8 milestones, and zones had no coordinates or
-- multiplier concept at all. "Borrow the zone's tourist-corridor/remote
-- multiplier" from the task description referred to something that didn't
-- exist yet. Confirmed with James before populating anything financially
-- material.
--
-- DERIVATION METHODOLOGY (sedan bands) - computed real implied $/km across
-- all 35 live ROUTES_DATA routes (ftt-booking-site/src/app.js, read-only).
-- Rate drops from ~$3.80/km at 5km to ~$1.35/km at 150km (real
-- economies-of-scale curve), then rises again for the separate Suva/Nausori
-- corridor (~$1.6/km at 200km+) - not one global curve, genuinely banded,
-- matching why pricing_rules has distance_min_km/distance_max_km at all.
-- Fit within each band (flagfall + per-km rate), checked against real data
-- points:
--   0-15km:    flagfall $10, $3.20/km  (checked vs Nadi/Wailoaloa/Nadi Airport actuals)
--   15-35km:   flagfall $15, $2.60/km  (checked vs Denarau/Sonaisali/Vuda/Lautoka)
--   35-70km:   flagfall $20, $1.85/km  (checked vs Momi Bay/Natadola/Sigatoka)
--   70-160km:  flagfall $25, $1.20/km  (checked vs Coral Coast/Pacific Harbour)
--   160-300km: flagfall $50, $1.45/km  (checked vs Suva/Nausori - the separate corridor)
-- All bands landed within ~15% of real actuals except two zones (below).
--
-- Minivan/minibus derived as a flat multiplier of the sedan band (1.3x /
-- 1.7x respectively) rather than independently banded - real per-zone
-- v/s and m/s ratios in the live data range ~1.16-1.4x and ~1.6-2.0x with
-- real noise (one live data point, Momi Bay, even shows minibus cheaper
-- than sedan - almost certainly a data entry quirk in the source, not a
-- real rate, excluded from the fit rather than propagated). 1.3x/1.7x are
-- representative of the more reliable mid/long-distance ratios.
--
-- REMOTE MULTIPLIER - checked every zone's actual price against its
-- band-predicted price. All 16 zones landed within a real ratio of
-- 0.88-1.18 (normal banded-model noise) EXCEPT two clear, consistent
-- outliers: Ba (actual/predicted = 1.328) and Rakiraki (1.332) - both
-- landing within 0.5% of each other, real evidence of a genuine North-coast
-- corridor premium, not noise. remote_multiplier = 1.33 for exactly these
-- two zones; 1.0 (no effect) everywhere else.
--
-- COORDINATES - real-world best estimates for each zone's town/area
-- center, provided by Claude Code (not surveyed, not geocoded via an API -
-- confirmed acceptable with James given Fiji's scale, where "nearest zone"
-- matching doesn't need survey-grade precision). Flagged here and in the
-- Milestone 9 report so this is never mistaken for authoritative data.

ALTER TABLE zones ADD COLUMN lat REAL;
ALTER TABLE zones ADD COLUMN lng REAL;
ALTER TABLE zones ADD COLUMN remote_multiplier REAL NOT NULL DEFAULT 1.0;

UPDATE zones SET lat = -17.8033, lng = 177.4145 WHERE name = 'Nadi';
UPDATE zones SET lat = -17.7554, lng = 177.4432 WHERE name = 'Nadi Airport';
UPDATE zones SET lat = -17.7717, lng = 177.4083 WHERE name = 'Wailoaloa';
UPDATE zones SET lat = -17.7746, lng = 177.3814 WHERE name = 'Denarau';
UPDATE zones SET lat = -17.8225, lng = 177.3634 WHERE name = 'Sonaisali';
UPDATE zones SET lat = -17.6725, lng = 177.3505 WHERE name = 'Vuda Point';
UPDATE zones SET lat = -17.6053, lng = 177.4503 WHERE name = 'Lautoka';
UPDATE zones SET lat = -17.9308, lng = 177.2678 WHERE name = 'Momi Bay';
UPDATE zones SET lat = -18.2264, lng = 177.3792 WHERE name = 'Natadola';
UPDATE zones SET lat = -18.1416, lng = 177.5049 WHERE name = 'Sigatoka';
UPDATE zones SET lat = -18.2000, lng = 177.7000 WHERE name = 'Coral Coast';
UPDATE zones SET lat = -18.2333, lng = 178.0500 WHERE name = 'Pacific Harbour';
UPDATE zones SET lat = -17.5333, lng = 177.6667, remote_multiplier = 1.33 WHERE name = 'Ba';
UPDATE zones SET lat = -17.3667, lng = 178.1667, remote_multiplier = 1.33 WHERE name = 'Rakiraki';
UPDATE zones SET lat = -18.1416, lng = 178.4419 WHERE name = 'Suva';
UPDATE zones SET lat = -18.0233, lng = 178.5561 WHERE name = 'Nausori';

INSERT INTO pricing_rules (vehicle_type, distance_min_km, distance_max_km, base_rate_fjd_per_km, flagfall_fjd) VALUES
  ('sedan',   0,   15,  3.20, 10),
  ('sedan',   15,  35,  2.60, 15),
  ('sedan',   35,  70,  1.85, 20),
  ('sedan',   70,  160, 1.20, 25),
  ('sedan',   160, 300, 1.45, 50),
  ('minivan', 0,   15,  4.16, 13),
  ('minivan', 15,  35,  3.38, 19.5),
  ('minivan', 35,  70,  2.405,26),
  ('minivan', 70,  160, 1.56, 32.5),
  ('minivan', 160, 300, 1.885,65),
  ('minibus', 0,   15,  5.44, 17),
  ('minibus', 15,  35,  4.42, 25.5),
  ('minibus', 35,  70,  3.145,34),
  ('minibus', 70,  160, 2.04, 42.5),
  ('minibus', 160, 300, 2.465,85);

-- Caches the GOOGLE ROUTES API result only (address resolution, distance,
-- ferry-leg detection, nearest zone) - not the computed fare. Fare depends
-- on vehicle_type, a free/local parameter; recomputing it from a cached
-- distance is cheap D1 math, not worth a separate cache row per vehicle
-- type. Only the paid, external part (resolving an address + real road
-- distance) is what this cache exists to avoid repeating.
CREATE TABLE geocoded_addresses (
  id INTEGER PRIMARY KEY,
  query_normalized TEXT NOT NULL UNIQUE,
  query_raw TEXT NOT NULL,
  resolved_address TEXT,
  lat REAL,
  lng REAL,
  distance_km REAL,
  duration_text TEXT,
  has_ferry_leg INTEGER NOT NULL DEFAULT 0,
  nearest_zone_id INTEGER REFERENCES zones(id),
  outcome TEXT NOT NULL, -- 'resolved' / 'needs_manual_confirmation' / 'needs_water_transfer'
  created_at TEXT DEFAULT (datetime('now'))
);

-- Per-IP daily cap on /quote (interim cost-abuse protection - see the
-- Milestone 9 report for why this, not a pause, was the recommendation).
-- Logs every request (hit or miss), not just cache misses - simpler to
-- reason about than trying to isolate exactly which requests were
-- billable, and the instruction asked for a cap on quote REQUESTS.
CREATE TABLE quote_requests_log (
  id INTEGER PRIMARY KEY,
  source_ip TEXT NOT NULL,
  query_normalized TEXT NOT NULL,
  cache_hit INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO platform_settings (key, value) VALUES ('quote_rate_limit_max_per_day', '20');
