/* Issue #54 - BOOKING-LED PLANNING stage (recovery branch). PLANNING ONLY.
 *
 * Builds a provisional plan from SAVED booking records: legs (arrivals plus the actually-recorded return legs), potential arrival/return
 * pairings from recorded routes and times, unsold potential empty legs, and for each item the known facts, the missing inputs and the
 * allocation decision ops must make.
 *
 * What this stage is NOT: it never labels anything operationally feasible (that stays with the verified pilot in scripts/seven_day_pilot.js),
 * it never proposes changing a guest's pickup time or service, it never turns a pairing or an empty leg into a discounted offer, and it
 * never invents a duration. Duration is DURATION_UNKNOWN unless a traceable estimate is supplied (source + date + provisional status).
 * Return locations are normalised to a zone ONLY through the existing platform mapping (destinations name -> zone), exact match, keeping the
 * original text; anything else stays unresolved and is never replaced by the outbound destination.
 */
import { zonedTimeToUtcIso } from './production_adapter.js';

export const AIRPORT = 'Nadi Airport';
export const DECISION = Object.freeze({
  NEEDS_DISPATCH_ALLOCATION: 'NEEDS_DISPATCH_ALLOCATION',
  PROPOSE_ALLOCATE_SECOND_TO_SAME_VEHICLE: 'PROPOSE_ALLOCATE_SECOND_TO_SAME_VEHICLE',
  SAME_VEHICLE_ALREADY_CONFIRM_TIMING: 'SAME_VEHICLE_ALREADY_CONFIRM_TIMING',
  REASSIGNMENT_PROPOSAL_FOR_OPS_REVIEW: 'REASSIGNMENT_PROPOSAL_FOR_OPS_REVIEW',
});
export const LOCATION_STATUS = Object.freeze({
  RESOLVED_VIA_PLATFORM_MAPPING: 'RESOLVED_VIA_PLATFORM_MAPPING',
  UNRESOLVED_NO_MATCH: 'UNRESOLVED_NO_MATCH',
  UNRESOLVED_AMBIGUOUS: 'UNRESOLVED_AMBIGUOUS',
  UNRESOLVED_NO_LOCATION_RECORDED: 'UNRESOLVED_NO_LOCATION_RECORDED',
});

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const startMs = (date, time) => (date && time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? Date.parse(zonedTimeToUtcIso(date, time) ?? '') : NaN);

/** Existing platform mapping only: exact (case/space-insensitive) name match -> zone; original value is always preserved. */
export function normalizeReturnLocation(original, destinations) {
  if (original == null || String(original).trim() === '') return { original: original ?? null, zone: null, status: LOCATION_STATUS.UNRESOLVED_NO_LOCATION_RECORDED };
  const hits = (destinations ?? []).filter((d) => norm(d.name) === norm(original));
  const zones = [...new Set(hits.map((h) => h.zone))];
  if (zones.length === 1) return { original, zone: zones[0], status: LOCATION_STATUS.RESOLVED_VIA_PLATFORM_MAPPING, mapping_source: 'destinations.name -> zones.name (existing platform mapping; not independently verified)' };
  if (zones.length > 1) return { original, zone: null, status: LOCATION_STATUS.UNRESOLVED_AMBIGUOUS };
  return { original, zone: null, status: LOCATION_STATUS.UNRESOLVED_NO_MATCH, suggestion: suggestZone(original, destinations) };
}

const tokens = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** NOT a normalisation: a punctuation-insensitive containment hint for ops to confirm. The location stays UNRESOLVED and no verified pairing is built from it. */
function suggestZone(original, destinations) {
  const o = tokens(original); if (!o) return null;
  const hits = (destinations ?? []).filter((d) => { const t = tokens(d.name); return t && (o.includes(t) || t.includes(o)); });
  const zones = [...new Set(hits.map((h) => h.zone))];
  return zones.length === 1 ? { zone: zones[0], verified: false, basis: 'punctuation-insensitive containment with an existing destination name; ops must confirm', matched_destination_names: hits.map((h) => h.name) } : null;
}

