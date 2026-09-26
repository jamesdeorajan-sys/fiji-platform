/* Issue #54 - BOOKING-LED PLANNING stage (recovery branch). PLANNING ONLY.
 *
 * Builds a provisional plan from SAVED booking records: legs (arrivals plus the actually-recorded return legs), potential arrival/return
 * pairings from recorded routes and times, unmatched requests with a hypothetical positioning need, and for each item the known facts, the missing inputs and the
 * allocation decision ops must make.
 *
 * What this stage is NOT: it never labels anything operationally feasible (that stays with the verified pilot in scripts/seven_day_pilot.js),
 * it never proposes changing a guest's pickup time or service, it never turns a pairing or a positioning need into a discounted offer, never treats a candidate pairing as an allocation, fill, saving or inventory, and it
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
  RESOLVED_VIA_OPS_CONFIRMATION: 'RESOLVED_VIA_OPS_CONFIRMATION',
  RESOLVED_VIA_SERVING_SOURCE_MAPPING: 'RESOLVED_VIA_SERVING_SOURCE_MAPPING',
  UNRESOLVED_NO_MATCH: 'UNRESOLVED_NO_MATCH',
  UNRESOLVED_AMBIGUOUS: 'UNRESOLVED_AMBIGUOUS',
  UNRESOLVED_NO_LOCATION_RECORDED: 'UNRESOLVED_NO_LOCATION_RECORDED',
});

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const startMs = (date, time) => (date && time && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? Date.parse(zonedTimeToUtcIso(date, time) ?? '') : NaN);

const STOP = new Set(['the', 'fiji', 'resort', 'spa', 'hotel', 'and', 'island', 'beach', 'golf', 'villas', 'international', 'a', 'of']);
const tokens = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sig = (s) => tokens(s).split(' ').filter((t) => t && !STOP.has(t));

export const MATCH_CATEGORY = Object.freeze({
  EXACT_PLATFORM_MAPPING: 'EXACT_PLATFORM_MAPPING',
  EXACT_STOREFRONT_HOTEL_OPTION: 'EXACT_STOREFRONT_HOTEL_OPTION',
  NAMING_VARIANT: 'NAMING_VARIANT',
  AMBIGUOUS: 'AMBIGUOUS',
  UNKNOWN_PLACE: 'UNKNOWN_PLACE',
  MISSING_TEXT: 'MISSING_TEXT',
});

/** Candidate names/aliases from existing sources only: D1 destinations (name -> zone) and the live storefront's own hotel options / route pages (name -> area). */
function candidateNames(destinations, hotelOptions) {
  const c = (destinations ?? []).map((d) => ({ name: d.name, zone: d.zone, source: 'platform destinations table (name -> zone)', kind: 'platform' }));
  for (const o of hotelOptions ?? []) c.push({ name: o.name, zone: o.zone, source: o.source ?? 'storefront hotel option (data-hotel -> data-area)', kind: o.kind ?? 'storefront' });
  return c.filter((x) => x.name && x.zone);
}

/**
 * Classifies a recorded return-pickup string against existing names/aliases. Evidence is returned for ops to CONFIRM; nothing here is
 * verified and the location stays unresolved until an exact platform-mapping match or an explicit ops confirmation.
 */
