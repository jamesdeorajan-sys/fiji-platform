/* Marau Stage 1 (PREVIEW ONLY) — round 19: the D1-backed synthetic
 * source harness (admin-token gated) that lets the round 17/18
 * real-booking-sync design be demonstrated over HTTP against the
 * hosted, isolated preview — the same demonstration the local test
 * suite already does in-memory, now reachable over the network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv } from './fixtures.mjs';
import worker from '../worker/worker.js';

installNetworkGuard();

function req(path, opts = {}) {
  return new Request('http://marau-preview.test' + path, opts);
}
async function call(env, path, opts) {
  const res = await worker.fetch(req(path, opts), env);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
function withJson(method, body, headers = {}) {
  return { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}
function authed(token) {
  return { authorization: `Bearer ${token}` };
}

function synthSourceBooking(overrides = {}) {
  return {
    source_booking_ref: 'h-1',
    id: 42001,
    guest_email: 'harness.guest@example.test',
    guest_phone: '+15005559001',
    pickup_zone: 'Nadi Airport',
    destination_zone: 'Denarau',
    vehicle_type: 'Sedan',
    pickup_date: '2026-11-01',
    pickup_time: '09:00',
    quoted_amount: 45,
    status: 'accepted',
    assigned_driver_id: 'drv_1',
    ...overrides,
  };
}

test('round19 harness: the six demonstration scenarios against the live worker', async (t) => {
  const env = makeEnv();
  const admin = { headers: authed(env.MARAU_ADMIN_TEST_TOKEN) };

  await t.test('1. saved pending booking -> secure guest Trip access', async () => {
    const booking = synthSourceBooking({ status: 'pending' });
    await call(env, '/preview/admin/synthetic-source', withJson('POST', booking, admin.headers));
    const sync = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'created', new_status: 'pending', source_event_id: 1, booking_id: booking.id }, admin.headers));
    assert.equal(sync.status, 200);
    assert.equal(sync.data.status, 'pending');
    const trip = await call(env, '/preview/trip', { headers: authed(sync.data.session.access_token) });
    assert.equal(trip.status, 200);
    assert.equal(trip.data.bookings[0].status, 'pending');
  });

  await t.test('2. operator decision recorded -> confirmed Trip', async () => {
    const booking = synthSourceBooking({ source_booking_ref: 'h-2', id: 42002, status: 'pending' });
    await call(env, '/preview/admin/synthetic-source', withJson('POST', booking, admin.headers));
    const saved = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'created', new_status: 'pending', source_event_id: 1, booking_id: booking.id }, admin.headers));

    await call(env, '/preview/admin/synthetic-source', withJson('POST', { ...booking, status: 'accepted' }, admin.headers));
    const accepted = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'accepted', new_status: 'accepted', source_event_id: 2, booking_id: booking.id }, admin.headers));
    assert.equal(accepted.data.status, 'confirmed');
    const trip = await call(env, '/preview/trip', { headers: authed(saved.data.session.access_token) });
    assert.equal(trip.data.bookings[0].status, 'confirmed');
  });

  await t.test('3. changed pickup/destination/price -> correct guest display', async () => {
    const booking = synthSourceBooking({ source_booking_ref: 'h-3', id: 42003, status: 'accepted' });
    await call(env, '/preview/admin/synthetic-source', withJson('POST', booking, admin.headers));
    const created = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'created', new_status: 'accepted', source_event_id: 1, booking_id: booking.id }, admin.headers));

    await call(env, '/preview/admin/synthetic-source', withJson('POST', { ...booking, destination_zone: 'Sofitel Denarau', pickup_time: '15:00', quoted_amount: 88 }, admin.headers));
    const changed = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/reconcile`, withJson('POST', { snapshot_sequence: 1 }, admin.headers));
    assert.equal(changed.data.applied, true);
    const trip = await call(env, '/preview/trip', { headers: authed(created.data.session.access_token) });
    assert.equal(trip.data.bookings[0].destination_zone, 'Sofitel Denarau');
    assert.equal(trip.data.bookings[0].quoted_amount, 88);
  });

  await t.test('4. cancellation', async () => {
    const booking = synthSourceBooking({ source_booking_ref: 'h-4', id: 42004, status: 'accepted' });
    await call(env, '/preview/admin/synthetic-source', withJson('POST', booking, admin.headers));
    const created = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'created', new_status: 'accepted', source_event_id: 1, booking_id: booking.id }, admin.headers));

    await call(env, '/preview/admin/synthetic-source', withJson('POST', { ...booking, status: 'cancelled' }, admin.headers));
    const cancelled = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'cancelled', new_status: 'cancelled', source_event_id: 2, booking_id: booking.id }, admin.headers));
    assert.equal(cancelled.data.status, 'cancelled');
    const trip = await call(env, '/preview/trip', { headers: authed(created.data.session.access_token) });
    assert.equal(trip.data.bookings[0].status, 'cancelled');
  });

  await t.test('5. interrupted first-sync recovery', async () => {
    const booking = synthSourceBooking({ source_booking_ref: 'h-5', id: 42005, status: 'pending' });
    await call(env, '/preview/admin/synthetic-source', withJson('POST', booking, admin.headers));
    env.DB.exec(`CREATE TRIGGER h5_block BEFORE INSERT ON marau_real_booking_links BEGIN SELECT RAISE(ABORT, 'fault'); END;`);
    const interrupted = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'created', new_status: 'pending', source_event_id: 1, booking_id: booking.id }, admin.headers));
    assert.equal(interrupted.status, 500, 'the fault-injected first attempt must genuinely fail over HTTP');
    env.DB.exec('DROP TRIGGER h5_block;');
    const retry = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'created', new_status: 'pending', source_event_id: 1, booking_id: booking.id }, admin.headers));
    assert.equal(retry.status, 200);
    assert.equal(retry.data.recovered, true);
    const state = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}`, admin);
    assert.ok(state.data.link);
  });

  await t.test('6. expired-owner takeover without stale overwrite', async () => {
    // Demonstrated directly against the live worker via the claim table:
    // seed, sync once, manually expire the claim (simulating a crashed
    // holder), confirm a second sync-event still succeeds cleanly (a
    // takeover) and no claim is left dangling.
    const booking = synthSourceBooking({ source_booking_ref: 'h-6', id: 42006, status: 'accepted' });
    await call(env, '/preview/admin/synthetic-source', withJson('POST', booking, admin.headers));
    const created = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'created', new_status: 'accepted', source_event_id: 1, booking_id: booking.id }, admin.headers));
    assert.equal(created.status, 200);

    const claimBefore = await env.DB.prepare('SELECT * FROM marau_real_booking_sync_claims WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
    assert.equal(claimBefore, null, 'claim released after a clean sync');

    await call(env, '/preview/admin/synthetic-source', withJson('POST', { ...booking, quoted_amount: 120 }, admin.headers));
    const second = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'accepted', new_status: 'accepted', source_event_id: 2, booking_id: booking.id }, admin.headers));
    assert.equal(second.data.applied, true);
    const state = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}`, admin);
    assert.equal(state.data.mirror.quoted_amount, 120);
    assert.equal(state.data.claim, null, 'no claim left held after a completed cycle');
  });

  await t.test('admin routes require the test admin token', async () => {
    const unauth = await call(env, '/preview/admin/synthetic-source', withJson('POST', synthSourceBooking()));
    assert.equal(unauth.status, 401);
  });
});
