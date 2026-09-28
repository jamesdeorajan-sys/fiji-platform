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

// ---------------------------------------------------------------------
// Round 22 — the confirmation commit boundary and recovery. Exact
// reproduction: fault-inject INSERT on marau_staff_decisions, confirm a
// reservation, observe the source/mirror already committed despite a
// reported failure, then drop the fault and retry.
// ---------------------------------------------------------------------

test('round22 exact repro: a fault-injected audit-insert failure must NEVER be reported as the confirmation failing -- source accepted and mirror confirmed, never a 500', async () => {
  const env = makeEnv();
  const { booking, saved } = await seedAndSaveReservation(env, { assigned_driver_id: 'drv_22' });
  const token = new URL(saved.data.mock_staff_alert.review_link).searchParams.get('token');

  env.DB.exec(`CREATE TRIGGER round22_block_audit BEFORE INSERT ON marau_staff_decisions BEGIN SELECT RAISE(ABORT, 'round22 fault injection'); END;`);

  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'Ana (ops)' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(decide.status, 200, 'a failure in the SECONDARY audit write must never be reported as the confirmation itself failing');
  assert.equal(decide.data.ok, true);
  assert.equal(decide.data.source_status, 'accepted');
  assert.equal(decide.data.audit.ok, false, 'the audit sub-result must honestly report its own failure, distinct from the overall success');
  assert.equal(decide.data.audit.reason, 'AUDIT_INSERT_FAILED');

  const source = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(source.status, 'accepted');
  assert.equal(source.confirmed_operator, 'Ana (ops)', 'the operator must be durably recorded on the source row itself, independent of the audit table');
  const mirror = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(mirror.status, 'confirmed', 'the guest-facing mirror must already be confirmed -- the sync genuinely completed');
  const { results: auditRows } = await env.DB.prepare('SELECT * FROM marau_staff_decisions WHERE subject_id = ?').bind(booking.source_booking_ref).all();
  assert.equal(auditRows.length, 0, 'the interrupted state under test: the audit row is genuinely missing');

  env.DB.exec('DROP TRIGGER round22_block_audit;');

  const retry = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'Someone Else (ops)' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(retry.status, 200, 'a retry after the fault is removed must repair, not report a hard failure');
  assert.equal(retry.data.recovered, true);
  assert.equal(retry.data.audit.ok, true);
  assert.equal(retry.data.confirmed_operator, 'Ana (ops)', 'the retry must NEVER replace the original deciding operator with its own argument');

  const { results: auditRowsAfterRetry } = await env.DB.prepare('SELECT * FROM marau_staff_decisions WHERE subject_id = ?').bind(booking.source_booking_ref).all();
  assert.equal(auditRowsAfterRetry.length, 1, 'exactly one audit row after repair -- never zero, never duplicated');
  assert.equal(auditRowsAfterRetry[0].operator, 'Ana (ops)', 'the repaired audit row must record the ORIGINAL operator, never the retry caller\'s own');

  const sourceAfterRetry = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(sourceAfterRetry.confirmed_operator, 'Ana (ops)', 'the source row\'s own durable operator must also never change on retry');
});

test('round22: the pending->accepted UPDATE is conditional and atomic -- a concurrent confirm attempt for the same reservation only ever lets one through', async () => {
  const env = makeEnv();
  const { booking, saved } = await seedAndSaveReservation(env, { assigned_driver_id: 'drv_concurrent' });
  const token = new URL(saved.data.mock_staff_alert.review_link).searchParams.get('token');

  const [a, b] = await Promise.all([
    call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'staff-A' }, authed(env.MARAU_ADMIN_TEST_TOKEN))),
    call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'staff-B' }, authed(env.MARAU_ADMIN_TEST_TOKEN))),
  ]);
  const results = [a, b];
  const winners = results.filter((r) => r.data.ok && !r.data.recovered);
  const recovered = results.filter((r) => r.data.recovered);
  assert.equal(winners.length, 1, 'exactly one call must perform the real atomic transition');
  assert.equal(recovered.length, 1, 'the other must land on the repair path, never a second real transition');

  const source = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.ok(source.confirmed_operator === 'staff-A' || source.confirmed_operator === 'staff-B');
  const winnerOperator = source.confirmed_operator;
  for (const r of results) assert.equal(r.data.confirmed_operator, winnerOperator);

  const { results: auditRows } = await env.DB.prepare('SELECT * FROM marau_staff_decisions WHERE subject_id = ?').bind(booking.source_booking_ref).all();
  assert.equal(auditRows.length, 1, 'exactly one audit row, even from two concurrent attempts');
  assert.equal(auditRows[0].operator, winnerOperator);
});

test('round22: the atomic UPDATE re-checks the driver requirement at write time too, not just in an earlier read', async () => {
  const env = makeEnv();
  const { booking, saved } = await seedAndSaveReservation(env);
  const token = new URL(saved.data.mock_staff_alert.review_link).searchParams.get('token');

  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(decide.status, 409);
  assert.equal(decide.data.error, 'DRIVER_NOT_ASSIGNED');
  const source = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(source.status, 'pending');
  assert.equal(source.confirmed_operator, null);
});

test('round22: a genuinely already-decided reservation NOT confirmed via this workflow (e.g. cancelled by another path) still reports ALREADY_DECIDED, not a false repair', async () => {
  const env = makeEnv();
  const { booking, saved } = await seedAndSaveReservation(env, { assigned_driver_id: 'drv_1' });
  await env.DB.prepare(`UPDATE marau_synthetic_source_bookings SET status = 'cancelled' WHERE source_booking_ref = ?`).bind(booking.source_booking_ref).run();

  const token = new URL(saved.data.mock_staff_alert.review_link).searchParams.get('token');
  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(decide.status, 409);
  assert.equal(decide.data.error, 'ALREADY_DECIDED');
  assert.equal(decide.data.current_status, 'cancelled');
});

test('round22: staff-authorisation regressions are preserved unchanged -- guest cannot decide, wrong admin_token rejected, missing operator rejected, driver check enforced', async () => {
  const env = makeEnv();
  const { booking, saved } = await seedAndSaveReservation(env, { assigned_driver_id: 'drv_1' });
  const token = new URL(saved.data.mock_staff_alert.review_link).searchParams.get('token');

  const noAuth = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'x' }));
  assert.equal(noAuth.status, 401);

  const wrongAdminToken = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'x', admin_token: 'wrong' }));
  assert.equal(wrongAdminToken.status, 401);

  const noOperator = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(noOperator.status, 400);

  const source = await env.DB.prepare('SELECT * FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(source.status, 'pending', 'none of the rejected attempts above may have confirmed anything');
});
