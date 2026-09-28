/* Marau Stage 1 (PREVIEW ONLY) — round 21: correcting the approved staff
 * workflow's SUBJECT. The "Review and confirm" link concerns the
 * INITIAL TRANSFER RESERVATION (a real booking, synced via
 * worker/real_booking_sync.js) — not only an additional Marau deal
 * request. Demonstrates the full chain: synthetic source reservation
 * saved -> pending guest Trip -> mock staff booking alert ->
 * authenticated booking-specific review -> explicit operational
 * confirmation recorded in the SYNTHETIC SOURCE -> sync -> confirmed
 * guest Trip. No production source writes.
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

let counter = 0;
function synthSourceBooking(overrides = {}) {
  const n = ++counter;
  return {
    source_booking_ref: `br-${n}`,
    id: 61000 + n,
    guest_email: `booking.review${n}@example.test`,
    guest_phone: `+15005559${String(n).padStart(3, '0')}`,
    pickup_zone: 'Nadi Airport',
    destination_zone: 'Denarau',
    vehicle_type: 'Sedan',
    pickup_date: '2026-11-15',
    pickup_time: '09:00',
    quoted_amount: 45,
    status: 'pending',
    ...overrides,
  };
}

async function seedAndSaveReservation(env, overrides = {}) {
  const booking = synthSourceBooking(overrides);
  const admin = authed(env.MARAU_ADMIN_TEST_TOKEN);
  await call(env, '/preview/admin/synthetic-source', withJson('POST', booking, admin));
  const saved = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'created', new_status: 'pending', source_event_id: 1, booking_id: booking.id }, admin));
  return { booking, saved };
}

test('full chain: reservation saved -> pending Trip -> mock staff alert -> authenticated review -> operational confirmation in the synthetic source -> sync -> confirmed Trip', async () => {
  const env = makeEnv();
  const { booking, saved } = await seedAndSaveReservation(env, { assigned_driver_id: 'drv_7' });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.status, 'pending');
  assert.ok(saved.data.mock_staff_alert, 'a mock staff booking alert must be produced the moment the reservation is saved');
  assert.ok(saved.data.mock_staff_alert.review_link.includes('/preview/staff/review?token='));

  // Pending guest Trip.
  const trip1 = await call(env, '/preview/trip', { headers: authed(saved.data.session.access_token) });
  assert.equal(trip1.data.bookings[0].status, 'pending');

  // Authenticated, booking-specific review.
  const token = new URL(saved.data.mock_staff_alert.review_link).searchParams.get('token');
  const page = await call(env, `/preview/staff/review?token=${token}`);
  assert.equal(page.status, 200);
  assert.ok(String(page.data).includes('Review reservation'));
  assert.ok(String(page.data).includes('drv_7'));

  // Explicit operational confirmation, recorded in the SYNTHETIC SOURCE.
  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'Ana (ops)' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(decide.status, 200);
  assert.equal(decide.data.source_status, 'accepted');

  const source = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(source.status, 'accepted', 'the confirmation must be recorded in the synthetic source, not just the Marau mirror');

  // Sync -> confirmed guest Trip.
  const trip2 = await call(env, '/preview/trip', { headers: authed(saved.data.session.access_token) });
  assert.equal(trip2.data.bookings[0].status, 'confirmed');

  // Operator recorded.
  const audit = await env.DB.prepare('SELECT * FROM marau_staff_decisions WHERE subject_id = ?').bind(booking.source_booking_ref).first();
  assert.equal(audit.operator, 'Ana (ops)');
  assert.equal(audit.decision, 'confirm');
  assert.equal(audit.subject_type, 'booking');
});

test('confirmation is refused when no driver/vehicle is on record — the guest Trip stays pending', async () => {
  const env = makeEnv();
  const { booking, saved } = await seedAndSaveReservation(env); // no assigned_driver_id
  const token = new URL(saved.data.mock_staff_alert.review_link).searchParams.get('token');

  const page = await call(env, `/preview/staff/review?token=${token}`);
  assert.ok(String(page.data).includes('NOT YET ASSIGNED'));

  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(decide.status, 409);
  assert.equal(decide.data.error, 'DRIVER_NOT_ASSIGNED');

  const source = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(source.status, 'pending');
  const trip = await call(env, '/preview/trip', { headers: authed(saved.data.session.access_token) });
  assert.equal(trip.data.bookings[0].status, 'pending', 'the guest Trip must stay pending when confirmation is refused');
});

test('a guest cannot decide their own reservation — the mock alert/token is never returned from a guest-facing call, and the token alone cannot decide', async () => {
  const env = makeEnv();
  const { booking, saved } = await seedAndSaveReservation(env, { assigned_driver_id: 'drv_1' });

  // The guest's OWN /preview/trip response never carries a review token.
  const trip = await call(env, '/preview/trip', { headers: authed(saved.data.session.access_token) });
  const serialized = JSON.stringify(trip.data);
  assert.ok(!serialized.includes('review_'), 'the guest-facing Trip response must never contain a review token');

  // Even a party who somehow obtained the token cannot decide without staff auth.
  const token = new URL(saved.data.mock_staff_alert.review_link).searchParams.get('token');
  const attempt = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'not-staff' }));
  assert.equal(attempt.status, 401);
  const source = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(source.status, 'pending');
});

test('a booking review token cannot be used to decide a DIFFERENT reservation, and vice versa — never confirms the wrong subject', async () => {
  const env = makeEnv();
  const { booking: bookingA, saved: savedA } = await seedAndSaveReservation(env, { assigned_driver_id: 'drv_a' });
  const { booking: bookingB } = await seedAndSaveReservation(env, { assigned_driver_id: 'drv_b' });

  const tokenA = new URL(savedA.data.mock_staff_alert.review_link).searchParams.get('token');
  // tokenA's subject is fixed server-side to bookingA — there is no
  // client-suppliable "which booking" parameter at decide time at all,
  // so this is structurally impossible to redirect; confirm it lands on
  // bookingA only.
  await call(env, '/preview/staff/review/decide', withJson('POST', { token: tokenA, decision: 'confirm', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));

  const sourceA = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(bookingA.source_booking_ref).first();
  const sourceB = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(bookingB.source_booking_ref).first();
  assert.equal(sourceA.status, 'accepted');
  assert.equal(sourceB.status, 'pending', 'a decision on token A must never affect booking B');
});

test('missing operator is rejected for a booking decision too, even with valid staff auth and a valid token', async () => {
  const env = makeEnv();
  const { saved } = await seedAndSaveReservation(env, { assigned_driver_id: 'drv_1' });
  const token = new URL(saved.data.mock_staff_alert.review_link).searchParams.get('token');
  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(decide.status, 400);
});

test('"decline" is not a supported decision for a reservation subject', async () => {
  const env = makeEnv();
  const { saved } = await seedAndSaveReservation(env, { assigned_driver_id: 'drv_1' });
  const token = new URL(saved.data.mock_staff_alert.review_link).searchParams.get('token');
  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'decline', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(decide.status, 400);
});

test('a stale/late-arriving event never reverts a confirmation made through the staff review flow (consistent with round 16/17\'s terminal-safety design)', async () => {
  const env = makeEnv();
  const { booking, saved } = await seedAndSaveReservation(env, { assigned_driver_id: 'drv_1' });
  const token = new URL(saved.data.mock_staff_alert.review_link).searchParams.get('token');
  await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));

  // A duplicate "created" event replayed afterward must not revert the
  // now-accepted reservation.
  const replay = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/sync-event`, withJson('POST', { event_type: 'created', new_status: 'pending', source_event_id: 1, booking_id: booking.id }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  const source = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(source.status, 'accepted');
});
