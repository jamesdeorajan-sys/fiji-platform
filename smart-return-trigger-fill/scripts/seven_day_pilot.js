/* Issue #54 — INTERNAL seven-day SHADOW pilot runner (recovery branch).
 *
 * Pure, in-memory, read-only. Writes nothing (no D1, no files unless the CLI is given --out),
 * sends nothing, publishes nothing, prices nothing publicly. Input is a SANITIZED, ops-VERIFIED
 * movement file (opaque refs, no names/phones/emails/notes) — see docs/OPS_VERIFIED_MOVEMENTS_CONTRACT.md.
 *
 * What it answers, per verified ARRIVAL leg (airport -> X) that has an assigned vehicle:
 *   - the PREDICTED EMPTY LEG (X -> airport) the same vehicle would otherwise drive empty;
 *   - already-SOLD reverse bookings that same vehicle can serve (a chain: deadhead avoided, NOT a discountable special);
 *   - a fleet-backed EMPTY-LEG OPPORTUNITY only if every operational gate passes, with the commercial verdict kept
 *     separate (HOLD unless verified payout + floor + an approved fare authority exist);
 *   - every rejected match with its reason.
 *
 * It never guesses: unknown duration, turnaround, capacity, passengers/luggage, vehicle assignment or economics is a HOLD
 * with a named reason. Placeholder geography (src/geo_seed.js) is NOT used: only exact reverse zone pairs are considered,
 * everything else is reported as NOT_EVALUATED_GEOGRAPHY_UNVERIFIED.
 */
import { zonedTimeToUtcIso } from '../src/production_adapter.js';
import { enforceFloor } from '../src/pricing.js';

export const REASON = Object.freeze({
  NOT_VERIFIED: 'NOT_VERIFIED',                         // movement lacks an ops/system confirmation with evidence
  NO_VEHICLE_ASSIGNMENT: 'NO_VEHICLE_ASSIGNMENT',       // cannot be fleet-backed without a named vehicle
  DIFFERENT_VEHICLE: 'DIFFERENT_VEHICLE',               // the candidate is assigned to another vehicle
  VEHICLE_CLASS_MISMATCH: 'VEHICLE_CLASS_MISMATCH',
  NOT_EXACT_REVERSE: 'NOT_EXACT_REVERSE',
  NOT_EVALUATED_GEOGRAPHY_UNVERIFIED: 'NOT_EVALUATED_GEOGRAPHY_UNVERIFIED',
  DURATION_UNKNOWN: 'DURATION_UNKNOWN',
  TURNAROUND_UNKNOWN: 'TURNAROUND_UNKNOWN',
  TIMING_INFEASIBLE: 'TIMING_INFEASIBLE',
  CAPACITY_UNKNOWN: 'CAPACITY_UNKNOWN',                 // passengers/luggage unknown, or capacity table not ops-confirmed
  CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
  VEHICLE_CONFLICT: 'VEHICLE_CONFLICT',                 // same vehicle already committed in the empty-leg window
  ECONOMICS_UNKNOWN: 'ECONOMICS_UNKNOWN',               // payout / floor / approved fare authority missing
  FARE_AUTHORITY_UNAPPROVED: 'FARE_AUTHORITY_UNAPPROVED',
});

const MIN = 60000;
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

