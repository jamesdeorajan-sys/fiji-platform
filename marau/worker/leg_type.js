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
 *   round_trip   the return is held inside this one booking (return fields / trip_type 'return') and the booking does NOT start at
 *                an airport: UNSUPPORTED (no way to say which leg is the holiday return).
 *   (airport-origin round trip)  mapped to TWO Marau legs of the same source booking: the 'arrival' row (shape
 *                round_trip_arrival_leg) and a derived 'return' row (round_trip_return_leg) - see deriveReturnLeg. The fare is ONE
 *                combined quote with no return amount, so the return leg's VALUE stays unresolved until an approved allocation rule.
 *   other        airport-to-airport, or neither end an airport.
 *   unclassified a location is missing/blank, or the source row did not provide the itinerary fields at all (a round trip
 *                cannot be ruled out) - fail closed.
 * A leg_type of 'return' exists only for bookings created in Marau where the guest DECLARED a return.
 */
const AIRPORT = /airport/i;
const ITINERARY_KEYS = ['return_date', 'return_time', 'return_pickup_location', 'trip_type'];
const present = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * The ITINERARY a staff status verification rests on (RC4). Every fact that could change what "this return is still going ahead"
 * means is part of it: the source's booking-level status, the return's pickup date/time, pickup location and destination, and the
 * arrival's pickup date/time. A verification is recorded against this string; any change to any part of it invalidates the
 * verification, and a staff member must confirm the basis they were SHOWN, so they can never verify an itinerary that has since moved.
 */
export function legStatusBasis(f) {
  return ['v2', f.source_status, f.return_pickup_datetime, f.return_pickup_zone, f.return_destination_zone, f.arrival_pickup_datetime].map((x) => (x == null ? '' : String(x))).join('|');
}

/** Direction only: 'arrival' | 'departure' | 'other'. An unknown end is 'other' - never guessed. */
export function classifyLeg(pickupZone, destinationZone) {
  if (!present(pickupZone) || !present(destinationZone)) return 'other';
  const from = AIRPORT.test(pickupZone);
  const to = AIRPORT.test(destinationZone);
  if (from && !to) return 'arrival';
  if (to && !from) return 'departure';
  return 'other';
}

export function hasReturnFields(row) {
  return present(row.return_date) || present(row.return_time) || present(row.return_pickup_location) || String(row.trip_type || '').toLowerCase() === 'return';
}

/**
 * The return leg of an airport-origin round trip held in ONE source booking.
 *   state 'none'                  no return fields
 *   state 'unsupported_direction' return fields but the booking does not start at an airport
 *   state 'details_missing'       return fields present but the return date/time is missing or unparseable: NO leg is guessed
 *   state 'complete'              leg: { pickup_zone, pickup_basis, destination_zone, pickup_datetime_raw }
 * The recorded return pickup location is kept; when absent the pickup is the outbound destination and is marked INFERRED.
 */
export function deriveReturnLeg(row, normalizePickupDatetime) {
  if (!hasReturnFields(row)) return { state: 'none' };
  if (classifyLeg(row.pickup_zone, row.destination_zone) !== 'arrival') return { state: 'unsupported_direction' };
  if (!present(row.return_date) || !present(row.return_time)) return { state: 'details_missing' };
  const raw = `${row.return_date.trim()}T${row.return_time.trim()}`;
  try { normalizePickupDatetime(raw); } catch { return { state: 'details_missing' }; }
  const recorded = present(row.return_pickup_location);
  return { state: 'complete', leg: { pickup_zone: recorded ? row.return_pickup_location.trim() : row.destination_zone, pickup_basis: recorded ? 'recorded' : 'inferred_from_outbound_destination', destination_zone: row.pickup_zone, pickup_datetime_raw: raw } };
}

/** The full, explicit classification of a mirrored source row. credit_basis: 'none' | 'needs_staff_confirmation' | 'unsupported'. */
export function classifyMirroredShape(row) {
  if (!present(row && row.pickup_zone) || !present(row && row.destination_zone)) {
    return { leg_type: 'unclassified', shape: 'missing_or_ambiguous_location', credit_basis: 'unsupported' };
  }
  if (!ITINERARY_KEYS.some((k) => k in row)) {
    return { leg_type: 'unclassified', shape: 'itinerary_fields_not_provided', credit_basis: 'unsupported' };
  }
  const hasReturn = hasReturnFields(row);
  const direction = classifyLeg(row.pickup_zone, row.destination_zone);
  if (hasReturn && direction === 'arrival') {
    const complete = Boolean(row.return_date && row.return_time && present(row.return_date) && present(row.return_time));
    return { leg_type: 'arrival', shape: complete ? 'round_trip_arrival_leg' : 'round_trip_return_details_missing', credit_basis: 'none' };
  }
  if (hasReturn) return { leg_type: 'round_trip', shape: 'round_trip_single_booking', credit_basis: 'unsupported' };
  if (direction === 'arrival') return { leg_type: 'arrival', shape: 'one_way_arrival', credit_basis: 'none' };
  if (direction === 'departure') return { leg_type: 'departure', shape: 'standalone_departure', credit_basis: 'needs_staff_confirmation' };
  return { leg_type: 'other', shape: 'direction_not_a_holiday_leg', credit_basis: 'unsupported' };
}
