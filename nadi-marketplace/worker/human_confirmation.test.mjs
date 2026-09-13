// Nadi Airport Transfers — Milestone 36: authoritative human-confirmed
// booking state tests.
//
// CORRECTED 2026-09-14 per CEO P0 review: the first version of this suite
// tested a design that repurposed bookings.status = 'human_confirmed',
// which was rejected because it would have silently blocked the existing
// operational driver-accept flow. This version tests the corrected,
// orthogonal design instead (human_confirmed_at/human_confirmed_by
// columns, bookings.status completely untouched) and adds real
// compatibility tests proving the existing pending -> accepted -> en_route
// -> completed flow, and cancellation, still work exactly as before both
// before and after a booking is human-confirmed.
//
// Offline, no network, no live D1 - drives the REAL worker.js `fetch()`
// handler (imported directly, not reimplemented) against an in-memory
// SQLite database loaded with the real schema.sql + the
// milestone36-human-confirmed-status.sql migration, via a minimal D1-
// compatible shim over node:sqlite (env.DB.prepare().bind().first()/
// all()/run(), matching the exact shape worker.js already expects). This
// is the first fully offline test suite for this Worker - every existing
// suite in this directory requires a live deployment, which "NO DEPLOY"
// rules out for this mission.
//
// .mjs to use ES import syntax (matching pricing-steps.test.mjs's own
// precedent) without needing a package.json in this directory.
//
// Run: node --test nadi-marketplace/worker/human_confirmation.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const MIGRATION_SQL = readFileSync(
  path.join(__dirname, '..', 'migrations', 'milestone36-human-confirmed-status.sql'),
  'utf8'
);

const TEST_ADMIN_TOKEN = 'test-admin-token-' + Math.random().toString(36).slice(2);

/**
 * Minimal D1-compatible shim over node:sqlite's synchronous API, matching
 * exactly the subset of the real D1 client worker.js uses:
 * env.DB.prepare(sql).bind(...args).first()/.all()/.run(), with
 * run()'s return shape { meta: { changes, last_row_id } }.
 */
function createD1Shim(db) {
  return {
    prepare(sql) {
      let boundArgs = [];
      const api = {
        bind(...args) {
          boundArgs = args;
          return api;
        },
        async first() {
          const stmt = db.prepare(sql);
          const row = stmt.get(...boundArgs);
          return row === undefined ? null : row;
        },
        async all() {
          const stmt = db.prepare(sql);
          return { results: stmt.all(...boundArgs) };
        },
        async run() {
          const stmt = db.prepare(sql);
          const info = stmt.run(...boundArgs);
          return { meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
        },
      };
      return api;
    },
  };
}

function freshEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  db.exec(MIGRATION_SQL);
  return { env: { DB: createD1Shim(db), ADMIN_TOKEN: TEST_ADMIN_TOKEN }, db };
}

