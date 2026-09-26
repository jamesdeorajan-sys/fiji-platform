/* Serving-source hotel -> zone mapping: geographic resolution only. Synthetic mapping (invented hotels); no customer data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveViaServingSource, buildPlan, LOCATION_STATUS } from '../src/booking_led_plan.js';

const RULE = { function: 'resolveFixedDestinationZone(destOpt)', app_js_line: 1167, logic: 'area in MARKETPLACE_ZONE_NAMES -> area; AREA_ZONE_ALIASES[area] -> zone; else NEEDS_LOOKUP',
  marketplace_zone_names: ['Denarau', 'Coral Coast', 'Natadola'], area_zone_aliases: { 'Port Denarau': 'Denarau' } };
const src = (storefront, opts, nameOnly = []) => ({ storefront, url: `https://${storefront}/`, index_sha256: 'a'.repeat(64), app_js_sha256: 'b'.repeat(64), zone_rule: RULE, options_with_area: opts, name_only_options: nameOnly });
const O = (value, hotel, area, lat = '1', lng = '2', label = hotel) => ({ value, hotel, area, label, lat, lng });
const MAPPING = () => ({ built_utc: '2026-09-21T00:00:00Z', history_check: { FTT: { production_deployments_checked: 3 } }, sources: {
  FTT: src('site-a.test', [O('ALPHA', 'Hotel Alpha', 'Coral Coast'), O('BETA', 'Hotel Beta', 'Denarau'), O('GAMMA', 'Hotel Gamma', 'Port Denarau'), O('DELTA1', 'Hotel Delta', 'Denarau'), O('DELTA2', 'Hotel Delta', 'Natadola'), O('EPS', 'Hotel Epsilon', 'Sabeto')], [{ value: 'P_ALPHA', label: 'Hotel Alpha', lat: '1', lng: '2' }, { value: 'P_BETA', label: 'Hotel Beta', lat: '9', lng: '9' }]),
  FD: src('site-b.test', [O('ALPHA', 'Hotel Alpha', 'Coral Coast'), O('BETA', 'Hotel Beta', 'Coral Coast')], []),
} });
const R = (text, store = 'FTT', dest = []) => resolveViaServingSource(text, store, MAPPING(), dest);

test('an explicit data-hotel -> data-area option resolves the zone, recording source, hashes, option, rule and history; the original text is not altered', () => {
  const r = R('hotel  ALPHA');
  assert.equal(r.resolved, true);
  assert.equal(r.zone, 'Coral Coast');
  assert.equal(r.mapping.data_area, 'Coral Coast');
  assert.deepEqual(r.mapping.option_values, ['ALPHA']);
  assert.equal(r.mapping.index_sha256.length, 64);
  assert.equal(r.mapping.app_js_sha256.length, 64);
  assert.match(r.mapping.zone_rule, /resolveFixedDestinationZone.*1167/);
  assert.equal(r.mapping.history_check.production_deployments_checked, 3);
  assert.match(r.mapping.limits, /does not confirm the guest/i);
  assert.deepEqual(r.mapping.name_only_duplicates_same_coordinates, ['P_ALPHA']);   // a name-only shortcut at the same coordinates is noted, not a conflict
});

test('exceptions stay UNRESOLVED: unknown name, several areas, conflicting name-only option, no 1:1 zone, other-storefront conflict, no serving source', () => {
  assert.equal(R('Hotel Unknown').exception, 'NAME_NOT_IN_SERVING_SOURCE_WITH_AREA');
  assert.equal(R('Hotel Delta').exception, 'CONFLICT_SEVERAL_AREAS_IN_SERVING_SOURCE');
  assert.equal(R('Hotel Beta').exception, 'CONFLICT_NAME_ONLY_OPTION_AT_DIFFERENT_COORDINATES');
  assert.match(R('Hotel Epsilon').exception, /AREA_HAS_NO_ONE_TO_ONE_ZONE/);
  const m = MAPPING(); m.sources.FTT.name_only_options = [];
  assert.equal(resolveViaServingSource('Hotel Beta', 'FTT', m, []).exception, 'CONFLICT_BETWEEN_STOREFRONT_SOURCES');   // FTT says Denarau, FD says Coral Coast
  assert.equal(R('Hotel Alpha', 'NOREF').exception, 'NO_SERVING_SOURCE_FOR_THIS_RECORD');
  assert.equal(R('').exception, 'MISSING_TEXT');
});

test('a documented alias area (Port Denarau) maps through the source\'s own zone rule', () => {
  assert.equal(R('Hotel Gamma').zone, 'Denarau');
});

test('a conflict with the platform destinations table leaves the zone unresolved', () => {
  assert.equal(R('Hotel Alpha', 'FTT', [{ name: 'Hotel Alpha', zone: 'Denarau' }]).exception, 'CONFLICT_WITH_PLATFORM_DESTINATIONS_TABLE');
});

test('agreement with the outbound zone is never used: a matching outbound zone does not resolve, a differing one does not block', () => {
  const rowsAgree = [{ id: 1, store: 'FTT', pickup_date: '2026-09-24', pickup_time: '09:00', pickup_zone: 'Nadi Airport', destination_zone: 'Coral Coast', vehicle_class: 'sedan', return_date: '2026-09-24', return_time: '15:00', return_pickup_location: 'Unlisted Hotel', flags: {} }];
  const p1 = buildPlan(rowsAgree, { windowStart: '2026-09-24', windowEnd: '2026-09-30', servingSourceMapping: MAPPING(), destinations: [] });
  assert.equal(p1.legs.find((l) => l.kind === 'RETURN').from_zone, null);            // outbound zone is Coral Coast, text unlisted -> stays unresolved
  const rowsDiffer = [{ ...rowsAgree[0], destination_zone: 'Denarau', return_pickup_location: 'Hotel Alpha' }];
  const p2 = buildPlan(rowsDiffer, { windowStart: '2026-09-24', windowEnd: '2026-09-30', servingSourceMapping: MAPPING(), destinations: [] });
  const ret = p2.legs.find((l) => l.kind === 'RETURN');
  assert.equal(ret.from_zone, 'Coral Coast');                                       // mapped from the option, even though the outbound zone differs
  assert.equal(ret.location.status, LOCATION_STATUS.RESOLVED_VIA_SERVING_SOURCE_MAPPING);
});

test('geographic resolution is kept separate from guest confirmation and the pickup arrangement; the resulting pairing is NOT operationally confirmed', () => {
  const base = { store: 'FTT', status: 'pending', pickup_zone: 'Nadi Airport', vehicle_class: 'minivan', distance_km: 50, passengers: 3, luggage: 3, flags: {}, provider_alert_accepted: true };
  const rows = [{ ...base, id: 1, pickup_date: '2026-09-24', pickup_time: '17:30', destination_zone: 'Coral Coast' },
    { ...base, id: 2, pickup_date: '2026-09-20', pickup_time: '10:00', destination_zone: 'Coral Coast', return_date: '2026-09-24', return_time: '14:00', return_pickup_location: 'Hotel Alpha' }];
  const plan = buildPlan(rows, { windowStart: '2026-09-24', windowEnd: '2026-09-30', servingSourceMapping: MAPPING(), destinations: [] });
  const ret = plan.legs.find((l) => l.kind === 'RETURN');
  assert.equal(ret.location.original, 'Hotel Alpha');
  assert.equal(ret.pickup_arrangement_verified, false);
  assert.equal(ret.confirmation.guest_confirmation, 'UNKNOWN');
  assert.equal(plan.pairings.length, 1);
  const p = plan.pairings[0];
  assert.equal(p.conditional_on_location_confirmation, false);
  assert.equal(p.planning_status, 'PLANNING_CANDIDATE_ZONE_MAPPING_RESOLVED_NOT_OPERATIONALLY_CONFIRMED');
  assert.equal(p.zone_resolution, LOCATION_STATUS.RESOLVED_VIA_SERVING_SOURCE_MAPPING);
  assert.ok(p.missing_inputs.some((m) => /verify the actual pickup arrangement/.test(m)));
  assert.ok(p.missing_inputs.some((m) => /guest confirmation status/.test(m)));
  assert.doesNotMatch(JSON.stringify(plan), /(?<!NOT_)OPERATIONALLY_CONFIRMED"?\s*[,}]|"FEASIBLE"/);
  assert.equal(plan.summary.potential_pairings.zone_mapping_resolved_not_operationally_confirmed, 1);
});

test('the non-overlapping-leg upper bound is labelled as an upper bound only, not a dispatchable schedule or additional bookings', () => {
  const s = buildPlan([], { windowStart: '2026-09-24', windowEnd: '2026-09-30' }).summary.competing_alternatives.statement;
  assert.match(s, /non-overlapping-leg upper bound/);
  assert.match(s, /not a dispatchable schedule and not additional bookings/);
});

test('the bundled evidence file carries source URLs, hashes, the zone rule and the history check for both storefronts', () => {
  const j = JSON.parse(readFileSync(new URL('../data/serving_source_hotel_zone_mapping_2026-09-21.json', import.meta.url), 'utf8'));
  for (const k of ['FTT', 'FD']) {
    assert.match(j.sources[k].index_sha256, /^[0-9a-f]{64}$/);
    assert.match(j.sources[k].app_js_sha256, /^[0-9a-f]{64}$/);
    assert.ok(j.sources[k].zone_rule.marketplace_zone_names.includes('Coral Coast'));
    assert.ok(j.sources[k].options_with_area.length > 100);
  }
  assert.equal(j.history_check.FTT.production_deployments_checked, 30);
  assert.equal(j.history_check.FD.production_deployments_checked, 19);
  assert.doesNotMatch(JSON.stringify(j), /guest_|phone|email/i);
});
