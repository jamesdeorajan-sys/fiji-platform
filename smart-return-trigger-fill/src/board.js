/* Issue #54 Stage 1 (SHADOW MODE) — 7-day movement board.
 * Read-only aggregation. No writes, no auto-publication, no send calls.
 */
import { computeMatchCandidates } from './matcher.js';
import { isReturnLockEligible, experienceCreditEligibility } from './pricing.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function buildSevenDayMovementBoard(store, { nowIso = new Date().toISOString(), minSpendThreshold = null } = {}) {
  const windowEndIso = new Date(new Date(nowIso).getTime() + SEVEN_DAYS_MS).toISOString();
  const movements = store.listMovements({ fromIso: nowIso, toIso: windowEndIso }).filter((m) => m.booking_status !== 'CANCELLED');

  const confirmedMovements = movements.filter((m) => m.booking_status === 'CONFIRMED');

  const matchesByMovement = new Map();
  for (const m of movements) {
    const pool = movements.filter((other) => other.movement_id !== m.movement_id);
    const candidates = computeMatchCandidates(m, pool, {
      routePriceTruthLookup: (o, d, v) => store.getRoutePriceTruth(o, d, v),
    });
    matchesByMovement.set(m.movement_id, candidates);
  }

  const unmatchedMovements = movements.filter((m) => (matchesByMovement.get(m.movement_id) ?? []).length === 0);

  const predictedEmptyLegs = movements.filter(
    (m) => !m.linked_return_movement_id && (matchesByMovement.get(m.movement_id) ?? []).length === 0
  );

  const corridorOpportunities = movements
    .map((m) => ({ movement: m, candidates: matchesByMovement.get(m.movement_id) ?? [] }))
    .filter(({ candidates }) => candidates.some((c) => c.match_type === 'CORRIDOR'));

  const returnLockEligible = [];
  const creditEligible = [];
  const seenItineraryPairs = new Set();
  for (const m of movements) {
    if (!m.linked_return_movement_id || seenItineraryPairs.has(m.itinerary_id)) continue;
    const returnMovement = store.getMovement(m.linked_return_movement_id);
    if (!returnMovement) continue;
    seenItineraryPairs.add(m.itinerary_id);

    // Eligibility is decided against when the return was locked in, not
    // against "now" the board happens to be viewed — see pricing.js.
    const bookedAtIso = m.created_at >= returnMovement.created_at ? m.created_at : returnMovement.created_at;

    const lockResult = isReturnLockEligible({ outboundMovement: m, returnMovement, nowIso: bookedAtIso });
    if (lockResult.eligible) {
      returnLockEligible.push({ itinerary_id: m.itinerary_id, outbound: m.movement_id, return: returnMovement.movement_id, ...lockResult });
    }

    const creditResult = experienceCreditEligibility({
      outboundMovement: m,
      returnMovement,
      nowIso: bookedAtIso,
      minSpendThreshold,
    });
    if (creditResult.eligible) {
      creditEligible.push({ itinerary_id: m.itinerary_id, outbound: m.movement_id, return: returnMovement.movement_id, ...creditResult });
    }
  }

  const possibleSmartFillSpecials = store
    .listOffers()
    .filter((o) => ['ACTIVE', 'VALIDATED'].includes(o.status) && o.earliest_pickup >= nowIso && o.earliest_pickup <= windowEndIso);

  let predictedEmptyKmTotal = 0;
  let predictedEmptyKmHasVerifiedFigure = false;
  let estimatedRecoverableRevenue = 0;
  for (const candidates of matchesByMovement.values()) {
    const best = candidates[0];
    if (!best) continue;
    if (best.empty_km_potentially_avoided != null) {
      predictedEmptyKmTotal += best.empty_km_potentially_avoided;
      if (best.empty_km_verified) predictedEmptyKmHasVerifiedFigure = true;
    }
    if (best.estimated_incremental_revenue != null) {
      estimatedRecoverableRevenue += best.estimated_incremental_revenue;
    }
  }

  return {
    window: { fromIso: nowIso, toIso: windowEndIso },
    confirmedMovements,
    predictedEmptyLegs,
    unmatchedMovements,
    corridorOpportunities,
    returnLockEligible,
    experienceCreditEligible: creditEligible,
    possibleSmartFillSpecials,
    predictedEmptyKm: {
      total: predictedEmptyKmTotal,
      allFiguresVerified: predictedEmptyKmHasVerifiedFigure && predictedEmptyKmTotal > 0,
      note: 'Distances are placeholder/unverified until ops confirms — see src/geo_seed.js',
    },
    estimatedRecoverableRevenue: {
      total: Number(estimatedRecoverableRevenue.toFixed(2)),
      note: 'Sum of only the candidates with a known route_price_truth.smart_match_price — never an invented figure',
    },
  };
}