export function classifyReturnLocation(original, destinations, hotelOptions) {
  if (original == null || String(original).trim() === '') return { category: MATCH_CATEGORY.MISSING_TEXT, suggestion: null, evidence: [] };
  const cands = candidateNames(destinations, hotelOptions);
  const exactPlatform = cands.filter((x) => x.kind === 'platform' && tokens(x.name) === tokens(original));
  if (new Set(exactPlatform.map((x) => x.zone)).size === 1) return { category: MATCH_CATEGORY.EXACT_PLATFORM_MAPPING, suggestion: { zone: exactPlatform[0].zone }, evidence: exactPlatform.map((x) => ({ source: x.source, name: x.name, zone: x.zone, method: 'exact (case/punctuation-insensitive)' })) };
  const exactStore = cands.filter((x) => x.kind !== 'platform' && tokens(x.name) === tokens(original));
  if (exactStore.length && new Set(exactStore.map((x) => x.zone)).size === 1)
    return { category: MATCH_CATEGORY.EXACT_STOREFRONT_HOTEL_OPTION, suggestion: { zone: exactStore[0].zone, verified: false }, evidence: exactStore.map((x) => ({ source: x.source, name: x.name, zone: x.zone, method: 'exact (case/punctuation-insensitive)' })) };
  const so = sig(original); const o = tokens(original);
  const variant = cands.filter((x) => { const sx = sig(x.name); const t = tokens(x.name); if (!sx.length || !so.length) return false; return o.includes(t) || t.includes(o) || sx.every((k) => so.includes(k)) || so.every((k) => sx.includes(k)); });
  const zones = [...new Set(variant.map((x) => x.zone))];
  const ev = variant.map((x) => ({ source: x.source, name: x.name, zone: x.zone, method: 'naming variant (containment / significant-word overlap)' }));
  if (exactStore.length > 1 || zones.length > 1) return { category: MATCH_CATEGORY.AMBIGUOUS, suggestion: null, evidence: ev.length ? ev : exactStore.map((x) => ({ source: x.source, name: x.name, zone: x.zone, method: 'exact' })) };
  if (zones.length === 1) return { category: MATCH_CATEGORY.NAMING_VARIANT, suggestion: { zone: zones[0], verified: false }, evidence: ev };
  return { category: MATCH_CATEGORY.UNKNOWN_PLACE, suggestion: null, evidence: [] };
}

/** Existing platform mapping only (exact name -> zone), original preserved; otherwise unresolved, with the classification/evidence attached. */
export function normalizeReturnLocation(original, destinations, hotelOptions) {
  const cls = classifyReturnLocation(original, destinations, hotelOptions);
  if (cls.category === MATCH_CATEGORY.MISSING_TEXT) return { original: original ?? null, zone: null, status: LOCATION_STATUS.UNRESOLVED_NO_LOCATION_RECORDED, category: cls.category, suggestion: null, evidence: [] };
  if (cls.category === MATCH_CATEGORY.EXACT_PLATFORM_MAPPING) return { original, zone: cls.suggestion.zone, status: LOCATION_STATUS.RESOLVED_VIA_PLATFORM_MAPPING, mapping_source: 'destinations.name -> zones.name (existing platform mapping; not independently verified)', category: cls.category, evidence: cls.evidence };
  const status = cls.category === MATCH_CATEGORY.AMBIGUOUS ? LOCATION_STATUS.UNRESOLVED_AMBIGUOUS : LOCATION_STATUS.UNRESOLVED_NO_MATCH;
  const suggestion = cls.suggestion ? { ...cls.suggestion, verified: false, basis: `${cls.category}: existing name/alias evidence; ops must confirm`, matched_destination_names: cls.evidence.map((e) => e.name) } : null;
  return { original, zone: null, status, category: cls.category, suggestion, evidence: cls.evidence };
}


const SOURCE_KEY = { FTT: 'FTT', FD: 'FD' };   // ref prefix -> serving source; NOREF rows have no known serving source

/**
 * GEOGRAPHIC resolution only. A recorded return-pickup string resolves to a zone when the SERVING SOURCE of the booking's own storefront
 * carries an explicit, unambiguous hotel -> area mapping (option data-hotel -> data-area) and its own zone rule (resolveFixedDestinationZone) maps
 * that area 1:1 to a marketplace zone. Name-only options, several options with different areas, a conflict with the other storefront's source or
 * the platform table, or an area with no 1:1 zone all leave the zone UNRESOLVED (an exception for ops). Agreement with the outbound zone is never
 * used as evidence. This is NOT confirmation of guest, time or the actual pickup arrangement.
 */