function confirmationOf(row) {
  return { status: 'SAVED_REQUEST_NOT_GUEST_CONFIRMED', guest_confirmation: 'UNKNOWN', provider_accepted_alert: row.provider_alert_accepted === true ? 'YES (delivery to staff not proven)' : 'NO_RECORD', booking_status_in_system: row.status ?? 'unknown' };
}

/** rows: sanitized saved-booking records (see tests for the shape). */
export function buildLegs(rows, { destinations, zoneDistanceCache, windowStart, windowEnd }) {
  const legs = []; const notes = { rows_in_scope: 0 }; let n = 0;
  const inWin = (d) => d && d >= windowStart && d <= windowEnd;
  const cacheKm = (zone) => { const c = (zoneDistanceCache ?? []).find((x) => (x.zone_a === AIRPORT && x.zone_b === zone) || (x.zone_b === AIRPORT && x.zone_a === zone)); return c ? { km: c.distance_km, source: `zone_distance_cache (server cache, saved ${String(c.created_at).slice(0, 10)})` } : null; };
  for (const r of rows) {
    const flags = [];
    if (r.flags?.test_uncertain) flags.push('TEST_UNCERTAIN');
    if (r.flags?.dup_d1) flags.push('DUPLICATE_RETRY_D1_EXCLUDED_FROM_PRIMARY_COUNTS');
    if (r.flags?.dup_trip) flags.push('POSSIBLE_DUPLICATE_TRIP_KEY');
    const load = { passengers: Number.isInteger(r.passengers) && r.passengers >= 1 ? r.passengers : null, luggage: Number.isInteger(r.luggage) && r.luggage >= 0 ? r.luggage : null };
    const base = { booking_id_private: r.id, storefront: r.store, vehicle_class_booked: r.vehicle_class ?? null, ...load, uncertainty_flags: flags, confirmation: confirmationOf(r), current_assignment: r.assigned_vehicle_ref ?? null, current_driver_assignment_in_system: r.assigned_driver_id ?? null };
    let used = false;
    if (inWin(r.pickup_date) && r.pickup_zone === AIRPORT) {
      used = true;
      legs.push({ ...base, leg_id: `L${String(++n).padStart(3, '0')}`, kind: 'ARRIVAL', date: r.pickup_date, time: r.pickup_time ?? null, start_ms: startMs(r.pickup_date, r.pickup_time),
        from_zone: AIRPORT, to_zone: r.destination_zone ?? null, location: { status: 'ZONE_RECORDED', original: r.destination_zone ?? null },
        distance: r.distance_km != null ? { km: r.distance_km, source: 'bookings.distance_km (server-calculated at save)' } : null, flight_recorded: r.flight_present === true });
    }
    if (r.return_date && inWin(r.return_date)) {
      used = true;
      const loc = normalizeReturnLocation(r.return_pickup_location, destinations);
      legs.push({ ...base, leg_id: `L${String(++n).padStart(3, '0')}`, kind: 'RETURN', date: r.return_date, time: r.return_time ?? null, start_ms: startMs(r.return_date, r.return_time),
        from_zone: loc.zone, to_zone: AIRPORT, location: loc, booking_outbound_zone: r.destination_zone ?? null, distance: loc.zone ? cacheKm(loc.zone) : null, flight_recorded: false });
    }
    if (used) notes.rows_in_scope++;
  }
  return { legs, notes };
}

const DURATION_UNKNOWN = { status: 'DURATION_UNKNOWN', source: null, provisional: null };
function durationFor(from, to, estimates) {
  const e = estimates?.[`${from}|${to}`];
  return e && Number.isFinite(e.minutes) && e.source && e.as_of ? { status: 'PROVISIONAL_ESTIMATE', minutes: e.minutes, source: e.source, as_of: e.as_of, provisional: true } : DURATION_UNKNOWN;
}

