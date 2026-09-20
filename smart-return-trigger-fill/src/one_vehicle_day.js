/* Issue #54 — one-vehicle / one-day SHADOW exercise: turns the two completed private ops sheets into the pilot's sanitized input, measures
 * input completeness and contradictions, and produces an AGGREGATE-ONLY summary. Pure functions; no I/O here; nothing is invented:
 * a blank answer stays unknown and the pilot holds on it. The CLI (scripts/one_vehicle_day_exercise.js) keeps every derived file private.
 */
import { runSevenDayPilot } from '../scripts/seven_day_pilot.js';

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const t = String(text).replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const col = (row, prefix) => { const k = Object.keys(row).find((h) => h.startsWith(prefix)); return k ? row[k] : ''; };
const num = (v) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const int = (v) => { const n = num(v); return n != null && Number.isInteger(n) ? n : (v === '' ? null : NaN); };
const yes = (v) => /^(y|yes)$/i.test(String(v).trim());
const no = (v) => /^(n|no)$/i.test(String(v).trim());

/** vehicleRows: [{item, 'your answer', notes}] -> config + a record of which answers were supplied. */
export function buildConfig(vehicleRows, airportZone = 'Nadi Airport') {
  const get = (prefix) => { const r = vehicleRows.find((x) => x.item.startsWith(prefix)); return r ? (r['your answer'] ?? '').trim() : ''; };
  const cls = get('vehicle_class'); const pax = int(get('max_passengers')); const bags = int(get('max_bags'));
  const turnaround = num(get('turnaround_minutes'));
  const from = get('attestation_from'); const to = get('attestation_to'); const stmt = get('attestation_statement');
  // The template pre-fills the sentence; leaving it untouched is NOT an attestation - ops must type YES or their name over it.
  const stmtOk = stmt !== '' && !/^I confirm the jobs sheet lists EVERY/i.test(stmt);
  const durations = {};
  for (const r of vehicleRows) {
    const m = /^drive_minutes\s+(.+?)\s*->\s*(.+)$/i.exec(r.item); const ans = (r['your answer'] ?? '').trim();
    if (m && !/each zone/i.test(m[1] + m[2]) && num(ans) > 0) durations[`${m[1].trim()}|${m[2].trim()}`] = Number(ans);
    if (/^drive_minutes/i.test(r.item) && /each zone|zone used/i.test(r.item)) {
      const dir = /Nadi Airport\s*->/i.test(r.item) ? 'out' : 'in';
      for (const part of ans.split(/[\n;]+/)) { const mm = /^\s*([^:=]+?)\s*[:=]\s*(\d+(?:\.\d+)?)\s*$/.exec(part); if (mm) durations[dir === 'out' ? `${airportZone}|${mm[1]}` : `${mm[1]}|${airportZone}`] = Number(mm[2]); }
    }
  }
  const capValid = Number.isInteger(pax) && pax >= 1 && Number.isInteger(bags) && bags >= 0;
  const attested = from && to && stmtOk;
  const optionalPayout = get('OPTIONAL operator payout'); const optionalCost = get('OPTIONAL extra cost');
  const config = {
    airport_zone: airportZone,
    turnaround_minutes: turnaround != null && turnaround >= 0 ? turnaround : null,
    vehicle_capacity_confirmed: cls !== '' && pax !== null && bags !== null,
    vehicle_capacity: cls !== '' ? { [cls]: { pax, bags } } : {},
    route_durations_verified: durations,
    vehicle_availability_attested: attested ? { [get('vehicle_ref')]: { from, to } } : {},
    route_price_truth: {},                       // economics are not part of step 1; commercial verdicts stay HOLD
    contribution_requirement: { approved: false },
  };
  const answered = { vehicle_ref: get('vehicle_ref') !== '', vehicle_class: cls !== '', max_passengers: pax !== null, max_bags: bags !== null, capacity_valid: cls !== '' && capValid, attestation_period: !!(from && to), attestation_statement: stmtOk,
    turnaround: turnaround != null, route_durations: Object.keys(durations).length, optional_payout: optionalPayout !== '', optional_extra_cost: optionalCost !== '' };
  return { config, answered, vehicle: { ref: get('vehicle_ref'), cls } };
}

