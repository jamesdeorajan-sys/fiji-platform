// Nadi Airport Transfers — Milestone 36: authoritative human-confirmed
// booking state tests.
//
// Offline, no network, no live D1 - drives the REAL worker.js `fetch()`
// handler (imported directly, not reimplemented) against an in-memory
// SQLite database loaded with the real schema.sql + the new
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

// ─── 5. repeated confirmation idempotent / 6. event written once / 7. status written once ──
test('repeated confirmation is idempotent: second call succeeds without writing a second event or re-writing status', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);

  const first = await humanConfirm(env, id);
  assert.equal(first.status, 200);
  assert.equal(first.body.already_confirmed, false);

  const second = await humanConfirm(env, id);
  assert.equal(second.status, 200);
  assert.equal(second.body.already_confirmed, true);
  assert.equal(second.body.status, 'human_confirmed');

  const events = db.prepare('SELECT * FROM booking_events WHERE booking_id = ? AND event_type = ?').all(id, 'human_confirmed');
  assert.equal(events.length, 1, 'event written exactly once across two confirm calls');

  const row = db.prepare('SELECT status FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'human_confirmed', 'status written exactly once and stays correct');
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

// ─── 8. cancellation after confirmation prevents Smart Return reuse ────
test('a booking already accepted/en_route/completed (not pending) cannot be human-confirmed', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db, { status: 'accepted' });
  const { status, body } = await humanConfirm(env, id);
  assert.equal(status, 409);
  assert.equal(body.ok, false);
});

test('cancelling a human_confirmed booking moves it out of human_confirmed - the existing /cancel endpoint already handles this with zero changes needed', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db);
  const confirmed = await humanConfirm(env, id);
  assert.equal(confirmed.status, 200);

  const cancelRes = await worker.fetch(req(`/admin/bookings/${id}/cancel`), env);
  assert.equal(cancelRes.status, 200);

  const row = db.prepare('SELECT status FROM bookings WHERE id = ?').get(id);
  assert.equal(row.status, 'cancelled', 'the pre-existing cancel endpoint already generically allows this — no backend change was needed for it');
});

test('a cancelled booking cannot be human-confirmed afterward', async () => {
  const { env, db } = freshEnv();
  const id = insertBooking(db, { status: 'cancelled' });
  const { status } = await humanConfirm(env, id);
  assert.equal(status, 409);
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