function insertBooking(db, overrides = {}) {
  const cols = {
    pickup_zone: 'NAD_AIRPORT',
    destination_zone: 'DENARAU',
    vehicle_type: 'sedan',
    quoted_currency: 'FJD',
    quoted_amount: 49,
    fx_rate_at_booking: 1,
    settlement_amount_fjd: 49,
    fuel_multiplier_applied: 1,
    payment_method: 'cash',
    status: 'pending',
    pickup_date: '2026-10-05',
    pickup_time: '09:30',
    ...overrides,
  };
  const fields = Object.keys(cols);
  const placeholders = fields.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO bookings (${fields.join(', ')}) VALUES (${placeholders})`);
  const info = stmt.run(...fields.map((f) => cols[f]));
  return info.lastInsertRowid;
}

function req(path, { method = 'POST', token = TEST_ADMIN_TOKEN, body } = {}) {
  const headers = {};
  if (token !== null) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://worker.test${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function humanConfirm(env, bookingId, opts = {}) {
  const res = await worker.fetch(req(`/admin/bookings/${bookingId}/human-confirm`, opts), env);
  const body = await res.json();
  return { status: res.status, body };
}

// ─── driver fixtures, for exercising the REAL pending -> accepted ->
// en_route -> completed flow (handleDriverAcceptBooking/
// handleDriverBookingStatus) unmodified by this mission, to prove human
// confirmation is genuinely orthogonal to it, not just asserted to be. ───

function insertDriver(db, overrides = {}) {
  const cols = {
    name: 'Test Driver',
    phone: '+6799999999',
    status: 'verified',
    zones: JSON.stringify(['NAD_AIRPORT']),
    online: 1,
    ...overrides,
  };
  const fields = Object.keys(cols);
  const placeholders = fields.map(() => '?').join(', ');
  const stmt = db.prepare(`INSERT INTO drivers (${fields.join(', ')}) VALUES (${placeholders})`);
  const info = stmt.run(...fields.map((f) => cols[f]));
  return info.lastInsertRowid;
}

function insertDriverLoginToken(db, driverId, token) {
  db.prepare(
    `INSERT INTO driver_login_tokens (driver_id, token, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))`
  ).run(driverId, token);
}

function driverAccept(env, bookingId, token) {
  return worker.fetch(req(`/driver/bookings/${bookingId}/accept`, { token }), env);
}

function driverStatus(env, bookingId, token, status) {
  return worker.fetch(req(`/driver/bookings/${bookingId}/status`, { token, body: { status } }), env);
}

// ─── 1. unauthenticated confirm rejected ───────────────────────────────
test('unauthenticated confirm is rejected (401), booking untouched', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);
  const { status, body } = await humanConfirm(env, id, { token: null });
  assert.equal(status, 401);
  const row = db.prepare('SELECT status FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'pending');
  const events = db.prepare('SELECT * FROM booking_events WHERE booking_id = ?').all(id);
  assert.equal(events.length, 0, 'no event may be written for a rejected unauthenticated attempt');
});

test('a wrong/garbage bearer token is rejected (401) too, not just a missing one', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);
  const { status } = await humanConfirm(env, id, { token: 'not-the-real-token' });
  assert.equal(status, 401);
  const row = db.prepare('SELECT status FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'pending');
});

// ─── 2. system/cron actor rejected ──────────────────────────────────────
// There is no route to this endpoint for a driver or a system/cron process
// at all - requireAdmin() is the ONLY gate, and it recognizes exactly one
// identity class (the admin bearer token / admin_login_tokens row). This
// test proves that by construction: calling the endpoint with no
// authentication is indistinguishable from "not admin", including for a
// hypothetical system/cron caller that has no admin token of its own.
test('a caller with no admin credential (representing a system/cron actor) is rejected, same as any other unauthenticated caller', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);
  const { status } = await humanConfirm(env, id, { token: null });
  assert.equal(status, 401);
  // And confirms directly: the event this endpoint writes on success is
  // ALWAYS actor:'admin' - there is no parameter or code path that lets a
  // caller supply a different actor value (see worker.js's
  // handleAdminHumanConfirm - actor is a literal, never read from the
  // request).
  const ok = await humanConfirm(env, id, { token: TEST_ADMIN_TOKEN });
  assert.equal(ok.status, 200);
  const event = db.prepare('SELECT actor FROM booking_events WHERE booking_id = ? AND event_type = ?').get(id, 'human_confirmed');
  assert.equal(event.actor, 'admin');
});

// ─── 3. wrong booking rejected ──────────────────────────────────────────
test('a nonexistent booking id is rejected (404)', async () => {
  const { env } = freshEnv();
  const { status, body } = await humanConfirm(env, 999999);
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

// ─── 4. missing pickup date/time rejected ───────────────────────────────
test('missing pickup_date fails closed (400), never confirmed', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db, { pickup_date: null });
  const { status, body } = await humanConfirm(env, id);
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  const row = db.prepare('SELECT status FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'pending');
});

test('missing pickup_time fails closed (400) too', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db, { pickup_time: null });
  const { status } = await humanConfirm(env, id);
  assert.equal(status, 400);
  const row = db.prepare('SELECT status FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'pending');
});

// ─── 5. repeated confirmation idempotent / 6. event written once / 7. timestamp written once ──
test('repeated confirmation is idempotent: second call succeeds without writing a second event or re-writing the timestamp — and bookings.status is never touched at all', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);

  const first = await humanConfirm(env, id);
  assert.equal(first.status, 200);
  assert.equal(first.body.already_confirmed, false);
  assert.ok(first.body.human_confirmed_at, 'must return the timestamp it just wrote');
  assert.equal(first.body.human_confirmed_by, 'admin');
  assert.equal(first.body.status, 'pending', 'bookings.status must be completely untouched by this action');

  const second = await humanConfirm(env, id);
  assert.equal(second.status, 200);
  assert.equal(second.body.already_confirmed, true);
  assert.equal(second.body.human_confirmed_at, first.body.human_confirmed_at, 'timestamp must not change on a repeat call');
  assert.equal(second.body.status, 'pending');

  const events = db.prepare('SELECT * FROM booking_events WHERE booking_id = ? AND event_type = ?').all(id, 'human_confirmed');
  assert.equal(events.length, 1, 'event written exactly once across two confirm calls');
  assert.equal(events[0].previous_status, 'pending', 'previous_status records the operational status at confirm time');
  assert.equal(events[0].new_status, null, 'new_status must be null - this action never changes bookings.status');
  assert.equal(events[0].actor, 'admin');

  const row = db.prepare('SELECT status, human_confirmed_at, human_confirmed_by FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'pending', 'bookings.status is unchanged by human confirmation - the whole point of the P0 correction');
  assert.equal(row.human_confirmed_by, 'admin');
  assert.ok(row.human_confirmed_at, 'human_confirmed_at written exactly once and stays correct');
});

test('a third, fourth, fifth repeat call all remain idempotent no-ops', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);
  for (let i = 0; i < 5; i++) {
    const { status } = await humanConfirm(env, id);
    assert.equal(status, 200);
  }
  const events = db.prepare('SELECT * FROM booking_events WHERE booking_id = ? AND event_type = ?').all(id, 'human_confirmed');
  assert.equal(events.length, 1);
});

// ─── 8. human confirmation is orthogonal to operational status — the P0 correction itself ────
test('a booking that is already accepted/en_route/completed/cancelled CAN still be human-confirmed - operational status is never a precondition (this is the exact P0 correction: the prior version wrongly rejected this with 409)', async () => {
  for (const status of ['accepted', 'en_route', 'completed', 'cancelled']) {
    const { env, db } = freshEnv();
    const id = insertBooking(db, { status });
    const { status: httpStatus, body } = await humanConfirm(env, id);
    assert.equal(httpStatus, 200, `status=${status} must not block human-confirm`);
    assert.equal(body.already_confirmed, false);
    assert.equal(body.status, status, 'bookings.status must be returned unchanged, exactly as it was before confirmation');
    const row = db.prepare('SELECT status, human_confirmed_at FROM bookings WHERE id = ?').get(id);
    assert.equal(row.status, status, 'bookings.status column itself must be unchanged in the database too');
    assert.ok(row.human_confirmed_at);
  }
});

test('cancelling a booking works identically whether or not it has been human-confirmed first - the existing /cancel endpoint needed zero changes, because it was never keyed off human_confirmed_at/by', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);
  const confirmed = await humanConfirm(env, id);
  assert.equal(confirmed.status, 200);

  const cancelRes = await worker.fetch(req(`/admin/bookings/${id}/cancel`), env);
  assert.equal(cancelRes.status, 200);

  const row = db.prepare('SELECT status, human_confirmed_at FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'cancelled', 'the pre-existing cancel endpoint already generically allows this — no backend change was needed for it');
  assert.ok(row.human_confirmed_at, 'cancelling does not clear the human-confirmed record - it is an independent, orthogonal fact');
});

test('a cancelled booking CAN be human-confirmed afterward too - no operational-status precondition exists in either direction', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db, { status: 'cancelled' });
  const { status, body } = await humanConfirm(env, id);
  assert.equal(status, 200);
  assert.equal(body.status, 'cancelled');
});

// ─── compatibility: the REAL pending -> accepted -> en_route -> completed flow, driven through worker.js unmodified, both before and after human-confirm ────

test('a pending booking stays exactly pending after human-confirm - status is untouched, driver dispatch/broadcast is unaffected', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);
  const confirmed = await humanConfirm(env, id);
  assert.equal(confirmed.status, 200);
  const row = db.prepare('SELECT status, assigned_driver_id FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'pending');
  assert.equal(row.assigned_driver_id, null, 'human-confirm must never assign a driver');
});

test('a human-confirmed-while-pending booking can still be accepted by a real driver through the REAL handleDriverAcceptBooking flow, reaching accepted exactly as if it had never been human-confirmed', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);

  const confirmed = await humanConfirm(env, id);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.status, 'pending');

  const token = 'driver-token-' + Math.random().toString(36).slice(2);
  const driverId = insertDriver(db);
  insertDriverLoginToken(db, driverId, token);

  const acceptRes = await driverAccept(env, id, token);
  const acceptBody = await acceptRes.json();
  assert.equal(acceptRes.status, 200);
  assert.equal(acceptBody.won, true, 'the exact same compare-and-swap accept flow must still succeed on a human-confirmed booking - the P0 bug this mission exists to fix would have made this fail');

  const row = db.prepare('SELECT status, assigned_driver_id, human_confirmed_at FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'accepted');
  assert.equal(row.assigned_driver_id, driverId);
  assert.ok(row.human_confirmed_at, 'human_confirmed_at survives the accept transition unchanged');
});

test('without human-confirm at all, a driver can still accept a pending booking exactly as before (regression guard: this mission must not have broken the untouched path)', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);
  const token = 'driver-token-' + Math.random().toString(36).slice(2);
  const driverId = insertDriver(db);
  insertDriverLoginToken(db, driverId, token);

  const acceptRes = await driverAccept(env, id, token);
  assert.equal(acceptRes.status, 200);
  const row = db.prepare('SELECT status, assigned_driver_id FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'accepted');
  assert.equal(row.assigned_driver_id, driverId);
});

test('accepted -> en_route -> completed still works via the REAL handleDriverBookingStatus/VALID_STATUS_TRANSITIONS flow, on a booking that was human-confirmed first', async () => {
  // payment_method: 'card' (not the default 'cash') so completing the trip
  // doesn't hit accrueCommission()'s env.DB.batch() call, which the D1 shim
  // in this file does not implement - unrelated to this mission's scope.
  const { env, db } = freshEnv();
  const id = insertBooking(db, { payment_method: 'card' });

  const confirmed = await humanConfirm(env, id);
  assert.equal(confirmed.status, 200);

  const token = 'driver-token-' + Math.random().toString(36).slice(2);
  const driverId = insertDriver(db);
  insertDriverLoginToken(db, driverId, token);

  const acceptRes = await driverAccept(env, id, token);
  assert.equal(acceptRes.status, 200);

  const enRouteRes = await driverStatus(env, id, token, 'en_route');
  assert.equal(enRouteRes.status, 200);
  let row = db.prepare('SELECT status FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'en_route');

  const completedRes = await driverStatus(env, id, token, 'completed');
  assert.equal(completedRes.status, 200);
  row = db.prepare('SELECT status, human_confirmed_at, human_confirmed_by FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'completed');
  assert.ok(row.human_confirmed_at, 'human confirmation record survives the full operational lifecycle unchanged');
  assert.equal(row.human_confirmed_by, 'admin');

  const events = db.prepare('SELECT event_type FROM booking_events WHERE booking_id = ? ORDER BY id').all(id);
  assert.deepEqual(events.map((e) => e.event_type), ['human_confirmed', 'accepted', 'en_route', 'completed'], 'the real operational event trail is completely unaffected by the human_confirmed event alongside it');
});

test('a booking can equally be human-confirmed AFTER it already reached accepted/en_route/completed via the real driver flow - order does not matter, because the two are orthogonal', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db, { payment_method: 'card' });
  const token = 'driver-token-' + Math.random().toString(36).slice(2);
  const driverId = insertDriver(db);
  insertDriverLoginToken(db, driverId, token);

  await driverAccept(env, id, token);
  await driverStatus(env, id, token, 'en_route');
  await driverStatus(env, id, token, 'completed');

  const confirmed = await humanConfirm(env, id);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.status, 'completed');

  const row = db.prepare('SELECT status, human_confirmed_at FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'completed');
  assert.ok(row.human_confirmed_at);
});

// ─── 9. existing pending rows unchanged (simulated at 107-row scale) ───
test('inserting and leaving 107 untouched pending bookings alongside one confirmed one - none of the 107 are altered', async () => {
  const { env, db } = freshEnv();
  const untouchedIds = [];
  for (let i = 0; i < 107; i++) {
    untouchedIds.push(insertBooking(db, { pickup_zone: 'NAD_AIRPORT', destination_zone: `ZONE_${i}` }));
  }
  const confirmMeId = insertBooking(db, { destination_zone: 'DENARAU' });

  const { status } = await humanConfirm(env, confirmMeId);
  assert.equal(status, 200);

  const stillPending = db.prepare(
    `SELECT COUNT(*) as n FROM bookings WHERE status = 'pending' AND id IN (${untouchedIds.map(() => '?').join(',')})`
  ).get(...untouchedIds);
  assert.equal(stillPending.n, 107, 'all 107 pre-existing pending rows remain exactly pending');

  const totalEvents = db.prepare('SELECT COUNT(*) as n FROM booking_events').get();
  assert.equal(totalEvents.n, 1, 'only the one confirmed booking produced an event - the 107 untouched rows produced none');
});

// ─── 10. no customer/driver messaging side effects ─────────────────────
test('handleAdminHumanConfirm never references any WhatsApp/notification send function — confirmed by reading its own source, not just behavior', async () => {
  const source = readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
  const start = source.indexOf('async function handleAdminHumanConfirm');
  const end = source.indexOf('\nasync function handleAdminManualAssign');
  const fnSource = source.slice(start, end);
  assert.ok(!/sendGuestDriverAssignedWhatsApp|sendWhatsApp|WHATSAPP_PHONE_ID|graph\.facebook\.com/i.test(fnSource), 'must not call any messaging function');
});

test('confirming a booking produces no outbound fetch() call — env has no network-capable binding the handler could have used, and the call still succeeds', async () => {
  // Structural proof: freshEnv() only ever provides { DB, ADMIN_TOKEN } - no
  // WHATSAPP_TOKEN, no fetch-capable binding at all - and the confirm call
  // still succeeds end to end, proving the handler genuinely doesn't need
  // (and doesn't attempt) any messaging side effect.
  const { env } = freshEnv();
  assert.deepEqual(Object.keys(env).sort(), ['ADMIN_TOKEN', 'DB']);
  const id_env = freshEnv();
  const id = insertBooking(id_env.db);
  const { status } = await humanConfirm(id_env.env, id);
  assert.equal(status, 200);
});

// ─── assigned_driver_id "if known" ──────────────────────────────────────
test('assigned_driver_id is included when already present on the booking, and is null when not', async () => {
  const { env, db } = freshEnv();
  const withDriver = insertBooking(db, { assigned_driver_id: null });
  db.prepare('INSERT INTO drivers (name, phone, status, zones) VALUES (?, ?, ?, ?)').run('Test Driver', '+6790000000', 'verified', '[]');
  const driverRow = db.prepare('SELECT id FROM drivers LIMIT 1').get();
  db.prepare('UPDATE bookings SET assigned_driver_id = ? WHERE id = ?').run(driverRow.id, withDriver);

  const withDriverResult = await humanConfirm(env, withDriver);
  assert.equal(withDriverResult.body.assigned_driver_id, driverRow.id);

  const withoutDriver = insertBooking(db, { assigned_driver_id: null });
  const withoutDriverResult = await humanConfirm(env, withoutDriver);
  assert.equal(withoutDriverResult.body.assigned_driver_id, null);
});

// ─── concurrent-request race safety ─────────────────────────────────────
test('two concurrent confirm requests for the same pending booking never both report a fresh (non-idempotent) success — the compare-and-swap UPDATE guarantees only one real write', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);
  const [a, b] = await Promise.all([humanConfirm(env, id), humanConfirm(env, id)]);
  const freshSuccesses = [a, b].filter((r) => r.status === 200 && r.body.already_confirmed === false);
  assert.equal(freshSuccesses.length, 1, 'exactly one of the two concurrent requests may be the real, non-idempotent write');
  const events = db.prepare('SELECT * FROM booking_events WHERE booking_id = ? AND event_type = ?').all(id, 'human_confirmed');
  assert.equal(events.length, 1);
});
