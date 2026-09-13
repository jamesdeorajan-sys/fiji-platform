/* Issue #54 Stage 1 (SHADOW MODE) — pricing guardrails.
 * Hard rule enforced everywhere in this file: nothing computed here may be
 * returned as a publishable/recommended price below absolute_floor, and
 * nothing is invented when payout/floor is unknown — the function returns
 * a HOLD decision instead of a guessed number.
 */
import {
  FARE_CLASS,
  RETURN_LOCK_MIN_DAYS_AHEAD,
  EXPERIENCE_CREDIT_VALUE_EACH,
  EXPERIENCE_CREDIT_MAX_COUNT,
  DEFAULT_MIN_TOUR_SPEND_PER_CREDIT,
} from './model.js';

export const PRICE_DECISION = Object.freeze({
  OK: 'OK',
  HOLD_UNKNOWN_FLOOR: 'HOLD_UNKNOWN_FLOOR',
  CLAMPED_TO_FLOOR: 'CLAMPED_TO_FLOOR',
});

/**
 * Enforces the absolute-floor hard rule for any candidate price.
 * - floor unknown  -> HOLD_UNKNOWN_FLOOR, price is null (never guessed).
 * - candidate below floor -> CLAMPED_TO_FLOOR, price = floor, flagged for
 *   human review rather than silently accepted (a computed price that
 *   undercuts the floor usually means an upstream input is wrong).
 * - otherwise -> OK, price = candidate.
 */
export function enforceFloor(candidatePrice, absoluteFloor) {
  if (absoluteFloor == null) {
    return { decision: PRICE_DECISION.HOLD_UNKNOWN_FLOOR, price: null };
  }
  if (candidatePrice == null) {
    return { decision: PRICE_DECISION.HOLD_UNKNOWN_FLOOR, price: null };
  }
  if (candidatePrice < absoluteFloor) {
    return { decision: PRICE_DECISION.CLAMPED_TO_FLOOR, price: absoluteFloor };
  }
  return { decision: PRICE_DECISION.OK, price: candidatePrice };
}

