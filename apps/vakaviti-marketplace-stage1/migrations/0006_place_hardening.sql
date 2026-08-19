PRAGMA foreign_keys = ON;

-- Pilot 6B: Place Authority truth hardening. Fully additive - three new tables, zero
-- changes to the existing places/place_relationships schema from Pilot 6A. These tables
-- let the Authority hold fact-level evidence, aliases, and external-system identifiers
-- as first-class, separately-provenanced records instead of folding them into a single
-- overloaded row on `places`.

CREATE TABLE IF NOT EXISTS place_evidence (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL,
  claim_type TEXT NOT NULL CHECK (claim_type IN (
    'IDENTITY','CANONICAL_NAME','PLACE_TYPE','PARENT','COORDINATES','ALIAS','RELATIONSHIP'
  )),
  claim_value TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  confidence TEXT,
  evidence_status TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (evidence_status IN (
    'UNVERIFIED','VERIFIED','REJECTED','SUPERSEDED'
  )),
  observed_at TEXT,
  verified_at TEXT,
  verified_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (place_id) REFERENCES places(id)
);

CREATE TABLE IF NOT EXISTS place_aliases (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL,
  alias_text TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT NOT NULL CHECK (alias_type IN (
    'FORMAL','COMMON','ALTERNATE','CODE','LEGACY','DEPRECATED'
  )),
  source_type TEXT,
  source_url TEXT,
  verification_status TEXT NOT NULL DEFAULT 'NOT_VERIFIED',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (place_id) REFERENCES places(id)
);

CREATE TABLE IF NOT EXISTS place_external_mappings (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL,
  system TEXT NOT NULL,
  external_type TEXT,
  external_id TEXT NOT NULL,
  external_slug TEXT,
  source TEXT,
  verification_status TEXT NOT NULL DEFAULT 'NOT_VERIFIED',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (place_id) REFERENCES places(id)
);

CREATE INDEX IF NOT EXISTS idx_place_evidence_place ON place_evidence(place_id, claim_type);
CREATE INDEX IF NOT EXISTS idx_place_aliases_place ON place_aliases(place_id);
CREATE INDEX IF NOT EXISTS idx_place_aliases_normalized ON place_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_place_external_mappings_place ON place_external_mappings(place_id);
CREATE INDEX IF NOT EXISTS idx_place_external_mappings_lookup ON place_external_mappings(system, external_id);
