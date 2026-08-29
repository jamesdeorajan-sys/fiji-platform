-- Daily Workers AI call budget counter - same UPSERT pattern as the publication caps.
CREATE TABLE IF NOT EXISTS daily_ai_call_counter (
  call_date TEXT PRIMARY KEY, -- 'YYYY-MM-DD', UTC
  count INTEGER NOT NULL DEFAULT 0
);
