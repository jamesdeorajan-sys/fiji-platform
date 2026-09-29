/* Marau Stage 1 (PREVIEW/TEST ONLY) — round 27/28: the next bounded
 * integration slice from docs/MARAU_STAGE1_PRODUCTION_RELEASE_PACKAGE.md
 * §1c: reservation saved -> secure guest link available immediately ->
 * authenticated staff confirmation -> authoritative outcome recovery ->
 * refreshed guest Trip, with the critical "source commits, response
 * lost" case covered directly.
 *
 * ROUND 28: Codex independently verified round 27 (461/461), then
 * reproduced three real defects plus three further hardening
 * requirements in worker/source_confirm.js's design — see that file's
 * own header for the full write-up. Every test below is organized
 * under the same fix numbers, so the correction each test proves is
 * traceable back to what it corrects.
 *
 * Preserved, unchanged and proven (not reopened as optional) in every
 * test below: immediate pending guest access (round 14), verified
 * ownership (guest_sessions, never recoverable by phone/email match —
 * round 15's fix, untouched), and the existing human WhatsApp loop's
 * independence from Marau (round 26's own finding, §2).
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
function staffAuthed(adminToken, staffToken) {
  return { authorization: `Bearer ${adminToken}`, 'x-marau-staff-token': staffToken };
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

async function seedStaffIdentity(env, token, operatorName) {
  await call(env, '/preview/admin/staff-identities', withJson('POST', { token, operator_name: operatorName }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
}

function sourceApiConfirm(env, sourceBookingRef, { driverId, staffToken, simulateResponseLoss, spoofedOperator } = {}) {
  const body = { driver_id: driverId };
  if (simulateResponseLoss) body.simulate_response_loss = true;
  if (spoofedOperator) body.operator = spoofedOperator; // fix 5: must be ignored entirely
  return call(env, `/preview/admin/synthetic-source/${sourceBookingRef}/source-api-confirm`, withJson('POST', body, staffAuthed(env.MARAU_ADMIN_TEST_TOKEN, staffToken)));
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
  // proven here, not assumed.
  const guestToken = saved.data.session.access_token;
  assert.ok(guestToken);
  const pendingTrip = await call(env, '/preview/trip', { headers: authed(guestToken) });
  assert.equal(pendingTrip.status, 200);
  assert.equal(pendingTrip.data.bookings[0].status, 'pending');

  await seedStaffIdentity(env, 'staff-tok-ana', 'Ana (ops)');

  // Unauthenticated (no staff identity) confirmation must be rejected.
  const noIdentity = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/source-api-confirm`, withJson('POST', { driver_id: 'drv_9' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(noIdentity.status, 401);

  const confirm = await sourceApiConfirm(env, booking.source_booking_ref, { driverId: 'drv_9', staffToken: 'staff-tok-ana' });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.data.ok, true);
  assert.equal(confirm.data.status, 'confirmed');
  assert.equal(confirm.data.confirmed_driver_id, 'drv_9');
  assert.equal(confirm.data.operator, 'Ana (ops)');
  assert.equal(confirm.data.recovered_via_readback, false);
  assert.equal(confirm.data.sync.ok, true);

  const refreshedTrip = await call(env, '/preview/trip', { headers: authed(guestToken) });
  assert.equal(refreshedTrip.data.bookings[0].status, 'confirmed');
});

// ---------------------------------------------------------------------
// FIX 5 — operator identity is derived from authenticated staff
// context, never a caller-supplied display-name field.
// ---------------------------------------------------------------------

test('fix 5: operator is derived from the authenticated staff identity token, never a spoofed body field, demonstrated with two isolated test identities', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);
  await seedStaffIdentity(env, 'staff-tok-ana', 'Ana (ops)');
  await seedStaffIdentity(env, 'staff-tok-bala', 'Bala (ops)');

  const confirm = await sourceApiConfirm(env, booking.source_booking_ref, { driverId: 'drv_1', staffToken: 'staff-tok-ana', spoofedOperator: 'Impersonated Name' });
  assert.equal(confirm.data.operator, 'Ana (ops)', 'the recorded operator must come from the authenticated identity token, never the request body');

  const { booking: booking2 } = await seedAndSaveReservation(env);
  const confirm2 = await sourceApiConfirm(env, booking2.source_booking_ref, { driverId: 'drv_2', staffToken: 'staff-tok-bala' });
  assert.equal(confirm2.data.operator, 'Bala (ops)', 'a different staff identity token attributes a different, correct operator');

  const unknownToken = await sourceApiConfirm(env, booking.source_booking_ref, { driverId: 'drv_1', staffToken: 'not-a-real-token' });
  assert.equal(unknownToken.status, 401);
});

// ---------------------------------------------------------------------
// FIX 1 — a cancelled reservation must never read back as confirmed,
// regardless of which driver id is still attached to it.
// ---------------------------------------------------------------------

test('fix 1: a reservation cancelled at the source in the window between a lost response and recovery is never reported as confirmed', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);

  const client = {
    async getReservation(ref) {
      const row = await env.DB.prepare('SELECT status, assigned_driver_id, confirmation_attempt_id, confirmed_operator_name FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(ref).first();
      return row ? { status: row.status, assigned_driver_id: row.assigned_driver_id, confirmation_attempt_id: row.confirmation_attempt_id, confirmed_operator: row.confirmed_operator_name } : null;
    },
    async confirmReservation(ref, { driverId, attemptId, operator }) {
      // Commits the assignment, THEN the reservation is cancelled
      // (e.g. by a real, ordinary admin cancellation racing with this
      // exact request) — retaining the driver id — BEFORE the response
      // is lost.
      await env.DB.prepare(`UPDATE marau_synthetic_source_bookings SET status = 'accepted', assigned_driver_id = ?, confirmation_attempt_id = ?, confirmed_operator_name = ? WHERE source_booking_ref = ?`)
        .bind(String(driverId), attemptId, operator, ref).run();
      await env.DB.prepare(`UPDATE marau_synthetic_source_bookings SET status = 'cancelled' WHERE source_booking_ref = ?`).bind(ref).run();
      throw new Error('SIMULATED_RESPONSE_LOSS_AFTER_CANCELLATION');
    },
  };

  const result = await confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_4', operator: 'Ana (ops)', nowIso });
  assert.equal(result.ok, false, 'a cancelled reservation must never be reported as a successful confirmation');
  assert.equal(result.status, 'source_cancelled');
  assert.notEqual(result.status, 'confirmed');
});

// ---------------------------------------------------------------------
// FIX 2 — driver-id equality alone cannot establish ownership; the
// durable, source-persisted attempt_id is the actual identity check.
// ---------------------------------------------------------------------

test('fix 2: a coincidentally-matching driver id from a DIFFERENT attempt is correctly reported as a conflict, never a false confirmation', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);

  // Simulate: someone else confirmed this reservation entirely outside
  // Marau (e.g. directly through the real system's own UI), using the
  // SAME driver id Marau is about to attempt — but a different attempt
  // identity, since Marau never issued it.
  await env.DB.prepare(`UPDATE marau_synthetic_source_bookings SET status = 'accepted', assigned_driver_id = ?, confirmation_attempt_id = ?, confirmed_operator_name = ? WHERE source_booking_ref = ?`)
    .bind('drv_shared', 'someone-elses-attempt-id', 'A Different Operator Entirely', booking.source_booking_ref).run();

  const client = {
    async getReservation(ref) {
      const row = await env.DB.prepare('SELECT status, assigned_driver_id, confirmation_attempt_id, confirmed_operator_name FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(ref).first();
      return row ? { status: row.status, assigned_driver_id: row.assigned_driver_id, confirmation_attempt_id: row.confirmation_attempt_id, confirmed_operator: row.confirmed_operator_name } : null;
    },
    async confirmReservation(ref) {
      const current = await this.getReservation(ref);
      return { won: false, current };
    },
  };

  const result = await confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_shared', operator: 'Ana (ops)', nowIso });
  assert.equal(result.status, 'conflict', 'the same driver id from a different attempt must never be treated as our own confirmation');
  assert.equal(result.confirmed_driver_id, 'drv_shared');
  assert.equal(result.operator, 'Ana (ops)', "the LOCAL ledger's own reserving operator is still recorded, distinct from whoever actually won at the source");
});

// ---------------------------------------------------------------------
// FIX 3 — a local ledger write failure must never lose a real source
// success. Reproduced with a real SQLite trigger, then recovered.
// ---------------------------------------------------------------------

test('fix 3: a fault-injected decision-log insert never loses a genuine source success, and a retry after the fault is removed repairs it without re-deciding', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);
  await seedStaffIdentity(env, 'staff-tok-ana', 'Ana (ops)');

  env.DB.exec(`CREATE TRIGGER round28_block_decision_log BEFORE INSERT ON marau_source_confirm_decision_log BEGIN SELECT RAISE(ABORT, 'round28 fault injection'); END;`);

  const first = await sourceApiConfirm(env, booking.source_booking_ref, { driverId: 'drv_7', staffToken: 'staff-tok-ana' });
  assert.equal(first.status, 200, 'a failure in the SECONDARY decision log must never be reported as the confirmation itself failing');
  assert.equal(first.data.ok, true);
  assert.equal(first.data.status, 'confirmed');
  assert.equal(first.data.operator, 'Ana (ops)');

  const { results: logRowsBefore } = await env.DB.prepare('SELECT * FROM marau_source_confirm_decision_log WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(logRowsBefore.length, 0, 'the interrupted state under test: the secondary decision log row is genuinely missing');

  const ledgerRow = await env.DB.prepare('SELECT * FROM marau_source_confirm_outcomes WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(ledgerRow.status, 'confirmed', 'the PRIMARY ledger row is already durable and correct despite the secondary fault');
  assert.equal(ledgerRow.operator, 'Ana (ops)');

  env.DB.exec('DROP TRIGGER round28_block_decision_log;');

  await seedStaffIdentity(env, 'staff-tok-bala', 'Bala (ops)');
  const retry = await sourceApiConfirm(env, booking.source_booking_ref, { driverId: 'drv_99', staffToken: 'staff-tok-bala' });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.confirmed_driver_id, 'drv_7', 'the retry must never change which driver was actually assigned');
  assert.equal(retry.data.operator, 'Ana (ops)', "the retry must never overwrite the original operator with the retrying caller's own identity");

  const { results: logRowsAfter } = await env.DB.prepare('SELECT * FROM marau_source_confirm_decision_log WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(logRowsAfter.length, 1, 'exactly one decision-log row after repair — never zero, never duplicated');
});

// ---------------------------------------------------------------------
// FIX 4 — an unavailable recovery readback is reported honestly, never
// guessed; a "still pending" read alone is not proof a write cannot
// still commit; a later, DIFFERENT caller's retry still recovers the
// original decision.
// ---------------------------------------------------------------------

test('fix 4: response lost AND the recovery readback also fails -- reported as a genuine unresolved outcome, never guessed', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);

  const client = {
    async getReservation() {
      throw new Error('SOURCE_TEMPORARILY_UNREACHABLE');
    },
    async confirmReservation() {
      throw new Error('SIMULATED_RESPONSE_LOSS');
    },
  };

  const result = await confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_1', operator: 'Ana (ops)', nowIso });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unresolved');
  assert.equal(result.unresolved, true);

  const ledgerRow = await env.DB.prepare('SELECT * FROM marau_source_confirm_outcomes WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(ledgerRow.status, 'reserved', 'the reservation itself must be left exactly as-is, never silently resolved to a guessed outcome');
});

test('fix 4: a readback showing the source still "pending" after a lost response is NOT treated as confident proof the write never landed', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);

  const client = {
    async getReservation() {
      // A pending read — genuinely ambiguous, since an in-flight
      // request could still commit after this read completes.
      return { status: 'pending', assigned_driver_id: null, confirmation_attempt_id: null, confirmed_operator: null };
    },
    async confirmReservation() {
      throw new Error('SIMULATED_RESPONSE_LOSS');
    },
  };

  const result = await confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_1', operator: 'Ana (ops)', nowIso });
  assert.equal(result.status, 'unresolved', 'a pending readback after a lost response must remain unresolved, not a confident "safe to retry"');
});

test('fix 4: a later retry by a DIFFERENT caller, once the source becomes readable again, recovers the ORIGINAL reservation\'s decision unchanged', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);

  let readbackAttempts = 0;
  const store = { status: 'pending', assigned_driver_id: null, confirmation_attempt_id: null, confirmed_operator: null };
  const client = {
    async getReservation() {
      readbackAttempts += 1;
      if (readbackAttempts === 1) throw new Error('SOURCE_TEMPORARILY_UNREACHABLE');
      return { ...store };
    },
    async confirmReservation(_ref, { driverId, attemptId, operator }) {
      store.status = 'accepted';
      store.assigned_driver_id = driverId;
      store.confirmation_attempt_id = attemptId;
      store.confirmed_operator = operator;
      throw new Error('SIMULATED_RESPONSE_LOSS');
    },
  };

  const first = await confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_5', operator: 'Ana (ops)', nowIso });
  assert.equal(first.status, 'unresolved', 'first attempt: both the write response and the recovery read are unavailable');

  // A genuinely different caller retries — different intended driver,
  // different operator — but the ORIGINAL reservation must still win.
  const retry = await confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_6', operator: 'Someone Else Entirely', nowIso });
  assert.equal(retry.ok, true);
  assert.equal(retry.status, 'confirmed');
  assert.equal(retry.confirmed_driver_id, 'drv_5', 'the original intended driver must be what was actually confirmed');
  assert.equal(retry.operator, 'Ana (ops)', "the original operator's attribution must survive, never the later caller's own");
});

// ---------------------------------------------------------------------
// FIX 6 — genuine concurrency: two truly concurrent confirm attempts
// for the same reservation converge on exactly one reserved attempt,
// exactly one real assignment, exactly one notification-equivalent
// side effect, and the same operator attribution.
// ---------------------------------------------------------------------

test('fix 6: two truly concurrent confirm attempts for the same reservation produce exactly one source decision, one assignment, one notification, and consistent attribution', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);

  let assignmentCount = 0;
  let notificationCount = 0;
  const store = { status: 'pending', assigned_driver_id: null, confirmation_attempt_id: null, confirmed_operator: null };
  const client = {
    async getReservation() {
      return { ...store };
    },
    async confirmReservation(_ref, { driverId, attemptId, operator }) {
      if (store.status !== 'pending') {
        return { won: false, current: { ...store } };
      }
      // The real system's own compare-and-swap, reproduced directly —
      // the assignment and its notification-equivalent side effect
      // happen together, exactly once, on the winning branch only.
      store.status = 'accepted';
      store.assigned_driver_id = driverId;
      store.confirmation_attempt_id = attemptId;
      store.confirmed_operator = operator;
      assignmentCount += 1;
      notificationCount += 1;
      return { won: true, current: { ...store } };
    },
  };

  const [a, b, c] = await Promise.all([
    confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_A', operator: 'Staff A', nowIso }),
    confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_B', operator: 'Staff B', nowIso }),
    confirmReservationAtSource(env, client, { sourceBookingRef: booking.source_booking_ref, driverId: 'drv_C', operator: 'Staff C', nowIso }),
  ]);

  assert.equal(assignmentCount, 1, 'exactly one real assignment must ever happen at the source, regardless of concurrent callers');
  assert.equal(notificationCount, 1, 'exactly one notification-equivalent side effect, never duplicated by concurrent callers');

  const results = [a, b, c];
  const confirmed = results.filter((r) => r.ok);
  assert.ok(confirmed.length >= 1, 'at least the winning attempt must resolve to confirmed');
  const operators = new Set(results.map((r) => r.operator));
  assert.equal(operators.size, 1, 'every concurrent caller must see the SAME operator attribution — the one whose reservation actually won');
  const driverIds = new Set(results.filter((r) => r.confirmed_driver_id).map((r) => r.confirmed_driver_id));
  assert.equal(driverIds.size, 1, 'every concurrent caller must see the SAME confirmed driver');

  const { results: ledgerRows } = await env.DB.prepare('SELECT * FROM marau_source_confirm_outcomes WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(ledgerRows.length, 1, 'exactly one local reservation must ever exist for this source_booking_ref, regardless of how many callers race to create it');
});

// ---------------------------------------------------------------------
// Link-generation isolation — unchanged design, re-verified against
// the round-28 corrected module.
// ---------------------------------------------------------------------

test('link-generation isolation: confirming at the source succeeds with zero dependency on guest_sessions/link minting ever having run', async () => {
  const env = makeEnv();
  const booking = synthSourceBooking();
  await call(env, '/preview/admin/synthetic-source', withJson('POST', booking, authed(env.MARAU_ADMIN_TEST_TOKEN)));

  const client = {
    async getReservation(ref) {
      const row = await env.DB.prepare('SELECT status, assigned_driver_id, confirmation_attempt_id, confirmed_operator_name FROM marau_synthetic_source_bookings WHERE source_booking_ref = ?').bind(ref).first();
      return row ? { status: row.status, assigned_driver_id: row.assigned_driver_id, confirmation_attempt_id: row.confirmation_attempt_id, confirmed_operator: row.confirmed_operator_name } : null;
    },
    async confirmReservation(ref, { driverId, attemptId, operator }) {
      const result = await env.DB
        .prepare(`UPDATE marau_synthetic_source_bookings SET status = 'accepted', assigned_driver_id = ?, confirmation_attempt_id = ?, confirmed_operator_name = ? WHERE source_booking_ref = ? AND status = 'pending' AND assigned_driver_id IS NULL`)
        .bind(driverId, attemptId, operator, ref)
        .run();
      const current = await this.getReservation(ref);
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

test('validation: missing driver_id or unknown staff identity is rejected before any source call', async () => {
  const env = makeEnv();
  const { booking } = await seedAndSaveReservation(env);
  await seedStaffIdentity(env, 'staff-tok-ana', 'Ana (ops)');

  const noDriver = await call(env, `/preview/admin/synthetic-source/${booking.source_booking_ref}/source-api-confirm`, withJson('POST', {}, staffAuthed(env.MARAU_ADMIN_TEST_TOKEN, 'staff-tok-ana')));
  assert.equal(noDriver.status, 400);

  const unknownStaff = await sourceApiConfirm(env, booking.source_booking_ref, { driverId: 'drv_1', staffToken: 'nonexistent' });
  assert.equal(unknownStaff.status, 401);
});