function toMs(pickupLocal) {
  if (typeof pickupLocal !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/.exec(pickupLocal);
  if (!m) return null;
  const iso = zonedTimeToUtcIso(m[1], m[2]);
  return iso ? Date.parse(iso) : null;
}

function isVerified(m) {
  const c = m.confirmation;
  return !!c && ['ops_worksheet', 'system_accepted'].includes(c.source) && typeof c.confirmed_at === 'string' && typeof c.evidence_ref === 'string' && c.evidence_ref.length > 0;
}

function completionMs(m) {
  const start = toMs(m.pickup_local);
  if (start == null || !isNum(m.duration_minutes)) return null;
  return start + m.duration_minutes * MIN;
}

function capacityCheck(m, config) {
  const cap = config.vehicle_capacity_confirmed ? config.vehicle_capacity?.[m.vehicle_class] : null;
  if (!cap || !isNum(m.passengers) || !isNum(m.luggage)) return { ok: null, reason: REASON.CAPACITY_UNKNOWN };
  if (m.passengers > cap.pax || m.luggage > cap.bags) return { ok: false, reason: REASON.CAPACITY_EXCEEDED };
  return { ok: true };
}

function economics(config, route) {
  // Commercial gate only; never affects operational feasibility. An empty-leg special needs ALL of:
  //   an approved fare authority for the route, a verified operator payout for the vehicle class, and a floor.
  const t = config.route_price_truth?.[`${route.from}|${route.to}|${route.vehicle_class}`];
  if (!t) return { status: 'HOLD', reason: REASON.ECONOMICS_UNKNOWN };
  if (t.fare_authority_approved !== true) return { status: 'HOLD', reason: REASON.FARE_AUTHORITY_UNAPPROVED };
  if (!isNum(t.operator_payout_fjd) || !isNum(t.absolute_floor_fjd) || !isNum(t.smart_match_price_fjd)) return { status: 'HOLD', reason: REASON.ECONOMICS_UNKNOWN };
  const f = enforceFloor(t.smart_match_price_fjd, t.absolute_floor_fjd);
  return { status: 'READY', price_fjd: f.price, clamped: f.decision !== 'OK', contribution_fjd: Number((f.price - t.operator_payout_fjd).toFixed(2)) };
}

export function runSevenDayPilot(input, { startDate, days = 7 } = {}) {
  const config = input.config ?? {};
  const airport = config.airport_zone ?? 'Nadi Airport';
  const all = Array.isArray(input.movements) ? input.movements : [];
  const startMs = toMs(`${startDate}T00:00`);
  const endMs = startMs == null ? null : startMs + days * 24 * 60 * MIN;
  const inWindow = (m) => { const t = toMs(m.pickup_local); return t != null && startMs != null && t >= startMs && t < endMs; };

  const verified = all.filter(isVerified);
  const unverified = all.filter((m) => !isVerified(m));
  const pool = verified.filter(inWindow);
  const rejected = [];
  const results = [];
  const turnaround = isNum(config.turnaround_minutes) ? config.turnaround_minutes : null;

  for (const a of pool.filter((m) => m.pickup_zone === airport && m.dropoff_zone !== airport)) {
    const X = a.dropoff_zone;
    const out = { movement_ref: a.movement_ref, predicted_empty_leg: { from: X, to: airport, vehicle_class: a.vehicle_class }, chains: [], opportunity: null };
    const hold = [];
    if (!a.assigned_vehicle_ref) hold.push(REASON.NO_VEHICLE_ASSIGNMENT);
    const done = completionMs(a);
    if (!isNum(a.duration_minutes)) hold.push(REASON.DURATION_UNKNOWN);
    if (turnaround == null) hold.push(REASON.TURNAROUND_UNKNOWN);
    const earliest = done != null && turnaround != null ? done + turnaround * MIN : null;
    out.predicted_empty_leg.earliest_start_utc = earliest != null ? new Date(earliest).toISOString() : null;
    out.predicted_empty_leg.duration_basis = 'ASSUMED_EQUAL_TO_OUTBOUND_UNVERIFIED';

    // (1) already-sold reverse bookings this vehicle could serve
    for (const d of pool) {
      if (d.movement_ref === a.movement_ref) continue;
      const reasons = [];
      if (d.pickup_zone === X && d.dropoff_zone === airport) {
        if (d.vehicle_class !== a.vehicle_class) reasons.push(REASON.VEHICLE_CLASS_MISMATCH);
        if (a.assigned_vehicle_ref && d.assigned_vehicle_ref && d.assigned_vehicle_ref !== a.assigned_vehicle_ref) reasons.push(REASON.DIFFERENT_VEHICLE);
        if (!a.assigned_vehicle_ref) reasons.push(REASON.NO_VEHICLE_ASSIGNMENT);
        if (!isNum(a.duration_minutes)) reasons.push(REASON.DURATION_UNKNOWN);
        if (turnaround == null) reasons.push(REASON.TURNAROUND_UNKNOWN);
        const cap = capacityCheck(d, config);
        if (cap.ok !== true) reasons.push(cap.reason);
        if (earliest != null) {
          const dStart = toMs(d.pickup_local);
          if (dStart == null || dStart < earliest) reasons.push(REASON.TIMING_INFEASIBLE);
        }
        if (reasons.length) rejected.push({ source: a.movement_ref, candidate: d.movement_ref, reasons: [...new Set(reasons)] });
        else out.chains.push({ candidate: d.movement_ref, note: 'sold reverse booking the same vehicle can serve: deadhead avoided, not a discountable special' });
      } else if (d.pickup_zone !== X || d.dropoff_zone !== airport) {
        if (d.pickup_zone === X || d.dropoff_zone === airport) rejected.push({ source: a.movement_ref, candidate: d.movement_ref, reasons: [REASON.NOT_EXACT_REVERSE, REASON.NOT_EVALUATED_GEOGRAPHY_UNVERIFIED] });
      }
    }

    // (2) fleet-backed empty-leg opportunity: only when no sold reverse booking already fills it
    if (out.chains.length === 0) {
      if (a.assigned_vehicle_ref && earliest != null) {
        // Empty-leg window = [earliest start, earliest start + outbound duration]. The reverse duration equal to the
        // outbound duration is an UNVERIFIED assumption, recorded in the output. A same-vehicle movement whose completion
        // is unknown cannot be ruled out, so it also counts as a conflict.
        const wEnd = earliest + a.duration_minutes * MIN;
        const conflict = pool.some((o) => {
          if (o.movement_ref === a.movement_ref || o.assigned_vehicle_ref !== a.assigned_vehicle_ref) return false;
          const st = toMs(o.pickup_local); if (st == null || st >= wEnd) return false;
          const en = completionMs(o); return en == null || en > earliest;
        });
        if (conflict) hold.push(REASON.VEHICLE_CONFLICT);
      }
      const eco = economics(config, { from: X, to: airport, vehicle_class: a.vehicle_class });
      const operational = hold.length === 0 ? 'FEASIBLE' : 'HOLD';
      out.opportunity = { operational, operational_hold_reasons: [...new Set(hold)], commercial: eco.status, commercial_reason: eco.reason ?? null, price_fjd: operational === 'FEASIBLE' && eco.status === 'READY' ? eco.price_fjd : null, contribution_fjd: operational === 'FEASIBLE' && eco.status === 'READY' ? eco.contribution_fjd : null };
    }
    results.push(out);
  }

  const reasonCounts = {};
  for (const r of rejected) for (const x of r.reasons) reasonCounts[x] = (reasonCounts[x] || 0) + 1;
  const holdCounts = {};
  for (const r of results) if (r.opportunity) for (const x of [...r.opportunity.operational_hold_reasons, ...(r.opportunity.commercial === 'HOLD' ? [r.opportunity.commercial_reason] : [])]) holdCounts[x] = (holdCounts[x] || 0) + 1;

  return {
    window: { start_date: startDate, days },
    shadow_only: true,
    counts: {
      movements_supplied: all.length,
      verified_movements: verified.length,
      not_verified_excluded: unverified.length,
      verified_in_window: pool.length,
      arrival_legs_evaluated: results.length,
      sold_reverse_chains: results.reduce((n, r) => n + r.chains.length, 0),
      opportunities_operationally_feasible: results.filter((r) => r.opportunity?.operational === 'FEASIBLE').length,
      opportunities_ready_to_price: results.filter((r) => r.opportunity?.operational === 'FEASIBLE' && r.opportunity?.commercial === 'READY').length,
      opportunities_on_hold: results.filter((r) => r.opportunity && !(r.opportunity.operational === 'FEASIBLE' && r.opportunity.commercial === 'READY')).length,
      rejected_matches: rejected.length,
    },
    rejection_reason_counts: reasonCounts,
    opportunity_hold_reason_counts: holdCounts,
    results,
    rejected,
  };
}

// CLI: node scripts/seven_day_pilot.js --input verified.json --start 2026-09-22 [--out report.json]
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('seven_day_pilot.js')) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const arg = (k) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
  const inputPath = arg('--input'); const start = arg('--start');
  if (!inputPath || !start) { console.error('usage: node scripts/seven_day_pilot.js --input verified_movements.json --start YYYY-MM-DD [--out report.json]'); process.exit(2); }
  const report = runSevenDayPilot(JSON.parse(readFileSync(inputPath, 'utf8')), { startDate: start });
  const text = JSON.stringify(report, null, 2);
  if (arg('--out')) writeFileSync(arg('--out'), text); else console.log(text);
}