export function resolveViaServingSource(original, storefront, mapping, destinations) {
  const key = SOURCE_KEY[storefront];
  if (!mapping || !key || !mapping.sources?.[key]) return { resolved: false, exception: 'NO_SERVING_SOURCE_FOR_THIS_RECORD' };
  const t = tokens(original); if (!t) return { resolved: false, exception: 'MISSING_TEXT' };
  const src = mapping.sources[key];
  const hits = src.options_with_area.filter((o) => (o.hotel && tokens(o.hotel) === t) || (!o.hotel && tokens(o.label) === t));
  if (!hits.length) return { resolved: false, exception: 'NAME_NOT_IN_SERVING_SOURCE_WITH_AREA' };
  const areas = [...new Set(hits.map((h) => h.area))];
  if (areas.length > 1) return { resolved: false, exception: 'CONFLICT_SEVERAL_AREAS_IN_SERVING_SOURCE', detail: areas };
  const area = areas[0]; const rule = src.zone_rule;
  const zone = (rule.marketplace_zone_names ?? []).includes(area) ? area : (rule.area_zone_aliases ?? {})[area] ?? null;
  if (!zone) return { resolved: false, exception: 'AREA_HAS_NO_ONE_TO_ONE_ZONE (NEEDS_LOOKUP)', detail: area };
  const dups = src.name_only_options.filter((o) => tokens(o.label) === t);
  const dupConflict = dups.filter((o) => hits.every((h) => o.lat && h.lat && (o.lat !== h.lat || o.lng !== h.lng)));
  if (dupConflict.length) return { resolved: false, exception: 'CONFLICT_NAME_ONLY_OPTION_AT_DIFFERENT_COORDINATES' };
  for (const [otherKey, other] of Object.entries(mapping.sources)) {
    if (otherKey === key) continue;
    const oh = other.options_with_area.filter((o) => (o.hotel && tokens(o.hotel) === t) || (!o.hotel && tokens(o.label) === t));
    const oz = [...new Set(oh.map((o) => ((other.zone_rule.marketplace_zone_names ?? []).includes(o.area) ? o.area : (other.zone_rule.area_zone_aliases ?? {})[o.area] ?? o.area)))];
    if (oz.length && (oz.length > 1 || oz[0] !== zone)) return { resolved: false, exception: 'CONFLICT_BETWEEN_STOREFRONT_SOURCES', detail: { [key]: zone, [otherKey]: oz } };
  }
  const platform = (destinations ?? []).filter((d) => tokens(d.name) === t);
  if (platform.length && new Set(platform.map((x) => x.zone)).size === 1 && platform[0].zone !== zone) return { resolved: false, exception: 'CONFLICT_WITH_PLATFORM_DESTINATIONS_TABLE' };
  return { resolved: true, zone, mapping: { storefront: src.storefront, serving_source_url: src.url, index_sha256: src.index_sha256, app_js_sha256: src.app_js_sha256, retrieved_utc: mapping.built_utc,
    option_values: hits.map((h) => h.value), data_hotel: hits[0].hotel ?? hits[0].label, data_area: area, zone_rule: `${rule.function} line ${rule.app_js_line}: ${rule.logic}`,
    name_only_duplicates_same_coordinates: dups.map((o) => o.value), history_check: mapping.history_check?.[key] ?? null,
    limits: 'Geographic mapping only. Does not confirm the guest, the pickup time, or the actual pickup arrangement (the recorded text is the widget\'s pre-filled default unless the guest edited it).' } };
}

function confirmationOf(row) {
  return { status: 'SAVED_REQUEST_NOT_GUEST_CONFIRMED', guest_confirmation: 'UNKNOWN', provider_accepted_alert: row.provider_alert_accepted === true ? 'YES (delivery to staff not proven)' : 'NO_RECORD', booking_status_in_system: row.status ?? 'unknown' };
}

