/* Issue #54 — INTERNAL seven-day SHADOW pilot runner (recovery branch, revision 2 after Codex's review of 441c000).
 *
 * Pure, in-memory, read-only. Writes nothing (no D1; a file only if the CLI is given --out), sends nothing, publishes nothing,
 * prices nothing publicly. Input is a SANITIZED, ops-VERIFIED movement file (opaque refs; no names, phones, emails, notes,
 * booking references) - see docs/OPS_VERIFIED_MOVEMENTS_CONTRACT.md.
 *
 * Vocabulary (kept strictly apart in the output):
 *   HYPOTHETICAL        a predicted empty leg (X -> airport) after a verified arrival. A prediction only.
 *   OPERATIONALLY_FEASIBLE  every operational gate passed with ops-verified inputs: assigned vehicle, verified outbound AND reverse
 *                       durations, confirmed turnaround, confirmed capacity, attested availability, no overlapping commitment
 *                       (checked against ALL supplied movements, including those crossing the window boundary).
 *   READY_FOR_DISPATCH_REVIEW  operationally feasible AND commercially safe (approved fare authority, valid inputs, floor >= known cost,
 *                       contribution >= the requirement James has approved). Still NOT an offer: dispatch approval, an exclusive
 *                       vehicle-time claim, expiry and withdrawal do not exist yet.
 *   SOLD CHAIN          an already-sold reverse booking the same vehicle can serve (deadhead avoided). Not a discountable special.
 *
 * It never guesses: every unknown is a HOLD with a named reason. Zero feasible legs under missing inputs is NOT evidence of zero
 * commercial demand or fleet potential - it means the inputs needed to establish feasibility or economics are missing.
 * Placeholder geography (src/geo_seed.js) is not used: only exact reverse zone pairs are considered.
 */
import { zonedTimeToUtcIso } from '../src/production_adapter.js';
import { enforceFloor } from '../src/pricing.js';

export const REASON = Object.freeze({
  // verification
  MISSING_CONFIRMATION: 'MISSING_CONFIRMATION', BAD_CONFIRMATION_SOURCE: 'BAD_CONFIRMATION_SOURCE',
  MISSING_CONFIRMER: 'MISSING_CONFIRMER', BAD_SYSTEM_ACTOR: 'BAD_SYSTEM_ACTOR',
  BAD_CONFIRMED_AT: 'BAD_CONFIRMED_AT', MISSING_EVIDENCE_REF: 'MISSING_EVIDENCE_REF',
  // operational
  NOT_VERIFIED: 'NOT_VERIFIED',
  NO_VEHICLE_ASSIGNMENT: 'NO_VEHICLE_ASSIGNMENT', DIFFERENT_VEHICLE: 'DIFFERENT_VEHICLE', VEHICLE_CLASS_MISMATCH: 'VEHICLE_CLASS_MISMATCH',
  NOT_EXACT_REVERSE: 'NOT_EXACT_REVERSE', NOT_EVALUATED_GEOGRAPHY_UNVERIFIED: 'NOT_EVALUATED_GEOGRAPHY_UNVERIFIED',
  DURATION_UNKNOWN: 'DURATION_UNKNOWN', REVERSE_DURATION_UNKNOWN: 'REVERSE_DURATION_UNKNOWN', SOLD_RETURN_DURATION_UNKNOWN: 'SOLD_RETURN_DURATION_UNKNOWN',
  TURNAROUND_UNKNOWN: 'TURNAROUND_UNKNOWN', TIMING_INFEASIBLE: 'TIMING_INFEASIBLE',
  CAPACITY_UNKNOWN: 'CAPACITY_UNKNOWN', CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
  AVAILABILITY_UNATTESTED: 'AVAILABILITY_UNATTESTED', VEHICLE_CONFLICT: 'VEHICLE_CONFLICT',
  SOURCE_JOB_CONFLICT: 'SOURCE_JOB_CONFLICT',           // the source arrival itself overlaps / is too close to another job of the same vehicle
  INVALID_LOAD: 'INVALID_LOAD', INVALID_CAPACITY_LIMIT: 'INVALID_CAPACITY_LIMIT',
  // commercial
  ECONOMICS_UNKNOWN: 'ECONOMICS_UNKNOWN', FARE_AUTHORITY_UNAPPROVED: 'FARE_AUTHORITY_UNAPPROVED', INVALID_COMMERCIAL_INPUT: 'INVALID_COMMERCIAL_INPUT',
  ADDITIONAL_COST_UNKNOWN: 'ADDITIONAL_COST_UNKNOWN', CONTRIBUTION_REQUIREMENT_NOT_APPROVED: 'CONTRIBUTION_REQUIREMENT_NOT_APPROVED',
  FLOOR_BELOW_KNOWN_COST: 'FLOOR_BELOW_KNOWN_COST', NEGATIVE_CONTRIBUTION: 'NEGATIVE_CONTRIBUTION', BELOW_APPROVED_CONTRIBUTION: 'BELOW_APPROVED_CONTRIBUTION',
});

