/* Marau Stage 1 (PREVIEW ONLY) — ONE shared eligibility check, used by
 * every place an offer could reach a guest or be acted on: public
 * listing (GET /preview/deals), AI recommendations (ai_assist.js),
 * requesting a deal, and confirming a deal request. Before this file
 * existed, each of those four call sites had its OWN ad hoc check
 * (`status IN ('ACTIVE','VALIDATED')`, sometimes also checking
 * expires_at, sometimes not) — a Codex review found an expired ACTIVE
 * offer still showing in both the public list and the AI's own
 * recommendations, because the listing/recommendation code paths never
 * checked expiry at all. A single function used everywhere means a gap
 * in one call site can no longer diverge from the others.
 *
 * FIX for a P1 Codex finding, second half: "VALIDATED alone must not
 * mean publicly approved." VALIDATED (src/offers.js) only means the
 * offer's required fields are present — it is a data-completeness
 * check, not a publication decision. ACTIVE is the state Issue #54's own
 * state machine reserves for "approved and live" (activateOffer moves
 * VALIDATED -> ACTIVE). Every previous Marau call site treated VALIDATED
 * as good enough to show/recommend/request — this file requires ACTIVE.
 */

export function evaluateOfferEligibility(offer, nowIso = new Date().toISOString()) {
  if (!offer) return { eligible: false, reason: 'NOT_FOUND' };

  if (offer.status !== 'ACTIVE') {
    return {
      eligible: false,
      reason: 'NOT_PUBLICLY_APPROVED',
      detail: `offer status is ${offer.status} — VALIDATED (or any other non-ACTIVE state) is not public approval`,
    };
  }

  if (!offer.expires_at || offer.expires_at <= nowIso) {
    return { eligible: false, reason: 'EXPIRED', detail: `expires_at ${offer.expires_at}` };
  }

  const inventory = Number(offer.inventory_count);
  if (!(Number.isFinite(inventory) && inventory > 0)) {
    return { eligible: false, reason: 'NO_INVENTORY' };
  }

  const price = offer.smart_match_price ?? offer.standard_price;
  if (!(Number.isFinite(price) && price >= 0)) {
    return { eligible: false, reason: 'INVALID_PRICE' };
  }

  if (offer.absolute_floor != null && price < offer.absolute_floor) {
    return { eligible: false, reason: 'BELOW_FLOOR', detail: `price ${price} is below absolute_floor ${offer.absolute_floor}` };
  }

  return { eligible: true };
}

export function filterEligibleOffers(offers, nowIso = new Date().toISOString()) {
  return offers.filter((o) => evaluateOfferEligibility(o, nowIso).eligible);
}
