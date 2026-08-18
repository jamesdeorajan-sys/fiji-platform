PRAGMA foreign_keys = ON;

-- Canonical Fiji Place Registry (Pilot 6A, 2026-08-19). Additive only - Stage 1's marketplace
-- (operators/products/offers) does not read from this table yet and does not depend on it. If
-- this table were dropped, the existing marketplace continues working unchanged.
--
-- Place IDs (plc_<opaque>) are intentionally a different ID space from Stage 1's own operator/
-- product UUIDs, per the CEO's Option-B canonical-ID direction from earlier pilots: they are
-- never reused, never reissued, and immutable once assigned. Slugs and names may be edited;
-- ids never are.
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  place_type TEXT NOT NULL CHECK (place_type IN ('COUNTRY','REGION','ISLAND_GROUP','ISLAND','CITY','AIRPORT','JETTY','PROPERTY','LOCALITY')),
  canonical_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL DEFAULT 'FJ',
  parent_place_id TEXT,
  latitude REAL,
  longitude REAL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INTERNAL_ONLY','PUBLICATION_BLOCKED','DEPRECATED')),
  source_type TEXT,
  source_url TEXT,
  observed_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_place_id) REFERENCES places(id)
);

-- Non-hierarchical relationships between places (e.g. a future jetty "DEPARTS_TO" an island).
-- Deliberately not populated by this pilot's seed set, which is fully expressible as a strict
-- parent tree via places.parent_place_id - this table exists so a future Route/Transport
-- Authority has somewhere to record relationships that are NOT parent/child without forcing
-- them into parent_place_id.
CREATE TABLE IF NOT EXISTS place_relationships (
  id TEXT PRIMARY KEY,
  from_place_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  to_place_id TEXT NOT NULL,
  source_type TEXT,
  source_url TEXT,
  observed_at TEXT,
  verification_status TEXT NOT NULL DEFAULT 'NOT_VERIFIED',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_place_id) REFERENCES places(id),
  FOREIGN KEY (to_place_id) REFERENCES places(id)
);

CREATE INDEX IF NOT EXISTS idx_places_parent ON places(parent_place_id);
CREATE INDEX IF NOT EXISTS idx_places_type ON places(place_type);
CREATE INDEX IF NOT EXISTS idx_place_relationships_from ON place_relationships(from_place_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_place_relationships_to ON place_relationships(to_place_id, relationship_type);
