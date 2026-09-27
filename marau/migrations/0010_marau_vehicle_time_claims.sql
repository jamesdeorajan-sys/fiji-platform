-- Marau Stage 1 (PREVIEW/TEST ONLY) — the actual double-sell guard for
-- DIFFERENT smart_offers that represent the same real vehicle/time slot.
--
-- src/offers.js's casOfferStatus already prevents the SAME offer_id being
-- held/filled twice. It does NOT prevent two DIFFERENT offer rows that
-- both trace back to the same source_movement_id (i.e. the same real
-- vehicle doing the same real trip) from both being confirmed — nothing
-- in the existing Issue #54 schema enforces that, and the mission
-- explicitly requires proving it before human confirmation. The PRIMARY
-- KEY below is the entire mechanism: confirming a deal_request inserts a
-- row here FIRST; if another offer for the same source_movement_id
-- already claimed it, this INSERT fails on the constraint and the second
-- confirmation is rejected cleanly, with the offer/deal_request left
-- exactly as they were (see worker.js#confirmDealRequest and
-- test/vehicle_time_claim_concurrency.test.mjs for the proof against a
-- real SQLite-backed D1-shaped store, not just application logic).
CREATE TABLE IF NOT EXISTS vehicle_time_claims (
  source_movement_id     TEXT PRIMARY KEY REFERENCES movements(movement_id),
  claimed_by_offer_id    TEXT NOT NULL REFERENCES smart_offers(offer_id),
  claimed_by_request_id  TEXT NOT NULL REFERENCES deal_requests(request_id),
  claimed_at             TEXT NOT NULL
);
