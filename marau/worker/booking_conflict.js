/* Marau Stage 1 (PREVIEW ONLY) — detects a resubmitted client_booking_ref
 * whose PAYLOAD doesn't match the original. A genuine retry (same key,
 * same fields) must return the existing booking unchanged (already
 * tested). Reusing a key for a DIFFERENT payload is either a real bug in
 * the caller or a stale key reused for a fresh, different booking — in
 * either case it must be rejected, not silently served as if it matched
 * and not silently overwritten.
 */

const COMPARABLE_FIELDS = ['guest_email', 'guest_phone', 'pickup_zone', 'destination_zone', 'vehicle_type', 'pickup_datetime', 'quoted_amount'];

function normalizeForCompare(value, field) {
  if (field === 'pickup_datetime') return new Date(value).toISOString();
  if (field === 'quoted_amount') return Number(value);
  return String(value);
}

/**
 * `existingBooking` is a row already stored under this client_booking_ref
 * (shaped like a marau_test_bookings row). `incoming` is the freshly
 * submitted request body. Returns { matches: true } for a genuine retry,
 * or { matches: false, mismatched_fields: [...] } otherwise.
 */
export function findPayloadMismatch(existingBooking, incoming) {
  const mismatched = [];
  for (const field of COMPARABLE_FIELDS) {
    const existingValue = normalizeForCompare(existingBooking[field], field);
    const incomingValue = normalizeForCompare(incoming[field], field);
    if (existingValue !== incomingValue) mismatched.push(field);
  }
  return mismatched.length === 0 ? { matches: true } : { matches: false, mismatched_fields: mismatched };
}
