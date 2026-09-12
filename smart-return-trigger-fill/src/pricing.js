/* Issue #54 Stage 1 (SHADOW MODE) — pricing guardrails.
 * Hard rule enforced everywhere in this file: nothing computed here may be
 * returned as a publishable/recommended price below absolute_floor, and
 * nothing is invented when payout/floor is unknown — the function returns
 * a HOLD decision instead of a guessed number.
 */
import { FARE_CLASS, RETURN_LOCK_MIN_DAYS_AHEAD, EXPERIENCE_CREDIT_VALUE_EACH, EXPERIENCE_CREDIT_MAX_COUNT } from './model.js';

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
 * AU$50 Fiji Experience Credit eligibility.
 * `minSpendThreshold` is the CEO-configurable minimum-spend / margin rule
 * called out in issue #54 — it is not yet policy-approved. While it is
 * null/undefined, eligibility always resolves false with reason
 * POLICY_UNCONFIGURED, and nothing is ever auto-issued (`issued` stays 0
 * regardless of this function's output — see migrations/0004).
 */
export function experienceCreditEligibility({
  outboundMovement,
  returnMovement,
  nowIso,
  minSpendThreshold = null,
  eligibleFttBookingCount = 0,
}) {
  const returnLock = isReturnLockEligible({ outboundMovement, returnMovement, nowIso });
  if (!returnLock.eligible) {
    return { eligible: false, creditCount: 0, reason: returnLock.reason };
  }
  if (minSpendThreshold == null) {
    return { eligible: false, creditCount: 0, reason: 'POLICY_UNCONFIGURED' };
  }
  const combinedSpend = (outboundMovement.customer_price ?? 0) + (returnMovement.customer_price ?? 0);
  if (combinedSpend < minSpendThreshold) {
    return { eligible: false, creditCount: 0, reason: 'BELOW_MIN_SPEND_THRESHOLD' };
  }
  const creditCount = Math.min(EXPERIENCE_CREDIT_MAX_COUNT, eligibleFttBookingCount);
  if (creditCount === 0) {
    return { eligible: false, creditCount: 0, reason: 'NO_ELIGIBLE_FTT_BOOKING' };
  }
  return {
    eligible: true,
    creditCount,
    creditValueEach: EXPERIENCE_CREDIT_VALUE_EACH,
    reason: 'ELIGIBLE',
  };
}

/**
 * SMART_MATCH fare: only when the matcher found a FEASIBLE candidate and
 * route_price_truth has a known smart_match_price. Floor enforcement
 * always applies on top.
 */
export function smartMatchPrice({ matchCandidate, routePriceTruth }) {
  if (!matchCandidate || matchCandidate.feasibility !== 'FEASIBLE') {
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
