/* Issue #54 Stage 1 (SHADOW MODE) — deterministic match engine.
 * Rule-based only: given a movement and the pool of other movements, find
 * reverse/corridor/chain candidates and score them. No AI/LLM call in this
 * module — the issue permits AI to rank/explain candidates on top of this,
 * but the hard feasibility/economics verdict must stay deterministic.
 *
 * CEO fix 2026-09-13: chronological feasibility is based on when the
 * SOURCE movement's own trip actually finishes (pickup + known duration),
 * plus a turnaround buffer — never a raw |pickup - pickup| gap, which
 * could accept a candidate that starts before the source movement can
 * possibly be done, or even before it starts. If the source movement's
 * duration is unknown, this returns HOLD_UNKNOWN_TIMING rather than
 * guessing from placeholder geography (src/geo_seed.js is classification
 * only — it never feeds a feasibility verdict).
 */
import { MATCH_TYPE, FEASIBILITY, estimateSourceCompletionMs } from './model.js';
import { lookupDistance, isNearby, corridorOf, MIN_TURNAROUND_MINUTES } from './geo_seed.js';

const CHRONOLOGICAL = Object.freeze({ OK: 'OK', INFEASIBLE: 'INFEASIBLE', UNKNOWN: 'UNKNOWN' });

/**
 * Requires candidate.pickup_datetime to be at least MIN_TURNAROUND_MINUTES
 * after the source movement's own estimated completion. Returns UNKNOWN
 * (never a guessed OK/INFEASIBLE) when the source's duration isn't known.
 */
function chronologicalFeasibility(sourceMovement, candidate) {
  const completionMs = estimateSourceCompletionMs(sourceMovement);
  if (completionMs == null) {
    return { status: CHRONOLOGICAL.UNKNOWN, gapMinutes: null };
  }
  const candidatePickupMs = new Date(candidate.pickup_datetime).getTime();
  const gapMinutes = (candidatePickupMs - completionMs) / 60000;
  return {
    status: gapMinutes >= MIN_TURNAROUND_MINUTES ? CHRONOLOGICAL.OK : CHRONOLOGICAL.INFEASIBLE,
    gapMinutes,
  };
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
 * movements). Each candidate carries a deterministic feasibility verdict:
 * INFEASIBLE for a certain vehicle/timing mismatch, HOLD_UNKNOWN_TIMING
 * when the source trip's completion time can't be established,
 * HOLD_UNKNOWN_ECONOMICS when payout/floor data is missing, and FEASIBLE
 * only once all three are confirmed.
 */
export function computeMatchCandidates(movement, pool, { routePriceTruthLookup } = {}) {
  const candidates = [];

  for (const candidate of pool) {
    if (candidate.movement_id === movement.movement_id) continue;
    if (candidate.booking_status === 'CANCELLED') continue;

    const classification = classify(movement, candidate);
    if (!classification) continue;

    const { type, baseScore } = classification;
    const chronological = chronologicalFeasibility(movement, candidate);
    const vehicleOk = vehicleCompatible(movement, candidate);
    const distance = lookupDistance(movement.dropoff_zone, candidate.pickup_zone);

    let score = baseScore;
    if (chronological.status === CHRONOLOGICAL.INFEASIBLE) score -= 30;
    if (chronological.status === CHRONOLOGICAL.UNKNOWN) score -= 10;
    if (!vehicleOk) score -= 25;
    score = Math.max(0, Math.min(100, score));

    const economicsKnown = movement.absolute_floor != null && movement.operator_payout != null;

    let feasibility;
    if (!vehicleOk || chronological.status === CHRONOLOGICAL.INFEASIBLE) {
      feasibility = FEASIBILITY.INFEASIBLE;
    } else if (chronological.status === CHRONOLOGICAL.UNKNOWN) {
      feasibility = FEASIBILITY.HOLD_UNKNOWN_TIMING;
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
      // true | false | null(unknown) — never coerced to a boolean guess.
      time_compatible:
        chronological.status === CHRONOLOGICAL.OK ? true : chronological.status === CHRONOLOGICAL.INFEASIBLE ? false : null,
      time_gap_minutes: chronological.gapMinutes,
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
 * drop-off feeds the next leg's pickup, using the same completion-based
 * chronological check as the general matcher above. A leg with unknown
 * duration cannot be confirmed connectable, so it is never chained
 * through (HOLD_UNKNOWN_TIMING is not treated as "good enough").
 * Deterministic depth-first search, small pools only (Stage 1 shadow mode
 * operates on a 7-day board, not a live fleet).
 */
export function findMultiLegChains(movement, pool, { maxLegs = 4 } = {}) {
  const chains = [];

  function extend(chain) {
    if (chain.length >= maxLegs) {
      if (chain.length >= 3) chains.push([...chain]);
      return;
    }
    const last = chain[chain.length - 1];
    for (const candidate of pool) {
      if (chain.some((m) => m.movement_id === candidate.movement_id)) continue;
      if (candidate.vehicle_class !== movement.vehicle_class) continue;
      if (candidate.pickup_zone !== last.dropoff_zone) continue;
      if (chronologicalFeasibility(last, candidate).status !== CHRONOLOGICAL.OK) continue;
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
