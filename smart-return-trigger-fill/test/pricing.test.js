import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceFloor, PRICE_DECISION, isReturnLockEligible, experienceCreditEligibility, smartMatchPrice, liveFillPrice } from '../src/pricing.js';

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

test('AU$50 credit: unconfigured policy always resolves ineligible, never silently issued', () => {
  const outbound = { pickup_datetime: '2026-10-10T00:00:00Z', customer_price: 100 };
  const ret = { pickup_datetime: '2026-10-13T00:00:00Z', customer_price: 100 };
  const result = experienceCreditEligibility({
    outboundMovement: outbound,
    returnMovement: ret,
    nowIso: '2026-10-01T00:00:00Z',
    minSpendThreshold: null,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'POLICY_UNCONFIGURED');
});

test('AU$50 credit: below configured min spend is ineligible', () => {
  const outbound = { pickup_datetime: '2026-10-10T00:00:00Z', customer_price: 20 };
  const ret = { pickup_datetime: '2026-10-13T00:00:00Z', customer_price: 20 };
  const result = experienceCreditEligibility({
    outboundMovement: outbound,
    returnMovement: ret,
    nowIso: '2026-10-01T00:00:00Z',
    minSpendThreshold: 200,
    eligibleFttBookingCount: 1,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'BELOW_MIN_SPEND_THRESHOLD');
});

test('AU$50 credit: eligible only when policy configured, spend met, and >=1 eligible FTT booking; capped at 2', () => {
  const outbound = { pickup_datetime: '2026-10-10T00:00:00Z', customer_price: 150 };
  const ret = { pickup_datetime: '2026-10-13T00:00:00Z', customer_price: 150 };
  const result = experienceCreditEligibility({
    outboundMovement: outbound,
    returnMovement: ret,
    nowIso: '2026-10-01T00:00:00Z',
    minSpendThreshold: 200,
    eligibleFttBookingCount: 5,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.creditCount, 2);
});

test('smartMatchPrice HOLDs when match is not FEASIBLE', () => {
  const result = smartMatchPrice({ matchCandidate: { feasibility: 'HOLD_UNKNOWN_ECONOMICS' }, routePriceTruth: { smart_match_price: 40, absolute_floor: 25 } });
  assert.equal(result.decision, PRICE_DECISION.HOLD_UNKNOWN_FLOOR);
  assert.equal(result.price, null);
});

test('smartMatchPrice returns a floor-safe price when feasible and route price truth known', () => {
  const result = smartMatchPrice({ matchCandidate: { feasibility: 'FEASIBLE' }, routePriceTruth: { smart_match_price: 40, absolute_floor: 25 } });
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
