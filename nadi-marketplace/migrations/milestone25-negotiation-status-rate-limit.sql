-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 25: rate limit for GET /negotiate/:id (the negotiation
-- status-polling endpoint).
--
-- Real gap found by an independent security review: this endpoint had
-- no rate limiting at all, alongside returning full guest PII
-- (guest_name, guest_phone, source_ip) to any unauthenticated caller
-- for a sequential, guessable ID - together, trivially scrapable. The
-- PII exposure itself is fixed in worker.js (the response now returns
-- only {id, status, reference_fare_fjd} plus the already-PII-free
-- offers array); this migration adds the rate-limit half of the fix.
--
-- A dedicated log table, not reusing negotiation_requests itself -
-- mirrors reference_fare_lookups/quote_requests_log's exact shape
-- (id, source_ip, created_at), the established pattern every other
-- rate-limited public endpoint in this file already uses. A 10-minute
-- window (not "per day" like most others) because this is a
-- continuously-polled endpoint (the guest widget polls every 5s while
-- waiting) - a daily cap would either be pointlessly huge or would
-- break a real guest's own wait. max=300 in a 10-minute window is
-- generous enough that a single real guest polling every 5s for the
-- full 20-minute negotiation_expiry_minutes window (≈240 polls) never
-- gets close to it, while still stopping a fast sequential-ID scrape.
INSERT INTO platform_settings (key, value) VALUES ('negotiation_status_rate_limit_max', '300');
INSERT INTO platform_settings (key, value) VALUES ('negotiation_status_rate_limit_window_minutes', '10');

CREATE TABLE negotiation_status_lookups (
  id INTEGER PRIMARY KEY,
  source_ip TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
