PRAGMA foreign_keys = ON;

-- Pilot 6D-A: additive Place Type taxonomy. This is NOT a places table rebuild - the existing
-- `place_type` column and its CHECK constraint are left completely untouched (legacy values,
-- including Nadi's CITY, remain exactly as they are). A new reference table plus a single
-- additive column carry the corrected taxonomy alongside the legacy one, proven safe in a
-- disposable D1 rehearsal database before being applied here (see Pilot 6D-A report).

CREATE TABLE IF NOT EXISTS place_types (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  legacy_place_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE places ADD COLUMN place_type_code TEXT REFERENCES place_types(code);

CREATE TABLE IF NOT EXISTS place_change_events (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  evidence_id TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (place_id) REFERENCES places(id),
  FOREIGN KEY (evidence_id) REFERENCES place_evidence(id)
);

CREATE INDEX IF NOT EXISTS idx_places_type_code ON places(place_type_code);
CREATE INDEX IF NOT EXISTS idx_place_change_events_place ON place_change_events(place_id, field_name);