/** jobRows: [{...}] from the jobs sheet -> movements + per-field completeness + contradiction counts (all counts only). */
export function buildMovements(jobRows, { date, vehicle, config }) {
  const turnaround = config.turnaround_minutes ?? 0;
  const movements = []; const c = { rows: jobRows.length, marked_this_vehicle: 0, marked_other_vehicle: 0, unanswered: 0, other_job_rows_used: 0, other_job_rows_blank: 0 };
  const missing = { start_local_time: 0, from_zone: 0, to_zone: 0, vehicle_ref: 0, passengers: 0, bags: 0, duration: 0, confirmed_by: 0, confirmed_at: 0, evidence_ref: 0 };
  const bad = { invalid_time: 0, invalid_duration: 0, invalid_load: 0, class_mismatch_vs_vehicle: 0, load_over_capacity: 0, vehicle_ref_mismatch: 0, attestation_does_not_cover_date: 0 };
  let n = 0; const mine = [];
  for (const r of jobRows) {
    const isOther = /^OTHER-JOB/i.test(r.booking_id);
    const flag = col(r, 'THIS_VEHICLE');
    const time = r.start_local_time; const from = r.from_zone; const to = r.to_zone;
    const dur = num(col(r, 'estimated_duration')); const pax = col(r, 'passengers'); const bags = col(r, 'bags');
    const by = col(r, 'confirmed_by'); const at = col(r, 'confirmed_at'); const ev = col(r, 'evidence_ref'); const vref = col(r, 'vehicle_ref');
    const filled = isOther ? (time || from || to || by || at || ev) !== '' && (time !== '' || from !== '' || to !== '') : true;
    if (isOther && !filled) { c.other_job_rows_blank++; continue; }
    let onVehicle;
    if (isOther) { onVehicle = true; c.other_job_rows_used++; }
    else if (yes(flag)) { onVehicle = true; c.marked_this_vehicle++; }
    else if (no(flag)) { onVehicle = false; c.marked_other_vehicle++; }
    else { c.unanswered++; continue; }
    const leg = /return/i.test(r.leg) ? 'departure' : 'arrival';
    if (onVehicle) {
      if (!time) missing.start_local_time++; if (!from) missing.from_zone++; if (!to) missing.to_zone++; if (!vref) missing.vehicle_ref++;
      if (pax === '') missing.passengers++; if (bags === '') missing.bags++; if (dur == null) missing.duration++;
      if (!by) missing.confirmed_by++; if (!at) missing.confirmed_at++; if (!ev) missing.evidence_ref++;
      if (vref && vehicle.ref && vref !== vehicle.ref) bad.vehicle_ref_mismatch++;
    }
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) bad.invalid_time++;
    if (col(r, 'estimated_duration') !== '' && !(dur > 0)) bad.invalid_duration++;
    const p = pax === '' ? null : Number(pax); const b = bags === '' ? null : Number(bags);
    if ((p !== null && !(Number.isInteger(p) && p >= 1)) || (b !== null && !(Number.isInteger(b) && b >= 0))) bad.invalid_load++;
    if (onVehicle && vehicle.cls && r.vehicle_class_booked && r.vehicle_class_booked !== vehicle.cls && !isOther) bad.class_mismatch_vs_vehicle++;
    const cap = config.vehicle_capacity?.[vehicle.cls];
    if (onVehicle && cap && Number.isInteger(p) && Number.isInteger(b) && (p > cap.pax || b > cap.bags)) bad.load_over_capacity++;
    const veh = onVehicle ? (vref || vehicle.ref || null) : 'other_vehicle';
    const m = {
      movement_ref: `d${String(++n).padStart(3, '0')}`, leg, pickup_zone: from, dropoff_zone: to,
      pickup_local: `${r.date || date}T${time}`, vehicle_class: r.vehicle_class_booked || vehicle.cls || null,
      passengers: p, luggage: b, duration_minutes: dur, assigned_vehicle_ref: veh,
      confirmation: { source: 'ops_worksheet', confirmed_by: by, confirmed_at: at, evidence_ref: ev },
    };
    movements.push(m); if (onVehicle) mine.push(m);
  }
  // contradictions: overlapping intervals on this vehicle (with turnaround). Times are same-day local, so compare minutes.
  const toMin = (t) => { const m = /^(\d{2}):(\d{2})$/.exec((t.split('T')[1] ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  let overlaps = 0; let unknownEnd = 0;
  for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
    const a = mine[i]; const b = mine[j]; const as = toMin(a.pickup_local); const bs = toMin(b.pickup_local);
    if (as == null || bs == null) continue;
    const ae = a.duration_minutes != null ? as + a.duration_minutes : null; const be = b.duration_minutes != null ? bs + b.duration_minutes : null;
    if (ae == null || be == null) { unknownEnd++; continue; }
    if (as < be + turnaround && bs < ae + turnaround) overlaps++;
  }
  const att = config.vehicle_availability_attested?.[vehicle.ref];
  if (att && (date < att.from.slice(0, 10) || date > att.to.slice(0, 10))) bad.attestation_does_not_cover_date++;
  return { movements, jobs: c, missing_fields_on_vehicle_jobs: missing, contradictions: { ...bad, overlapping_job_pairs_on_vehicle_incl_turnaround: overlaps, job_pairs_with_unknown_end: unknownEnd } };
}

/** Full exercise: aggregate-only summary in the five sections requested. */
export function runOneVehicleDay({ jobsCsv, vehicleCsv, date }) {
  const { config, answered, vehicle } = buildConfig(parseCsv(vehicleCsv));
  const built = buildMovements(parseCsv(jobsCsv), { date, vehicle, config });
  const report = runSevenDayPilot({ config, movements: built.movements }, { startDate: date, days: 1 });
  const opsHold = report.opportunity_hold_reason_counts;
  const commercialReasons = new Set(['ECONOMICS_UNKNOWN', 'FARE_AUTHORITY_UNAPPROVED', 'INVALID_COMMERCIAL_INPUT', 'ADDITIONAL_COST_UNKNOWN', 'CONTRIBUTION_REQUIREMENT_NOT_APPROVED', 'FLOOR_BELOW_KNOWN_COST', 'NEGATIVE_CONTRIBUTION', 'BELOW_APPROVED_CONTRIBUTION']);
  const operational = {}; const commercial = {};
  for (const [k, v] of Object.entries(opsHold)) (commercialReasons.has(k) ? commercial : operational)[k] = v;
  const summary = {
    date, shadow_only: true, aggregates_only: true,
    interpretation: report.interpretation,
    section1_input_completeness_and_contradictions: { vehicle_sheet_answered: answered, jobs: built.jobs, missing_fields_on_vehicle_jobs: built.missing_fields_on_vehicle_jobs, contradictions: built.contradictions, input_gaps: report.input_gaps },
    section2_verified_movements_and_sold_return_matches: { movements_supplied: report.counts.movements_supplied, verified_movements: report.counts.verified_movements, not_verified_excluded: report.counts.not_verified_excluded, not_verified_reason_counts: report.not_verified_reason_counts, sold_reverse_chains: report.counts.sold_reverse_chains, rejected_matches: report.counts.rejected_matches, rejection_reason_counts: report.rejection_reason_counts },
    section3_hypothetical_vs_operationally_feasible: { arrival_legs_evaluated: report.counts.arrival_legs_evaluated, hypothetical_empty_legs: report.counts.hypothetical_empty_legs, operationally_feasible: report.counts.operationally_feasible, ready_for_dispatch_review: report.counts.ready_for_dispatch_review },
    section4a_operational_holds: operational,
    section4b_commercial_holds: commercial,
  };
  return { summary, report, movements: built.movements, config };
}

/** Private comparison rows for ops: does the proposed schedule match ground reality? (Contains only opaque refs, zones, times.) */
export function comparisonRows(report) {
  const rows = [];
  for (const r of report.results) {
    rows.push({ movement_ref: r.movement_ref, proposed: 'HYPOTHETICAL empty leg', from_zone: r.predicted_empty_leg.from, to_zone: r.predicted_empty_leg.to, earliest_start_utc: r.predicted_empty_leg.earliest_start_utc ?? '', pilot_stage: r.opportunity?.stage ?? 'SOLD_CHAIN',
      pilot_holds: r.opportunity ? [...r.opportunity.operational_hold_reasons, r.opportunity.commercial_reason].filter(Boolean).join('; ') : '' });
  }
  return rows;
}

/** Aggregate a completed comparison sheet (ops filled `vehicle_actually_free (Y/N)` and `matches_reality (Y/N)`). */
export function summarizeComparison(rows) {
  const c = { proposed_legs: rows.length, vehicle_actually_free_yes: 0, vehicle_actually_free_no: 0, matches_reality_yes: 0, matches_reality_no: 0, unanswered: 0 };
  for (const r of rows) {
    const free = col(r, 'vehicle_actually_free'); const match = col(r, 'matches_reality');
    if (free === '' && match === '') { c.unanswered++; continue; }
    if (yes(free)) c.vehicle_actually_free_yes++; else if (no(free)) c.vehicle_actually_free_no++;
    if (yes(match)) c.matches_reality_yes++; else if (no(match)) c.matches_reality_no++;
  }
  return c;
}
