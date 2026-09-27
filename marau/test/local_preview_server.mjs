/* Marau Stage 1 (PREVIEW ONLY) — local screenshot/demo server.
 *
 * NOT part of the Worker or its deployment. This is a throwaway Node HTTP
 * server, used only to take design-review screenshots against the REAL
 * worker.js fetch handler and a REAL SQLite-backed D1 shape (the same
 * test/d1_sqlite_shim.mjs the test suite uses) — never a real Cloudflare
 * D1, never a real deploy. wrangler's own local D1 (`wrangler dev
 * --local`) produces an opaque internal error for any D1-touching route
 * in this sandboxed environment (reproduced on a trivial CREATE TABLE —
 * see docs/MARAU_STAGE1_REVIEW_PACKAGE.md §9), so this script exists
 * purely to unblock visual verification without that dependency.
 */
import http from 'node:http';
import { createTestD1 } from './d1_sqlite_shim.mjs';
import { synthGuest, seedActiveOffer } from './fixtures.mjs';
import worker from '../worker/worker.js';

const env = {
  DB: createTestD1(),
  MARAU_ADMIN_TEST_TOKEN: 'demo-admin-token',
  MARAU_OPS_WHATSAPP_TEST_NUMBER: '+15556414099',
};

async function seedDemoData() {
  await seedActiveOffer(env, {
    origin_zone: 'DENARAU', destination_zone: 'NAD_AIRPORT',
    smart_match_price: 24, standard_price: 60,
    earliest_pickup: new Date(Date.now() + 5 * 3600_000).toISOString(),
    latest_pickup: new Date(Date.now() + 7 * 3600_000).toISOString(),
    expires_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
  });
  await seedActiveOffer(env, {
    origin_zone: 'NAD_AIRPORT', destination_zone: 'DENARAU',
    smart_match_price: 30, standard_price: 55,
    earliest_pickup: new Date(Date.now() + 26 * 3600_000).toISOString(),
    latest_pickup: new Date(Date.now() + 28 * 3600_000).toISOString(),
    expires_at: new Date(Date.now() + 27 * 3600_000).toISOString(),
  });

  const guest = synthGuest({
    guest_email: 'demo.guest@example.test',
    guest_phone: '+15005551234',
    pickup_zone: 'Nadi Airport',
    destination_zone: 'Sofitel Denarau',
    vehicle_type: 'Private van, up to 6',
    quoted_amount: 89,
    pickup_datetime: new Date(Date.now() + 20 * 3600_000).toISOString(),
    client_booking_ref: 'DEMO-BOOKING-1',
  });
  const req = new Request('http://demo.local/preview/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(guest),
  });
  const res = await worker.fetch(req, env);
  const data = await res.json();

  // ROUND 4 DEMO: an OLD, CANCELLED booking with an EARLIER pickup time
  // than the real upcoming one — this is the exact case Codex's finding
  // 2 found broken (the render function picked this one as "Next
  // pickup"). Seeded directly (same technique the round-4 regression
  // tests use) so the screenshot proves the fix against a realistic trip
  // that has real history, not just a single clean booking.
  const trip = await (await worker.fetch(new Request('http://demo.local/preview/trip', { headers: { authorization: `Bearer ${data.access_token}` } }), env)).json();
  const firstBookingId = trip.bookings[0].id;
  const oldRow = await env.DB
    .prepare(
      `INSERT INTO marau_test_bookings
        (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, test_data, created_at, updated_at)
       VALUES (?, (SELECT guest_session_id FROM marau_test_bookings WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, 'cancelled', 1, ?, ?)`
    )
    .bind(
      'DEMO-OLD-CANCELLED-1',
      firstBookingId,
      'demo.guest@example.test',
      '+15005551234',
      'Sofitel Denarau',
      'Nadi Airport',
      'Sedan',
      new Date(Date.now() - 30 * 3600_000).toISOString(),
      45,
      new Date(Date.now() - 40 * 3600_000).toISOString(),
      new Date(Date.now() - 40 * 3600_000).toISOString()
    )
    .run();
  console.log('[demo] seeded booking, access_token:', data.access_token);
  console.log('[demo] seeded an OLD CANCELLED booking (earlier pickup_datetime) to demonstrate the pickup-accuracy fix');
  return data.access_token;
}

const token = await seedDemoData();

const server = http.createServer(async (nodeReq, nodeRes) => {
  const chunks = [];
  for await (const chunk of nodeReq) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const url = 'http://127.0.0.1:8899' + nodeReq.url;
  const request = new Request(url, {
    method: nodeReq.method,
    headers: nodeReq.headers,
    body: nodeReq.method === 'GET' || nodeReq.method === 'HEAD' ? undefined : body,
  });
  try {
    const response = await worker.fetch(request, env);
    nodeRes.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    nodeRes.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    nodeRes.writeHead(500);
    nodeRes.end(String(err));
  }
});

server.listen(8899, () => {
  console.log('[demo] Marau preview demo server on http://127.0.0.1:8899');
  console.log('[demo] guest trip link: http://127.0.0.1:8899/#tok=' + token);
  console.log('[demo] admin token: demo-admin-token');
});
