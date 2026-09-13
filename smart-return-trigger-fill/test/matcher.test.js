import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMovementInput } from '../src/model.js';
import { computeMatchCandidates, findMultiLegChains } from '../src/matcher.js';
import { buildSyntheticMovements } from './fixtures/synthetic_movements.js';

const movements = buildSyntheticMovements().map((raw) => normalizeMovementInput(raw));
const byId = Object.fromEntries(movements.map((m) => [m.movement_id, m]));

test('exact reverse leg is detected and scored highest', () => {
  const candidates = computeMatchCandidates(byId.mv_syn_out_01, movements);
  const exact = candidates.find((c) => c.candidate_movement_id === 'mv_syn_ret_01');
  assert.ok(exact, 'expected exact reverse candidate to be found');
  assert.equal(exact.match_type, 'EXACT_REVERSE');
  assert.ok(exact.match_score >= 90);
});

test('known duration + chronology + vehicle yields operationally FEASIBLE, independent of economics', () => {
  const candidates = computeMatchCandidates(byId.mv_syn_out_01, movements);
  const exact = candidates.find((c) => c.candidate_movement_id === 'mv_syn_ret_01');
  assert.equal(exact.operational_feasibility, 'FEASIBLE');
  // No routePriceTruthLookup was supplied here, so pricing has nothing to
  // verify against — that's a separate axis from operational feasibility.
  assert.equal(exact.commercial_pricing_status, 'HOLD_UNKNOWN_ECONOMICS');
});

test('CEO fix 2026-09-13: the SOURCE movement having unknown economics does NOT block operational feasibility', () => {
  // mv_syn_nearby_01 itself has null operator_payout/absolute_floor — under
  // the old (buggy) design this alone forced a HOLD verdict on every
  // candidate. It must not anymore: operational feasibility only cares
  // about chronology and vehicle class.
  const candidates = computeMatchCandidates(byId.mv_syn_nearby_01, movements);
  assert.ok(candidates.length > 0, 'expected at least one nearby-reverse candidate');
  const operationallyFeasible = candidates.filter((c) => c.operational_feasibility === 'FEASIBLE');
  assert.ok(
    operationallyFeasible.length > 0,
    'expected at least one candidate to be operationally feasible despite the source lacking economics'
  );
  // Pricing must still HOLD though — no route_price_truth was supplied.
  for (const c of operationallyFeasible) {
    assert.equal(c.commercial_pricing_status, 'HOLD_UNKNOWN_ECONOMICS');
  }
});

test('corridor match is detected between corridor_a and corridor_b', () => {
  const candidates = computeMatchCandidates(byId.mv_syn_corridor_a, movements);
  const corridor = candidates.find((c) => c.candidate_movement_id === 'mv_syn_corridor_b');
  assert.ok(corridor, 'expected corridor candidate');
  assert.equal(corridor.match_type, 'CORRIDOR');
});

test('a genuinely unmatched movement returns zero candidates', () => {
  const candidates = computeMatchCandidates(byId.mv_syn_unmatched_01, movements);
  assert.equal(candidates.length, 0);
});

test('cancelled movements are excluded as match candidates', () => {
  const cancelled = { ...byId.mv_syn_ret_01, booking_status: 'CANCELLED' };
  const pool = movements.map((m) => (m.movement_id === cancelled.movement_id ? cancelled : m));
  const candidates = computeMatchCandidates(byId.mv_syn_out_01, pool);
  assert.ok(!candidates.some((c) => c.candidate_movement_id === 'mv_syn_ret_01'));
});

test('multi-leg chain of 3 same-vehicle-class legs is found', () => {
  const chains = findMultiLegChains(byId.mv_syn_chain_a, movements);
  assert.ok(chains.length > 0);
  const target = chains.find(
    (c) =>
      c.movement_ids.includes('mv_syn_chain_a') &&
      c.movement_ids.includes('mv_syn_chain_b') &&
      c.movement_ids.includes('mv_syn_chain_c')
  );
  assert.ok(target, `expected a chain containing a, b and c among: ${JSON.stringify(chains.map((c) => c.movement_ids))}`);
});

test('a chain never includes a candidate that starts before the previous leg', () => {
  const chains = findMultiLegChains(byId.mv_syn_chain_a, movements);
  for (const chain of chains) {
    const legs = chain.movement_ids.map((id) => byId[id] ?? movements.find((m) => m.movement_id === id));
    for (let i = 1; i < legs.length; i++) {
      assert.ok(new Date(legs[i].pickup_datetime) > new Date(legs[i - 1].pickup_datetime));
    }
  }
});

test('time-incompatible candidates (too tight a turnaround) are marked INFEASIBLE, not silently dropped', () => {
  const tight = normalizeMovementInput({
    ...byId.mv_syn_ret_01,
    movement_id: 'mv_syn_tight',
    booking_reference: 'SYN-TIGHT',
    pickup_datetime: new Date(new Date(byId.mv_syn_out_01.pickup_datetime).getTime() + 5 * 60000).toISOString(),
  });
  const candidates = computeMatchCandidates(byId.mv_syn_out_01, [...movements, tight]);
  const found = candidates.find((c) => c.candidate_movement_id === 'mv_syn_tight');
  assert.ok(found);
  assert.equal(found.time_compatible, false);
  assert.equal(found.operational_feasibility, 'INFEASIBLE');
});
