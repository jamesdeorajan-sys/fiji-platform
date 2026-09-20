/* Issue #54 - booking-led planning CLI (PLANNING ONLY).
 *   node scripts/booking_led_plan.js --input booking-led-input-PRIVATE.json --private-dir DIR [--windows 2026-09-24:2026-09-24,2026-09-24:2026-09-30]
 * Reads a private JSON of saved-booking rows (built by a read-only extractor), writes prepopulated PRIVATE worksheets (legs, pairings,
 * potential empty legs) for ops to correct and complete, and prints ONLY the aggregate summary (safe to publish).
 * No network, no D1, no messages, no booking changes.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildPlan } from '../src/booking_led_plan.js';

const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const input = arg('--input'); const dir = arg('--private-dir');
if (!input || !dir) { console.error('usage: node scripts/booking_led_plan.js --input FILE.json --private-dir DIR [--windows A:B,C:D]'); process.exit(2); }
const windows = (arg('--windows') ?? '2026-09-24:2026-09-24,2026-09-24:2026-09-30').split(',').map((w) => w.split(':'));
const data = JSON.parse(readFileSync(input, 'utf8'));
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = (head, rows) => '﻿' + [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h])).join(','))].join('\n');
mkdirSync(dir, { recursive: true });
const out = [];
const scenarioOn = process.argv.includes('--scenario-outbound-zone');
for (const [a, b] of windows) {
  const tag = a === b ? `${a}` : `${a}_to_${b}`;
  const plan = buildPlan(data.rows, { destinations: data.destinations, zoneDistanceCache: data.zone_distance_cache, windowStart: a, windowEnd: b, conditional: !process.argv.includes('--no-conditional') });
  const byLeg = Object.fromEntries(plan.legs.map((l) => [l.leg_id, l]));
  const legRows = plan.legs.map((l) => ({
    leg_id: l.leg_id, booking_id: l.booking_id_private, storefront: l.storefront, kind: l.kind, date: l.date, recorded_pickup_time: l.time ?? '', from_zone: l.from_zone ?? '', to_zone: l.to_zone ?? '',
    recorded_location_text: l.location.original ?? '', location_status: l.location.status, unverified_zone_suggestion: l.location.suggestion ? `${l.location.suggestion.zone} (via ${l.location.suggestion.matched_destination_names.join(' / ')}; ops to confirm)` : '', booked_class: l.vehicle_class_booked ?? '', passengers: l.passengers ?? '', luggage: l.luggage ?? '',
    outbound_zone_of_same_booking: l.kind === 'RETURN' ? (l.booking_outbound_zone ?? '') : '', distance_km: l.distance?.km ?? '', distance_source: l.distance?.source ?? 'NOT_RECORDED', duration: 'DURATION_UNKNOWN',
    saved_request_status: `${l.confirmation.status} (guest confirmation ${l.confirmation.guest_confirmation}; provider alert ${l.confirmation.provider_accepted_alert})`,
    uncertainty_flags: l.uncertainty_flags.join('; '), current_vehicle_assignment: l.current_assignment ?? 'UNASSIGNED', decision_needed: l.current_assignment ? 'confirm assignment' : 'NEEDS_DISPATCH_ALLOCATION',
    'OPS: correct pickup time (guest time is fixed - only fix a recording error)': '', 'OPS: correct return location or zone': '', 'OPS: vehicle_ref': '', 'OPS: driver': '', 'OPS: passengers': '', 'OPS: bags': '', 'OPS: real drive minutes for this leg': '',
    'OPS: guest confirmed? (Y/N + how)': '', 'OPS: notes': '' }));
  const pairRows = plan.pairings.map((p) => ({
    pairing_id: p.pairing_id, type: p.type, first_leg: p.first_leg, first_booking: byLeg[p.first_leg].booking_id_private, second_leg: p.second_leg, second_booking: byLeg[p.second_leg].booking_id_private,
    zone: p.zone, conditional_on_location_confirmation: p.conditional_on_location_confirmation ? 'YES - confirm the return pickup location first' : 'no', first_pickup: p.facts.first_pickup, second_pickup: p.facts.second_pickup, recorded_gap_minutes: p.facts.recorded_pickup_gap_minutes, booked_class: p.facts.booked_class,
    duration_status: p.duration.status, timing_check_for_ops: p.timing_check_for_ops, current_assignments: `${p.current_assignments.first ?? 'UNASSIGNED'} / ${p.current_assignments.second ?? 'UNASSIGNED'}`,
    decision: p.decision, reassignment_proposal: p.reassignment_proposal ?? '', allocation_decision_for_ops: p.allocation_decision_for_ops, missing_inputs: p.missing_inputs.join(' | '), uncertainty_flags: p.uncertainty_flags.join('; '),
    planning_status: p.planning_status,
    'OPS: decision (one vehicle for both / keep separate / other)': '', 'OPS: vehicle_ref': '', 'OPS: real drive minutes leg 1': '', 'OPS: real drive minutes leg 2': '', 'OPS: turnaround minutes': '', 'OPS: timing works? (Y/N)': '', 'OPS: notes': '' }));
  const emptyRows = plan.empties.map((e) => ({ leg_id: e.leg_id, booking_id: byLeg[e.leg_id].booking_id_private, type: e.type, from_zone: e.from_zone ?? '', to_zone: e.to_zone ?? '', around: e.after ?? e.before ?? '', note: e.note, planning_status: e.planning_status,
    'OPS: is a vehicle actually free/empty here? (Y/N)': '', 'OPS: what actually happens': '', 'OPS: notes': '' }));
  writeFileSync(`${dir}/legs_${tag}_PRIVATE.csv`, csv(Object.keys(legRows[0] ?? { leg_id: '' }), legRows));
  writeFileSync(`${dir}/pairings_${tag}_PRIVATE.csv`, csv(Object.keys(pairRows[0] ?? { pairing_id: '' }), pairRows));
  writeFileSync(`${dir}/potential_empty_legs_${tag}_PRIVATE.csv`, csv(Object.keys(emptyRows[0] ?? { leg_id: '' }), emptyRows));
  writeFileSync(`${dir}/plan_${tag}_PRIVATE.json`, JSON.stringify({ legs: plan.legs, pairings: plan.pairings, empties: plan.empties, skipped: plan.skipped }, null, 2));
  out.push(plan.summary);
  if (scenarioOn) {   // explicit, separate, clearly-labelled scenario: NOT the plan
    const sc = buildPlan(data.rows, { destinations: data.destinations, zoneDistanceCache: data.zone_distance_cache, windowStart: a, windowEnd: b, conditional: true, scenarioOutbound: true });
    const scen = sc.pairings.filter((p) => p.scenario_only_outbound_zone_assumed);
    const scLegs = Object.fromEntries(sc.legs.map((l) => [l.leg_id, l]));
    const rowsS = scen.map((p) => ({ pairing_id: p.pairing_id, type: p.type, first_booking: scLegs[p.first_leg].booking_id_private, second_booking: scLegs[p.second_leg].booking_id_private, zone_assumed: p.zone, first_pickup: p.facts.first_pickup, second_pickup: p.facts.second_pickup, recorded_gap_minutes: p.facts.recorded_pickup_gap_minutes, booked_class: p.facts.booked_class, status: p.planning_status, missing_inputs: p.missing_inputs.join(' | '), 'OPS: real return pickup location': '', 'OPS: confirm pairing worth considering? (Y/N)': '', 'OPS: notes': '' }));
    writeFileSync(`${dir}/SCENARIO_outbound_zone_assumed_pairings_${tag}_PRIVATE.csv`, csv(Object.keys(rowsS[0] ?? { pairing_id: '' }), rowsS));
    out.push({ label: `${a}..${b} SCENARIO (return pickup assumed = same booking's outbound zone; pending ops confirmation; NOT the plan)`, scenario_pairings: scen.length, by_type: sc.summary.potential_pairings.by_type, by_gap_minutes_bucket: scen.reduce((o, p) => { const m = p.facts.recorded_pickup_gap_minutes; const k = m < 60 ? '<60' : m < 180 ? '60-179' : m < 360 ? '180-359' : '>=360'; o[k] = (o[k] || 0) + 1; return o; }, {}), by_decision: scen.reduce((o, p) => { o[p.decision] = (o[p.decision] || 0) + 1; return o; }, {}), legs_with_competing_candidates: sc.summary.potential_pairings.legs_with_competing_candidates });
  }
}
console.log(JSON.stringify(out, null, 2));
