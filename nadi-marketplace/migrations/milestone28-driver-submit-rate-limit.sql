INSERT INTO platform_settings (key, value) VALUES ('driver_submit_rate_limit_max', '5');
INSERT INTO platform_settings (key, value) VALUES ('driver_submit_rate_limit_window_minutes', '60');

CREATE TABLE driver_submit_lookups (
  id INTEGER PRIMARY KEY,
  source_ip TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
