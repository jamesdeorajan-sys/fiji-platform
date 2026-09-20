/* Booking-led planning stage. Synthetic rows only (opaque ids, invented hotel names); no customer data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReturnLocation, buildLegs, buildPairings, buildPlan, LOCATION_STATUS, DECISION } from '../src/booking_led_plan.js';

const DEST = [
  { name: 'Hotel Alpha', zone: 'Denarau' }, { name: 'Hotel Beta', zone: 'Coral Coast' }, { name: 'Twin Name', zone: 'Denarau' }, { name: 'Twin Name', zone: 'Momi Bay' },
];
const CTX = { destinations: DEST, zoneDistanceCache: [{ zone_a: 'Denarau', zone_b: 'Nadi Airport', distance_km: 11.8, created_at: '2026-07-26 10:10:31' }], windowStart: '2026-09-24', windowEnd: '2026-09-30' };
let n = 100;
const row = (o = {}) => ({ id: ++n, store: 'FTT', status: 'pending', pickup_date: '2026-09-24', pickup_time: '09:00', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_class: 'sedan', distance_km: 11.8,
  return_date: null, return_time: null, return_pickup_location: null, passengers: 2, luggage: 2, assigned_driver_id: null, assigned_vehicle_ref: null, provider_alert_accepted: true, flight_present: true, flags: {}, ...o });
const withReturn = (o = {}) => row({ return_date: '2026-09-24', return_time: '15:00', return_pickup_location: 'Hotel Alpha', ...o });

test('return location: exact existing-mapping match resolves (case/space-insensitive) and preserves the original text', () => {
  const r = normalizeReturnLocation('  hotel   ALPHA ', DEST);
  assert.equal(r.zone, 'Denarau');
  assert.equal(r.status, LOCATION_STATUS.RESOLVED_VIA_PLATFORM_MAPPING);
  assert.equal(r.original, '  hotel   ALPHA ');
  assert.match(r.mapping_source, /not independently verified/);
});

test('return location: no match, ambiguous and missing stay UNRESOLVED and never become the outbound destination', () => {
  assert.equal(normalizeReturnLocation('Somewhere Else', DEST).status, LOCATION_STATUS.UNRESOLVED_NO_MATCH);
  assert.equal(normalizeReturnLocation('Twin Name', DEST).status, LOCATION_STATUS.UNRESOLVED_AMBIGUOUS);
  assert.equal(normalizeReturnLocation('', DEST).status, LOCATION_STATUS.UNRESOLVED_NO_LOCATION_RECORDED);
  const { legs } = buildLegs([row({ destination_zone: 'Denarau', return_date: '2026-09-24', return_time: '15:00', return_pickup_location: null })], CTX);
  const ret = legs.find((l) => l.kind === 'RETURN');
  assert.equal(ret.from_zone, null, 'must not silently substitute the outbound destination');
  assert.equal(ret.location.status, LOCATION_STATUS.UNRESOLVED_NO_LOCATION_RECORDED);
});

test('legs: arrivals plus ACTUALLY recorded return legs; a return in the window is expanded even if the arrival is outside it; outside-window legs are excluded', () => {
  const { legs } = buildLegs([withReturn(), row({ pickup_date: '2026-09-20', return_date: '2026-09-25', return_time: '10:00', return_pickup_location: 'Hotel Beta' }), row({ pickup_date: '2026-10-05' })], CTX);
  assert.deepEqual(legs.map((l) => l.kind), ['ARRIVAL', 'RETURN', 'RETURN']);
  assert.equal(legs[2].from_zone, 'Coral Coast');
});

test('a return leg without a recorded time is listed but cannot be paired (missing fact, not a guess)', () => {
  const { legs } = buildLegs([withReturn({ return_time: null }), row({ pickup_time: '08:00' })], CTX);
  const { pairings, skipped } = buildPairings(legs);
  assert.equal(pairings.length, 0);
  assert.equal(skipped.missing_time, 1);
});

test('pairing arrival -> return in the same exact zone: recorded gap, DURATION_UNKNOWN, timing NOT_DETERMINED, not feasible, not an offer', () => {
  const a = row({ pickup_time: '09:00' }); const b = row({ pickup_time: '11:00', destination_zone: 'Coral Coast', return_date: '2026-09-24', return_time: '15:00', return_pickup_location: 'Hotel Alpha' });
  const { pairings, legs } = buildPlan([a, b], CTX);
  const p = pairings.find((x) => x.type === 'SOLD_SEQUENCE_ARRIVAL_THEN_RETURN');
  assert.ok(p);
  assert.equal(p.zone, 'Denarau');
  assert.equal(p.facts.recorded_pickup_gap_minutes, 360);
  assert.equal(p.duration.status, 'DURATION_UNKNOWN');
  assert.match(p.timing_check_for_ops, /NOT_DETERMINED/);
  assert.equal(p.planning_status, 'PLANNING_CANDIDATE_NOT_VERIFIED');
  assert.equal(p.facts.guest_pickup_times_fixed, true);
  assert.doesNotMatch(JSON.stringify({ pairings, legs }), /FEASIBLE/);
  assert.match(p.note, /not an offer/i);
});

test('pairing return -> arrival is a distinct type (vehicle brings the returning guest to the airport, then takes the arriving guest out)', () => {
  const a = withReturn({ pickup_date: '2026-09-22', return_time: '09:00' });      // return leg 24 Sep 09:00 from Denarau
  const b = row({ pickup_time: '10:30' });                                        // arrival to Denarau 10:30
  const { pairings } = buildPlan([a, b], CTX);
  assert.equal(pairings.length, 1);
  assert.equal(pairings[0].type, 'SOLD_SEQUENCE_RETURN_THEN_ARRIVAL');
  assert.equal(pairings[0].facts.recorded_pickup_gap_minutes, 90);
});

test('unassigned pairings are NEEDS_DISPATCH_ALLOCATION; a missing vehicle never prevents listing the pairing', () => {
  const { pairings } = buildPlan([row({}), withReturn({ pickup_date: '2026-09-22' })], CTX);
  assert.equal(pairings[0].decision, DECISION.NEEDS_DISPATCH_ALLOCATION);
});

test('differing assignments are a REASSIGNMENT proposal for ops review, not a rejection; one assigned proposes allocating the other; same vehicle asks to confirm timing', () => {
  const mk = (va, vb) => buildPlan([row({ assigned_vehicle_ref: va }), withReturn({ pickup_date: '2026-09-22', assigned_vehicle_ref: vb })], CTX).pairings;
  const diff = mk('Van-A', 'Van-B');
  assert.equal(diff.length, 1);
  assert.equal(diff[0].decision, DECISION.REASSIGNMENT_PROPOSAL_FOR_OPS_REVIEW);
  assert.match(diff[0].reassignment_proposal, /Van-A.*Van-B/);
  assert.match(diff[0].reassignment_proposal, /guest times and booked class stay fixed/i);
  assert.equal(mk('Van-A', null)[0].decision, DECISION.PROPOSE_ALLOCATE_SECOND_TO_SAME_VEHICLE);
  assert.equal(mk('Van-A', 'Van-A')[0].decision, DECISION.SAME_VEHICLE_ALREADY_CONFIRM_TIMING);
});

test('guest service is fixed: different booked classes are not paired and the reason is counted', () => {
  const { pairings, skipped } = buildPlan([row({ vehicle_class: 'sedan' }), withReturn({ pickup_date: '2026-09-22', vehicle_class: 'minivan' })], CTX);
  assert.equal(pairings.length, 0);
  assert.equal(skipped.class_differs_guest_service_fixed, 1);
});

test('different zones on the same day are not paired (adjacency unverified) and are counted; unresolved return zones are counted separately', () => {
  const diffZone = buildPlan([row({ destination_zone: 'Coral Coast' }), withReturn({ pickup_date: '2026-09-22' })], CTX);
  assert.equal(diffZone.pairings.length, 0);
  assert.equal(diffZone.skipped.different_zone_same_day, 1);
  const unresolved = buildPlan([row({}), withReturn({ pickup_date: '2026-09-22', return_pickup_location: 'Unknown Lodge' })], CTX);
  assert.equal(unresolved.pairings.length, 0);
  assert.equal(unresolved.skipped.return_zone_unresolved, 1);
});

test('duration: only a traceable estimate (source + date + minutes) is shown, always provisional; timing conclusion stays NOT_DETERMINED', () => {
  const rows = [row({}), withReturn({ pickup_date: '2026-09-22' })];
  const est = { 'Nadi Airport|Denarau': { minutes: 30, source: 'ops note (example)', as_of: '2026-09-21' } };
  const p = buildPlan(rows, { ...CTX, routeDurationEstimates: est }).pairings[0];
  assert.equal(p.duration.status, 'PROVISIONAL_ESTIMATE');
  assert.equal(p.duration.provisional, true);
  assert.match(p.timing_check_for_ops, /PROVISIONAL.*NOT_DETERMINED/);
  const bad = buildPlan(rows, { ...CTX, routeDurationEstimates: { 'Nadi Airport|Denarau': { minutes: 30 } } }).pairings[0];
  assert.equal(bad.duration.status, 'DURATION_UNKNOWN', 'an untraceable number is not used');
});

test('test/duplicate uncertainty and guest-confirmation status are preserved and listed as missing facts', () => {
  const rows = [row({ flags: { test_uncertain: true } }), withReturn({ pickup_date: '2026-09-22', flags: { dup_trip: true }, provider_alert_accepted: false })];
  const { pairings, legs } = buildPlan(rows, CTX);
  assert.deepEqual(pairings[0].uncertainty_flags.sort(), ['POSSIBLE_DUPLICATE_TRIP_KEY', 'TEST_UNCERTAIN']);
  assert.ok(pairings[0].missing_inputs.some((m) => /resolve test\/duplicate uncertainty/.test(m)));
  assert.ok(pairings[0].missing_inputs.some((m) => /guest confirmation status/.test(m)));
  assert.ok(legs.every((l) => l.confirmation.status === 'SAVED_REQUEST_NOT_GUEST_CONFIRMED' && l.confirmation.guest_confirmation === 'UNKNOWN'));
  assert.equal(legs.find((l) => l.kind === 'RETURN').confirmation.provider_accepted_alert, 'NO_RECORD');
});

test('missing passengers/luggage are named per leg', () => {
  const { pairings } = buildPlan([row({ passengers: null, luggage: null }), withReturn({ pickup_date: '2026-09-22' })], CTX);
  assert.ok(pairings[0].missing_inputs.some((m) => /passengers\/luggage for L001/.test(m)));
});

test('unsold potential empty legs are separate from sold pairings and are not offers', () => {
  const { empties, pairings } = buildPlan([row({}), withReturn({ pickup_date: '2026-09-22', return_pickup_location: 'Hotel Beta' })], CTX);
  assert.equal(pairings.length, 0);
  assert.deepEqual(empties.map((e) => e.type).sort(), ['UNSOLD_POTENTIAL_EMPTY_POSITIONING_LEG', 'UNSOLD_POTENTIAL_EMPTY_RETURN_LEG']);
  assert.ok(empties.every((e) => /not an offer/i.test(e.note) || /cannot be assessed/i.test(e.note)));
});

test('competing candidates: a leg with two possible partners is counted, and pairings are not silently assigned', () => {
  const a = row({ pickup_time: '09:00' });
  const r1 = withReturn({ pickup_date: '2026-09-22', return_time: '13:00' }); const r2 = withReturn({ pickup_date: '2026-09-22', return_time: '16:00' });
  const { pairings, summary } = buildPlan([a, r1, r2], CTX);
  assert.equal(pairings.length, 2);
  assert.equal(summary.potential_pairings.legs_with_competing_candidates, 1);
});

test('the aggregate summary carries counts only: no ids, hotel names or individual times', () => {
  const { summary } = buildPlan([row({}), withReturn({ pickup_date: '2026-09-22' })], CTX);
  const text = JSON.stringify(summary);
  assert.doesNotMatch(text, /Hotel Alpha|\b10[1-9]\b|09:00|15:00/);
  assert.equal(summary.planning_only, true);
  assert.equal(summary.potential_pairings.timing_conclusion, 'NOT_DETERMINED for every pairing');
  assert.equal(summary.distance_available.arrival_from_bookings, 1);   // the second row arrives before the window; only its return leg is in scope
  assert.match(summary.statement, /Nothing here is operationally feasible/);
});

test('near-miss return text is only an UNVERIFIED suggestion: the location stays UNRESOLVED and any pairing is marked CONDITIONAL on ops confirming it', () => {
  const loc = normalizeReturnLocation('Hotel Alpha Fiji', DEST);
  assert.equal(loc.status, LOCATION_STATUS.UNRESOLVED_NO_MATCH);
  assert.equal(loc.zone, null);
  assert.equal(loc.suggestion.zone, 'Denarau');
  assert.equal(loc.suggestion.verified, false);
  const rows = [row({}), withReturn({ pickup_date: '2026-09-22', return_pickup_location: 'Hotel Alpha Fiji' })];
  const plan = buildPlan(rows, CTX);
  assert.equal(plan.pairings.length, 1);
  assert.equal(plan.pairings[0].conditional_on_location_confirmation, true);
  assert.equal(plan.pairings[0].planning_status, 'PLANNING_CANDIDATE_CONDITIONAL_ON_LOCATION_CONFIRMATION');
  assert.match(plan.pairings[0].missing_inputs[0], /CONFIRM return pickup location/);
  assert.equal(plan.summary.potential_pairings.confirmed_mapping, 0);
  assert.equal(plan.summary.potential_pairings.conditional_on_location_confirmation, 1);
  // with conditional pairings switched off nothing is built from a suggestion
  assert.equal(buildPlan(rows, { ...CTX, conditional: false }).pairings.length, 0);
});

test('an ambiguous suggestion (two zones) or no containment gives no suggestion at all', () => {
  assert.equal(normalizeReturnLocation('Twin Name Lodge', DEST).suggestion, null);
  assert.equal(normalizeReturnLocation('Unknown Lodge', DEST).suggestion, null);
});

test('SCENARIO (explicit opt-in only): an unresolved return pickup may be assumed to equal the same booking\'s outbound zone, clearly flagged as scenario-only; the default plan never does this', () => {
  const rows = [row({}), withReturn({ pickup_date: '2026-09-22', return_pickup_location: 'Unknown Lodge' })];   // outbound zone Denarau
  assert.equal(buildPlan(rows, CTX).pairings.length, 0, 'default: no silent substitution');
  const sc = buildPlan(rows, { ...CTX, scenarioOutbound: true });
  assert.equal(sc.pairings.length, 1);
  assert.equal(sc.pairings[0].scenario_only_outbound_zone_assumed, true);
  assert.match(sc.pairings[0].planning_status, /^SCENARIO_ONLY/);
  assert.match(sc.pairings[0].missing_inputs[0], /SCENARIO ONLY/);
  assert.equal(sc.summary.potential_pairings.confirmed_mapping, 0);
  assert.equal(sc.summary.potential_pairings.scenario_only_outbound_zone_assumed, 1);
});

test('a booking is never paired with its own legs (same guest round trip is not a vehicle pairing)', () => {
  const own = row({ return_date: '2026-09-24', return_time: '15:00', return_pickup_location: 'Hotel Alpha' });
  assert.equal(buildPlan([own], CTX).pairings.length, 0);
});
