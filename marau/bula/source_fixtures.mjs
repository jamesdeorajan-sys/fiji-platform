// SYNTHETIC fixtures shaped like the verified NAT/FijiDash source contract (docs/BULA_SOURCE_CONTRACT_DRAFT.md; worker/nadi_booking_reader.js).
// The real `bookings` row carries: id, status (pending|accepted|en_route|completed|cancelled), assigned_driver_id, guest_email, guest_phone, pickup_zone,
// destination_zone, vehicle_type, quoted_currency, quoted_amount, pickup_date, pickup_time, return_*, flight_number. It does NOT carry passengers, luggage,
// add-ons or a discount; passengers exist only through a negotiation record and are an OPTIONAL field of the reader. No network, no production data.
export const NAT_ORIGIN = 'https://nat-source.synthetic.test';
export function natBooking(id, over = {}) {
  return { id, client_booking_ref: `SYN-NAT-${id}`, status: 'pending', assigned_driver_id: null, guest_email: `guest${id}@example.test`, guest_phone: `+1555010${String(id).padStart(4, '0')}`,
    pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', quoted_currency: 'FJD', quoted_amount: 85, settlement_amount_fjd: 85, commission_base_fjd: 85,
    pickup_date: '2026-11-20', pickup_time: '14:30', return_date: null, return_time: null, return_pickup_location: null, flight_number: 'FJ391', created_at: '2026-11-01T01:00:00Z', ...over };
}
/** A fetch double for GET {origin}/admin/bookings/:id. `store` is a Map id->row; behaviour is switchable per test. Records every call (read-only: GET only). */
export function natFetch(store, ctl = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    if ((init.method || 'GET') !== 'GET') throw new Error('SYNTHETIC SOURCE IS READ-ONLY');
    if (ctl.failOnCall && calls.length === ctl.failOnCall) return new Response('upstream down', { status: 503 });
    if (ctl.down) return new Response('upstream down', { status: 503 });
    const id = Number(String(url).split('/').pop()); const row = store.get(id);
    if (!row) return new Response(JSON.stringify({ ok: false }), { status: 404 });
    return new Response(JSON.stringify({ ok: true, booking: row }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  f.calls = calls; return f;
}
