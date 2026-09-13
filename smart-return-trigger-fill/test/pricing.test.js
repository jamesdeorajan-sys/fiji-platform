import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enforceFloor,
  PRICE_DECISION,
  isReturnLockEligible,
  earnExperienceCreditEligibility,
  redeemExperienceCredit,
  smartMatchPrice,
  liveFillPrice,
} from '../src/pricing.js';

test('enforceFloor: unknown floor always returns HOLD, never a guessed price', () => {
  const result = enforceFloor(50, null);
  assert.equal(result.decision, PRICE_DECISION.HOLD_UNKNOWN_FLOOR);
  assert.equal(result.price, null);
});

test('enforceFloor: candidate below floor is clamped and flagged, never returned as-is', () => {
  const result = enforceFloor(10, 25);
  assert.equal(result.decision, PRICE_DECISION.CLAMPED_TO_FLOOR);
  assert.equal(result.price, 25);
});

test('enforceFloor: candidate at or above floor passes through unchanged', () => {
  const result = enforceFloor(40, 25);
  assert.equal(result.decision, PRICE_DECISION.OK);
  assert.equal(result.price, 40);
});

test('RETURN_LOCK requires both legs and >=7 days ahead', () => {
  const outbound = { pickup_datetime: '2026-10-10T00:00:00Z' };
  const ret = { pickup_datetime: '2026-10-13T00:00:00Z' };

  const eligibleFar = isReturnLockEligible({ outboundMovement: outbound, returnMovement: ret, nowIso: '2026-10-01T00:00:00Z' });
  assert.equal(eligibleFar.eligible, true);

  const ineligibleSoon = isReturnLockEligible({ outboundMovement: outbound, returnMovement: ret, nowIso: '2026-10-08T00:00:00Z' });
  assert.equal(ineligibleSoon.eligible, false);
  assert.equal(ineligibleSoon.reason, 'LESS_THAN_7_DAYS_AHEAD');
});

test('AU$50 credit EARN: no transfer-spend threshold at all — return-lock alone earns 2 credits', () => {
  const outbound = { pickup_datetime: '2026-10-10T00:00:00Z', customer_price: 1 }; // trivial transfer spend
  const ret = { pickup_datetime: '2026-10-13T00:00:00Z', customer_price: 1 };
  const result = earnExperienceCreditEligibility({ outboundMovement: outbound, returnMovement: ret, nowIso: '2026-10-01T00:00:00Z' });
  assert.equal(result.earned, true);
  assert.equal(result.creditsEarned, 2);
});

test('AU$50 credit EARN: not return-lock eligible -> not earned', () => {
  const outbound = { pickup_datetime: '2026-10-10T00:00:00Z', customer_price: 500 };
  const ret = { pickup_datetime: '2026-10-13T00:00:00Z', customer_price: 500 };
  const result = earnExperienceCreditEligibility({ outboundMovement: outbound, returnMovement: ret, nowIso: '2026-10-08T00:00:00Z' });
  assert.equal(result.earned, false);
  assert.equal(result.reason, 'LESS_THAN_7_DAYS_AHEAD');
});

test('AU$50 credit REDEEM: no configured threshold and no override -> POLICY_UNCONFIGURED', () => {
  const result = redeemExperienceCredit({ tourBooking: { tourSpend: 150 }, minSpendThreshold: null });
  assert.equal(result.redeemable, false);
  assert.equal(result.reason, 'POLICY_UNCONFIGURED');
});

test('AU$50 credit REDEEM: defaults to AU$100 minimum tour spend per credit', () => {
  const belowDefault = redeemExperienceCredit({ tourBooking: { tourSpend: 99 } });
  assert.equal(belowDefault.redeemable, false);
  assert.equal(belowDefault.reason, 'BELOW_MIN_TOUR_SPEND');

  const atDefault = redeemExperienceCredit({ tourBooking: { tourSpend: 100 } });
  assert.equal(atDefault.redeemable, true);
});

test('AU$50 credit REDEEM: never uses combined transfer customer_price as the threshold — only the tour booking\'s own spend', () => {
  // A transfer priced at $500 must not make a $50 tour booking redeemable.
  const result = redeemExperienceCredit({ tourBooking: { tourSpend: 50 } });
  assert.equal(result.redeemable, false);
  assert.equal(result.reason, 'BELOW_MIN_TOUR_SPEND');
});

test('AU$50 credit REDEEM: product-level override replaces the AU$100 default', () => {
  const result = redeemExperienceCredit({ tourBooking: { tourSpend: 60, productMinSpendOverride: 50 } });
  assert.equal(result.redeemable, true);
  assert.equal(result.appliedThreshold, 50);
});

test('AU$50 credit REDEEM: no tour booking at all -> not redeemable, no guess', () => {
  const result = redeemExperienceCredit({ tourBooking: null });
  assert.equal(result.redeemable, false);
  assert.equal(result.reason, 'NO_TOUR_BOOKING');
});

test('smartMatchPrice HOLDs when the candidate is not operationally feasible', () => {
  const result = smartMatchPrice({
    matchCandidate: { operational_feasibility: 'HOLD_UNKNOWN_TIMING', commercial_pricing_status: 'READY' },
    routePriceTruth: { smart_match_price: 40, absolute_floor: 25 },
  });
  assert.equal(result.decision, PRICE_DECISION.HOLD_UNKNOWN_FLOOR);
  assert.equal(result.price, null);
});

test('CEO fix 2026-09-13: smartMatchPrice HOLDs when operationally feasible but the CANDIDATE leg economics are unverified', () => {
  const result = smartMatchPrice({
    matchCandidate: { operational_feasibility: 'FEASIBLE', commercial_pricing_status: 'HOLD_UNKNOWN_ECONOMICS' },
    routePriceTruth: { smart_match_price: 40, absolute_floor: 25 },
  });
  assert.equal(result.decision, PRICE_DECISION.HOLD_UNKNOWN_FLOOR);
  assert.equal(result.price, null);
});

test('smartMatchPrice returns a floor-safe price when operationally feasible AND commercially ready', () => {
  const result = smartMatchPrice({
    matchCandidate: { operational_feasibility: 'FEASIBLE', commercial_pricing_status: 'READY' },
    routePriceTruth: { smart_match_price: 40, absolute_floor: 25 },
  });
  assert.equal(result.decision, PRICE_DECISION.OK);
  assert.equal(result.price, 40);
});

test('liveFillPrice HOLDs for a non-active offer', () => {
  const result = liveFillPrice({ offer: { status: 'DISCOVERED', standard_price: 40, absolute_floor: 25 } });
  assert.equal(result.decision, PRICE_DECISION.HOLD_UNKNOWN_FLOOR);
});

test('liveFillPrice never returns a price below the offer floor', () => {
  const result = liveFillPrice({ offer: { status: 'ACTIVE', smart_match_price: 10, absolute_floor: 25 } });
  assert.equal(result.decision, PRICE_DECISION.CLAMPED_TO_FLOOR);
  assert.equal(result.price, 25);
});
