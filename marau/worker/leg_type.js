/* Marau (PREVIEW/TEST ONLY) - which leg of a holiday a transfer is, derived ONLY from what the source record itself says.
 *
 * What the real source (nadi-dispatch-api) records: pickup/destination zone, pickup date/time, and - for a round trip - the
 * itinerary fields return_date / return_time / return_pickup_location (and trip_type 'one-way' | 'return') ON THE SAME BOOKING.
 * It has NO field linking one booking to another, so "this departure is the return of that arrival" is never derivable.
 *
 * Therefore a direction (airport-bound vs airport-origin) is reported as a DIRECTION, never as a round-trip relationship:
 *   arrival      airport -> elsewhere, no return fields
 *   departure    elsewhere -> airport, no return fields. Relationship to any arrival is UNPROVEN: a credit may land on it only
 *                with explicit staff confirmation (recorded as relationship_basis).
 *   round_trip   the return is held inside this one booking (return fields / trip_type 'return'). Its fare is one combined
 *                quote, so a credit cannot discount "just the return": UNSUPPORTED for credit.
 *   other        airport-to-airport, or neither end an airport.
 *   unclassified a location is missing/blank, or the source row did not provide the itinerary fields at all (a round trip
 *                cannot be ruled out) - fail closed.
 * A leg_type of 'return' exists only for bookings created in Marau where the guest DECLARED a return.
 */
const AIRPORT = /airport/i;
const ITINERARY_KEYS = ['return_date', 'return_time', 'return_pickup_location', 'trip_type'];
const present = (v) => typeof v === 'string' && v.trim() !== '';

/** Direction only: 'arrival' | 'departure' | 'other'. An unknown end is 'other' - never guessed. */
export function classifyLeg(pickupZone, destinationZone) {
  if (!present(pickupZone) || !present(destinationZone)) return 'other';
  const from = AIRPORT.test(pickupZone);
  const to = AIRPORT.test(destinationZone);
  if (from && !to) return 'arrival';
  if (to && !from) return 'departure';
  return 'other';
}

/** The full, explicit classification of a mirrored source row. credit_basis: 'none' | 'needs_staff_confirmation' | 'unsupported'. */
export function classifyMirroredShape(row) {
  if (!present(row && row.pickup_zone) || !present(row && row.destination_zone)) {
    return { leg_type: 'unclassified', shape: 'missing_or_ambiguous_location', credit_basis: 'unsupported' };
  }
  if (!ITINERARY_KEYS.some((k) => k in row)) {
    return { leg_type: 'unclassified', shape: 'itinerary_fields_not_provided', credit_basis: 'unsupported' };
  }
  const hasReturn = present(row.return_date) || present(row.return_time) || present(row.return_pickup_location) || String(row.trip_type || '').toLowerCase() === 'return';
  if (hasReturn) return { leg_type: 'round_trip', shape: 'round_trip_single_booking', credit_basis: 'unsupported' };
  const direction = classifyLeg(row.pickup_zone, row.destination_zone);
  if (direction === 'arrival') return { leg_type: 'arrival', shape: 'one_way_arrival', credit_basis: 'none' };
  if (direction === 'departure') return { leg_type: 'departure', shape: 'standalone_departure', credit_basis: 'needs_staff_confirmation' };
  return { leg_type: 'other', shape: 'direction_not_a_holiday_leg', credit_basis: 'unsupported' };
}