export const STAGE = Object.freeze({
  HYPOTHETICAL_HOLD: 'HYPOTHETICAL_HOLD',
  OPERATIONALLY_FEASIBLE_COMMERCIAL_HOLD: 'OPERATIONALLY_FEASIBLE_COMMERCIAL_HOLD',
  READY_FOR_DISPATCH_REVIEW: 'READY_FOR_DISPATCH_REVIEW',
});

const MIN = 60000;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isNonNeg = (n) => isNum(n) && n >= 0;
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

function localToMs(local) {
  if (typeof local !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/.exec(local);
  if (!m) return null;
  const iso = zonedTimeToUtcIso(m[1], m[2]);
  return iso ? Date.parse(iso) : null;
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const SYSTEM_ACTOR = /^(admin|driver:\d+)$/;

/** Contract check (docs/OPS_VERIFIED_MOVEMENTS_CONTRACT.md): source, named confirmer, ISO timestamp with zone, evidence pointer. */
export function checkConfirmation(m) {
  const c = m?.confirmation;
  if (!c || typeof c !== 'object') return { ok: false, reason: REASON.MISSING_CONFIRMATION };
  if (!['ops_worksheet', 'system_accepted'].includes(c.source)) return { ok: false, reason: REASON.BAD_CONFIRMATION_SOURCE };
  if (!nonEmpty(c.confirmed_by)) return { ok: false, reason: REASON.MISSING_CONFIRMER };
  if (c.source === 'system_accepted' && !SYSTEM_ACTOR.test(c.confirmed_by.trim())) return { ok: false, reason: REASON.BAD_SYSTEM_ACTOR };
  if (typeof c.confirmed_at !== 'string' || !ISO_WITH_ZONE.test(c.confirmed_at) || Number.isNaN(Date.parse(c.confirmed_at))) return { ok: false, reason: REASON.BAD_CONFIRMED_AT };
  if (!nonEmpty(c.evidence_ref)) return { ok: false, reason: REASON.MISSING_EVIDENCE_REF };
  return { ok: true };
}

export function runSevenDayPilot(input, { startDate, days = 7 } = {}) {
  const config = input.config ?? {};
  const airport = config.airport_zone ?? 'Nadi Airport';
  const all = Array.isArray(input.movements) ? input.movements : [];
  const startMs = localToMs(`${startDate}T00:00`);
  const endMs = startMs == null ? null : startMs + days * 24 * 60 * MIN;
  const inWindow = (m) => { const t = localToMs(m.pickup_local); return t != null && startMs != null && t >= startMs && t < endMs; };

  const notVerifiedReasons = {};
  const verified = [];
  for (const m of all) {
    const v = checkConfirmation(m);
    if (v.ok) verified.push(m); else notVerifiedReasons[v.reason] = (notVerifiedReasons[v.reason] || 0) + 1;
  }
  const pool = verified.filter(inWindow);
  const turnaround = isNum(config.turnaround_minutes) && config.turnaround_minutes >= 0 ? config.turnaround_minutes : null;

  const durationOf = (m) => (isNonNeg(m.duration_minutes) && m.duration_minutes > 0 ? m.duration_minutes
    : (isNonNeg(config.route_durations_verified?.[`${m.pickup_zone}|${m.dropoff_zone}`]) && config.route_durations_verified[`${m.pickup_zone}|${m.dropoff_zone}`] > 0 ? config.route_durations_verified[`${m.pickup_zone}|${m.dropoff_zone}`] : null));
  const startOf = (m) => localToMs(m.pickup_local);
  const endOf = (m) => { const s = startOf(m); const d = durationOf(m); return s == null || d == null ? null : s + d * MIN; };

  // Capacity limit: pax must be a positive integer, bags a non-negative integer, and the table must be ops-confirmed.
  const capacityState = (cls) => {
    if (config.vehicle_capacity_confirmed !== true || config.vehicle_capacity?.[cls] == null) return 'UNCONFIRMED';
    const { pax, bags } = config.vehicle_capacity[cls];
    return Number.isInteger(pax) && pax >= 1 && Number.isInteger(bags) && bags >= 0 ? 'OK' : 'INVALID';
  };
  const capacityGate = (cls) => { const c = capacityState(cls); return c === 'UNCONFIRMED' ? REASON.CAPACITY_UNKNOWN : c === 'INVALID' ? REASON.INVALID_CAPACITY_LIMIT : null; };
  // Load: passengers a positive integer, luggage a non-negative integer. Absent = unknown; present but malformed = invalid.
  const loadState = (m) => {
    const p = m.passengers; const l = m.luggage;
    if (p == null && l == null) return 'UNKNOWN';
    if (typeof p !== 'number' || typeof l !== 'number') return p == null || l == null ? 'UNKNOWN' : 'INVALID';
    return Number.isInteger(p) && p >= 1 && Number.isInteger(l) && l >= 0 ? 'OK' : 'INVALID';
  };
  const loadFits = (m, cls) => m.passengers <= config.vehicle_capacity[cls].pax && m.luggage <= config.vehicle_capacity[cls].bags;
  const attested = (veh, fromMs, toMs) => {
    const a = config.vehicle_availability_attested?.[veh];
    const f = a ? localToMs(a.from) : null; const t = a ? localToMs(a.to) : null;
    return f != null && t != null && fromMs != null && toMs != null && f <= fromMs && t >= toMs;
  };
  // Every supplied movement (verified or not, inside or outside the window) that names this vehicle is a potential commitment.
  // A turnaround buffer applies on both sides of the interval. Unknown start or end cannot be ruled out, so it counts as a conflict.
  const buf = (turnaround ?? 0) * MIN;
  const conflicts = (veh, fromMs, toMs, ignoreRefs) => all.some((o) => {
    if (o.assigned_vehicle_ref !== veh || ignoreRefs.includes(o.movement_ref)) return false;
    const st = startOf(o); if (st == null) return true;
    const en = endOf(o); if (en == null) return st < toMs + buf;
    return st < toMs + buf && en + buf > fromMs;
  });

  const results = []; const rejected = [];
  for (const a of pool.filter((m) => m.pickup_zone === airport && m.dropoff_zone !== airport)) {
    const X = a.dropoff_zone;
    const out = { movement_ref: a.movement_ref, predicted_empty_leg: { status: 'HYPOTHETICAL', from: X, to: airport, vehicle_class: a.vehicle_class }, chains: [], opportunity: null };
    const aStart = startOf(a); const aEnd = endOf(a);
    const reverseMin = isNonNeg(config.route_durations_verified?.[`${X}|${airport}`]) && config.route_durations_verified[`${X}|${airport}`] > 0 ? config.route_durations_verified[`${X}|${airport}`] : null;
    const earliest = aEnd != null && turnaround != null ? aEnd + turnaround * MIN : null;
    const legEnd = earliest != null && reverseMin != null ? earliest + reverseMin * MIN : null;
    out.predicted_empty_leg.earliest_start_utc = earliest != null ? new Date(earliest).toISOString() : null;
    out.predicted_empty_leg.duration_basis = reverseMin != null ? 'OPS_VERIFIED_ROUTE_DURATION' : 'UNKNOWN';

    // shared operational gates for this vehicle after leg A
    const gates = [];
    if (!a.assigned_vehicle_ref) gates.push(REASON.NO_VEHICLE_ASSIGNMENT);
    if (aEnd == null) gates.push(REASON.DURATION_UNKNOWN);
    if (turnaround == null) gates.push(REASON.TURNAROUND_UNKNOWN);
    const capG = capacityGate(a.vehicle_class);
    if (capG) gates.push(capG);
    const aLoad = loadState(a);
    if (aLoad === 'INVALID') gates.push(REASON.INVALID_LOAD);
    else if (aLoad === 'OK' && capacityState(a.vehicle_class) === 'OK' && !loadFits(a, a.vehicle_class)) gates.push(REASON.CAPACITY_EXCEEDED);
    // The SOURCE arrival must itself be consistent with the job records: its own interval (with turnaround) may not overlap another job of
    // the same vehicle. An availability attestation never overrides contradictory job records.
    if (a.assigned_vehicle_ref && aStart != null && aEnd != null && conflicts(a.assigned_vehicle_ref, aStart, aEnd, [a.movement_ref])) gates.push(REASON.SOURCE_JOB_CONFLICT);

    // (1) sold reverse bookings: same gates as an opportunity, applied to the sold booking's complete interval
    for (const d of pool) {
      if (d.movement_ref === a.movement_ref) continue;
      if (d.pickup_zone === X && d.dropoff_zone === airport) {
        const reasons = [...gates];
        if (d.vehicle_class !== a.vehicle_class) reasons.push(REASON.VEHICLE_CLASS_MISMATCH);
        if (a.assigned_vehicle_ref && d.assigned_vehicle_ref && d.assigned_vehicle_ref !== a.assigned_vehicle_ref) reasons.push(REASON.DIFFERENT_VEHICLE);
        const dStart = startOf(d); const dEnd = endOf(d);
        if (dEnd == null) reasons.push(REASON.SOLD_RETURN_DURATION_UNKNOWN);
        if (earliest != null && (dStart == null || dStart < earliest)) reasons.push(REASON.TIMING_INFEASIBLE);
        const dLoad = loadState(d);
        if (dLoad === 'INVALID') reasons.push(REASON.INVALID_LOAD);
        else if (capacityState(a.vehicle_class) === 'OK') {
          if (dLoad === 'UNKNOWN') reasons.push(REASON.CAPACITY_UNKNOWN);
          else if (!loadFits(d, a.vehicle_class)) reasons.push(REASON.CAPACITY_EXCEEDED);
        }
        if (a.assigned_vehicle_ref && dStart != null && dEnd != null) {
          if (!attested(a.assigned_vehicle_ref, aStart, dEnd)) reasons.push(REASON.AVAILABILITY_UNATTESTED);
          if (conflicts(a.assigned_vehicle_ref, dStart, dEnd, [a.movement_ref, d.movement_ref])) reasons.push(REASON.VEHICLE_CONFLICT);
        }
        if (reasons.length) rejected.push({ source: a.movement_ref, candidate: d.movement_ref, reasons: [...new Set(reasons)] });
        else out.chains.push({ candidate: d.movement_ref, note: 'SOLD CHAIN: sold reverse booking the same vehicle can serve; deadhead avoided; not a discountable special' });
      } else if (d.pickup_zone === X || d.dropoff_zone === airport) {
        rejected.push({ source: a.movement_ref, candidate: d.movement_ref, reasons: [REASON.NOT_EXACT_REVERSE, REASON.NOT_EVALUATED_GEOGRAPHY_UNVERIFIED] });
      }
    }

    // (2) hypothetical empty leg -> operational gates -> commercial gates (only when no sold booking already fills it)
    if (out.chains.length === 0) {
      const hold = [...gates];
      if (reverseMin == null) hold.push(REASON.REVERSE_DURATION_UNKNOWN);
      if (a.assigned_vehicle_ref && earliest != null && legEnd != null) {
        if (!attested(a.assigned_vehicle_ref, aStart, legEnd)) hold.push(REASON.AVAILABILITY_UNATTESTED);
        if (conflicts(a.assigned_vehicle_ref, earliest, legEnd, [a.movement_ref])) hold.push(REASON.VEHICLE_CONFLICT);
      } else if (a.assigned_vehicle_ref && !hold.includes(REASON.AVAILABILITY_UNATTESTED)) {
        hold.push(REASON.AVAILABILITY_UNATTESTED);   // window cannot be established without verified durations/turnaround
      }
      const operational = hold.length === 0 ? 'FEASIBLE' : 'HOLD';
      const eco = economics(config, { from: X, to: airport, vehicle_class: a.vehicle_class });
      const ready = operational === 'FEASIBLE' && eco.status === 'READY';
      out.opportunity = {
        stage: ready ? STAGE.READY_FOR_DISPATCH_REVIEW : (operational === 'FEASIBLE' ? STAGE.OPERATIONALLY_FEASIBLE_COMMERCIAL_HOLD : STAGE.HYPOTHETICAL_HOLD),
        operational, operational_hold_reasons: [...new Set(hold)],
        commercial: eco.status, commercial_reason: eco.reason ?? null,
        price_fjd: ready ? eco.price_fjd : null, contribution_fjd: ready ? eco.contribution_fjd : null,
        not_an_offer: 'requires dispatch approval, an exclusive vehicle-time claim, expiry and withdrawal handling (not built)',
      };
    }
    results.push(out);
  }

  const reasonCounts = {};
  for (const r of rejected) for (const x of r.reasons) reasonCounts[x] = (reasonCounts[x] || 0) + 1;
  const holdCounts = {};
  for (const r of results) if (r.opportunity) for (const x of [...r.opportunity.operational_hold_reasons, ...(r.opportunity.commercial === 'HOLD' ? [r.opportunity.commercial_reason] : [])]) holdCounts[x] = (holdCounts[x] || 0) + 1;

  const opps = results.map((r) => r.opportunity).filter(Boolean);
  const inputGaps = [];
  if (turnaround == null) inputGaps.push('turnaround_minutes (ops-confirmed)');
  if (config.vehicle_capacity_confirmed !== true) inputGaps.push('vehicle capacity table (ops-confirmed)');
  else if (Object.values(config.vehicle_capacity ?? {}).some((c) => !(Number.isInteger(c?.pax) && c.pax >= 1 && Number.isInteger(c?.bags) && c.bags >= 0))) inputGaps.push('valid vehicle capacity limits (positive-integer passengers, non-negative-integer bags)');
  if (!config.route_durations_verified || Object.keys(config.route_durations_verified).length === 0) inputGaps.push('ops-verified route durations (outbound and reverse)');
  if (!config.vehicle_availability_attested || Object.keys(config.vehicle_availability_attested).length === 0) inputGaps.push('vehicle availability attestation (complete commitments list per vehicle and period)');
  if (pool.some((m) => !m.assigned_vehicle_ref)) inputGaps.push('vehicle assignment on verified movements');
  if (!config.route_price_truth || Object.keys(config.route_price_truth).length === 0) inputGaps.push('route price truth (payout, additional cost, floor, price, approved fare authority)');
  if (!(config.contribution_requirement?.approved === true)) inputGaps.push('contribution requirement approved by James');
  if (verified.length === 0) inputGaps.push('any verified movements');

  return {
    window: { start_date: startDate, days },
    shadow_only: true,
    interpretation: 'Zero feasible or ready-for-review legs under missing inputs is NOT evidence of zero commercial demand or fleet potential; it means the inputs needed to establish feasibility or economics are missing. Hypothetical empty legs are predictions, not offers.',
    input_gaps: inputGaps,
    counts: {
      movements_supplied: all.length,
      verified_movements: verified.length,
      not_verified_excluded: all.length - verified.length,
      verified_in_window: pool.length,
      arrival_legs_evaluated: results.length,
      hypothetical_empty_legs: results.length,
      sold_reverse_chains: results.reduce((n, r) => n + r.chains.length, 0),
      operationally_feasible: opps.filter((o) => o.operational === 'FEASIBLE').length,
      ready_for_dispatch_review: opps.filter((o) => o.stage === STAGE.READY_FOR_DISPATCH_REVIEW).length,
      on_hold: opps.filter((o) => o.stage !== STAGE.READY_FOR_DISPATCH_REVIEW).length,
      rejected_matches: rejected.length,
    },
    not_verified_reason_counts: notVerifiedReasons,
    rejection_reason_counts: reasonCounts,
    opportunity_hold_reason_counts: holdCounts,
    results,
    rejected,
  };
}

function economics(config, route) {
  const t = config.route_price_truth?.[`${route.from}|${route.to}|${route.vehicle_class}`];
  if (!t) return { status: 'HOLD', reason: REASON.ECONOMICS_UNKNOWN };
  if (t.fare_authority_approved !== true) return { status: 'HOLD', reason: REASON.FARE_AUTHORITY_UNAPPROVED };
  if (t.additional_cost_fjd == null) return { status: 'HOLD', reason: REASON.ADDITIONAL_COST_UNKNOWN };
  if (![t.operator_payout_fjd, t.additional_cost_fjd, t.absolute_floor_fjd, t.smart_match_price_fjd].every(isNonNeg)) return { status: 'HOLD', reason: REASON.INVALID_COMMERCIAL_INPUT };
  const req = config.contribution_requirement;
  if (!(req && req.approved === true && isNonNeg(req.min_fjd) && nonEmpty(req.approved_by))) return { status: 'HOLD', reason: REASON.CONTRIBUTION_REQUIREMENT_NOT_APPROVED };
  const cost = t.operator_payout_fjd + t.additional_cost_fjd;
  if (t.absolute_floor_fjd < cost) return { status: 'HOLD', reason: REASON.FLOOR_BELOW_KNOWN_COST };
  const price = enforceFloor(t.smart_match_price_fjd, t.absolute_floor_fjd).price;
  const contribution = Number((price - cost).toFixed(2));
  if (contribution < 0) return { status: 'HOLD', reason: REASON.NEGATIVE_CONTRIBUTION };
  if (contribution < req.min_fjd) return { status: 'HOLD', reason: REASON.BELOW_APPROVED_CONTRIBUTION };
  return { status: 'READY', price_fjd: price, contribution_fjd: contribution };
}

// CLI: node scripts/seven_day_pilot.js --input verified.json --start 2026-09-22 [--out report.json]
if (process.argv[1]?.endsWith('seven_day_pilot.js')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
  const inputPath = arg('--input'); const start = arg('--start');
  if (!inputPath || !start) { console.error('usage: node scripts/seven_day_pilot.js --input verified_movements.json --start YYYY-MM-DD [--out report.json]'); process.exit(2); }
  const report = runSevenDayPilot(JSON.parse(readFileSync(inputPath, 'utf8')), { startDate: start });
  const text = JSON.stringify(report, null, 2);
  if (arg('--out')) writeFileSync(arg('--out'), text); else console.log(text);
}