/** rows: sanitized saved-booking records (see tests for the shape). */
export function buildLegs(rows, { destinations, hotelOptions, servingSourceMapping, zoneDistanceCache, windowStart, windowEnd, locationCorrections, knownZones }) {
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
      let loc = normalizeReturnLocation(r.return_pickup_location, destinations, hotelOptions);
      if (loc.zone == null && loc.category !== MATCH_CATEGORY.MISSING_TEXT) {
        const via = resolveViaServingSource(r.return_pickup_location, r.store, servingSourceMapping, destinations);
        if (via.resolved) loc = { ...loc, zone: via.zone, status: LOCATION_STATUS.RESOLVED_VIA_SERVING_SOURCE_MAPPING, geographic_resolution: via.mapping, resolved_by: 'serving-source hotel->zone mapping' };
        else if (servingSourceMapping) loc = { ...loc, mapping_exception: via.exception, mapping_exception_detail: via.detail ?? null };
      }
      const fix = locationCorrections?.[r.id];
      if (fix) {   // explicit ops confirmation: needs a known zone, a named confirmer and an evidence pointer; the recorded text is preserved
        const ok = (knownZones ?? []).includes(fix.zone) && typeof fix.confirmed_by === 'string' && fix.confirmed_by.trim() && typeof fix.evidence_ref === 'string' && fix.evidence_ref.trim();
        loc = ok ? { ...loc, zone: fix.zone, status: LOCATION_STATUS.RESOLVED_VIA_OPS_CONFIRMATION, resolved_by: 'ops confirmation' }
                 : { ...loc, ops_correction_rejected: 'OPS_CORRECTION_INVALID (needs a known zone, confirmed_by and evidence_ref)' };
      }
      legs.push({ ...base, leg_id: `L${String(++n).padStart(3, '0')}`, kind: 'RETURN', date: r.return_date, time: r.return_time ?? null, start_ms: startMs(r.return_date, r.return_time),
        from_zone: loc.zone, to_zone: AIRPORT, location: loc, booking_outbound_zone: r.destination_zone ?? null, pickup_arrangement_verified: false, distance: loc.zone ? cacheKm(loc.zone) : null, flight_recorded: false });
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
    if (ret.location?.status === LOCATION_STATUS.RESOLVED_VIA_SERVING_SOURCE_MAPPING) missing.push(`verify the actual pickup arrangement for ${ret.leg_id} (the zone is mapped from the widget's hotel option; that is geography only - it does not confirm where or when the guest will actually be collected)`);
    missing.push('turnaround minutes between the two jobs', 'vehicle capacity for the booked class', 'vehicle/driver identity and availability');
    for (const l of [x, y]) {
      if (l.passengers == null || l.luggage == null) missing.push(`passengers/luggage for ${l.leg_id}`);
      if (l.confirmation.guest_confirmation === 'UNKNOWN') missing.push(`guest confirmation status for ${l.leg_id}`);
    }
    const flags = [...new Set([...x.uncertainty_flags, ...y.uncertainty_flags])];
    if (flags.length) missing.push(`resolve test/duplicate uncertainty: ${flags.join(', ')}`);
    pairings.push({
      pairing_id: `P${String(++n).padStart(3, '0')}`, conditional_on_location_confirmation: isConditional, scenario_only_outbound_zone_assumed: isScenario,
      type: seqA ? 'SAVED_REQUEST_PAIRING_ARRIVAL_THEN_RETURN' : 'SAVED_REQUEST_PAIRING_RETURN_THEN_ARRIVAL',
      first_leg: x.leg_id, second_leg: y.leg_id, zone,
      note: 'Both legs are saved requests (guest confirmation unknown; no verified vehicle movement). This is one COMPETING ALTERNATIVE for ops to select or reject - not an allocation, not a filled leg, not a saving, not inventory, not an offer, and not a feasibility conclusion.',
      does_not_allocate: true, alternative_of_legs: [x.leg_id, y.leg_id],
      facts: { recorded_pickup_gap_minutes: gap, first_pickup: `${x.date} ${x.time}`, second_pickup: `${y.date} ${y.time}`, booked_class: x.vehicle_class_booked, distance_first_leg: x.distance ?? null, guest_pickup_times_fixed: true },
      duration: dur,
      timing_check_for_ops: dur.status === 'DURATION_UNKNOWN'
        ? `Ops to state the real drive time for each leg and turnaround, then check the ${gap}-minute recorded gap covers the first job plus turnaround. Timing conclusion: NOT_DETERMINED.`
        : `PROVISIONAL (${dur.source}, as of ${dur.as_of}): ${dur.minutes} min for the reverse route; ops to confirm before any conclusion. Timing conclusion: NOT_DETERMINED.`,
      current_assignments: { first: ax, second: ay },
      decision, reassignment_proposal: proposal,
      allocation_decision_for_ops: 'Choose one vehicle for both legs (or keep separate); confirm timing; confirm the guests\' pickup times and services stay as booked.',
      missing_inputs: missing, uncertainty_flags: flags,
      planning_status: isScenario ? 'SCENARIO_ONLY_NOT_A_PLANNING_CANDIDATE_UNTIL_LOCATION_CONFIRMED' : isConditional ? 'PLANNING_CANDIDATE_CONDITIONAL_ON_LOCATION_CONFIRMATION' : (ret.location?.status === LOCATION_STATUS.RESOLVED_VIA_SERVING_SOURCE_MAPPING ? 'PLANNING_CANDIDATE_ZONE_MAPPING_RESOLVED_NOT_OPERATIONALLY_CONFIRMED' : 'PLANNING_CANDIDATE_NOT_VERIFIED'),
      zone_resolution: ret.location?.status ?? null,
    });
  }
  return { pairings, skipped };
}

