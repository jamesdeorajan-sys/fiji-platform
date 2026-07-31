// Fiji Dash — unit tests for the named pricing steps in pricing.mjs
// (Recommendation 2 / plan Step 3).
//
// Pure, local, no network and no live database - these test the formula
// steps in isolation with synthetic numbers. Real-route ground truth
// (actual zones, actual pricing_rules) is covered separately by
// pricing.test.js, which hits the live API.
//
// .mjs to match pricing.mjs's own module type (no package.json needed -
// see pricing.mjs's own header comment for why).
//
// Run together with the integration suite: node --test nadi-marketplace/worker

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RETURN_MULTIPLIER, resolveDistanceKm, computeBaseFare, applyZoneMultiplier,
  applyTripTypeMultiplier, isNightPickup, applyNightSurcharge,
  applyLoyaltyDiscount, computeFinalTotal, computeBoatFare, assertSanePricing,
} from './pricing.mjs';

// ─── Step 1: resolveDistanceKm ─────────────────────────────────────────
test('resolveDistanceKm: boat transfers are never distance-based', () => {
  assert.equal(resolveDistanceKm({ transferType: 'boat', cachedDistanceKm: 42 }), null);
});
test('resolveDistanceKm: a valid cached distance passes through unchanged', () => {
  assert.equal(resolveDistanceKm({ transferType: 'road', cachedDistanceKm: 54.718 }), 54.718);
});
test('resolveDistanceKm: missing or non-finite distance returns null, not a bad number', () => {
  assert.equal(resolveDistanceKm({ transferType: 'road', cachedDistanceKm: null }), null);
  assert.equal(resolveDistanceKm({ transferType: 'road', cachedDistanceKm: undefined }), null);
  assert.equal(resolveDistanceKm({ transferType: 'road', cachedDistanceKm: NaN }), null);
});

// ─── Step 2: computeBaseFare ────────────────────────────────────────────
test('computeBaseFare: flagfall + rate x distance', () => {
  assert.equal(computeBaseFare({ flagfallFjd: 10, baseRateFjdPerKm: 2, distanceKm: 20 }), 50);
});
test('computeBaseFare: zero distance still returns the flagfall', () => {
  assert.equal(computeBaseFare({ flagfallFjd: 10, baseRateFjdPerKm: 2, distanceKm: 0 }), 10);
});
test('computeBaseFare: missing pricing_rules data (no matching row) returns null, not zero', () => {
  assert.equal(computeBaseFare({ flagfallFjd: null, baseRateFjdPerKm: 2, distanceKm: 20 }), null);
  assert.equal(computeBaseFare({ flagfallFjd: 10, baseRateFjdPerKm: 2, distanceKm: null }), null);
});

// ─── Step 3: applyZoneMultiplier ────────────────────────────────────────
test('applyZoneMultiplier: multiplier of 1 leaves the fare unchanged', () => {
  assert.equal(applyZoneMultiplier(100, 1), 100);
});
test('applyZoneMultiplier: a real remote multiplier scales the base fare', () => {
  assert.equal(applyZoneMultiplier(100, 1.5), 150);
});
test('applyZoneMultiplier: a null/undefined multiplier defaults to 1, not 0', () => {
  assert.equal(applyZoneMultiplier(100, null), 100);
  assert.equal(applyZoneMultiplier(100, undefined), 100);
});

// ─── Step 4: applyTripTypeMultiplier — the step behind the Milestone 17 bug ─
test('applyTripTypeMultiplier: one-way passes through unchanged', () => {
  assert.equal(applyTripTypeMultiplier(69.08, 'one-way'), 69.08);
});
test('applyTripTypeMultiplier: return always equals one-way x RETURN_MULTIPLIER, exactly', () => {
  for (const fare of [10, 69.08, 357.35, 1, 999.99]) {
    assert.equal(applyTripTypeMultiplier(fare, 'return'), fare * RETURN_MULTIPLIER);
  }
});
test('applyTripTypeMultiplier: an unrecognised trip type is treated as one-way, not silently multiplied', () => {
  assert.equal(applyTripTypeMultiplier(100, 'round-trip'), 100);
  assert.equal(applyTripTypeMultiplier(100, undefined), 100);
});