export function buildPairings(legs, { routeDurationEstimates, conditional = true, scenarioOutbound = false } = {}) {
  const pairings = []; let n = 0; const skipped = { different_zone_same_day: 0, class_differs_guest_service_fixed: 0, missing_time: 0, return_zone_unresolved: 0, simultaneous_pickups: 0 };
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
    let x = legs[i]; let y = legs[j];
    if (x.booking_id_private === y.booking_id_private || x.date !== y.date) continue;
    if (!((x.kind === 'ARRIVAL' && y.kind === 'RETURN') || (x.kind === 'RETURN' && y.kind === 'ARRIVAL'))) continue;
    if (!Number.isFinite(x.start_ms) || !Number.isFinite(y.start_ms)) { skipped.missing_time++; continue; }
    if (x.start_ms > y.start_ms) [x, y] = [y, x];                          // x runs first (recorded guest pickup times are fixed)
    if (x.start_ms === y.start_ms) { skipped.simultaneous_pickups++; continue; }
    const seqA = x.kind === 'ARRIVAL';
    const arrival = seqA ? x : y; const ret = seqA ? y : x;
    const suggested = conditional ? ret.location?.suggestion?.zone ?? null : null;
    // SCENARIO ONLY (explicit opt-in, never the default plan): treat an unresolved return pickup as the same booking's recorded outbound zone, pending ops confirmation.
    const scenarioZone = scenarioOutbound && ret.from_zone == null && suggested == null ? ret.booking_outbound_zone ?? null : null;
    const retZone = ret.from_zone ?? suggested ?? scenarioZone;
    const isScenario = scenarioZone != null && retZone === scenarioZone;
    const isConditional = ret.from_zone == null && suggested != null && !isScenario;
    if (retZone == null) { skipped.return_zone_unresolved++; continue; }
    if (retZone !== arrival.to_zone) { skipped.different_zone_same_day++; continue; }   // exact-zone pairings only; adjacency is unverified
    if (x.vehicle_class_booked !== y.vehicle_class_booked) { skipped.class_differs_guest_service_fixed++; continue; }
    const zone = arrival.to_zone;
    const gap = Math.round((y.start_ms - x.start_ms) / 60000);
    const dur = durationFor(seqA ? AIRPORT : zone, seqA ? zone : AIRPORT, routeDurationEstimates);
    const ax = x.current_assignment; const ay = y.current_assignment;
    let decision; let proposal = null;
    if (!ax && !ay) decision = DECISION.NEEDS_DISPATCH_ALLOCATION;
    else if (ax && ay && ax === ay) decision = DECISION.SAME_VEHICLE_ALREADY_CONFIRM_TIMING;
    else if (ax && ay) { decision = DECISION.REASSIGNMENT_PROPOSAL_FOR_OPS_REVIEW; proposal = `Serve both legs with one vehicle; ops to choose between ${ax} and ${ay} (or another). Guest times and booked class stay fixed.`; }
    else { decision = DECISION.PROPOSE_ALLOCATE_SECOND_TO_SAME_VEHICLE; proposal = `Leg ${ax ? y.leg_id : x.leg_id} is unassigned; ops to consider allocating it to ${ax ?? ay}.`; }
    const missing = [];
    if (dur.status === 'DURATION_UNKNOWN') missing.push(`drive minutes ${seqA ? AIRPORT : zone}->${seqA ? zone : AIRPORT} and ${seqA ? zone : AIRPORT}->${seqA ? AIRPORT : zone} (DURATION_UNKNOWN: no traceable route-duration estimate exists)`);
    if (isScenario) missing.unshift(`SCENARIO ONLY: the recorded return pickup text on ${ret.leg_id} is unresolved; this pairing assumes it equals the same booking's outbound zone (${retZone}). Ops must confirm the real return pickup location before it counts as a candidate.`);
    if (isConditional) missing.unshift(`CONFIRM return pickup location: recorded text on ${ret.leg_id} is unresolved; suggested zone ${retZone} (unverified suggestion - ops to confirm or correct)`);
    missing.push('turnaround minutes between the two jobs', 'vehicle capacity for the booked class', 'vehicle/driver identity and availability');
    for (const l of [x, y]) {
      if (l.passengers == null || l.luggage == null) missing.push(`passengers/luggage for ${l.leg_id}`);
      if (l.confirmation.guest_confirmation === 'UNKNOWN') missing.push(`guest confirmation status for ${l.leg_id}`);
    }
    const flags = [...new Set([...x.uncertainty_flags, ...y.uncertainty_flags])];
    if (flags.length) missing.push(`resolve test/duplicate uncertainty: ${flags.join(', ')}`);
    pairings.push({
      pairing_id: `P${String(++n).padStart(3, '0')}`, conditional_on_location_confirmation: isConditional, scenario_only_outbound_zone_assumed: isScenario,
      type: seqA ? 'SOLD_SEQUENCE_ARRIVAL_THEN_RETURN' : 'SOLD_SEQUENCE_RETURN_THEN_ARRIVAL',
      first_leg: x.leg_id, second_leg: y.leg_id, zone,
      note: 'Both legs are already-sold saved requests (not guest-confirmed). This is a planning candidate, not an offer and not a feasibility conclusion.',
      facts: { recorded_pickup_gap_minutes: gap, first_pickup: `${x.date} ${x.time}`, second_pickup: `${y.date} ${y.time}`, booked_class: x.vehicle_class_booked, distance_first_leg: x.distance ?? null, guest_pickup_times_fixed: true },
      duration: dur,
      timing_check_for_ops: dur.status === 'DURATION_UNKNOWN'
        ? `Ops to state the real drive time for each leg and turnaround, then check the ${gap}-minute recorded gap covers the first job plus turnaround. Timing conclusion: NOT_DETERMINED.`
        : `PROVISIONAL (${dur.source}, as of ${dur.as_of}): ${dur.minutes} min for the reverse route; ops to confirm before any conclusion. Timing conclusion: NOT_DETERMINED.`,
      current_assignments: { first: ax, second: ay },
      decision, reassignment_proposal: proposal,
      allocation_decision_for_ops: 'Choose one vehicle for both legs (or keep separate); confirm timing; confirm the guests\' pickup times and services stay as booked.',
      missing_inputs: missing, uncertainty_flags: flags,
      planning_status: isScenario ? 'SCENARIO_ONLY_NOT_A_PLANNING_CANDIDATE_UNTIL_LOCATION_CONFIRMED' : isConditional ? 'PLANNING_CANDIDATE_CONDITIONAL_ON_LOCATION_CONFIRMATION' : 'PLANNING_CANDIDATE_NOT_VERIFIED',
    });
  }
  return { pairings, skipped };
}