/** Requests with no candidate partner in the saved records. Provisional: without verified vehicle movements this is a HYPOTHETICAL positioning need, not an empty leg and not an offer. */
export function buildUnmatchedRequests(legs, pairings) {
  const inAlternatives = new Set(pairings.flatMap((p) => [p.first_leg, p.second_leg]));
  const out = [];
  for (const l of legs) {
    if (inAlternatives.has(l.leg_id)) continue;
    const base = { leg_id: l.leg_id, type: 'UNMATCHED_REQUEST', need: 'HYPOTHETICAL_POSITIONING_NEED', provisional_status: 'PROVISIONAL_UNTIL_OPS_SELECTS_AND_VALIDATES_A_SCHEDULE', planning_status: 'PLANNING_CANDIDATE_NOT_VERIFIED' };
    if (l.kind === 'ARRIVAL') out.push({ ...base, direction: 'RETURN_TO_AIRPORT_AFTER_ARRIVAL', from_zone: l.to_zone, to_zone: AIRPORT, after: `${l.date} ${l.time}`, note: 'Hypothetical: no saved request in the records is a candidate partner for this arrival. Whether a vehicle would actually travel back empty depends on a verified vehicle movement and availability. Not an offer.' });
    else out.push({ ...base, direction: 'OUTBOUND_POSITIONING_BEFORE_RETURN_PICKUP', from_zone: AIRPORT, to_zone: l.from_zone, before: `${l.date} ${l.time}`, note: l.from_zone ? 'Hypothetical: no saved request in the records is a candidate partner for this return. Not an offer.' : 'Cannot be assessed: the return pickup zone is unresolved.' });
  }
  return out;
}

/** Candidate pairings share legs, so they are COMPETING ALTERNATIVES. Groups = connected components; upper bound = max set of alternatives using each leg at most once. */
export function buildAlternativeGroups(pairings) {
  const parent = new Map(); const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const p of pairings) for (const id of [p.first_leg, p.second_leg]) if (!parent.has(id)) parent.set(id, id);
  for (const p of pairings) parent.set(find(p.first_leg), find(p.second_leg));
  const groups = new Map();
  for (const p of pairings) { const r = find(p.first_leg); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); }
  const out = []; let n = 0;
  for (const list of groups.values()) {
    const id = `G${String(++n).padStart(2, '0')}`;
    // maximum matching between arrival-side and return-side legs (Kuhn)
    const isArr = (p, leg) => (p.type.endsWith('ARRIVAL_THEN_RETURN') ? p.first_leg === leg : p.second_leg === leg);
    const left = [...new Set(list.map((p) => (p.type.endsWith('ARRIVAL_THEN_RETURN') ? p.first_leg : p.second_leg)))];
    const adj = Object.fromEntries(left.map((a) => [a, list.filter((p) => isArr(p, a)).map((p) => (p.type.endsWith('ARRIVAL_THEN_RETURN') ? p.second_leg : p.first_leg))]));
    const match = new Map(); const tryA = (a, seen) => { for (const r of adj[a]) { if (seen.has(r)) continue; seen.add(r); if (!match.has(r) || tryA(match.get(r), seen)) { match.set(r, a); return true; } } return false; };
    let best = 0; for (const a of left) if (tryA(a, new Set())) best++;
    for (const p of list) p.alternative_group = id;
    out.push({ group_id: id, alternatives: list.length, legs: new Set(list.flatMap((p) => [p.first_leg, p.second_leg])).size, non_overlapping_leg_upper_bound: best });
  }
  return out;
}

const bucket = (m) => (m < 60 ? '<60' : m < 180 ? '60-179' : m < 360 ? '180-359' : '>=360');

