/* Seven-day shadow pilot runner — synthetic, opaque-ref fixtures only (test_data). No PII, no real bookings. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSevenDayPilot, REASON } from '../scripts/seven_day_pilot.js';

const OK_CONF = { source: 'ops_worksheet', confirmed_by: 'ops:dispatcher-1', confirmed_at: '2026-09-20T05:00:00Z', evidence_ref: 'ops-sheet-row-A' };
const CONFIG = {
  airport_zone: 'Nadi Airport',
  turnaround_minutes: 45,
  vehicle_capacity_confirmed: true,
  vehicle_capacity: { sedan: { pax: 3, bags: 3 }, minivan: { pax: 7, bags: 7 } },
  route_durations_verified: { 'Denarau|Nadi Airport': 80 },
  vehicle_availability_attested: { veh_A: { from: '2026-09-20T00:00', to: '2026-09-30T00:00' } },
};
let n = 0;
const mv = (o) => ({ movement_ref: `t_${++n}`, leg: 'arrival', pickup_zone: 'Nadi Airport', dropoff_zone: 'Denarau', pickup_local: '2026-09-22T09:00', vehicle_class: 'sedan',
  passengers: 2, luggage: 2, duration_minutes: 90, assigned_vehicle_ref: 'veh_A', confirmation: OK_CONF, test_data: true, ...o });
const run = (movements, config = CONFIG) => runSevenDayPilot({ config, movements }, { startDate: '2026-09-22' });
const rev = (o) => mv({ leg: 'departure', pickup_zone: 'Denarau', dropoff_zone: 'Nadi Airport', pickup_local: '2026-09-22T14:00', assigned_vehicle_ref: null, ...o });

test('unverified movements are excluded and counted, never evaluated', () => {
  const r = run([mv({ confirmation: null }), mv({ confirmation: { source: 'guess', confirmed_at: 'x', evidence_ref: 'y' } }), mv({ confirmation: { ...OK_CONF, evidence_ref: '' } })]);
  assert.equal(r.counts.verified_movements, 0);
  assert.equal(r.counts.not_verified_excluded, 3);
  assert.equal(r.results.length, 0);
});

test('verified arrival with known duration/turnaround/vehicle and no reverse booking -> operationally FEASIBLE opportunity, commercially HOLD, no price', () => {
  const r = run([mv({})]);
  const o = r.results[0];
  assert.equal(o.predicted_empty_leg.from, 'Denarau');
  assert.equal(o.predicted_empty_leg.to, 'Nadi Airport');
  assert.equal(o.predicted_empty_leg.status, 'HYPOTHETICAL');
  assert.equal(o.predicted_empty_leg.earliest_start_utc, '2026-09-21T23:15:00.000Z'); // 09:00 +90m +45m = 11:15 Fiji (UTC+12)
  assert.equal(o.predicted_empty_leg.duration_basis, 'OPS_VERIFIED_ROUTE_DURATION');
  assert.equal(o.opportunity.operational, 'FEASIBLE');
  assert.equal(o.opportunity.commercial, 'HOLD');
  assert.equal(o.opportunity.commercial_reason, REASON.ECONOMICS_UNKNOWN);
  assert.equal(o.opportunity.price_fjd, null);
  assert.equal(r.counts.ready_for_dispatch_review, 0);
  assert.equal(o.opportunity.stage, 'OPERATIONALLY_FEASIBLE_COMMERCIAL_HOLD');
});

test('a price appears only with approved fare authority, payout, additional cost, floor and an approved contribution requirement; it is clamped to the floor', () => {
  const truth = (extra) => ({ ...CONFIG, contribution_requirement: { approved: true, min_fjd: 0, approved_by: 'james', approved_on: '2026-09-21' },
    route_price_truth: { 'Denarau|Nadi Airport|sedan': { operator_payout_fjd: 20, additional_cost_fjd: 5, absolute_floor_fjd: 30, smart_match_price_fjd: 25, fare_authority_approved: true, ...extra } } });
  const ready = run([mv({})], truth({})).results[0].opportunity;
  assert.equal(ready.commercial, 'READY');
  assert.equal(ready.price_fjd, 30);            // 25 is below the floor -> clamped
  assert.equal(ready.contribution_fjd, 5);      // 30 - (20 + 5)
  assert.equal(run([mv({})], truth({ fare_authority_approved: false })).results[0].opportunity.commercial_reason, REASON.FARE_AUTHORITY_UNAPPROVED);
  assert.equal(run([mv({})], truth({ operator_payout_fjd: null })).results[0].opportunity.commercial_reason, REASON.INVALID_COMMERCIAL_INPUT);
  assert.equal(run([mv({})], truth({ absolute_floor_fjd: null })).results[0].opportunity.price_fjd, null);
});

test('formula-derived truth without explicit fare authority approval never prices', () => {
  const cfg = { ...CONFIG, route_price_truth: { 'Denarau|Nadi Airport|sedan': { operator_payout_fjd: 20, absolute_floor_fjd: 30, smart_match_price_fjd: 35 } } };
  const o = run([mv({})], cfg).results[0].opportunity;
  assert.equal(o.commercial, 'HOLD');
  assert.equal(o.price_fjd, null);
});

test('no assigned vehicle -> HOLD NO_VEHICLE_ASSIGNMENT (cannot be fleet-backed)', () => {
  const o = run([mv({ assigned_vehicle_ref: null })]).results[0].opportunity;
  assert.equal(o.operational, 'HOLD');
  assert.ok(o.operational_hold_reasons.includes(REASON.NO_VEHICLE_ASSIGNMENT));
  assert.equal(o.stage, 'HYPOTHETICAL_HOLD');
});

test('unknown duration and unknown turnaround are separate named HOLDs, never guessed', () => {
  const a = run([mv({ duration_minutes: null })]).results[0].opportunity;
  assert.ok(a.operational_hold_reasons.includes(REASON.DURATION_UNKNOWN));
  const b = run([mv({})], { ...CONFIG, turnaround_minutes: null }).results[0];
  assert.ok(b.opportunity.operational_hold_reasons.includes(REASON.TURNAROUND_UNKNOWN));
  assert.equal(b.predicted_empty_leg.earliest_start_utc, null);
});

test('a sold reverse booking the same vehicle can serve is a chain (deadhead avoided), not a discountable special', () => {
  const r = run([mv({}), rev({})]);
  assert.equal(r.results[0].chains.length, 1);
  assert.equal(r.results[0].opportunity, null);
  assert.equal(r.counts.sold_reverse_chains, 1);
});

test('reverse booking that starts before the vehicle can be free is rejected TIMING_INFEASIBLE and the opportunity remains', () => {
  const r = run([mv({}), rev({ pickup_local: '2026-09-22T10:30' })]);
  assert.deepEqual(r.rejected[0].reasons, [REASON.TIMING_INFEASIBLE]);
  assert.equal(r.results[0].chains.length, 0);
  assert.equal(r.results[0].opportunity.operational, 'FEASIBLE');
});

test('reverse booking assigned to a different vehicle, or a different class, is rejected with that reason', () => {
  const r = run([mv({}), rev({ assigned_vehicle_ref: 'veh_B' }), rev({ vehicle_class: 'minivan' })]);
  const reasons = r.rejected.flatMap((x) => x.reasons);
  assert.ok(reasons.includes(REASON.DIFFERENT_VEHICLE));
  assert.ok(reasons.includes(REASON.VEHICLE_CLASS_MISMATCH));
});

test('capacity: unknown passengers/luggage, unconfirmed capacity table, and exceeded capacity are all rejected, never assumed fine', () => {
  assert.ok(run([mv({}), rev({ passengers: null })]).rejected[0].reasons.includes(REASON.CAPACITY_UNKNOWN));
  assert.ok(run([mv({}), rev({})], { ...CONFIG, vehicle_capacity_confirmed: false }).rejected[0].reasons.includes(REASON.CAPACITY_UNKNOWN));
  assert.ok(run([mv({}), rev({ passengers: 5 })]).rejected[0].reasons.includes(REASON.CAPACITY_EXCEEDED));
});

test('same vehicle already committed in the empty-leg window (or completion unknown) -> HOLD VEHICLE_CONFLICT', () => {
  const busy = mv({ leg: 'departure', pickup_zone: 'Coral Coast', dropoff_zone: 'Nadi Airport', pickup_local: '2026-09-22T11:30', duration_minutes: 60 });
  assert.ok(run([mv({}), busy]).results[0].opportunity.operational_hold_reasons.includes(REASON.VEHICLE_CONFLICT));
  const unknownEnd = { ...busy, duration_minutes: null };
  assert.ok(run([mv({}), unknownEnd]).results[0].opportunity.operational_hold_reasons.includes(REASON.VEHICLE_CONFLICT));
  const later = { ...busy, pickup_local: '2026-09-22T20:00' };
  assert.deepEqual(run([mv({}), later]).results[0].opportunity.operational_hold_reasons, []);
});

test('non-exact reverse routes are reported as geography-unverified, never matched via placeholder geography', () => {
  const r = run([mv({}), rev({ pickup_zone: 'Coral Coast' })]);
  const x = r.rejected.find((y) => y.reasons.includes(REASON.NOT_EXACT_REVERSE));
  assert.ok(x.reasons.includes(REASON.NOT_EVALUATED_GEOGRAPHY_UNVERIFIED));
  assert.equal(r.results[0].chains.length, 0);
});

test('movements outside the seven-day window are not evaluated', () => {
  const r = run([mv({ pickup_local: '2026-09-29T09:00' }), mv({ pickup_local: '2026-09-21T23:59' })]);
  assert.equal(r.counts.verified_in_window, 0);
});

test('report is shadow-only and carries no customer identifiers', () => {
  const r = run([mv({}), rev({})]);
  assert.equal(r.shadow_only, true);
  const text = JSON.stringify(r);
  assert.doesNotMatch(text, /"(name|phone|email|guest|notes|flight)/i);
});
