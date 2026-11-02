-- Bula source discovery (polling) + staff-visible mirror refusals. Additive; safe to apply once. No guest data is stored here: references, reason codes and field NAMES only.
CREATE TABLE IF NOT EXISTS bula_source_discovery_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  watermark INTEGER NOT NULL,                 -- highest NAT booking id fully handled (a transient failure holds it back)
  floor_id INTEGER NOT NULL,                  -- the watermark at first run: discovery never looks below it (history is not mirrored)
  bootstrapped_at INTEGER NOT NULL,
  last_poll_at INTEGER, last_ok_at INTEGER,
  last_error TEXT,                            -- a code, never a message body
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  discovered_total INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bula_source_refusals (
  source_booking_ref TEXT PRIMARY KEY,
  reason TEXT NOT NULL,                       -- e.g. MISSING_GUEST_CONTACT, MISSING_QUOTED_AMOUNT, SOURCE_READ_FAILED
  detail TEXT,                                -- field NAMES only, e.g. 'missing:guest_email'
  source_status TEXT,
  first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
  resolved_at INTEGER, resolved_by TEXT, resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_bula_source_refusals_state ON bula_source_refusals(state, first_seen_at);