/** Aggregate-only summary (no ids, locations, times of individual bookings). */
export function summarizePlan({ legs, pairings, skipped, empties, groups }, label) {
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
    return_location_match_category: count(returns, (l) => l.location.category ?? 'NOT_CLASSIFIED'),
    return_location_mapping_exceptions: count(returns.filter((l) => l.location.mapping_exception), (l) => l.location.mapping_exception),
    return_locations_with_unverified_zone_suggestion: returns.filter((l) => l.location.suggestion).length,
    return_legs_missing_time: returns.filter((l) => !l.time).length,
    distance_available: { arrival_from_bookings: arrivals.filter((l) => l.distance).length, return_from_zone_cache: returns.filter((l) => l.distance).length },
    confirmation: count(legs, (l) => l.confirmation.status),
    provider_accepted_alert: count(legs, (l) => l.confirmation.provider_accepted_alert),
    uncertainty_flags: count(legs.flatMap((l) => l.uncertainty_flags.map((f) => ({ f }))), (x) => x.f),
    legs_with_any_uncertainty_flag: legs.filter((l) => l.uncertainty_flags.length).length,
    competing_alternatives: { statement: 'Pairings are COMPETING ALTERNATIVES that share legs. They are not additive bookings, not savings, not inventory; a pairing does not allocate or fill any leg. Ops selects and validates a schedule. The non-overlapping-leg upper bound is only the most alternatives that share no leg - it is not a dispatchable schedule and not additional bookings.', pairing_alternatives: pairings.length, alternative_groups: (groups ?? []).length, alternatives_per_group: (groups ?? []).map((g) => g.alternatives), non_overlapping_leg_upper_bound_per_group: (groups ?? []).map((g) => g.non_overlapping_leg_upper_bound), legs_allocated: 0 },
    potential_pairings: { total: pairings.length, confirmed_mapping: pairings.filter((p) => !p.conditional_on_location_confirmation && !p.scenario_only_outbound_zone_assumed).length, conditional_on_location_confirmation: pairings.filter((p) => p.conditional_on_location_confirmation).length, scenario_only_outbound_zone_assumed: pairings.filter((p) => p.scenario_only_outbound_zone_assumed).length, zone_mapping_resolved_not_operationally_confirmed: pairings.filter((p) => p.planning_status === 'PLANNING_CANDIDATE_ZONE_MAPPING_RESOLVED_NOT_OPERATIONALLY_CONFIRMED').length, by_type: count(pairings, (p) => p.type), by_gap_minutes_bucket: count(pairings, (p) => bucket(p.facts.recorded_pickup_gap_minutes)), by_decision: count(pairings, (p) => p.decision),
      legs_with_at_least_one_candidate: Object.keys(candidatesPerLeg).length, legs_with_competing_candidates: Object.values(candidatesPerLeg).filter((v) => v > 1).length,
      duration_status: count(pairings, (p) => p.duration.status), timing_conclusion: 'NOT_DETERMINED for every pairing' },
    not_paired_reasons: skipped,
    unmatched_requests_hypothetical_positioning_need: { total: empties.length, by_direction: count(empties, (e) => e.direction), status: 'PROVISIONAL_UNTIL_OPS_SELECTS_AND_VALIDATES_A_SCHEDULE' },
    pairings_with_missing_drive_minutes: pairings.filter((p) => p.missing_inputs.some((m) => /DURATION_UNKNOWN/.test(m))).length,
    pairings_with_unknown_passengers_or_luggage: pairings.filter((p) => p.missing_inputs.some((m) => /passengers\/luggage/.test(m))).length,
  };
}

export function buildPlan(rows, ctx) {
  const { legs } = buildLegs(rows, ctx);
  const { pairings, skipped } = buildPairings(legs, { routeDurationEstimates: ctx.routeDurationEstimates, conditional: ctx.conditional !== false, scenarioOutbound: ctx.scenarioOutbound === true });
  const groups = buildAlternativeGroups(pairings);
  const empties = buildUnmatchedRequests(legs, pairings);
  const inAlt = new Set(pairings.flatMap((p) => [p.first_leg, p.second_leg]));
  for (const l of legs) { l.allocation_status = 'UNALLOCATED'; l.provisional_status = inAlt.has(l.leg_id) ? 'HAS_COMPETING_CANDIDATE_ALTERNATIVES_NOT_ALLOCATED' : 'UNMATCHED_REQUEST_PROVISIONAL'; }
  return { legs, pairings, skipped, empties, groups, summary: summarizePlan({ legs, pairings, skipped, empties, groups }, `${ctx.windowStart}..${ctx.windowEnd}`) };
}
