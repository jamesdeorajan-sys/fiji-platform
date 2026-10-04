/* Marau (PREVIEW/TEST ONLY) - READ-ONLY adapter from the nadi-dispatch-api `bookings` table to the mirror's injected `reader`.
 *
 * Source contract (proposed, branch ceo/nadi-booking-read-itinerary, NOT deployed): GET /admin/bookings/:id returns
 * { ok: true, booking: { id, client_booking_ref, status, assigned_driver_id, guest_phone, guest_email, pickup_zone, destination_zone,
 *   vehicle_type, quoted_currency, quoted_amount, settlement_amount_fjd, commission_base_fjd, pickup_date, pickup_time, return_date,
 *   return_time, return_pickup_location, flight_number, created_at } }.
 * The real `bookings` row holds a round trip as ONE booking: the return is return_* on the same row, with a single quoted_amount and
 * NO separate return amount and NO link to any other booking. This adapter reports exactly that and invents nothing.
 *
 * What the adapter guarantees: it performs ONE GET of ONE validated booking id per call (never a write, never a body, redirects are
 * never followed with the credential attached); it returns ONLY whitelisted fields, type-checked (guest name, notes, IP and
 * attribution columns can never cross it); it fails closed (throws) on any unexpected response and returns null only for a genuine
 * 404; and it exposes `provenance` - HOW the data arrived - which the mirror records on every row. `authenticated: true` means the
 * read went over https to the configured origin with the admin credential; it does NOT mean the integration is approved.
 */
import { validatedRoot, bookingIdFromRef } from './nadi_source_client.js';

const STATUSES = new Set(['pending', 'accepted', 'en_route', 'completed', 'cancelled']);
const STRING_FIELDS = ['client_booking_ref', 'guest_phone', 'guest_email', 'pickup_zone', 'destination_zone', 'vehicle_type', 'quoted_currency', 'pickup_date', 'pickup_time', 'return_date', 'return_time', 'return_pickup_location', 'flight_number', 'created_at'];
const NUMBER_FIELDS = ['quoted_amount', 'settlement_amount_fjd', 'commission_base_fjd'];

function bad(code) { return new Error(`SOURCE_${code}`); }

export function createNadiBookingReader({ baseUrl, adminToken, fetchImpl, timeoutMs = 8000 }) {
  if (!adminToken) throw new Error('adminToken is required');
  const root = validatedRoot(baseUrl);
  const doFetch = fetchImpl || ((...a) => fetch(...a));

  async function reader(sourceBookingRef) {
    const id = bookingIdFromRef(sourceBookingRef);
    const res = await doFetch(`${root}/admin/bookings/${id}`, { method: 'GET', headers: { authorization: `Bearer ${adminToken}` }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400) throw bad(`REDIRECT_REFUSED_${res.status}`);
    if (res.status === 404) return null;
    let data;
    try { data = await res.json(); } catch { throw bad(`NON_JSON_RESPONSE_${res.status}`); }
    if (res.status !== 200 || !data || data.ok !== true || !data.booking || typeof data.booking !== 'object') throw bad(`READ_FAILED_${res.status}`);
    const b = data.booking;
    if (Number(b.id) !== id) throw bad('BOOKING_ID_MISMATCH');
    if (typeof b.status !== 'string' || !STATUSES.has(b.status)) throw bad('UNRECOGNISED_STATUS');
    const out = { id, source_booking_ref: String(id), status: b.status, assigned_driver_id: b.assigned_driver_id == null ? null : String(b.assigned_driver_id), whatsapp_available: null };
    for (const k of STRING_FIELDS) {
      const v = b[k];
      if (v == null) out[k] = null;
      else if (typeof v === 'string') out[k] = v;
      else throw bad(`MALFORMED_FIELD_${k}`);
    }
    for (const k of NUMBER_FIELDS) {
      const v = b[k];
      if (v == null) out[k] = null;
      else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      else throw bad(`MALFORMED_FIELD_${k}`);
    }
    return out;
  }
  reader.provenance = Object.freeze({ kind: 'nadi_dispatch_api', origin: new URL(root).origin, authenticated: true, read_only: true });
  return reader;
}
