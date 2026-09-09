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