// ─── Step 5: night surcharge ────────────────────────────────────────────
test('isNightPickup: inside the 10pm-6am window', () => {
  assert.equal(isNightPickup('22:00'), true);
  assert.equal(isNightPickup('23:59'), true);
  assert.equal(isNightPickup('00:00'), true);
  assert.equal(isNightPickup('05:59'), true);
});
test('isNightPickup: boundary values are exclusive of the day window (6am/10pm exactly)', () => {
  assert.equal(isNightPickup('06:00'), false);
  assert.equal(isNightPickup('21:59'), false);
});
test('isNightPickup: missing pickup time is never treated as night', () => {
  assert.equal(isNightPickup(null), false);
  assert.equal(isNightPickup(undefined), false);
  assert.equal(isNightPickup(''), false);
});
test('applyNightSurcharge: +20% at night, unchanged in the day', () => {
  assert.equal(applyNightSurcharge(100, '23:00'), 120);
  assert.equal(applyNightSurcharge(100, '14:00'), 100);
});

// ─── Step 6: loyalty discount ────────────────────────────────────────────
test('applyLoyaltyDiscount: 10% off a transfer-only subtotal over the threshold', () => {
  const { discountFjd, finalFjd } = applyLoyaltyDiscount(100, false);
  assert.equal(discountFjd, 10);
  assert.equal(finalFjd, 90);
});
test('applyLoyaltyDiscount: exactly at the threshold does NOT qualify (must be strictly over)', () => {
  const { discountFjd, finalFjd } = applyLoyaltyDiscount(50, false);
  assert.equal(discountFjd, 0);
  assert.equal(finalFjd, 50);
});
test('applyLoyaltyDiscount: a tour booking never gets the loyalty discount, regardless of subtotal', () => {
  const { discountFjd, finalFjd } = applyLoyaltyDiscount(500, true);
  assert.equal(discountFjd, 0);
  assert.equal(finalFjd, 500);
});

// ─── Step 7: final total rounding ────────────────────────────────────────
test('computeFinalTotal: rounds to 2 decimal places (cents), the server-authoritative precision', () => {
  assert.equal(computeFinalTotal(69.0801), 69.08);
  assert.equal(computeFinalTotal(127.798), 127.8);
});

// ─── Boat fare ───────────────────────────────────────────────────────────
test('computeBoatFare: adults only', () => {
  assert.equal(computeBoatFare({ adults: 2, children: 0, adultFareFjd: 50, childFareFjd: null }), 100);
});
test('computeBoatFare: adults + children', () => {
  assert.equal(computeBoatFare({ adults: 2, children: 1, adultFareFjd: 50, childFareFjd: 20 }), 120);
});
test('computeBoatFare: an unsourced fare (pricing_status pending) returns null, never a fabricated number', () => {
  assert.equal(computeBoatFare({ adults: 2, children: 0, adultFareFjd: null, childFareFjd: null }), null);
});

// ─── Recommendation 4: the runtime guardrail ─────────────────────────────
test('assertSanePricing: one-way trips are never subject to the return-ratio bound', () => {
  assert.equal(assertSanePricing({ oneWayEquivalentFjd: 100, finalTotalFjd: 9999, tripType: 'one-way' }).sane, true);
});
test('assertSanePricing: a correctly-priced return trip (~1.85x) is sane', () => {
  const result = assertSanePricing({ oneWayEquivalentFjd: 69.08, finalTotalFjd: 127.8, tripType: 'return' });
  assert.equal(result.sane, true);
});
test('assertSanePricing: catches the exact Milestone 17 failure mode — a return total that collapsed to ~1x one-way', () => {
  const result = assertSanePricing({ oneWayEquivalentFjd: 69.08, finalTotalFjd: 62.08, tripType: 'return' });
  assert.equal(result.sane, false);
  assert.ok(result.reason.includes('outside the sane'));
});
test('assertSanePricing: also catches a return total that is implausibly HIGH, not just implausibly low', () => {
  const result = assertSanePricing({ oneWayEquivalentFjd: 69.08, finalTotalFjd: 500, tripType: 'return' });
  assert.equal(result.sane, false);
});
test('assertSanePricing: a missing one-way equivalent fails safe (flagged, not silently passed)', () => {
  const result = assertSanePricing({ oneWayEquivalentFjd: null, finalTotalFjd: 127.8, tripType: 'return' });
  assert.equal(result.sane, false);
});
