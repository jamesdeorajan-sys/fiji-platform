/* Booking-led planning, revision 2: language, return-location evidence categories, ops corrections, competing alternatives.
 * Synthetic rows only (invented hotel names); no customer data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReturnLocation, buildPlan, LOCATION_STATUS } from '../src/booking_led_plan.js';

const DEST = [{ name: 'Hotel Alpha', zone: 'Denarau' }, { name: 'Hotel Beta', zone: 'Coral Coast' }];
const CTX = { destinations: DEST, zoneDistanceCache: [], windowStart: '2026-09-24', windowEnd: '2026-09-30' };
const HOTEL_OPTS = [
  { name: 'The Naviti Resort Korolevu', zone: 'Coral Coast', source: 'storefront hotel option (data-hotel -> data-area)' },
  { name: 'The Warwick Fiji', zone: 'Coral Coast', source: 'storefront hotel option (data-hotel -> data-area)' },
  { name: 'InterContinental Fiji Golf Resort & Spa Denarau', zone: 'Denarau', source: 'storefront hotel option (data-hotel -> data-area)' },
  { name: 'InterContinental Fiji Golf Resort & Spa Natadola', zone: 'Natadola', source: 'storefront hotel option (data-hotel -> data-area)' },
];
let n = 700;
const row = (o = {}) => ({ id: ++n, store: 'FTT', status: 'pending', pickup_date: '2026-09-24', pickup_time: '09:00', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_class: 'sedan', distance_km: 11.8,
  return_date: null, return_time: null, return_pickup_location: null, passengers: 2, luggage: 2, assigned_driver_id: null, assigned_vehicle_ref: null, provider_alert_accepted: true, flight_present: true, flags: {}, ...o });
const withReturn = (o = {}) => row({ return_date: '2026-09-24', return_time: '15:00', return_pickup_location: 'Hotel Alpha', ...o });

test('return-location classification separates missing text, exact storefront-option match, naming variant, ambiguous and unknown - each with its evidence', () => {
  const c = (t) => classifyReturnLocation(t, DEST, HOTEL_OPTS);
  assert.equal(c('').category, 'MISSING_TEXT');
  const exact = c('the naviti resort  Korolevu');
  assert.equal(exact.category, 'EXACT_STOREFRONT_HOTEL_OPTION');
  assert.equal(exact.suggestion.zone, 'Coral Coast');
  assert.equal(exact.evidence[0].source, 'storefront hotel option (data-hotel -> data-area)');
  const variant = c('Naviti Resort');
  assert.equal(variant.category, 'NAMING_VARIANT');
  assert.equal(variant.suggestion.zone, 'Coral Coast');
  assert.equal(c('InterContinental Fiji').category, 'AMBIGUOUS');
  assert.equal(c('InterContinental Fiji').suggestion, null);
  assert.equal(c('Mystery Guesthouse').category, 'UNKNOWN_PLACE');
});

test('an exact storefront-option match is still only a SUGGESTION: the leg stays unresolved and its pairing is conditional until ops confirm', () => {
  const ctx = { ...CTX, hotelOptions: HOTEL_OPTS };
  const rows = [row({ destination_zone: 'Coral Coast' }), row({ pickup_date: '2026-09-22', destination_zone: 'Coral Coast', return_date: '2026-09-24', return_time: '15:00', return_pickup_location: 'The Warwick Fiji' })];
  const plan = buildPlan(rows, ctx);
  const ret = plan.legs.find((l) => l.kind === 'RETURN');
  assert.equal(ret.location.status, LOCATION_STATUS.UNRESOLVED_NO_MATCH);
  assert.equal(ret.from_zone, null);
  assert.equal(ret.location.category, 'EXACT_STOREFRONT_HOTEL_OPTION');
  assert.equal(plan.pairings[0].conditional_on_location_confirmation, true);
  assert.equal(plan.summary.return_location_match_category.EXACT_STOREFRONT_HOTEL_OPTION, 1);
});

test('an explicit ops confirmation resolves the return zone (recorded text preserved); incomplete or unknown-zone corrections are rejected', () => {
  const rows = [row({ destination_zone: 'Coral Coast' }), row({ id: 555, pickup_date: '2026-09-22', destination_zone: 'Coral Coast', return_date: '2026-09-24', return_time: '15:00', return_pickup_location: 'Somewhere Odd' })];
  const good = buildPlan(rows, { ...CTX, knownZones: ['Coral Coast', 'Denarau'], locationCorrections: { 555: { zone: 'Coral Coast', confirmed_by: 'ops:x', evidence_ref: 'sheet-1' } } });
  const ret = good.legs.find((l) => l.kind === 'RETURN');
  assert.equal(ret.location.status, LOCATION_STATUS.RESOLVED_VIA_OPS_CONFIRMATION);
  assert.equal(ret.from_zone, 'Coral Coast');
  assert.equal(ret.location.original, 'Somewhere Odd');
  assert.equal(good.pairings.length, 1);
  assert.equal(good.pairings[0].conditional_on_location_confirmation, false);
  for (const bad of [{ zone: 'Coral Coast', confirmed_by: '', evidence_ref: 'e' }, { zone: 'Coral Coast', confirmed_by: 'ops', evidence_ref: '' }, { zone: 'Atlantis', confirmed_by: 'ops', evidence_ref: 'e' }]) {
    const p = buildPlan(rows, { ...CTX, knownZones: ['Coral Coast'], locationCorrections: { 555: bad } });
    assert.equal(p.legs.find((l) => l.kind === 'RETURN').from_zone, null);
    assert.match(p.legs.find((l) => l.kind === 'RETURN').location.ops_correction_rejected, /OPS_CORRECTION_INVALID/);
  }
});

test('pairings are COMPETING ALTERNATIVES: grouped, never additive, never allocating; the at-once upper bound counts each leg once', () => {
  const a = row({ pickup_time: '09:00' });
  const r1 = withReturn({ pickup_date: '2026-09-22', return_time: '13:00' }); const r2 = withReturn({ pickup_date: '2026-09-22', return_time: '16:00' });
  const plan = buildPlan([a, r1, r2], CTX);
  assert.equal(plan.pairings.length, 2);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].alternatives, 2);
  assert.equal(plan.groups[0].max_selectable_at_once_upper_bound, 1);
  const alt = plan.summary.competing_alternatives;
  assert.match(alt.statement, /not additive bookings, not savings, not inventory/);
  assert.equal(alt.legs_allocated, 0);
  assert.ok(plan.pairings.every((p) => p.does_not_allocate === true && p.alternative_group === 'G01'));
  assert.ok(plan.legs.every((l) => l.allocation_status === 'UNALLOCATED'));
  assert.ok(plan.legs.every((l) => /^HAS_COMPETING_CANDIDATE_ALTERNATIVES_NOT_ALLOCATED$|^UNMATCHED_REQUEST_PROVISIONAL$/.test(l.provisional_status)));
});

test('disjoint alternatives form separate groups (each can be selected) but stay candidates, not allocations', () => {
  const rows = [row({ pickup_time: '09:00' }), withReturn({ pickup_date: '2026-09-22', return_time: '13:00' }),
    row({ pickup_time: '10:00', destination_zone: 'Coral Coast', vehicle_class: 'minivan' }), withReturn({ pickup_date: '2026-09-22', return_time: '14:00', destination_zone: 'Coral Coast', return_pickup_location: 'Hotel Beta', vehicle_class: 'minivan' })];
  const plan = buildPlan(rows, CTX);
  assert.equal(plan.groups.length, 2);
  assert.deepEqual(plan.summary.competing_alternatives.max_selectable_at_once_upper_bound_per_group, [1, 1]);
  assert.equal(plan.summary.competing_alternatives.legs_allocated, 0);
});

test('language: never "already-sold", "unsold", "SOLD_" or "empty leg" for saved requests whose guest confirmation is unknown', () => {
  const plan = buildPlan([row({}), withReturn({ pickup_date: '2026-09-22' }), row({ destination_zone: 'Coral Coast', pickup_time: '20:00' })], CTX);
  const text = JSON.stringify(plan);
  assert.doesNotMatch(text, /already-sold|unsold|UNSOLD|SOLD_|empty leg/i);
  assert.match(text, /SAVED_REQUEST_PAIRING_/);
  assert.match(text, /UNMATCHED_REQUEST/);
  assert.match(text, /HYPOTHETICAL_POSITIONING_NEED/);
});
