-- Vakaviti funnel observability - CEO P0 Round 5, Track B.
-- Deliberately its own database, its own table, its own Worker. Never
-- shares a connection, a table, or a deploy with the bookings D1
-- (nadi-marketplace-db) or its Worker - an analytics outage here cannot
-- touch booking persistence, and dropping this table entirely would lose
-- zero booking data.
CREATE TABLE IF NOT EXISTS funnel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  session_id TEXT NOT NULL,
  platform TEXT NOT NULL,           -- 'fijidash' | 'nadi' - which guest site fired it
  first_source TEXT,
  first_medium TEXT,
  first_campaign TEXT,
  first_referrer TEXT,
  first_landing_path TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_session ON funnel_events(session_id);
CREATE INDEX IF NOT EXISTS idx_funnel_events_type_created ON funnel_events(event_type, created_at);

-- ─── Migration: route attribution RC ──────────────────────────────────────
-- Adds route attribution (utm_content + the actual /transfer/<slug> the
-- guest landed on) to the existing live table. This is a migration against
-- a table that already has rows - D1/SQLite's ADD COLUMN backfills NULL
-- for existing rows, nothing is lost or recomputed. Run this block once,
-- after the CREATE TABLE above has already applied on the live database
-- (it has - funnel_events already exists in production). Do not re-run
-- if these columns already exist - ADD COLUMN has no "IF NOT EXISTS" form
-- in SQLite and will error on a column that's already there.
ALTER TABLE funnel_events ADD COLUMN first_content TEXT;  -- utm_content, e.g. 'pacific-harbour'
ALTER TABLE funnel_events ADD COLUMN route_slug TEXT;     -- the /transfer/<slug> path the guest actually landed on, or first_content as fallback
CREATE INDEX IF NOT EXISTS idx_funnel_events_route_slug ON funnel_events(route_slug);
