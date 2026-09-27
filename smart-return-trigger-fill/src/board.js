/* Issue #54 Stage 1 (SHADOW MODE) — 7-day movement board.
 * Read-only aggregation. No writes, no auto-publication, no send calls.
 *
 * Marau Stage 1 fix (2026-09-28): this function is now `async` and awaits
 * every store call (see src/offers.js's file header for the full
 * explanation of the underlying defect). One extra wrinkle here:
 * src/matcher.js#computeMatchCandidates is a plain synchronous function
 * by design (it's pure deterministic logic with no I/O of its own), and
 * it invokes `routePriceTruthLookup(origin, destination, vehicleClass)`
 * synchronously inline. Against createD1Store, `store.getRoutePriceTruth`
 * returns a Promise, so a naive `(o, d, v) => store.getRoutePriceTruth(o,
 * d, v)` closure passed straight into the matcher would hand back an
 * unresolved Promise instead of the real entry — same class of bug as
 * everywhere else in this file header. The fix here is to resolve every
 * route-price-truth entry the matcher could possibly need ONCE, up front
 * (awaited), into a plain Map, and hand the matcher a synchronous closure
 * over that Map — so the matcher itself never has to become async or
 * know anything about the store's I/O timing.
 */
import { computeMatchCandidates } from './matcher.js';
import { isReturnLockEligible, earnExperienceCreditEligibility } from './pricing.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function routePriceTruthKey(originZone, destinationZone, vehicleClass) {
  return `${originZone}|${destinationZone}|${vehicleClass}`;
}

export async function buildSevenDayMovementBoard(store, { nowIso = new Date().toISOString() } = {}) {
  const windowEndIso = new Date(new Date(nowIso).getTime() + SEVEN_DAYS_MS).toISOString();
  const rawMovements = await store.listMovements({ fromIso: nowIso, toIso: windowEndIso });
  const movements = rawMovements.filter((m) => m.booking_status !== 'CANCELLED');

  const confirmedMovements = movements.filter((m) => m.booking_status === 'CONFIRMED');

  // Resolve every (origin, destination, vehicle_class) tuple this board
  // could look up, ONCE, before any synchronous matcher call — see file
  // header. Candidates are always drawn from `movements` itself, so this
  // covers every tuple the matcher will ever query below.
  const routePriceTruthCache = new Map();
  const neededTuples = new Set(movements.map((m) => routePriceTruthKey(m.pickup_zone, m.dropoff_zone, m.vehicle_class)));
  for (const key of neededTuples) {
    const [originZone, destinationZone, vehicleClass] = key.split('|');
    routePriceTruthCache.set(key, await store.getRoutePriceTruth(originZone, destinationZone, vehicleClass));
  }
  const syncRoutePriceTruthLookup = (originZone, destinationZone, vehicleClass) =>
    routePriceTruthCache.get(routePriceTruthKey(originZone, destinationZone, vehicleClass)) ?? null;

  const matchesByMovement = new Map();
  for (const m of movements) {
    const pool = movements.filter((other) => other.movement_id !== m.movement_id);
    const candidates = computeMatchCandidates(m, pool, { routePriceTruthLookup: syncRoutePriceTruthLookup });
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
  // Earn-only: whether this itinerary has earned the right to 2x AU$25
  // credits. Redemption against a specific FijiTourTransfers tour booking
  // (src/pricing.js#redeemExperienceCredit) is a separate check the board
  // does not attempt — the board has no tour-booking data source, only
  // transfer movements.
  const creditsEarned = [];
  const seenItineraryPairs = new Set();
  for (const m of movements) {
    if (!m.linked_return_movement_id || seenItineraryPairs.has(m.itinerary_id)) continue;
    const returnMovement = await store.getMovement(m.linked_return_movement_id);
    if (!returnMovement) continue;
    seenItineraryPairs.add(m.itinerary_id);

    // Eligibility is decided against when the return was locked in, not
    // against "now" the board happens to be viewed — see pricing.js.
    const bookedAtIso = m.created_at >= returnMovement.created_at ? m.created_at : returnMovement.created_at;

    const lockResult = isReturnLockEligible({ outboundMovement: m, returnMovement, nowIso: bookedAtIso });
    if (lockResult.eligible) {
      returnLockEligible.push({ itinerary_id: m.itinerary_id, outbound: m.movement_id, return: returnMovement.movement_id, ...lockResult });
    }

    const earnResult = earnExperienceCreditEligibility({ outboundMovement: m, returnMovement, nowIso: bookedAtIso });
    if (earnResult.earned) {
      creditsEarned.push({ itinerary_id: m.itinerary_id, outbound: m.movement_id, return: returnMovement.movement_id, ...earnResult });
    }
  }

  const allOffers = await store.listOffers();
  const possibleSmartFillSpecials = allOffers.filter(
    (o) => ['ACTIVE', 'VALIDATED'].includes(o.status) && o.earliest_pickup >= nowIso && o.earliest_pickup <= windowEndIso
  );

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
    experienceCreditEarned: creditsEarned,
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