/** Unsold potential empty legs: an ARRIVAL with no sold candidate return, and a RETURN with no sold candidate arrival. Neither is an offer. */
export function buildPotentialEmptyLegs(legs, pairings) {
  const paired = new Set(pairings.flatMap((p) => [p.first_leg, p.second_leg]));
  const out = [];
  for (const l of legs) {
    if (paired.has(l.leg_id)) continue;
    if (l.kind === 'ARRIVAL') out.push({ leg_id: l.leg_id, type: 'UNSOLD_POTENTIAL_EMPTY_RETURN_LEG', from_zone: l.to_zone, to_zone: AIRPORT, after: `${l.date} ${l.time}`, note: 'Hypothetical: the vehicle that serves this arrival has no recorded sold job back from that zone. Not an offer; needs vehicle identity, duration, availability, economics and approvals.', planning_status: 'PLANNING_CANDIDATE_NOT_VERIFIED' });
    else out.push({ leg_id: l.leg_id, type: 'UNSOLD_POTENTIAL_EMPTY_POSITIONING_LEG', from_zone: AIRPORT, to_zone: l.from_zone, before: `${l.date} ${l.time}`, note: l.from_zone ? 'Hypothetical: no recorded sold job takes a vehicle out to this pickup zone beforehand. Not an offer.' : 'Cannot be assessed: the return pickup zone is unresolved.', planning_status: 'PLANNING_CANDIDATE_NOT_VERIFIED' });
  }
  return out;
}

const bucket = (m) => (m < 60 ? '<60' : m < 180 ? '60-179' : m < 360 ? '180-359' : '>=360');

