/* Issue #54 Stage 1 (SHADOW MODE) — deterministic match engine.
 * Rule-based only: given a movement and the pool of other movements, find
 * reverse/corridor/chain candidates and score them. No AI/LLM call in this
 * module — the issue permits AI to rank/explain candidates on top of this,
 * but the hard feasibility/economics verdict must stay deterministic.
 */
import { MATCH_TYPE, FEASIBILITY } from './model.js';
import { lookupDistance, isNearby, corridorOf, MIN_TURNAROUND_MINUTES } from './geo_seed.js';

function minutesBetween(isoA, isoB) {
  return Math.abs(new Date(isoB).getTime() - new Date(isoA).getTime()) / 60000;
}

function timeCompatible(movement, candidate) {
  const gapMinutes = minutesBetween(movement.pickup_datetime, candidate.pickup_datetime);
  return { compatible: gapMinutes >= MIN_TURNAROUND_MINUTES, gapMinutes };
}

function vehicleCompatible(movement, candidate) {
  return movement.vehicle_class === candidate.vehicle_class;
}

function classify(movement, candidate) {
  const isExactReverse =
    candidate.pickup_zone === movement.dropoff_zone && candidate.dropoff_zone === movement.pickup_zone;
  if (isExactReverse) return { type: MATCH_TYPE.EXACT_REVERSE, baseScore: 95 };

  const isNearbyReverse =
    isNearby(candidate.pickup_zone, movement.dropoff_zone) && isNearby(candidate.dropoff_zone, movement.pickup_zone);
  if (isNearbyReverse) return { type: MATCH_TYPE.NEARBY_REVERSE, baseScore: 75 };

  const corridor = corridorOf(movement.pickup_zone, movement.dropoff_zone);
  const candidateCorridor = corridorOf(candidate.pickup_zone, candidate.dropoff_zone);
  if (corridor && corridor === candidateCorridor) return { type: MATCH_TYPE.CORRIDOR, baseScore: 55 };

  const isExtensionChain = movement.dropoff_zone === candidate.pickup_zone;
  if (isExtensionChain) return { type: MATCH_TYPE.EXTENSION_CHAIN, baseScore: 45 };

  return null;
}

/**
 * Returns match candidates for `movement` against `pool` (all other known
 * movements). Each candidate carries a deterministic feasibility verdict —
 * HOLD_UNKNOWN_ECONOMICS whenever payout/floor data is missing, per the
 * hard rule "do not calculate an aggressive public fare on unknown
 * economics."
 */
export function computeMatchCandidates(movement, pool, { routePriceTruthLookup } = {}) {
  const candidates = [];

  for (const candidate of pool) {
    if (candidate.movement_id === movement.movement_id) continue;
    if (candidate.booking_status === 'CANCELLED') continue;

    const classification = classify(movement, candidate);
    if (!classification) continue;

    const { type, baseScore } = classification;
    const time = timeCompatible(movement, candidate);
    const vehicleOk = vehicleCompatible(movement, candidate);
    const distance = lookupDistance(movement.dropoff_zone, candidate.pickup_zone);

    let score = baseScore;
    if (!time.compatible) score -= 30;
    if (!vehicleOk) score -= 25;
    score = Math.max(0, Math.min(100, score));

    const economicsKnown = movement.absolute_floor != null && movement.operator_payout != null;

    let feasibility;
    if (!time.compatible || !vehicleOk) {
      feasibility = FEASIBILITY.INFEASIBLE;
    } else if (!economicsKnown) {
      feasibility = FEASIBILITY.HOLD_UNKNOWN_ECONOMICS;
    } else {
      feasibility = FEASIBILITY.FEASIBLE;
    }

    let routePrice = null;
    if (routePriceTruthLookup) {
      routePrice = routePriceTruthLookup(candidate.pickup_zone, candidate.dropoff_zone, candidate.vehicle_class);
    }

    const estimatedIncrementalRevenue =
      feasibility === FEASIBILITY.FEASIBLE && routePrice?.smart_match_price != null
        ? routePrice.smart_match_price
        : null;

    const estimatedContribution =
      estimatedIncrementalRevenue != null && candidate.operator_payout != null
        ? Number((estimatedIncrementalRevenue - candidate.operator_payout).toFixed(2))
        : null;

    candidates.push({
      candidate_movement_id: candidate.movement_id,
      match_type: type,
      match_score: score,
      time_compatible: time.compatible,
      time_gap_minutes: time.gapMinutes,
      route_compatible: true,
      vehicle_compatible: vehicleOk,
      empty_km_potentially_avoided: distance ? distance.km : null,
      empty_km_verified: distance ? distance.verified : false,
      feasibility,
      estimated_incremental_revenue: estimatedIncrementalRevenue,
      estimated_contribution: estimatedContribution,
    });
  }

  return candidates.sort((a, b) => b.match_score - a.match_score);
}

/**
 * Multi-leg chain: finds sequences of 3+ movements where each leg's
 * drop-off feeds the next leg's pickup within the turnaround window, for
 * the same vehicle class. Deterministic depth-first search, small pools
 * only (Stage 1 shadow mode operates on a 7-day board, not a live fleet).
 */
export function findMultiLegChains(movement, pool, { maxLegs = 4 } = {}) {
  const chains = [];

  // Chains move forward in time by definition (leg N's drop-off feeds leg
  // N+1's pickup), so — unlike the general reverse/corridor matcher above —
  // a candidate that starts before the previous leg's pickup can never be
  // the next leg, regardless of how large the absolute time gap is.
  function forwardTurnaroundOk(last, candidate) {
    const gapMinutes = (new Date(candidate.pickup_datetime).getTime() - new Date(last.pickup_datetime).getTime()) / 60000;
    return gapMinutes >= MIN_TURNAROUND_MINUTES;
  }

  function extend(chain) {
    if (chain.length >= maxLegs) {
      if (chain.length >= 3) chains.push([...chain]);
      return;
    }
    const last = chain[chain.length - 1];
    let extended = false;
    for (const candidate of pool) {
      if (chain.some((m) => m.movement_id === candidate.movement_id)) continue;
      if (candidate.vehicle_class !== movement.vehicle_class) continue;
      if (candidate.pickup_zone !== last.dropoff_zone) continue;
      if (!forwardTurnaroundOk(last, candidate)) continue;
      extended = true;
      extend([...chain, candidate]);
    }
    if (chain.length >= 3) chains.push([...chain]);
  }

  extend([movement]);

  return chains.map((chain) => ({
    match_type: MATCH_TYPE.MULTI_LEG_CHAIN,
    movement_ids: chain.map((m) => m.movement_id),
    leg_count: chain.length,
  }));
}
