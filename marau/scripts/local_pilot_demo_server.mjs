/* LOCAL demo server (127.0.0.1 only): the real worker.js over an in-memory SQLite D1, seeded with SYNTHETIC data, so the staff console's
 * deals-pilot panel and a round-trip trip can be exercised in a real browser without any Cloudflare credential. Test values only:
 *   admin token: demo-admin-token    staff tokens: demo-staff-ana / demo-staff-bala
 *   node scripts/local_pilot_demo_server.mjs   ->   http://127.0.0.1:8898/staff
 */
import http from 'node:http';
import { createTestD1 } from '../test/d1_sqlite_shim.mjs';
import { synthGuest } from '../test/fixtures.mjs';
import worker, { createGuestSession, createSessionAndOfferLink, nowIso } from '../worker/worker.js';
import { syncRealBookingEvent } from '../worker/real_booking_sync.js';
import { normalizePickupDatetime } from '../worker/fiji_time.js';

const env = { DB: createTestD1(), MARAU_ADMIN_TEST_TOKEN: 'demo-admin-token', MARAU_OPS_WHATSAPP_TEST_NUMBER: '+15556414099' };
const call = async (p, { method = 'GET', body, headers = {} } = {}) => { const r = await worker.fetch(new Request('http://127.0.0.1:8898' + p, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const A = { authorization: 'Bearer demo-admin-token' }; const ANA = { ...A, 'x-marau-staff-token': 'demo-staff-ana' };
const inDays = (d) => new Date(Date.now() + d * 86400_000).toISOString();
for (const [t, n] of [['demo-staff-ana', 'Ana (demo ops)'], ['demo-staff-bala', 'Bala (demo ops)']]) await call('/preview/admin/staff-identities', { method: 'POST', headers: A, body: { token: t, operator_name: n } });
const sup = await call('/preview/admin/suppliers', { method: 'POST', headers: ANA, body: { name: 'Synthetic Reef Tours', fulfilment_owner: 'Ana (demo ops)' } });
await call(`/preview/admin/suppliers/${sup.supplier_id}/verify`, { method: 'POST', headers: ANA });
const offers = [];
for (const [title, cap] of [['Synthetic snorkel', 4], ['Synthetic sunset cruise', 1]]) { const o = await call('/preview/admin/offers', { method: 'POST', headers: ANA, body: { supplier_id: sup.supplier_id, title, location: 'Mamanuca reef (synthetic)', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5.5), capacity: cap, price_per_place_fjd: 120 } }); await call(`/preview/admin/offers/${o.offer_id}/publish`, { method: 'POST', headers: ANA }); offers.push(o.offer_id); }
await call('/preview/admin/editions', { method: 'POST', headers: ANA, body: { fiji_date: '2031-03-03', slot: 'morning', offer_ids: offers } });
await call(`/preview/admin/editions/${encodeURIComponent('2031-03-03:morning')}/publish`, { method: 'POST', headers: ANA });
for (const [i, consent] of ['granted', 'granted', 'unknown'].entries()) { const g = await call('/preview/bookings', { method: 'POST', body: synthGuest({ guest_email: `pilot.guest${i}@example.test`, leg_type: 'arrival' }) }); if (consent !== 'unknown') await call('/preview/trip/contact', { method: 'POST', headers: { authorization: `Bearer ${g.access_token}` }, body: { marketing_consent: consent } }); }
// a ROUND-TRIP source booking (real schema field names), mirrored through the real sync path
const src = { id: 4242, source_booking_ref: '4242', guest_email: 'roundtrip.demo@example.test', guest_phone: '+15005557777', whatsapp_available: null, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', quoted_currency: 'FJD', quoted_amount: 170, settlement_amount_fjd: 150, commission_base_fjd: 20, status: 'accepted', assigned_driver_id: '3', pickup_date: inDays(3).slice(0, 10), pickup_time: '09:00', return_date: inDays(10).slice(0, 10), return_time: '10:30', return_pickup_location: 'Sofitel Denarau lobby' };
const sync = await syncRealBookingEvent(env, '4242', { event_type: 'created', new_status: 'accepted', source_event_id: 1, booking_id: 4242 }, { createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime, reader: async () => ({ ...src }) });
console.log('[demo] round-trip trip link: http://127.0.0.1:8898/#tok=' + sync.session.access_token);
console.log('[demo] staff console: http://127.0.0.1:8898/staff   (admin demo-admin-token, staff demo-staff-ana)');
http.createServer(async (nodeReq, nodeRes) => {
  const chunks = []; for await (const c of nodeReq) chunks.push(c);
  const request = new Request('http://127.0.0.1:8898' + nodeReq.url, { method: nodeReq.method, headers: nodeReq.headers, body: ['GET', 'HEAD'].includes(nodeReq.method) ? undefined : Buffer.concat(chunks) });
  try { const r = await worker.fetch(request, env); nodeRes.writeHead(r.status, Object.fromEntries(r.headers.entries())); nodeRes.end(Buffer.from(await r.arrayBuffer())); } catch (e) { console.error(e); nodeRes.writeHead(500); nodeRes.end(String(e)); }
}).listen(8898, '127.0.0.1', () => console.log('[demo] listening on 127.0.0.1:8898'));
