-- Marau Stage 1 (PREVIEW/TEST ONLY) — approved-price provenance.
--
-- FIX for a second-review P1 finding: evaluateOfferEligibility silently
-- passed an offer with an UNKNOWN absolute_floor (NULL was treated as "no
-- floor to violate" rather than "floor unknown, cannot safely proceed") —
-- the same class of gap Issue #54's own COMMERCIAL_PRICING_STATUS
-- HOLD_UNKNOWN_ECONOMICS exists to prevent. worker_offer_eligibility.js
-- now requires a genuine, finite absolute_floor.
--
-- These two columns snapshot the price and floor the GUEST actually saw
-- and agreed to at request time (handleRequestDeal). Confirmation
-- (handleAdminConfirmDealRequest) compares the offer's CURRENT price/floor
-- against this snapshot and refuses to confirm if either has moved
-- (409 PRICE_CHANGED_SINCE_REQUEST) — a stale/changed commercial term is
-- never silently honoured at whatever the offer happens to say "now".
ALTER TABLE deal_requests ADD COLUMN requested_price REAL;
ALTER TABLE deal_requests ADD COLUMN requested_floor REAL;
