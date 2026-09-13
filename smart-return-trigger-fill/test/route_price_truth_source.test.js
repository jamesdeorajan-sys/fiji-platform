/* Issue #54 Stage 1 (SHADOW MODE) — route-price-truth assembly tests.
 *
 * buildRoutePriceTruthEntry() never computes a reference fare, commission
 * rate, or floor ratio itself — every one of those is a REQUIRED,
 * caller-supplied input sourced from the real backend (see the module's
 * own header for exactly where). These tests prove it fails closed
 * whenever one is missing, and that the derived operator_payout/
 * absolute_floor figures match the real formulas already in production
 * use (nadi-marketplace/worker/worker.js: computeRealReferenceFare,
 * NEGOTIATION_FLOOR_RATIO, default_commission_rate) — not invented ones.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FLOOR_RATIO,
  buildRoutePriceTruthEntry,
} from '../src/route_price_truth_source.js';

test('DEFAULT_FLOOR_RATIO matches the real backend\'s NEGOTIATION_FLOOR_RATIO', () => {
  assert.equal(DEFAULT_FLOOR_RATIO, 0.80);
});

test('fails closed with MISSING_REFERENCE_FARE when no referenceFareFjd is supplied — never guesses a public price', () => {
  const result = buildRoutePriceTruthEntry({
    originZone: 'NAD_AIRPORT', destinationZone: 'DENARAU', vehicleClass: 'SEDAN',
    commissionRate: 0.15,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MISSING_REFERENCE_FARE');
});

test('fails closed for a non-positive or non-finite referenceFareFjd too', () => {
  for (const bad of [0, -5, NaN, Infinity, null]) {
    const result = buildRoutePriceTruthEntry({
      originZone: 'NAD_AIRPORT', destinationZone: 'DENARAU', vehicleClass: 'SEDAN',
      referenceFareFjd: bad, commissionRate: 0.15,
    });
    assert.equal(result.ok, false, `expected failure for referenceFareFjd=${bad}`);
    assert.equal(result.reason, 'MISSING_REFERENCE_FARE');
  }
});

test('fails closed with MISSING_COMMISSION_RATE when no commission rate is supplied — never assumes a default platform rate', () => {
  const result = buildRoutePriceTruthEntry({
    originZone: 'NAD_AIRPORT', destinationZone: 'DENARAU', vehicleClass: 'SEDAN',
    referenceFareFjd: 49,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MISSING_COMMISSION_RATE');
});

test('fails closed for an out-of-range commission rate (must be a real fraction, 0 <= rate < 1)', () => {
  for (const bad of [-0.1, 1, 1.5, NaN]) {
    const result = buildRoutePriceTruthEntry({
      originZone: 'NAD_AIRPORT', destinationZone: 'DENARAU', vehicleClass: 'SEDAN',
      referenceFareFjd: 49, commissionRate: bad,
    });
    assert.equal(result.ok, false, `expected failure for commissionRate=${bad}`);
    assert.equal(result.reason, 'MISSING_COMMISSION_RATE');
  }
});

test('fails closed for an invalid floorRatio override (must be in (0, 1])', () => {
  for (const bad of [0, -0.1, 1.1, NaN]) {
    const result = buildRoutePriceTruthEntry({
      originZone: 'NAD_AIRPORT', destinationZone: 'DENARAU', vehicleClass: 'SEDAN',
      referenceFareFjd: 49, commissionRate: 0.15, floorRatio: bad,
    });
    assert.equal(result.ok, false, `expected failure for floorRatio=${bad}`);
    assert.equal(result.reason, 'INVALID_FLOOR_RATIO');
  }
});

test('happy path: derives operator_payout and absolute_floor using the real backend\'s own formulas, not invented ones', () => {
  // Mirrors nadi-marketplace/worker/worker.js exactly:
  //   commission = settlement_amount_fjd * commission_rate
  //   operator payout = settlement_amount_fjd - commission
  //                    = settlement_amount_fjd * (1 - commission_rate)
  //   NEGOTIATION_FLOOR_RATIO-equivalent floor = reference_fare * floorRatio
  const result = buildRoutePriceTruthEntry({
    originZone: 'NAD_AIRPORT', destinationZone: 'DENARAU', vehicleClass: 'SEDAN',
    referenceFareFjd: 100, commissionRate: 0.15, // real default_commission_rate as of this mission
    asOfIso: '2026-10-01T00:00:00Z',
  });
  assert.equal(result.ok, true);
  assert.equal(result.entry.standard_price, 100);
  assert.equal(result.entry.smart_match_price, 100, 'never priced above the real public reference fare without a separate explicit commercial decision');
  assert.equal(result.entry.operator_payout, 85, '100 * (1 - 0.15)');
  assert.equal(result.entry.absolute_floor, 80, '100 * 0.80 (DEFAULT_FLOOR_RATIO)');
  assert.equal(result.entry.currency, 'FJD');
  assert.equal(result.entry.route_id, 'nad_airport-denarau-sedan');
  assert.equal(result.entry.last_verified_at, '2026-10-01T00:00:00Z');
  assert.ok(result.entry.pricing_reason.includes('reference_fare_fjd=100'));
  assert.ok(result.entry.effective_rule_version.includes('floor_ratio=0.8'));
  assert.ok(result.entry.effective_rule_version.includes('commission_rate=0.15'));
});

test('a custom floorRatio override still produces a self-consistent, validation-passing entry', () => {
  const result = buildRoutePriceTruthEntry({
    originZone: 'NAD_AIRPORT', destinationZone: 'PACIFIC_HARBOUR', vehicleClass: 'MINIVAN',
    referenceFareFjd: 269, commissionRate: 0.15, floorRatio: 0.75,
  });
  assert.equal(result.ok, true);
  assert.equal(result.entry.absolute_floor, 201.75);
  assert.ok(result.entry.smart_match_price >= result.entry.absolute_floor, 'must satisfy the contract\'s own floor-consistency check');
});

test('the resulting entry is directly usable as a store.upsertRoutePriceTruth() argument (round-trips through the real memory store)', async () => {
  const { createMemoryStore } = await import('../src/db.js');
  const result = buildRoutePriceTruthEntry({
    originZone: 'NAD_AIRPORT', destinationZone: 'DENARAU', vehicleClass: 'SEDAN',
    referenceFareFjd: 49, commissionRate: 0.15,
  });
  assert.equal(result.ok, true);
  const store = createMemoryStore();
  store.upsertRoutePriceTruth(result.entry);
  const looked_up = store.getRoutePriceTruth('NAD_AIRPORT', 'DENARAU', 'SEDAN');
  assert.equal(looked_up.absolute_floor, result.entry.absolute_floor);
});