/** Aggregate-only summary (no ids, locations, times of individual bookings). */
export function summarizePlan({ legs, pairings, skipped, empties }, label) {
  const count = (arr, f) => arr.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o; }, {});
  const returns = legs.filter((l) => l.kind === 'RETURN'); const arrivals = legs.filter((l) => l.kind === 'ARRIVAL');
  const candidatesPerLeg = {}; for (const p of pairings) for (const id of [p.first_leg, p.second_leg]) candidatesPerLeg[id] = (candidatesPerLeg[id] || 0) + 1;
  return {
    label, planning_only: true,
    statement: 'Planning candidates only. Nothing here is operationally feasible, verified for dispatch, a discounted offer, or a change to any booking or guest commitment.',
    rows_in_scope: new Set(legs.map((l) => l.booking_id_private)).size,
    legs: { total: legs.length, arrival: arrivals.length, return: returns.length, by_date: count(legs, (l) => l.date) },
    arrivals_by_destination_zone: count(arrivals, (l) => l.to_zone ?? 'UNKNOWN'),
    legs_by_booked_class: count(legs, (l) => l.vehicle_class_booked ?? 'UNKNOWN'),
    legs_with_passengers_and_luggage_known: legs.filter((l) => l.passengers != null && l.luggage != null).length,
    return_location_status: count(returns, (l) => l.location.status),
    return_locations_with_unverified_zone_suggestion: returns.filter((l) => l.location.suggestion).length,
    return_legs_missing_time: returns.filter((l) => !l.time).length,
    distance_available: { arrival_from_bookings: arrivals.filter((l) => l.distance).length, return_from_zone_cache: returns.filter((l) => l.distance).length },
    confirmation: count(legs, (l) => l.confirmation.status),
    provider_accepted_alert: count(legs, (l) => l.confirmation.provider_accepted_alert),
    uncertainty_flags: count(legs.flatMap((l) => l.uncertainty_flags.map((f) => ({ f }))), (x) => x.f),
    legs_with_any_uncertainty_flag: legs.filter((l) => l.uncertainty_flags.length).length,
    potential_pairings: { total: pairings.length, confirmed_mapping: pairings.filter((p) => !p.conditional_on_location_confirmation && !p.scenario_only_outbound_zone_assumed).length, conditional_on_location_confirmation: pairings.filter((p) => p.conditional_on_location_confirmation).length, scenario_only_outbound_zone_assumed: pairings.filter((p) => p.scenario_only_outbound_zone_assumed).length, by_type: count(pairings, (p) => p.type), by_gap_minutes_bucket: count(pairings, (p) => bucket(p.facts.recorded_pickup_gap_minutes)), by_decision: count(pairings, (p) => p.decision),
      legs_with_at_least_one_candidate: Object.keys(candidatesPerLeg).length, legs_with_competing_candidates: Object.values(candidatesPerLeg).filter((v) => v > 1).length,
      duration_status: count(pairings, (p) => p.duration.status), timing_conclusion: 'NOT_DETERMINED for every pairing' },
    not_paired_reasons: skipped,
    unsold_potential_empty_legs: count(empties, (e) => e.type),
    pairings_with_missing_drive_minutes: pairings.filter((p) => p.missing_inputs.some((m) => /DURATION_UNKNOWN/.test(m))).length,
    pairings_with_unknown_passengers_or_luggage: pairings.filter((p) => p.missing_inputs.some((m) => /passengers\/luggage/.test(m))).length,
  };
}

export function buildPlan(rows, ctx) {
  const { legs } = buildLegs(rows, ctx);
  const { pairings, skipped } = buildPairings(legs, { routeDurationEstimates: ctx.routeDurationEstimates, conditional: ctx.conditional !== false, scenarioOutbound: ctx.scenarioOutbound === true });
  const empties = buildPotentialEmptyLegs(legs, pairings);
  return { legs, pairings, skipped, empties, summary: summarizePlan({ legs, pairings, skipped, empties }, `${ctx.windowStart}..${ctx.windowEnd}`) };
}
