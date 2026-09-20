/* Issue #54 - booking-led planning CLI (PLANNING ONLY).
 *   node scripts/booking_led_plan.js --input booking-led-input-PRIVATE.json --private-dir DIR
 *        [--windows 2026-09-24:2026-09-24,2026-09-24:2026-09-30] [--scenario-outbound-zone]
 *        [--location-confirmations COMPLETED_CONFIRMATION_SHEET.csv]
 * Reads a private JSON of saved-booking rows (built by a read-only extractor), writes prepopulated PRIVATE worksheets for ops to correct and
 * complete, and prints ONLY the aggregate summary (safe to publish). No network, no D1, no messages, no booking changes.
 * A completed return-location confirmation sheet (ops answers in the "OPS:" columns) is turned into explicit ops confirmations; a pairing
 * never allocates or fills a leg - pairings are competing alternatives for ops to select and validate.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildPlan } from '../src/booking_led_plan.js';
import { parseCsv } from '../src/one_vehicle_day.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const input = arg('--input'); const dir = arg('--private-dir');
if (!input || !dir) { console.error('usage: node scripts/booking_led_plan.js --input FILE.json --private-dir DIR [--windows A:B,...] [--scenario-outbound-zone] [--location-confirmations SHEET.csv]'); process.exit(2); }
const windows = (arg('--windows') ?? '2026-09-24:2026-09-24,2026-09-24:2026-09-30').split(',').map((w) => w.split(':'));
const data = JSON.parse(readFileSync(input, 'utf8'));
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = (head, rows) => '﻿' + [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n');
mkdirSync(dir, { recursive: true });

// ops confirmations: booking_id -> {zone, confirmed_by, evidence_ref}. Accepting the suggestion needs its suggested zone; a typed zone overrides it.
const corrections = {};
const confPath = arg('--location-confirmations');
if (confPath) {
  for (const r of parseCsv(readFileSync(confPath, 'utf8'))) {
    const get = (p) => { const k = Object.keys(r).find((h) => h.startsWith(p)); return k ? r[k] : ''; };
    const zone = get('OPS: confirmed zone').trim() || (/^(y|yes)$/i.test(get('OPS: accept suggestion').trim()) ? get('suggested_zone').trim() : '');
    if (zone) corrections[Number(r.booking_id)] = { zone, confirmed_by: get('OPS: confirmed by'), evidence_ref: get('OPS: evidence') };
  }
}
const ctxBase = { destinations: data.destinations, hotelOptions: data.hotel_options, zoneDistanceCache: data.zone_distance_cache, knownZones: data.known_zones, locationCorrections: corrections, conditional: !process.argv.includes('--no-conditional') };
const bucket = (m) => (m < 60 ? '<60' : m < 180 ? '60-179' : m < 360 ? '180-359' : '>=360');
const out = [];
const scenarioOn = process.argv.includes('--scenario-outbound-zone');
for (const [a, b] of windows) {
  const tag = a === b ? `${a}` : `${a}_to_${b}`;
  const plan = buildPlan(data.rows, { ...ctxBase, windowStart: a, windowEnd: b });
  const byLeg = Object.fromEntries(plan.legs.map((l) => [l.leg_id, l]));
  const evidenceText = (l) => (l.location.evidence ?? []).map((e) => `${e.name} [${e.zone}] via ${e.source} (${e.method})`).join(' || ');

  // 1. return-location confirmation sheet (24 Sep first) - the smallest thing ops must fix
  const retLegs = plan.legs.filter((l) => l.kind === 'RETURN').sort((x, y) => (x.date === '2026-09-24' ? 0 : 1) - (y.date === '2026-09-24' ? 0 : 1) || x.date.localeCompare(y.date) || String(x.time).localeCompare(String(y.time)));
  const confRows = retLegs.map((l) => ({
    priority: l.date === '2026-09-24' ? '1 - 24 Sep' : '2', leg_id: l.leg_id, booking_id: l.booking_id_private, date: l.date, recorded_return_pickup_time: l.time ?? '',
    recorded_return_pickup_text: l.location.original ?? '', match_category: l.location.category, current_status: l.location.status, suggested_zone: l.location.suggestion?.zone ?? '',
    evidence_for_suggestion: evidenceText(l), same_booking_outbound_zone_evidence_only: l.booking_outbound_zone ?? '',
    'OPS: accept suggestion? (Y/N)': '', 'OPS: confirmed zone (only if different or no suggestion)': '', 'OPS: confirmed by': '', 'OPS: evidence': '', 'OPS: notes': '' }));
  writeFileSync(`${dir}/return_location_confirmation_${tag}_PRIVATE.csv`, csv(Object.keys(confRows[0] ?? { leg_id: '' }), confRows));

  // 2. legs sheet
  const legRows = plan.legs.map((l) => ({
    leg_id: l.leg_id, booking_id: l.booking_id_private, storefront: l.storefront, kind: l.kind, date: l.date, recorded_pickup_time: l.time ?? '', from_zone: l.from_zone ?? '', to_zone: l.to_zone ?? '',
    recorded_location_text: l.location.original ?? '', location_status: l.location.status, match_category: l.location.category ?? '', unverified_zone_suggestion: l.location.suggestion ? `${l.location.suggestion.zone} (ops to confirm)` : '',
    booked_class: l.vehicle_class_booked ?? '', passengers: l.passengers ?? '', luggage: l.luggage ?? '', outbound_zone_of_same_booking: l.kind === 'RETURN' ? (l.booking_outbound_zone ?? '') : '',
    distance_km: l.distance?.km ?? '', distance_source: l.distance?.source ?? 'NOT_RECORDED', duration: 'DURATION_UNKNOWN',
    saved_request_status: `${l.confirmation.status} (guest confirmation ${l.confirmation.guest_confirmation}; provider alert ${l.confirmation.provider_accepted_alert})`,
    uncertainty_flags: l.uncertainty_flags.join('; '), current_vehicle_assignment: l.current_assignment ?? 'UNASSIGNED', allocation_status: l.allocation_status, provisional_status: l.provisional_status,
    decision_needed: l.current_assignment ? 'confirm assignment' : 'NEEDS_DISPATCH_ALLOCATION',
    'OPS: correct pickup time (guest time is fixed - only fix a recording error)': '', 'OPS: vehicle_ref': '', 'OPS: driver': '', 'OPS: passengers': '', 'OPS: bags': '', 'OPS: real drive minutes for this leg': '',
    'OPS: guest confirmed? (Y/N + how)': '', 'OPS: notes': '' }));
  writeFileSync(`${dir}/legs_${tag}_PRIVATE.csv`, csv(Object.keys(legRows[0] ?? { leg_id: '' }), legRows));

  // 3. competing alternatives (grouped) + the allocation decisions ops must make
  const pairRows = plan.pairings.map((p) => ({
    alternative_group: p.alternative_group, pairing_id: p.pairing_id, type: p.type, first_leg: p.first_leg, first_booking: byLeg[p.first_leg].booking_id_private, second_leg: p.second_leg, second_booking: byLeg[p.second_leg].booking_id_private,
    zone: p.zone, depends_on_confirming_return_location: p.conditional_on_location_confirmation ? 'YES' : 'no', first_pickup: p.facts.first_pickup, second_pickup: p.facts.second_pickup, recorded_gap_minutes: p.facts.recorded_pickup_gap_minutes, booked_class: p.facts.booked_class,
    duration_status: p.duration.status, timing_check_for_ops: p.timing_check_for_ops, current_assignments: `${p.current_assignments.first ?? 'UNASSIGNED'} / ${p.current_assignments.second ?? 'UNASSIGNED'}`,
    decision: p.decision, reassignment_proposal: p.reassignment_proposal ?? '', missing_inputs: p.missing_inputs.join(' | '), uncertainty_flags: p.uncertainty_flags.join('; '),
    statement: 'COMPETING ALTERNATIVE - does not allocate or fill any leg; not additive; not a saving; not inventory',
    'OPS: select this alternative? (Y/N)': '', 'OPS: vehicle_ref': '', 'OPS: real drive minutes leg 1': '', 'OPS: real drive minutes leg 2': '', 'OPS: turnaround minutes': '', 'OPS: timing works? (Y/N)': '', 'OPS: notes': '' }));
  writeFileSync(`${dir}/competing_alternatives_${tag}_PRIVATE.csv`, csv(Object.keys(pairRows[0] ?? { pairing_id: '' }), pairRows));
  const decisionRows = plan.legs.map((l) => {
    const alts = plan.pairings.filter((p) => p.first_leg === l.leg_id || p.second_leg === l.leg_id);
    return { leg_id: l.leg_id, booking_id: l.booking_id_private, kind: l.kind, date: l.date, recorded_pickup_time: l.time ?? '', zone_route: `${l.from_zone ?? (l.location.suggestion ? `${l.location.suggestion.zone} (SUGGESTED, unconfirmed)` : '? (unresolved)')} -> ${l.to_zone ?? '?'}`, booked_class: l.vehicle_class_booked ?? '', allocation_status: l.allocation_status,
      decisions_ops_must_make: [`1. Allocate a vehicle/driver (currently ${l.current_assignment ?? 'UNASSIGNED'})`, alts.length ? `2. Select at most ONE of ${alts.length} competing alternative(s): ${alts.map((p) => p.pairing_id).join(', ')} (or keep separate)` : '2. No candidate partner in the records: leave separate unless ops know of one', l.location.status.startsWith('UNRESOLVED') ? '3. Confirm the real return pickup location' : '', '4. Give real drive minutes and turnaround; confirm the guest pickup time and service stay as booked'].filter(Boolean).join(' ; '),
      candidate_alternatives: alts.map((p) => p.pairing_id).join(', '), provisional_status: l.provisional_status,
      'OPS: vehicle_ref chosen': '', 'OPS: alternative selected': '', 'OPS: notes': '' };
  });
  writeFileSync(`${dir}/allocation_decisions_${tag}_PRIVATE.csv`, csv(Object.keys(decisionRows[0] ?? { leg_id: '' }), decisionRows));
  const unmatchedRows = plan.empties.map((e) => ({ leg_id: e.leg_id, booking_id: byLeg[e.leg_id].booking_id_private, type: e.type, need: e.need, direction: e.direction, from_zone: e.from_zone ?? '', to_zone: e.to_zone ?? '', around: e.after ?? e.before ?? '', note: e.note, provisional_status: e.provisional_status,
    'OPS: is a vehicle actually free/empty here? (Y/N)': '', 'OPS: what actually happens': '', 'OPS: notes': '' }));
  writeFileSync(`${dir}/unmatched_requests_${tag}_PRIVATE.csv`, csv(Object.keys(unmatchedRows[0] ?? { leg_id: '' }), unmatchedRows));
  writeFileSync(`${dir}/plan_${tag}_PRIVATE.json`, JSON.stringify({ legs: plan.legs, pairings: plan.pairings, groups: plan.groups, empties: plan.empties, skipped: plan.skipped }, null, 2));
  out.push(plan.summary);
  if (scenarioOn) {   // explicit, separate, clearly-labelled scenario: NOT the plan
    const sc = buildPlan(data.rows, { ...ctxBase, windowStart: a, windowEnd: b, conditional: true, scenarioOutbound: true });
    const scen = sc.pairings.filter((p) => p.scenario_only_outbound_zone_assumed);
    const scLegs = Object.fromEntries(sc.legs.map((l) => [l.leg_id, l]));
    const rowsS = scen.map((p) => ({ alternative_group: p.alternative_group, pairing_id: p.pairing_id, type: p.type, first_booking: scLegs[p.first_leg].booking_id_private, second_booking: scLegs[p.second_leg].booking_id_private, zone_assumed: p.zone, first_pickup: p.facts.first_pickup, second_pickup: p.facts.second_pickup, recorded_gap_minutes: p.facts.recorded_pickup_gap_minutes, booked_class: p.facts.booked_class, status: p.planning_status, missing_inputs: p.missing_inputs.join(' | '), 'OPS: real return pickup location': '', 'OPS: notes': '' }));
    writeFileSync(`${dir}/SCENARIO_competing_alternatives_outbound_zone_assumed_${tag}_PRIVATE.csv`, csv(Object.keys(rowsS[0] ?? { pairing_id: '' }), rowsS));
    out.push({ label: `${a}..${b} SCENARIO (return pickup assumed = same booking's outbound zone; pending ops confirmation; NOT the plan)`, statement: 'Competing alternatives that share legs - not additive bookings, savings or inventory; nothing is allocated or filled.',
      scenario_alternatives: scen.length, alternative_groups: sc.groups.length, max_selectable_at_once_upper_bound_per_group: sc.groups.map((g) => g.max_selectable_at_once_upper_bound), by_type: sc.summary.potential_pairings.by_type,
      by_gap_minutes_bucket: scen.reduce((o, p) => { const k = bucket(p.facts.recorded_pickup_gap_minutes); o[k] = (o[k] || 0) + 1; return o; }, {}) });
  }
}
console.log(JSON.stringify(out, null, 2));
