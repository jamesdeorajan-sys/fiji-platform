import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpsCard, recommendedAction } from '../src/whatsapp_cards.js';

const movement = {
  source_site: 'nadiairporttransfers.com',
  booking_reference: 'CARD-0001',
  pickup_zone: 'NAD_AIRPORT',
  dropoff_zone: 'DENARAU',
  pickup_datetime: '2026-10-05T09:00:00Z',
  passenger_count: 2,
  vehicle_class: 'SEDAN',
  customer_price: 45,
};

test('ops card is a plain string with no send/network side effects, and lists HOLD when there is no match', () => {
  const card = buildOpsCard(movement, []);
  assert.equal(typeof card, 'string');
  assert.match(card, /NEW TRANSFER \/ MATCH OPPORTUNITY/);
  assert.match(card, /Recommended action: HOLD/);
  assert.match(card, /Potential matched movement: none found/);
});

test('an unverified empty-km estimate is labelled as such, never presented as fact', () => {
  const candidates = [{
    candidate_movement_id: 'mv_x', match_score: 90, match_type: 'EXACT_REVERSE',
    operational_feasibility: 'FEASIBLE', commercial_pricing_status: 'READY',
    empty_km_potentially_avoided: 20, empty_km_verified: false,
  }];
  const card = buildOpsCard(movement, candidates);
  assert.match(card, /20 \(unverified estimate\)/);
});

test('recommendedAction returns HOLD when not operationally feasible, regardless of match score', () => {
  const action = recommendedAction({ operational_feasibility: 'HOLD_UNKNOWN_TIMING', commercial_pricing_status: 'READY', match_score: 95, match_type: 'EXACT_REVERSE' });
  assert.equal(action, 'HOLD');
});

test('recommendedAction returns RETURN_LOCK for an operationally feasible exact reverse match, even with pricing unready', () => {
  const action = recommendedAction({ operational_feasibility: 'FEASIBLE', commercial_pricing_status: 'HOLD_UNKNOWN_ECONOMICS', match_score: 95, match_type: 'EXACT_REVERSE' });
  assert.equal(action, 'RETURN_LOCK');
});

test('CEO fix 2026-09-13: recommendedAction returns HOLD for a non-reverse match that is operationally feasible but commercially unready', () => {
  const action = recommendedAction({ operational_feasibility: 'FEASIBLE', commercial_pricing_status: 'HOLD_UNKNOWN_ECONOMICS', match_score: 80, match_type: 'CORRIDOR' });
  assert.equal(action, 'HOLD');
});

test('recommendedAction returns SMART_MATCH only once both operational and commercial checks pass', () => {
  const action = recommendedAction({ operational_feasibility: 'FEASIBLE', commercial_pricing_status: 'READY', match_score: 80, match_type: 'CORRIDOR' });
  assert.equal(action, 'SMART_MATCH');
});
