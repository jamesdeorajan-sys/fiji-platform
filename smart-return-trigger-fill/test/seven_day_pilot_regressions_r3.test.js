/* Regression tests for the two remaining cases from Codex's review of 344d407 (Issue #54):
 *  1. the SOURCE arrival must itself be validated (own interval, turnaround, contradictory job records) - attestation never overrides job records;
 *  2. invalid loads / capacity limits must HOLD with a reason.
 * Written BEFORE the fixes: on 344d407 the negative cases below FAIL. Synthetic, opaque-ref fixtures only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSevenDayPilot, REASON } from '../scripts/seven_day_pilot.js';

const CONF = { source: 'ops_worksheet', confirmed_by: 'ops:dispatcher-1', confirmed_at: '2026-09-20T05:00:00Z', evidence_ref: 'sheet-row-1' };
const FULL = () => ({
  airport_zone: 'Nadi Airport',
  turnaround_minutes: 45,
  vehicle_capacity_confirmed: true,
  vehicle_capacity: { sedan: { pax: 3, bags: 3 } },
  route_durations_verified: { 'Denarau|Nadi Airport': 30 },
  vehicle_availability_attested: { veh_A: { from: '2026-09-23T00:00', to: '2026-09-26T00:00' } },
  route_price_truth: { 'Denarau|Nadi Airport|sedan': { operator_payout_fjd: 20, additional_cost_fjd: 5, absolute_floor_fjd: 30, smart_match_price_fjd: 40, fare_authority_approved: true } },
  contribution_requirement: { approved: true, min_fjd: 10, approved_by: 'james', approved_on: '2026-09-21' },
});
let n = 0;
const arrival = (o = {}) => ({ movement_ref: `a_${++n}`, leg: 'arrival', pickup_zone: 'Nadi Airport', dropoff_zone: 'Denarau', pickup_local: '2026-09-24T09:00', vehicle_class: 'sedan', passengers: 2, luggage: 2, duration_minutes: 60, assigned_vehicle_ref: 'veh_A', confirmation: CONF, ...o });
const sold = (o = {}) => ({ movement_ref: `s_${++n}`, leg: 'departure', pickup_zone: 'Denarau', dropoff_zone: 'Nadi Airport', pickup_local: '2026-09-24T14:00', vehicle_class: 'sedan', passengers: 2, luggage: 2, duration_minutes: 30, assigned_vehicle_ref: null, confirmation: CONF, ...o });
const job = (o = {}) => ({ movement_ref: `j_${++n}`, leg: 'departure', pickup_zone: 'Momi Bay', dropoff_zone: 'Nadi Airport', pickup_local: '2026-09-24T09:15', vehicle_class: 'sedan', passengers: 2, luggage: 1, duration_minutes: 30, assigned_vehicle_ref: 'veh_A', confirmation: CONF, ...o });
const run = (movements, config = FULL()) => runSevenDayPilot({ config, movements }, { startDate: '2026-09-24' });
const A = (r) => r.results.find((x) => x.movement_ref.startsWith('a_'));
const opp = (r) => A(r).opportunity;

test('control: fully specified inputs with no contradictions reach READY_FOR_DISPATCH_REVIEW', () => {
  assert.equal(opp(run([arrival()])).stage, 'READY_FOR_DISPATCH_REVIEW');
});

// ---- 1. source arrival validation
test("Codex case: another job on the SAME vehicle overlapping the source arrival (09:15 during 09:00-10:00) is a source-job conflict, not READY", () => {
  const r = run([arrival(), job()]);
  const o = opp(r);
  assert.equal(o.stage, 'HYPOTHETICAL_HOLD');
  assert.ok(o.operational_hold_reasons.includes(REASON.SOURCE_JOB_CONFLICT));
  assert.equal(o.price_fjd, null);
  assert.equal(r.counts.ready_for_dispatch_review, 0);
});

test('an availability attestation never overrides contradictory job records', () => {
  const cfg = FULL();   // attestation covers the whole period and the jobs still contradict each other
  assert.ok(cfg.vehicle_availability_attested.veh_A);
  assert.ok(opp(run([arrival(), job()], cfg)).operational_hold_reasons.includes(REASON.SOURCE_JOB_CONFLICT));
});

test('a sold reverse booking is not a chain while the source arrival itself conflicts', () => {
  const r = run([arrival(), sold(), job()]);
  assert.equal(A(r).chains.length, 0);
  assert.ok(r.rejected.some((x) => x.reasons.includes(REASON.SOURCE_JOB_CONFLICT)));
});

test('turnaround applies BEFORE the source arrival: a job ending 30 min earlier (turnaround 45) conflicts; one ending 60 min earlier does not', () => {
  const tooClose = job({ pickup_zone: 'Coral Coast', dropoff_zone: 'Nadi Airport', pickup_local: '2026-09-24T07:30', duration_minutes: 60 });   // ends 08:30, A starts 09:00
  assert.ok(opp(run([arrival(), tooClose])).operational_hold_reasons.includes(REASON.SOURCE_JOB_CONFLICT));
  const ok = job({ pickup_zone: 'Coral Coast', dropoff_zone: 'Nadi Airport', pickup_local: '2026-09-24T07:00', duration_minutes: 60 });          // ends 08:00
  assert.equal(opp(run([arrival(), ok])).stage, 'READY_FOR_DISPATCH_REVIEW');
});

test('turnaround applies AFTER the empty leg: a job starting 10 min after the leg ends conflicts; 60 min after does not', () => {
  // A 09:00-10:00, earliest empty-leg start 10:45, leg 30 min -> ends 11:15
  const near = job({ pickup_zone: 'Nadi Airport', dropoff_zone: 'Coral Coast', pickup_local: '2026-09-24T11:25', duration_minutes: 30 });
  assert.ok(opp(run([arrival(), near])).operational_hold_reasons.includes(REASON.VEHICLE_CONFLICT));
  const far = job({ pickup_zone: 'Nadi Airport', dropoff_zone: 'Coral Coast', pickup_local: '2026-09-24T12:15', duration_minutes: 30 });
  assert.equal(opp(run([arrival(), far])).stage, 'READY_FOR_DISPATCH_REVIEW');
});

test('an intervening commitment between the source arrival and the proposed return blocks both the chain and the empty leg', () => {
  const mid = job({ pickup_zone: 'Nadi Airport', dropoff_zone: 'Coral Coast', pickup_local: '2026-09-24T13:00', duration_minutes: 90 });   // 13:00-14:30 overlaps sold 14:00-14:30
  const r = run([arrival(), sold(), mid]);
  assert.equal(A(r).chains.length, 0);
  assert.ok(r.rejected.some((x) => x.reasons.includes(REASON.VEHICLE_CONFLICT)));
});

test('a source job with unknown duration cannot be ruled out: an overlapping start still conflicts', () => {
  const unknownEnd = job({ duration_minutes: null });     // starts 09:15 inside the source arrival
  assert.ok(opp(run([arrival(), unknownEnd], { ...FULL(), route_durations_verified: { 'Denarau|Nadi Airport': 30 } })).operational_hold_reasons.includes(REASON.SOURCE_JOB_CONFLICT));
});

// ---- 2. invalid loads and capacity limits
const BAD_LOADS = [
  { passengers: -1, luggage: -1 }, { passengers: 0, luggage: 0 }, { passengers: 2.5, luggage: 1 }, { passengers: 2, luggage: 1.5 },
  { passengers: NaN, luggage: 1 }, { passengers: 2, luggage: Infinity }, { passengers: '2', luggage: 1 }, { passengers: 2, luggage: '1' }, { passengers: 2, luggage: -1 },
];

test('Codex case: a sold reverse movement with invalid passengers/luggage is never a chain; it is rejected INVALID_LOAD', () => {
  for (const bad of BAD_LOADS) {
    const r = run([arrival(), sold(bad)]);
    assert.equal(A(r).chains.length, 0, JSON.stringify(bad));
    assert.ok(r.rejected.some((x) => x.reasons.includes(REASON.INVALID_LOAD)), JSON.stringify(bad));
  }
});

test('valid boundary loads are accepted: 1 passenger / 0 bags, and exactly the capacity limit', () => {
  assert.equal(A(run([arrival(), sold({ passengers: 1, luggage: 0 })])).chains.length, 1);
  assert.equal(A(run([arrival(), sold({ passengers: 3, luggage: 3 })])).chains.length, 1);
  assert.ok(run([arrival(), sold({ passengers: 4, luggage: 0 })]).rejected.some((x) => x.reasons.includes(REASON.CAPACITY_EXCEEDED)));
});

test('missing (null) loads stay CAPACITY_UNKNOWN, distinct from invalid', () => {
  const r = run([arrival(), sold({ passengers: null, luggage: null })]);
  assert.ok(r.rejected.some((x) => x.reasons.includes(REASON.CAPACITY_UNKNOWN)));
  assert.ok(!r.rejected.some((x) => x.reasons.includes(REASON.INVALID_LOAD)));
});

test('an invalid load on the source arrival holds the opportunity; an over-capacity source load is a contradiction', () => {
  assert.ok(opp(run([arrival({ passengers: -1, luggage: -1 })])).operational_hold_reasons.includes(REASON.INVALID_LOAD));
  assert.ok(opp(run([arrival({ passengers: 6, luggage: 1 })])).operational_hold_reasons.includes(REASON.CAPACITY_EXCEEDED));
});

test('invalid capacity limits hold with INVALID_CAPACITY_LIMIT and suppress price', () => {
  for (const cap of [{ pax: -1, bags: 3 }, { pax: 0, bags: 3 }, { pax: 2.5, bags: 3 }, { pax: NaN, bags: 3 }, { pax: '3', bags: 3 }, { pax: 3, bags: -1 }, { pax: 3, bags: 1.5 }, { pax: 3, bags: NaN }]) {
    const cfg = FULL(); cfg.vehicle_capacity = { sedan: cap };
    const o = opp(run([arrival()], cfg));
    assert.ok(o.operational_hold_reasons.includes(REASON.INVALID_CAPACITY_LIMIT), JSON.stringify(cap));
    assert.equal(o.price_fjd, null);
    assert.notEqual(o.stage, 'READY_FOR_DISPATCH_REVIEW');
  }
  const zeroBags = FULL(); zeroBags.vehicle_capacity = { sedan: { pax: 3, bags: 0 } };
  assert.equal(opp(run([arrival({ luggage: 0 })], zeroBags)).stage, 'READY_FOR_DISPATCH_REVIEW');   // 0 bags is a valid limit
});
