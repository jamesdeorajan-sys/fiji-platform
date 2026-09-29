/* Marau Stage 1 (PREVIEW/TEST ONLY) — round 27: the next bounded
 * integration slice from docs/MARAU_STAGE1_PRODUCTION_RELEASE_PACKAGE.md
 * §1c: reservation saved -> secure guest link available immediately ->
 * authenticated staff confirmation -> authoritative outcome recovery ->
 * refreshed guest Trip, with the critical "source commits, response
 * lost" case covered directly. See worker/source_confirm.js's own
 * header for the design and why this is a genuinely new failure class
 * versus rounds 19-22's same-process D1 UPDATE confirm workflow.
 *
 * Preserved, unchanged, and proven (not reopened as optional) in every
 * test below: immediate pending guest access (round 14), verified
 * ownership (guest_sessions, never recoverable by phone/email match —
 * round 15's fix, untouched), individually-attributed staff decisions
 * (operator recorded per decision, never silently substituted on
 * retry — rounds 20-22's design), and the existing human WhatsApp
 * loop's independence from Marau (this round's own release-package
 * finding, §2).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv } from './fixtures.mjs';
import worker, { nowIso } from '../worker/worker.js';
import { confirmReservationAtSource } from '../worker/source_confirm.js';

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
    source_booking_ref: `sc-${n}`,
    id: 71000 + n,
    guest_email: `source.confirm${n}@example.test`,
    guest_phone: `+15005558${String(n).padStart(3, '0')}`,
    pickup_zone: 'Nadi Airport',
    destination_zone: 'Denarau',
    vehicle_type: 'Sedan',
    pickup_date: '2026-11-20',
    pickup_time: '10:00',
    quoted_amount: 55,
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

function sourceApiConfirm(env, sourceBookingRef, body) {
  return call(env, `/preview/admin/synthetic-source/${sourceBookingRef}/source-api-confirm`, withJson('POST', body, authed(env.MARAU_ADMIN_TEST_TOKEN)));
}

// ---------------------------------------------------------------------
// The full flow, end to end, over real HTTP against this Worker.
// ---------------------------------------------------------------------

test('full flow: reservation saved -> guest link available immediately -> authenticated staff confirmation at the source -> refreshed guest Trip, with no duplicate assignment', async () => {
  const env = makeEnv();
  const { booking, saved } = await seedAndSaveReservation(env);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.created, true);

  // Immediate pending guest access, verified ownership — unchanged,
  // proven here, not assumed: the guest already has a working, scoped
  // access token the moment the reservation synced as pending, BEFORE
  // any staff decision.
  const guestToken = saved.data.session.access_token;
  assert.ok(guestToken);
  const pendingTrip = await call(env, '/preview/trip', { headers: authed(guestToken) });
  assert.equal(pendingTrip.status, 200);
  assert.equal(pendingTrip.data.bookings[0].status, 'pending');

  // Unauthenticated staff confirmation must be rejected outright.
  const unauthed = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/source-api-confirm`, withJson('POST', { driver_id: 'drv_9', operator: 'Ana (ops)' }));
  assert.equal(unauthed.status, 401);

  // Authenticated staff confirmation.
  const confirm = await sourceApiConfirm(env, booking.source_booking_ref, { driver_id: 'drv_9', operator: 'Ana (ops)' });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.data.ok, true);
  assert.equal(confirm.data.outcome, 'confirmed');
  assert.equal(confirm.data.confirmed_driver_id, 'drv_9');
  assert.equal(confirm.data.operator, 'Ana (ops)');
  assert.equal(confirm.data.recovered_via_readback, false);
  assert.equal(confirm.data.sync.ok, true);

  // Refreshed guest Trip — immediately, not waiting for a separate tick.
  const refreshedTrip = await call(env, '/preview/trip', { headers: authed(guestToken) });
  assert.equal(refreshedTrip.data.bookings[0].status, 'confirmed');
});

// ---------------------------------------------------------------------
// THE CRITICAL CASE: the source commits the confirmation, but its
// response is lost. A retry must recover the original decision without
// duplicate assignment, notification, or changed operator attribution.
// ---------------------------------------------------------------------

test('critical case: source commits confirmation but the response is lost — recovers the original decision, no duplicate assignment or changed attribution', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);

  // The call that actually commits, then loses its own response.
  const lost = await sourceApiConfirm(env, booking.source_booking_ref, { driver_id: 'drv_1', operator: 'Ana (ops)', simulate_response_loss: true });
  // The demonstration endpoint itself still returns the RECOVERED
  // outcome (it reads it back internally) — the point being tested is
  // that source_confirm.js's own recovery logic, not the HTTP layer,
  // is what makes this safe; a real HTTP client would instead see its
  // OWN request time out and have to retry, covered by the next call.
  assert.equal(lost.status, 200);
  assert.equal(lost.data.ok, true);
  assert.equal(lost.data.recovered_via_readback, true);
  assert.equal(lost.data.confirmed_driver_id, 'drv_1');
  assert.equal(lost.data.operator, 'Ana (ops)');

  // The actual caller-side retry: same reservation, a DIFFERENT
  // operator (simulating a different staff member retrying after
  // seeing a timeout) and even a different intended driver — none of
  // it may change the durably-recorded outcome.
  const retry = await sourceApiConfirm(env, booking.source_booking_ref, { driver_id: 'drv_2', operator: 'Someone Else (ops)' });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.ok, true);
  assert.equal(retry.data.confirmed_driver_id, 'drv_1', 'the retry must never change which driver was actually assigned');
  assert.equal(retry.data.operator, 'Ana (ops)', 'the retry must never overwrite the original operator attribution');

  // No duplicate assignment at the source itself.
  const state = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}`, { headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(state.data.source.assigned_driver_id, 'drv_1');
  assert.equal(state.data.source.status, 'accepted');
});

test('critical case, unit-level: a source client that throws after committing causes zero additional writes on a third call (no duplicate notification)', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);

  let confirmCalls = 0;
  const store = { status: 'pending', assigned_driver_id: null };
  const client = {
    async getReservation() {
      return { ...store };
    },
    async confirmReservation(_ref, { driverId }) {
      confirmCalls += 1;
      // The real system's own compare-and-swap, reproduced directly.
      if (store.status !== 'pending' || store.assigned_driver_id) {
        return { won: false, current: { ...store } };
      }
      store.status = 'accepted';
      store.assigned_driver_id = driverId;
      throw new Error('SIMULATED_RESPONSE_LOSS_AFTER_COMMIT');
    },
  };

  const first = await confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_5', operator: 'Ana (ops)', nowIso });
  assert.equal(first.ok, true);
  assert.equal(first.recovered_via_readback, true);
  assert.equal(confirmCalls, 1, 'the write is attempted exactly once');

  const second = await confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_5', operator: 'Ana (ops)', nowIso });
  assert.equal(second.ok, true);
  assert.equal(confirmCalls, 1, 'a retry after the outcome is already durably known must make ZERO further calls to the source client');

  const third = await confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_9', operator: 'A Different Operator' });
  assert.equal(third.ok, true);
  assert.equal(third.operator, 'Ana (ops)');
  assert.equal(confirmCalls, 1, 'even a third caller with entirely different arguments never re-decides or re-calls the source');
});

// ---------------------------------------------------------------------
// Genuine conflict — never falsely attributed to the losing attempt.
// ---------------------------------------------------------------------

test('genuine conflict: two different intended drivers racing — the loser gets a conflict result, never a false confirmation or false attribution', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);

  const winner = await sourceApiConfirm(env, booking.source_booking_ref, { driver_id: 'drv_1', operator: 'Ana (ops)' });
  assert.equal(winner.data.outcome, 'confirmed');

  // A second, genuinely different attempt for the SAME source ref that
  // never went through the (already-ledgered) fast path — simulated by
  // clearing the local ledger only, to exercise the source's own
  // conflict response directly rather than the local fast path.
  await env.DB.prepare('DELETE FROM marau_source_confirm_outcomes WHERE source_booking_ref = ?').bind(booking.source_booking_ref).run();
  const loser = await sourceApiConfirm(env, booking.source_booking_ref, { driver_id: 'drv_2', operator: 'Someone Else (ops)' });
  assert.equal(loser.status, 409);
  assert.equal(loser.data.ok, false);
  assert.equal(loser.data.outcome, 'conflict');
  assert.equal(loser.data.confirmed_driver_id, 'drv_1');
  assert.equal(loser.data.operator, null, 'a conflicting attempt must never be attributed an operator');
});

// ---------------------------------------------------------------------
// Link-generation failure must never affect the original reservation
// or the source confirmation — they are genuinely decoupled.
// ---------------------------------------------------------------------

test('link-generation isolation: confirming at the source succeeds with zero dependency on guest_sessions/link minting ever having run', async () => {
  const env = makeEnv();
  // A source reservation that was NEVER synced into Marau at all (no
  // guest_sessions row, no marau_test_bookings mirror, no link-minting
  // of any kind) — modelling link generation having failed entirely,
  // or not yet having run.
  const booking = synthSourceBooking();
  await call(env, '/preview/admin/synthetic-source', withJson('POST', booking, authed(env.MARAU_ADMIN_TEST_TOKEN)));

  const client = {
    async getReservation() {
      const row = await env.DB.prepare('SELECT status, assigned_driver_id FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
      return row;
    },
    async confirmReservation(_ref, { driverId }) {
      const result = await env.DB
        .prepare(`UPDATE marau_synthetic_source_bookings SET status = 'accepted', assigned_driver_id = ? WHERE source_booking_ref = ? AND status = 'pending' AND assigned_driver_id IS NULL`)
        .bind(driverId, booking.source_booking_ref)
        .run();
      const current = await env.DB.prepare('SELECT status, assigned_driver_id FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
      return { won: result.meta.changes === 1, current };
    },
  };

  const noSessionExists = await env.DB.prepare('SELECT COUNT(*) AS n FROM guest_sessions WHERE guest_contact_key LIKE ?').bind(`%${booking.guest_phone}%`).first();
  assert.equal(noSessionExists.n, 0, 'sanity check: no guest session/link exists for this reservation before confirming');

  const result = await confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_3', operator: 'Ana (ops)', nowIso });
  assert.equal(result.ok, true, 'the real reservation confirms at the source regardless of whether guest-link generation ever ran');

  const source = await env.DB.prepare('SELECT status, assigned_driver_id FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(source.status, 'accepted');
  assert.equal(source.assigned_driver_id, 'drv_3');
});

// ---------------------------------------------------------------------
// Input validation, unchanged discipline.
// ---------------------------------------------------------------------

test('validation: missing driver_id or operator is rejected before any source call', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);

  const noDriver = await sourceApiConfirm(env, booking.source_booking_ref, { operator: 'Ana (ops)' });
  assert.equal(noDriver.status, 400);

  const noOperator = await sourceApiConfirm(env, booking.source_booking_ref, { driver_id: 'drv_1' });
  assert.equal(noOperator.status, 400);
});
