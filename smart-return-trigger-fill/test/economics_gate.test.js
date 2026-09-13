import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMovementInput } from '../src/model.js';
import { computeMatchCandidates } from '../src/matcher.js';
import { smartMatchPrice, PRICE_DECISION } from '../src/pricing.js';

/* CEO fix 2026-09-13 (second review): operational feasibility must never
 * be conflated with commercial pricing readiness, and a price must never
 * be authorized on the source movement's economics when the CANDIDATE —
 * the leg actually being sold via SMART_MATCH/LIVE_FILL — has unverified
 * economics. These tests exercise the real computeMatchCandidates ->
 * smartMatchPrice pipeline end to end, not just fabricated objects. */

const BASE = '2026-10-10T00:00:00Z';
const plus = (minutes) => new Date(new Date(BASE).getTime() + minutes * 60000).toISOString();

function mk(overrides) {
  return normalizeMovementInput({
    source_site: 'nadiairporttransfers.com',
    origin: 'x',
    destination: 'y',
    arrival_or_departure: 'arrival',
    passenger_count: 1,
    vehicle_class: 'SEDAN',
    customer_price: 50,
    test_data: true,
    ...overrides,
  });
}

function feasibleSourceCandidatePair(candidateOverrides = {}) {
  const source = mk({
    booking_reference: 'ECO-SRC',
    pickup_zone: 'NAD_AIRPORT',
    dropoff_zone: 'DENARAU',
    pickup_datetime: plus(0),
    estimated_duration_minutes: 30,
    operator_payout: 30,
    absolute_floor: 25,
  });
  const candidate = mk({
    booking_reference: 'ECO-CAND',
    pickup_zone: 'DENARAU',
    dropoff_zone: 'NAD_AIRPORT',
    pickup_datetime: plus(200), // comfortably after source completion + buffer
    ...candidateOverrides,
  });
  return { source, candidate };
}

test('1. source economics known + candidate economics unknown = operational match OK, price HOLD', () => {
  const { source, candidate } = feasibleSourceCandidatePair({ operator_payout: null, absolute_floor: null });
  const [match] = computeMatchCandidates(source, [candidate]); // no routePriceTruthLookup supplied

  assert.equal(match.operational_feasibility, 'FEASIBLE', 'chronology/vehicle line up regardless of economics');
  assert.equal(match.commercial_pricing_status, 'HOLD_UNKNOWN_ECONOMICS');
  assert.equal(match.estimated_incremental_revenue, null);

  const price = smartMatchPrice({ matchCandidate: match, routePriceTruth: null });
  assert.equal(price.decision, PRICE_DECISION.HOLD_UNKNOWN_FLOOR);
  assert.equal(price.price, null);
});

test('2. candidate floor unknown (even with route_price_truth present) = no Smart Match price', () => {
  const { source, candidate } = feasibleSourceCandidatePair({ operator_payout: 20 });
  const routePriceTruth = { smart_match_price: 40, absolute_floor: null, operator_payout: 25 };
  const [match] = computeMatchCandidates(source, [candidate], {
    routePriceTruthLookup: () => routePriceTruth,
  });

  assert.equal(match.operational_feasibility, 'FEASIBLE');
  assert.equal(match.commercial_pricing_status, 'HOLD_UNKNOWN_ECONOMICS', 'floor is unverified, so pricing must HOLD');
  assert.equal(match.estimated_incremental_revenue, null);

  const price = smartMatchPrice({ matchCandidate: match, routePriceTruth });
  assert.equal(price.decision, PRICE_DECISION.HOLD_UNKNOWN_FLOOR);
  assert.equal(price.price, null);
});

test('3. candidate payout/cost-basis unknown = contribution UNKNOWN and pricing HOLDs per policy', () => {
  const { source, candidate } = feasibleSourceCandidatePair({ operator_payout: null }); // no cost basis on the booking itself
  const routePriceTruth = { smart_match_price: 40, absolute_floor: 25, operator_payout: null }; // and none on the route either
  const [match] = computeMatchCandidates(source, [candidate], {
    routePriceTruthLookup: () => routePriceTruth,
  });

  assert.equal(match.operational_feasibility, 'FEASIBLE');
  assert.equal(match.commercial_pricing_status, 'HOLD_UNKNOWN_ECONOMICS', 'no cost basis anywhere for the candidate leg');
  assert.equal(match.estimated_contribution, null);

  const price = smartMatchPrice({ matchCandidate: match, routePriceTruth });
  assert.equal(price.decision, PRICE_DECISION.HOLD_UNKNOWN_FLOOR);
});

test('4. both route floor and a cost basis verified on the candidate leg = price may pass through enforceFloor', () => {
  const { source, candidate } = feasibleSourceCandidatePair({ operator_payout: null, absolute_floor: null }); // candidate booking itself has none...
  const routePriceTruth = { smart_match_price: 40, absolute_floor: 25, operator_payout: 30 }; // ...but the ROUTE has verified figures
  const [match] = computeMatchCandidates(source, [candidate], {
    routePriceTruthLookup: () => routePriceTruth,
  });

  assert.equal(match.operational_feasibility, 'FEASIBLE');
  assert.equal(match.commercial_pricing_status, 'READY');
  assert.equal(match.estimated_incremental_revenue, 40);
  assert.equal(match.estimated_contribution, 10); // 40 - 30

  const price = smartMatchPrice({ matchCandidate: match, routePriceTruth });
  assert.equal(price.decision, PRICE_DECISION.OK);
  assert.equal(price.price, 40);
});

test('a cost basis on the candidate BOOKING itself (not the route) also satisfies commercial readiness', () => {
  const { source, candidate } = feasibleSourceCandidatePair({ operator_payout: 22, absolute_floor: null });
  const routePriceTruth = { smart_match_price: 40, absolute_floor: 25, operator_payout: null }; // route has no payout figure
  const [match] = computeMatchCandidates(source, [candidate], {
    routePriceTruthLookup: () => routePriceTruth,
  });

  assert.equal(match.commercial_pricing_status, 'READY');
  assert.equal(match.estimated_contribution, 18); // 40 - 22, using the booking's own payout
});

test('source economics being fully verified never substitutes for the candidate\'s own verification', () => {
  // Source has everything known; candidate and route both have nothing.
  const { source, candidate } = feasibleSourceCandidatePair({ operator_payout: null, absolute_floor: null });
  const [match] = computeMatchCandidates(source, [candidate]); // no route_price_truth at all

  assert.equal(match.operational_feasibility, 'FEASIBLE');
  assert.equal(match.commercial_pricing_status, 'HOLD_UNKNOWN_ECONOMICS', 'the source being fully priced must not leak into the candidate\'s pricing status');
});
