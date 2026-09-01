-- Milestone 16: real server-side reference fare for the Flexible Fare
-- feature. Two small, permanent additions:
--
-- zone_distance_cache: the real driving distance between two zones never
-- changes (zone coordinates are fixed reference points, not per-guest
-- addresses), so it's cached indefinitely rather than re-fetched from
-- Google on every step-4 render. zone_a/zone_b are stored in a canonical
-- (alphabetically sorted) order so A->B and B->A share one row - direction
-- doesn't affect distance for this use case, unlike the geocoded_addresses
-- cache which is direction-sensitive for a different reason (which end is
-- the free-text address).
--
-- reference_fare_lookups: a lightweight per-IP rate-limit counter for the
-- new GET /reference-fare endpoint. Kept separate from
-- negotiation_requests (which tracks actual proposals, a much rarer
-- action) since this endpoint is hit on every eligible step-4 render, not
-- just on submit.

CREATE TABLE zone_distance_cache (
  id INTEGER PRIMARY KEY,
  zone_a TEXT NOT NULL,
  zone_b TEXT NOT NULL,
  distance_km REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(zone_a, zone_b)
);

CREATE TABLE reference_fare_lookups (
  id INTEGER PRIMARY KEY,
  source_ip TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO platform_settings (key, value) VALUES ('reference_fare_rate_limit_max_per_day', '60');
INSERT INTO platform_settings (key, value) VALUES ('reference_fare_rate_limit_window_minutes', '10');
