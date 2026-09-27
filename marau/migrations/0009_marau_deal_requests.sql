-- Marau Stage 1 (PREVIEW/TEST ONLY) — "Request this deal" as an idempotent
-- request, deliberately NOT a timed hold (holds/waitlist/credits are
-- explicitly deferred out of Stage 1). A request never changes
-- smart_offers.status by itself — only an authenticated ops confirm
-- (worker.js's confirmDealRequest, which also claims the vehicle/time slot
-- via vehicle_time_claims — see 0010) moves an offer, and opening/sending
-- WhatsApp is not a confirmation of anything.
CREATE TABLE IF NOT EXISTS deal_requests (
  request_id              TEXT PRIMARY KEY,
  offer_id                TEXT NOT NULL REFERENCES smart_offers(offer_id),
  guest_session_id        TEXT NOT NULL REFERENCES guest_sessions(session_id),
  idempotency_key         TEXT NOT NULL UNIQUE,  -- guest_session_id + offer_id: a retried request returns the same row
  status                  TEXT NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED', 'CONFIRMED', 'DECLINED', 'WITHDRAWN')),
  whatsapp_handoff_prepared INTEGER NOT NULL DEFAULT 0, -- message text was constructed; nothing was ever sent
  decided_by              TEXT,   -- synthetic/test ops identifier only
  decided_at              TEXT,
  test_data               INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deal_requests_offer ON deal_requests(offer_id);
CREATE INDEX IF NOT EXISTS idx_deal_requests_status ON deal_requests(status);
CREATE INDEX IF NOT EXISTS idx_deal_requests_session ON deal_requests(guest_session_id);