function daysBetween(fromIso, toIso) {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * RETURN_LOCK eligibility: both legs booked, and the first travel date is
 * at least RETURN_LOCK_MIN_DAYS_AHEAD days from `nowIso`.
 *
 * `nowIso` must be the moment the return leg was locked in (e.g. the later
 * of the two movements' created_at), NOT the current wall-clock time at
 * whatever point this is evaluated. Eligibility is a fact about the
 * booking, decided once — recomputing it against "today" would make a
 * traveller lose their locked return discount simply because their trip
 * got closer, which is not the intended rule.
 */
export function isReturnLockEligible({ outboundMovement, returnMovement, nowIso }) {
  if (!outboundMovement || !returnMovement) {
    return { eligible: false, reason: 'MISSING_LEG' };
  }
  const firstLegDate =
    outboundMovement.pickup_datetime <= returnMovement.pickup_datetime
      ? outboundMovement.pickup_datetime
      : returnMovement.pickup_datetime;
  const daysAhead = daysBetween(nowIso, firstLegDate);
  if (daysAhead < RETURN_LOCK_MIN_DAYS_AHEAD) {
    return { eligible: false, reason: 'LESS_THAN_7_DAYS_AHEAD', daysAhead };
  }
  return { eligible: true, reason: 'BOTH_LEGS_BOOKED_7_PLUS_DAYS_AHEAD', daysAhead };
}

/**
 * AU$50 Fiji Experience Credit — EARN side.
 *
 * CEO policy fix 2026-09-13: earning is decided purely by RETURN_LOCK
 * eligibility (both legs booked, first travel >= 7 days ahead) — there is
 * NO transfer-spend threshold on the earn side. Earning 2x AU$25 credits
 * is a property of the return-lock booking itself, independent of
 * whether/how those credits ever get redeemed.
 */
export function earnExperienceCreditEligibility({ outboundMovement, returnMovement, nowIso }) {
  const returnLock = isReturnLockEligible({ outboundMovement, returnMovement, nowIso });
  if (!returnLock.eligible) {
    return { earned: false, creditsEarned: 0, reason: returnLock.reason };
  }
  return {
    earned: true,
    creditsEarned: EXPERIENCE_CREDIT_MAX_COUNT,
    creditValueEach: EXPERIENCE_CREDIT_VALUE_EACH,
    reason: 'RETURN_LOCK_EARNED',
  };
}

/**
 * AU$50 Fiji Experience Credit — REDEEM side.
 *
 * CEO policy fix 2026-09-13: each AU$25 credit redeems against ONE
 * separate, eligible FijiTourTransfers TOUR booking — never against the
 * combined transfer customer_price that earned the credit in the first
 * place. `tourBooking.tourSpend` is that tour product's own price.
 * Default minimum is AU$100/credit (`DEFAULT_MIN_TOUR_SPEND_PER_CREDIT`),
 * overridable per product via `tourBooking.productMinSpendOverride`.
 *
 * No live issuance/redemption exists yet in Stage 1 — this function is a
 * pure eligibility check for CEO/ops review, not a redemption action.
 */
export function redeemExperienceCredit({ tourBooking, minSpendThreshold = DEFAULT_MIN_TOUR_SPEND_PER_CREDIT }) {
  if (!tourBooking) {
    return { redeemable: false, reason: 'NO_TOUR_BOOKING' };
  }
  const threshold = tourBooking.productMinSpendOverride ?? minSpendThreshold;
  if (threshold == null) {
    return { redeemable: false, reason: 'POLICY_UNCONFIGURED' };
  }
  if (tourBooking.tourSpend == null) {
    return { redeemable: false, reason: 'TOUR_SPEND_UNKNOWN' };
  }
  if (tourBooking.tourSpend < threshold) {
    return { redeemable: false, reason: 'BELOW_MIN_TOUR_SPEND', appliedThreshold: threshold };
  }
  return { redeemable: true, reason: 'ELIGIBLE', appliedThreshold: threshold };
}

/**
 * SMART_MATCH fare: requires BOTH an operationally feasible candidate AND
 * a READY commercial_pricing_status on that same candidate (CEO fix
 * 2026-09-13, second review) — a match can be operationally fine while
 * still HOLDing on price because the CANDIDATE leg's own economics are
 * unverified. Floor enforcement always applies on top.
 */
export function smartMatchPrice({ matchCandidate, routePriceTruth }) {
  if (!matchCandidate || matchCandidate.operational_feasibility !== 'FEASIBLE') {
    return { fareClass: FARE_CLASS.SMART_MATCH, decision: PRICE_DECISION.HOLD_UNKNOWN_FLOOR, price: null };
  }
  if (matchCandidate.commercial_pricing_status !== 'READY') {
    return { fareClass: FARE_CLASS.SMART_MATCH, decision: PRICE_DECISION.HOLD_UNKNOWN_FLOOR, price: null };
  }
  if (!routePriceTruth || routePriceTruth.smart_match_price == null) {
    return { fareClass: FARE_CLASS.SMART_MATCH, decision: PRICE_DECISION.HOLD_UNKNOWN_FLOOR, price: null };
  }
  const { decision, price } = enforceFloor(routePriceTruth.smart_match_price, routePriceTruth.absolute_floor);
  return { fareClass: FARE_CLASS.SMART_MATCH, decision, price };
}

/**
 * LIVE_FILL fare: only for a real ACTIVE/VALIDATED offer with a known
 * floor. Never fabricates a discount off an unknown baseline.
 */
export function liveFillPrice({ offer }) {
  if (!offer || !['ACTIVE', 'VALIDATED', 'HELD'].includes(offer.status)) {
    return { fareClass: FARE_CLASS.LIVE_FILL, decision: PRICE_DECISION.HOLD_UNKNOWN_FLOOR, price: null };
  }
  const candidate = offer.smart_match_price ?? offer.standard_price;
  const { decision, price } = enforceFloor(candidate, offer.absolute_floor);
  return { fareClass: FARE_CLASS.LIVE_FILL, decision, price };
}
