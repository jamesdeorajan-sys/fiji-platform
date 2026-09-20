/* Regression tests for the gaps found in Codex's independent review of 441c000 (Issue #54).
 * Written BEFORE the fixes: on 441c000 the negative cases below FAIL (they are the reproduction).
 * Synthetic, opaque-ref fixtures only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSevenDayPilot, REASON } from '../scripts/seven_day_pilot.js';

const CONF = { source: 'ops_worksheet', confirmed_by: 'ops:dispatcher-1', confirmed_at: '2026-09-20T05:00:00Z', evidence_ref: 'sheet-row-1' };
const FULL = () => ({
  airport_zone: 'Nadi Airport',
  turnaround_minutes: 45,
  vehicle_capacity_confirmed: true,
  vehicle_capacity: { sedan: { pax: 3, bags: 3 } },
  route_durations_verified: { 'Denarau|Nadi Airport': 80 },
  vehicle_availability_attested: { veh_A: { from: '2026-09-20T00:00', to: '2026-09-30T00:00' } },
  route_price_truth: { 'Denarau|Nadi Airport|sedan': { operator_payout_fjd: 20, additional_cost_fjd: 5, absolute_floor_fjd: 30, smart_match_price_fjd: 40, fare_authority_approved: true } },
  contribution_requirement: { approved: true, min_fjd: 10, approved_by: 'james', approved_on: '2026-09-21' },
});
let n = 0;
const arrival = (o = {}) => ({ movement_ref: `a_${++n}`, leg: 'arrival', pickup_zone: 'Nadi Airport', dropoff_zone: 'Denarau', pickup_local: '2026-09-22T09:00', vehicle_class: 'sedan', passengers: 2, luggage: 2, duration_minutes: 90, assigned_vehicle_ref: 'veh_A', confirmation: CONF, ...o });
const sold = (o = {}) => ({ movement_ref: `s_${++n}`, leg: 'departure', pickup_zone: 'Denarau', dropoff_zone: 'Nadi Airport', pickup_local: '2026-09-22T14:00', vehicle_class: 'sedan', passengers: 2, luggage: 2, duration_minutes: 80, assigned_vehicle_ref: null, confirmation: CONF, ...o });
const other = (o = {}) => ({ movement_ref: `o_${++n}`, leg: 'arrival', pickup_zone: 'Nadi Airport', dropoff_zone: 'Coral Coast', pickup_local: '2026-09-22T14:30', vehicle_class: 'sedan', passengers: 2, luggage: 2, duration_minutes: 120, assigned_vehicle_ref: 'veh_A', confirmation: CONF, ...o });
const run = (movements, config = FULL()) => runSevenDayPilot({ config, movements }, { startDate: '2026-09-22' });
const opp = (r) => r.results[0].opportunity;

test('baseline: with every input present and safe, the leg is READY_FOR_DISPATCH_REVIEW (and still not an offer)', () => {
  const o = opp(run([arrival()]));
  assert.equal(o.operational, 'FEASIBLE');
  assert.equal(o.commercial, 'READY');
  assert.equal(o.stage, 'READY_FOR_DISPATCH_REVIEW');
  assert.equal(o.contribution_fjd, 15);    // 40 - (20 + 5)
});

// ---- Codex finding 1: capacity, reverse duration, availability
test('vehicle_capacity_confirmed=false -> operational HOLD CAPACITY_UNKNOWN, never FEASIBLE', () => {
  const o = opp(run([arrival()], { ...FULL(), vehicle_capacity_confirmed: false }));
  assert.equal(o.operational, 'HOLD');
  assert.ok(o.operational_hold_reasons.includes(REASON.CAPACITY_UNKNOWN));
  assert.equal(o.price_fjd, null);
});

test('no ops-verified reverse duration -> HOLD REVERSE_DURATION_UNKNOWN (the outbound duration is not silently reused)', () => {
  const cfg = FULL(); delete cfg.route_durations_verified;
  const r = run([arrival()], cfg);
  assert.ok(opp(r).operational_hold_reasons.includes(REASON.REVERSE_DURATION_UNKNOWN));
  assert.notEqual(r.results[0].predicted_empty_leg.duration_basis, 'ASSUMED_EQUAL_TO_OUTBOUND_UNVERIFIED');
  assert.equal(opp(r).operational, 'HOLD');
});

test('vehicle availability must be attested for the whole empty-leg window, otherwise HOLD AVAILABILITY_UNATTESTED', () => {
  const none = FULL(); delete none.vehicle_availability_attested;
  assert.ok(opp(run([arrival()], none)).operational_hold_reasons.includes(REASON.AVAILABILITY_UNATTESTED));
  const short = FULL(); short.vehicle_availability_attested = { veh_A: { from: '2026-09-22T00:00', to: '2026-09-22T10:00' } };
  assert.ok(opp(run([arrival()], short)).operational_hold_reasons.includes(REASON.AVAILABILITY_UNATTESTED));
});

// ---- Codex finding 3: chains must pass the same checks as opportunities
test('a sold return with unknown duration is NOT accepted as a chain', () => {
  const r = run([arrival(), sold({ duration_minutes: null })], { ...FULL(), route_durations_verified: {} });
  assert.equal(r.results[0].chains.length, 0);
  assert.ok(r.rejected.some((x) => x.reasons.includes(REASON.SOLD_RETURN_DURATION_UNKNOWN)));
});

test('a sold return whose full interval overlaps another commitment of the same vehicle is rejected VEHICLE_CONFLICT (duration null or not)', () => {
  // other job 14:30-16:30 on veh_A overlaps the return 14:00-15:20
  const r = run([arrival(), sold({}), other()]);
  assert.equal(r.results.find((x) => x.movement_ref.startsWith('a_')).chains.length, 0);
  assert.ok(r.rejected.some((x) => x.reasons.includes(REASON.VEHICLE_CONFLICT)));
  const r2 = run([arrival(), sold({ duration_minutes: null }), other()]);
  assert.equal(r2.results.find((x) => x.movement_ref.startsWith('a_')).chains.length, 0);
});

test('a same-vehicle commitment that starts BEFORE the reporting window but is still running blocks the leg', () => {
  const early = other({ pickup_local: '2026-09-21T23:30', duration_minutes: 900 });   // 23:30 -> 14:30 next day, straddles the window start
  const o = opp(run([arrival({ pickup_local: '2026-09-22T09:00' }), early]));
  assert.ok(o.operational_hold_reasons.includes(REASON.VEHICLE_CONFLICT));
});

test('a commitment AFTER the window end also blocks a leg whose interval reaches it', () => {
  const a = arrival({ pickup_local: '2026-09-28T22:00', duration_minutes: 90 });
  const late = other({ pickup_local: '2026-09-29T00:30', duration_minutes: 60 });    // starts after window end (29th 00:00 Fiji)
  const cfg = FULL(); cfg.vehicle_availability_attested.veh_A.to = '2026-09-30T00:00';
  const o = opp(run([a, late], cfg));
  assert.ok(o.operational_hold_reasons.includes(REASON.VEHICLE_CONFLICT));
});

test('an unverified movement naming the same vehicle still counts as a possible conflict (never ignored)', () => {
  const o = opp(run([arrival(), other({ confirmation: null, pickup_local: '2026-09-22T11:30' })]));   // inside the 11:15-12:35 empty-leg window
  assert.ok(o.operational_hold_reasons.includes(REASON.VEHICLE_CONFLICT));
});

// ---- Codex finding 4: confirmation contract
test('malformed or incomplete confirmation records are rejected with a reason and never evaluated', () => {
  const bad = [
    { ...CONF, confirmed_at: '' },
    { ...CONF, confirmed_at: 'WHATIF' },
    { ...CONF, confirmed_at: '2026-09-20' },           // no time/zone
    { ...CONF, confirmed_by: '' },
    { ...CONF, confirmed_by: '   ' },
    { ...CONF, confirmed_by: undefined },
    { ...CONF, evidence_ref: ' ' },
    { ...CONF, source: 'guess' },
    { source: 'system_accepted', confirmed_by: 'someone', confirmed_at: CONF.confirmed_at, evidence_ref: 'ev' },  // system source needs admin|driver:<id>
    null,
  ];
  const r = run(bad.map((c) => arrival({ confirmation: c })));
  assert.equal(r.counts.verified_movements, 0);
  assert.equal(r.counts.not_verified_excluded, bad.length);
  assert.ok(Object.keys(r.not_verified_reason_counts).length >= 5);
});

test('a well-formed system_accepted confirmation (admin / driver:<id>) is accepted', () => {
  const r = run([arrival({ confirmation: { source: 'system_accepted', confirmed_by: 'driver:77', confirmed_at: '2026-09-20T05:00:00+12:00', evidence_ref: 'event-9' } })]);
  assert.equal(r.counts.verified_movements, 1);
});

test('the report never carries the confirmer identity', () => {
  assert.doesNotMatch(JSON.stringify(run([arrival()])), /dispatcher-1|confirmed_by/);
});

// ---- Codex finding 2: economics
test('approved fare flag with price 30, floor 20, payout 40 is NOT ready: floor below known cost / negative contribution', () => {
  const cfg = FULL(); cfg.route_price_truth['Denarau|Nadi Airport|sedan'] = { operator_payout_fjd: 40, additional_cost_fjd: 0, absolute_floor_fjd: 20, smart_match_price_fjd: 30, fare_authority_approved: true };
  const o = opp(run([arrival()], cfg));
  assert.equal(o.commercial, 'HOLD');
  assert.equal(o.commercial_reason, REASON.FLOOR_BELOW_KNOWN_COST);
  assert.equal(o.price_fjd, null);
  assert.equal(o.contribution_fjd, null);
});

test('price above a sound floor but contribution negative or below the APPROVED requirement is HOLD', () => {
  const t = (extra) => { const c = FULL(); c.route_price_truth['Denarau|Nadi Airport|sedan'] = { ...c.route_price_truth['Denarau|Nadi Airport|sedan'], ...extra }; return c; };
  assert.equal(opp(run([arrival()], t({ smart_match_price_fjd: 26, absolute_floor_fjd: 26 }))).commercial_reason, REASON.BELOW_APPROVED_CONTRIBUTION);   // contribution 1 < 10
  assert.equal(opp(run([arrival()], t({ smart_match_price_fjd: 30, absolute_floor_fjd: 30 }))).commercial_reason, REASON.BELOW_APPROVED_CONTRIBUTION);   // contribution 5 < 10
  // a price below known cost cannot pass either: the floor (which prices are clamped to) must itself cover cost
  assert.equal(opp(run([arrival()], t({ smart_match_price_fjd: 22, absolute_floor_fjd: 22 }))).commercial_reason, REASON.FLOOR_BELOW_KNOWN_COST);   // 22 < 20 + 5
});

test('additional costs unknown, or no approved contribution requirement, is HOLD — no margin threshold is invented', () => {
  const noCost = FULL(); delete noCost.route_price_truth['Denarau|Nadi Airport|sedan'].additional_cost_fjd;
  assert.equal(opp(run([arrival()], noCost)).commercial_reason, REASON.ADDITIONAL_COST_UNKNOWN);
  const noReq = FULL(); delete noReq.contribution_requirement;
  assert.equal(opp(run([arrival()], noReq)).commercial_reason, REASON.CONTRIBUTION_REQUIREMENT_NOT_APPROVED);
  const unapproved = FULL(); unapproved.contribution_requirement.approved = false;
  assert.equal(opp(run([arrival()], unapproved)).commercial_reason, REASON.CONTRIBUTION_REQUIREMENT_NOT_APPROVED);
  const noApprover = FULL(); noApprover.contribution_requirement.approved_by = '';
  assert.equal(opp(run([arrival()], noApprover)).commercial_reason, REASON.CONTRIBUTION_REQUIREMENT_NOT_APPROVED);
});

test('invalid commercial inputs (NaN, negative, string, Infinity) are HOLD INVALID_COMMERCIAL_INPUT', () => {
  for (const bad of [{ operator_payout_fjd: NaN }, { operator_payout_fjd: -5 }, { smart_match_price_fjd: '40' }, { absolute_floor_fjd: Infinity }, { additional_cost_fjd: -1 }]) {
    const c = FULL(); c.route_price_truth['Denarau|Nadi Airport|sedan'] = { ...c.route_price_truth['Denarau|Nadi Airport|sedan'], ...bad };
    const o = opp(run([arrival()], c));
    assert.equal(o.commercial, 'HOLD', JSON.stringify(bad));
    assert.equal(o.price_fjd, null);
  }
});

// ---- hypothetical vs feasible vs sellable
test('predicted empty legs are labelled HYPOTHETICAL; only fully-gated legs reach READY_FOR_DISPATCH_REVIEW; counts keep them apart', () => {
  const r = run([arrival(), arrival({ movement_ref: 'a_noveh', assigned_vehicle_ref: null, pickup_local: '2026-09-23T09:00' })]);
  assert.equal(r.results.every((x) => x.predicted_empty_leg.status === 'HYPOTHETICAL'), true);
  assert.equal(r.counts.hypothetical_empty_legs, 2);
  assert.equal(r.counts.operationally_feasible, 1);
  assert.equal(r.counts.ready_for_dispatch_review, 1);
  assert.match(r.interpretation, /not evidence of zero (commercial )?demand/i);
});

test('missing inputs yield HOLD stage and an input_gaps list, and the report says zero feasible is not zero demand', () => {
  const r = run([arrival()], { airport_zone: 'Nadi Airport' });
  assert.equal(opp(r).stage, 'HYPOTHETICAL_HOLD');
  assert.ok(r.input_gaps.length > 0);
  assert.match(r.interpretation, /zero feasible/i);
});
