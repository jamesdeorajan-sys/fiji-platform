/* Issue #54 Stage 1 (SHADOW MODE) — internal ops recommendation cards.
 *
 * This module ONLY builds a plain string for human review. It never calls
 * any WhatsApp/Meta send API and has no network access. Wiring an actual
 * send integration is explicitly out of scope until CEO approval — see
 * "DO NOT auto-send to customer" in issue #54.
 */

export function recommendedAction(bestCandidate) {
  if (!bestCandidate) return 'HOLD';
  if (bestCandidate.feasibility === 'HOLD_UNKNOWN_ECONOMICS') return 'HOLD';
  if (bestCandidate.feasibility === 'INFEASIBLE') return 'HOLD';
  if (bestCandidate.match_type === 'EXACT_REVERSE') return 'RETURN_LOCK';
  if (bestCandidate.match_score >= 70) return 'SMART_MATCH';
  return 'LIVE_FILL';
}

export function buildOpsCard(movement, matchCandidates = []) {
  const best = matchCandidates[0] ?? null;
  const lines = [
    'NEW TRANSFER / MATCH OPPORTUNITY',
    '',
    `Source: ${movement.source_site}`,
    `Booking ref: ${movement.booking_reference}`,
    `Route: ${movement.pickup_zone} -> ${movement.dropoff_zone}`,
    `Time: ${movement.pickup_datetime}`,
    `Passengers: ${movement.passenger_count}`,
    `Vehicle: ${movement.vehicle_class}`,
    `Customer fare: ${movement.customer_price}`,
    `Potential matched movement: ${best ? best.candidate_movement_id : 'none found'}`,
    `Match score: ${best ? best.match_score : '-'}`,
    `Empty km potentially avoided: ${
      best && best.empty_km_potentially_avoided != null
        ? `${best.empty_km_potentially_avoided}${best.empty_km_verified ? '' : ' (unverified estimate)'}`
        : 'unknown'
    }`,
    `Recommended action: ${recommendedAction(best)}`,
  ];
  return lines.join('\n');
}
