/* Bula Happiness - SOURCE FIDELITY labels. Pure. For every mirrored booking field it states how the NAT source stands on it:
 *   SOURCE_CONFIRMED - the source supplied a value.
 *   SOURCE_MISSING   - the NAT `bookings` table CAN carry this field, but this booking has none (null/empty). Nothing is guessed.
 *   NOT_APPLICABLE   - the NAT `bookings` table has NO column for this (passengers, luggage, add-ons, discount) and the source supplied nothing.
 * A value is never inferred, defaulted or copied from another field; the labels only describe what arrived. */
export const SOURCE_CONFIRMED = 'SOURCE_CONFIRMED', SOURCE_MISSING = 'SOURCE_MISSING', NOT_APPLICABLE = 'NOT_APPLICABLE';
/** Fields the NAT bookings row can carry (label -> reader field). */
export const CARRIED_FIELDS = Object.freeze({ guestEmail: 'guest_email', guestPhone: 'guest_phone', clientReference: 'client_booking_ref', bookingCreatedAt: 'created_at', pickupDate: 'pickup_date', pickupTime: 'pickup_time',
  flight: 'flight_number', quotedAmount: 'quoted_amount', quotedCurrency: 'quoted_currency', returnDate: 'return_date', returnTime: 'return_time', returnPickupLocation: 'return_pickup_location' });
/** Fields the NAT schema does not have (only a FUTURE source contract could supply them). */
export const NOT_IN_NAT_SCHEMA = Object.freeze({ passengers: 'passengers', luggage: 'luggage_count', addOns: 'add_ons', discount: 'discount_amount' });
const present = (v) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '');
export function fieldProvenance(src) {
  const s = src && typeof src === 'object' ? src : {}; const out = {};
  for (const [label, f] of Object.entries(CARRIED_FIELDS)) out[label] = present(s[f]) ? SOURCE_CONFIRMED : SOURCE_MISSING;
  for (const [label, f] of Object.entries(NOT_IN_NAT_SCHEMA)) out[label] = present(s[f]) ? SOURCE_CONFIRMED : NOT_APPLICABLE;
  return out;
}
