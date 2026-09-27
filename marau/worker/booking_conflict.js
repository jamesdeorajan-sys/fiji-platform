/* Marau Stage 1 (PREVIEW ONLY) — detects a resubmitted client_booking_ref
 * whose PAYLOAD doesn't match the original. A genuine retry (same key,
 * same fields) must return the existing booking unchanged (already
 * tested). Reusing a key for a DIFFERENT payload is either a real bug in
 * the caller or a stale key reused for a fresh, different booking — in
 * either case it must be rejected, not silently served as if it matched
 * and not silently overwritten.
 */

import { normalizePickupDatetime } from './fiji_time.js';

const COMPARABLE_FIELDS = ['guest_email', 'guest_phone', 'pickup_zone', 'destination_zone', 'vehicle_type', 'pickup_datetime', 'quoted_amount'];

// FIX (fourth independent review, finding 2 — Fiji time): this used to
// re-parse pickup_datetime with plain `new Date(value).toISOString()` —
// fine for the ALREADY-STORED value (already a real UTC instant), but
// WRONG for the freshly incoming raw request body, whose naive
// "YYYY-MM-DDTHH:MM" is meant as Fiji wall-clock time, not server-local
// time. Comparing a naively-reparsed incoming value against the
// correctly Fiji-normalized stored value made every genuine retry look
// like a payload mismatch (a 12-hour difference). Both sides must go
// through the SAME normalization used when a value is actually stored.
function normalizeForCompare(value, field) {
  if (field === 'pickup_datetime') return normalizePickupDatetime(value);
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
