import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRoutePriceTruthEntry } from '../src/route_price_truth.js';

test('rejects an entry missing required identity fields', () => {
  const result = validateRoutePriceTruthEntry({ origin_zone: 'NAD_AIRPORT' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('route_id')));
});

test('rejects any price below the entry\'s own absolute_floor', () => {
  const result = validateRoutePriceTruthEntry({
    route_id: 'r1', origin_zone: 'NAD_AIRPORT', destination_zone: 'DENARAU', vehicle_class: 'SEDAN', currency: 'AUD',
    absolute_floor: 25, smart_match_price: 10,
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('smart_match_price')));
});

test('accepts a fully-formed, floor-consistent entry', () => {
  const result = validateRoutePriceTruthEntry({
    route_id: 'r1', origin_zone: 'NAD_AIRPORT', destination_zone: 'DENARAU', vehicle_class: 'SEDAN', currency: 'AUD',
    standard_price: 45, absolute_floor: 25, smart_match_price: 30,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('null price fields are allowed (unknown, not zero)', () => {
  const result = validateRoutePriceTruthEntry({
    route_id: 'r1', origin_zone: 'NAD_AIRPORT', destination_zone: 'DENARAU', vehicle_class: 'SEDAN', currency: 'AUD',
    standard_price: null, absolute_floor: null,
  });
  assert.equal(result.valid, true);
});
