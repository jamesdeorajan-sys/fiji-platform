// Issue #54 / Marau integration - milestone38: durable confirmation attempt identity on POST /admin/bookings/manual-assign
// (Path A) and the read-only GET /admin/bookings/:id/confirmation.
//
// Offline: the REAL worker.js fetch() handler against in-memory SQLite (real schema + every migration through
// milestone38); Meta's Graph API is a per-test global.fetch stub behind the default-deny network guard.
// Run: node --test nadi-marketplace/worker/confirmation_attempt_identity.test.mjs
//
// What this proves about the PROPOSED real contract (nothing here touches any real database or sends any message):
//   - existing callers (no attempt_id) are unchanged, including when milestone38 is not applied;
//   - a lost response is recoverable: replaying the same attempt_id reports the original decision with ZERO new side
//     effects (no second assignment, no second event, no second guest WhatsApp) and never changes the operator;
//   - a different attempt, or a coincidentally identical driver, is a conflict - driver equality proves nothing;
//   - concurrent confirmations produce exactly one decision and one guest notification;
//   - cancellation and progressed (en_route / completed) bookings stay explicit and readable;
//   - the readback carries no guest or driver contact data;
//   - a caller that asked for attempt identity is refused loudly if the migration is absent, never silently served
//     without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';
import { installNetworkGuard } from './network_guard.mjs';
installNetworkGuard();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const SCHEMA_SQL = readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const BASE_MIGRATIONS = [
  'milestone34-booking-idempotency-and-contact-fields.sql',
  'milestone35-revenue-attribution.sql',
  'milestone36-admin-notification-retry-state.sql',
  'milestone37-driver-broadcast-claim-state.sql',
];
const IDENTITY_MIGRATION = 'milestone38-confirmation-attempt-identity.sql';
const sqlOf = (f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');

const ADMIN = 'test-admin-token';
const GUEST_TEMPLATE = 'vakaviti_guest_driver_assigned';

function createD1Shim(db) {
  return {
    prepare(sql) {
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        async first() { const r = db.prepare(sql).get(...args); return r === undefined ? null : r; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() { const i = db.prepare(sql).run(...args); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; },
      };
      return api;
    },
  };
}

function freshEnv({ applyIdentityMigration = true } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  for (const f of BASE_MIGRATIONS) db.exec(sqlOf(f));
  if (applyIdentityMigration) db.exec(sqlOf(IDENTITY_MIGRATION));
  db.prepare(`UPDATE platform_settings SET value = ? WHERE key = 'admin_alert_phone'`).run('+6799999999');
  const driverIds = [];
  for (const [i, name] of ['Alpha', 'Bravo'].entries()) {
    driverIds.push(Number(db.prepare(`INSERT INTO drivers (name, phone, status, zones, online) VALUES (?, ?, 'verified', ?, 1)`).run(`Driver ${name}`, `+679900000${i}`, JSON.stringify(['Nadi Airport'])).lastInsertRowid));
  }
  const env = { DB: createD1Shim(db), ADMIN_TOKEN: ADMIN, WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'p', HEALTH_ALERT_SEND_TIMEOUT_MS: '60' };
  return { db, env, driverIds };
}

function makeCtx() { const jobs = []; return { waitUntil: (p) => jobs.push(p), flush: async () => { await Promise.all(jobs.splice(0)); } }; }

let refCounter = 0;
const bookingPayload = () => ({
  guest_name: 'Synthetic Guest', guest_phone: '+6799112233', guest_email: 'synthetic.guest@example.test',
  pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', quoted_currency: 'FJD', quoted_amount: 49,
  payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: '09:30', client_booking_ref: `FD-ATT${++refCounter}`,
});

// Meta stub: records every send by template name so the guest "driver assigned" notification can be counted exactly.
function metaStub() {
  const sent = []; const original = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    let name = 'unknown';
    try { name = JSON.parse(opts.body).template.name; } catch { /* non-template send */ }
    sent.push(name);
    return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.T' }] }) };
  };
  return { sent, guestSends: () => sent.filter((n) => n === GUEST_TEMPLATE).length, restore: () => { globalThis.fetch = original; } };
}

async function createBooking(env) {
  const ctx = makeCtx();
  const res = await worker.fetch(new Request('https://w.test/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify(bookingPayload()) }), env, ctx);
  await ctx.flush();
  assert.equal(res.status, 201);
  return (await res.json()).booking_id;
}

async function assign(env, body, { token = ADMIN } = {}) {
  const ctx = makeCtx();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request('https://w.test/admin/bookings/manual-assign', { method: 'POST', headers, body: JSON.stringify(body) }), env, ctx);
  await ctx.flush();
  return { status: res.status, body: await res.json() };
}

async function readback(env, bookingId, { token = ADMIN } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await worker.fetch(new Request(`https://w.test/admin/bookings/${bookingId}/confirmation`, { headers }), env, makeCtx());
  return { status: res.status, body: await res.json() };
}

async function cancel(env, bookingId) {
  const res = await worker.fetch(new Request(`https://w.test/admin/bookings/${bookingId}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' }, body: '{}' }), env, makeCtx());
  return res.status;
}

const eventTypes = (db, id) => db.prepare('SELECT event_type FROM booking_events WHERE booking_id = ? ORDER BY id').all(id).map((r) => r.event_type);
const acceptedEvents = (db, id) => eventTypes(db, id).filter((e) => e === 'accepted').length;
const row = (db, id) => ({ ...db.prepare('SELECT status, assigned_driver_id, confirmation_attempt_id, confirmed_operator, confirmed_operator_attestation FROM bookings WHERE id = ?').get(id) });

// ---------------------------------------------------------------------------------------------------------------
// Backward compatibility - existing callers
// ---------------------------------------------------------------------------------------------------------------

test('existing callers: no attempt_id behaves exactly as before - win, then a byte-identical legacy 409 for a taken booking', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    const won = await assign(env, { driver_id: driverIds[0], booking_id: id });
    assert.equal(won.status, 200);
    assert.equal(won.body.won, true);
    assert.equal(won.body.booking.assigned_driver_id, driverIds[0]);
    assert.equal(row(db, id).confirmation_attempt_id, null, 'a legacy confirmation leaves the new columns NULL');
    assert.equal(m.guestSends(), 1);

    const taken = await assign(env, { driver_id: driverIds[1], booking_id: id });
    assert.equal(taken.status, 409);
    assert.deepEqual(taken.body, { ok: false, won: false, reason: 'Booking already taken or no longer available.', current: { assigned_driver_id: driverIds[0], status: 'accepted' } });
    assert.equal(m.guestSends(), 1, 'a legacy 409 sends nothing');
  } finally { m.restore(); }
});

test('existing callers keep working on a database where milestone38 has NOT been applied', async () => {
  const { env, driverIds } = freshEnv({ applyIdentityMigration: false });
  const m = metaStub();
  try {
    const id = await createBooking(env);
    const won = await assign(env, { driver_id: driverIds[0], booking_id: id });
    assert.equal(won.status, 200);
    assert.equal(won.body.won, true);
    const taken = await assign(env, { driver_id: driverIds[1], booking_id: id });
    assert.equal(taken.status, 409);
  } finally { m.restore(); }
});

test('a caller that ASKS for attempt identity is refused loudly when milestone38 is absent - never silently served without it', async () => {
  const { env, db, driverIds } = freshEnv({ applyIdentityMigration: false });
  const m = metaStub();
  try {
    const id = await createBooking(env);
    const res = await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
    assert.equal(res.status, 501);
    assert.equal(res.body.error, 'CONFIRMATION_ATTEMPT_IDENTITY_UNSUPPORTED');
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(id).status, 'pending', 'nothing was assigned');
    assert.equal(m.guestSends(), 0);
    const rb = await readback(env, id);
    assert.equal(rb.status, 501);
  } finally { m.restore(); }
});

// ---------------------------------------------------------------------------------------------------------------
// Authentication and validation
// ---------------------------------------------------------------------------------------------------------------

test('both endpoints require the admin credential', async () => {
  const { env, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    const noAuth = await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' }, { token: null });
    assert.equal(noAuth.status, 401);
    const wrong = await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' }, { token: 'not-the-token' });
    assert.equal(wrong.status, 401);
    assert.equal((await readback(env, id, { token: null })).status, 401);
    assert.equal((await readback(env, id, { token: 'not-the-token' })).status, 401);
    assert.equal(m.guestSends(), 0);
  } finally { m.restore(); }
});

test('validation: malformed attempt_id, missing/oversized operator are 400 before anything is written', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    const base = { driver_id: driverIds[0], booking_id: id };
    assert.equal((await assign(env, { ...base, attempt_id: 'short', operator: 'Ana' })).status, 400);
    assert.equal((await assign(env, { ...base, attempt_id: 'has spaces in it!', operator: 'Ana' })).status, 400);
    assert.equal((await assign(env, { ...base, attempt_id: 'attempt_0123456789' })).status, 400, 'operator is required with attempt_id');
    assert.equal((await assign(env, { ...base, attempt_id: 'attempt_0123456789', operator: '   ' })).status, 400);
    assert.equal((await assign(env, { ...base, attempt_id: 'attempt_0123456789', operator: 'x'.repeat(101) })).status, 400);
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(id).status, 'pending');
  } finally { m.restore(); }
});

test('an unverified driver is still refused with attempt identity supplied (existing rule preserved)', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    db.prepare(`UPDATE drivers SET status = 'pending' WHERE id = ?`).run(driverIds[0]);
    const res = await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
    assert.equal(res.status, 403);
    assert.equal(row(db, id).confirmation_attempt_id, null);
  } finally { m.restore(); }
});

// ---------------------------------------------------------------------------------------------------------------
// The decision, its identity, and lost-response recovery
// ---------------------------------------------------------------------------------------------------------------

test('a confirmation with identity persists attempt id, operator and the service-asserted label atomically, and notifies the guest once', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    const res = await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
    assert.equal(res.status, 200);
    assert.equal(res.body.won, true);
    assert.deepEqual(row(db, id), { status: 'accepted', assigned_driver_id: driverIds[0], confirmation_attempt_id: 'attempt_0123456789', confirmed_operator: 'Ana (ops)', confirmed_operator_attestation: 'service-asserted' });
    const meta = JSON.parse(db.prepare(`SELECT metadata FROM booking_events WHERE booking_id = ? AND event_type = 'accepted'`).get(id).metadata);
    assert.equal(meta.attempt_id, 'attempt_0123456789');
    assert.equal(meta.operator, 'Ana (ops)');
    assert.equal(meta.operator_attestation, 'service-asserted');
    assert.equal(acceptedEvents(db, id), 1);
    assert.equal(m.guestSends(), 1);
  } finally { m.restore(); }
});

test('LOST RESPONSE: the decision committed, the caller never saw it - a replay of the same attempt reports the original decision with no new side effects and never changes the operator', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' }); // response "lost"
    const before = { sends: m.guestSends(), events: eventTypes(db, id).length, state: row(db, id) };

    const replay = await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Someone Else (ops)' });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.ok, true);
    assert.equal(replay.body.won, false);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.current.confirmation_attempt_id, 'attempt_0123456789');
    assert.equal(replay.body.current.confirmed_operator, 'Ana (ops)', 'the replaying caller\'s operator argument must never replace the original');

    assert.equal(m.guestSends(), before.sends, 'no second guest WhatsApp');
    assert.equal(eventTypes(db, id).length, before.events, 'no second event of any kind');
    assert.equal(acceptedEvents(db, id), 1);
    assert.deepEqual(row(db, id), before.state, 'the stored decision is unchanged');
  } finally { m.restore(); }
});

test('the same attempt_id with a DIFFERENT driver is a caller error (409), never silently the same decision', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
    const res = await assign(env, { driver_id: driverIds[1], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'ATTEMPT_ID_DRIVER_MISMATCH');
    assert.equal(row(db, id).assigned_driver_id, driverIds[0]);
  } finally { m.restore(); }
});

test('driver equality proves nothing: a DIFFERENT attempt naming the SAME driver is a conflict, and the winner\'s identity stays readable', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_winner_0001', operator: 'Ana (ops)' });
    const loser = await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_loser_00002', operator: 'Bala (ops)' });
    assert.equal(loser.status, 409);
    assert.equal(loser.body.won, false);
    assert.equal(loser.body.replayed, undefined);
    assert.equal(loser.body.current.confirmation_attempt_id, 'attempt_winner_0001');
    assert.equal(loser.body.current.confirmed_operator, 'Ana (ops)');
    assert.equal(m.guestSends(), 1);
    assert.equal(row(db, id).confirmed_operator, 'Ana (ops)');
  } finally { m.restore(); }
});

test('an attempt_id names exactly one decision: reusing it for a different booking is refused by the database', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const first = await createBooking(env);
    const second = await createBooking(env);
    await assign(env, { driver_id: driverIds[0], booking_id: first, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
    const reuse = await assign(env, { driver_id: driverIds[0], booking_id: second, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
    assert.equal(reuse.status, 409);
    assert.equal(reuse.body.error, 'ATTEMPT_ID_ALREADY_USED_FOR_ANOTHER_BOOKING');
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(second).status, 'pending');
  } finally { m.restore(); }
});

// ---------------------------------------------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------------------------------------------

test('CONCURRENT confirmations by different attempts: exactly one decision, one assignment event, one guest notification; every loser sees the winner\'s identity', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    const results = await Promise.all([
      assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_concurrent_A', operator: 'Staff A' }),
      assign(env, { driver_id: driverIds[1], booking_id: id, attempt_id: 'attempt_concurrent_B', operator: 'Staff B' }),
      assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_concurrent_C', operator: 'Staff C' }),
    ]);
    const winners = results.filter((r) => r.status === 200 && r.body.won === true);
    assert.equal(winners.length, 1, 'exactly one confirmation wins');
    assert.equal(results.filter((r) => r.status === 409).length, 2);
    const stored = row(db, id);
    for (const loser of results.filter((r) => r.status === 409)) {
      assert.equal(loser.body.current.confirmation_attempt_id, stored.confirmation_attempt_id);
      assert.equal(loser.body.current.confirmed_operator, stored.confirmed_operator);
    }
    assert.equal(acceptedEvents(db, id), 1);
    assert.equal(m.guestSends(), 1);
  } finally { m.restore(); }
});

test('CONCURRENT retries of the SAME attempt: one win, the rest are replays, still exactly one guest notification', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    const body = { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_same_retries', operator: 'Ana (ops)' };
    const results = await Promise.all([assign(env, body), assign(env, body), assign(env, body)]);
    assert.ok(results.every((r) => r.status === 200 && r.body.ok === true));
    assert.equal(results.filter((r) => r.body.won === true).length, 1);
    assert.equal(results.filter((r) => r.body.replayed === true).length, 2);
    assert.equal(acceptedEvents(db, id), 1);
    assert.equal(m.guestSends(), 1);
    assert.equal(row(db, id).confirmed_operator, 'Ana (ops)');
  } finally { m.restore(); }
});

// ---------------------------------------------------------------------------------------------------------------
// Cancellation and progressed bookings
// ---------------------------------------------------------------------------------------------------------------

test('CANCELLATION stays explicit: the cancelled booking keeps its driver AND its attempt identity, the readback says cancelled, and a new attempt cannot resurrect it', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
    assert.equal(await cancel(env, id), 200);

    const rb = await readback(env, id);
    assert.equal(rb.body.status, 'cancelled');
    assert.equal(rb.body.assigned_driver_id, driverIds[0], 'a cancelled booking still carries its driver - which is exactly why status must be checked first');
    assert.equal(rb.body.confirmation_attempt_id, 'attempt_0123456789');

    const again = await assign(env, { driver_id: driverIds[1], booking_id: id, attempt_id: 'attempt_new_0000001', operator: 'Bala (ops)' });
    assert.equal(again.status, 409);
    assert.equal(again.body.current.status, 'cancelled');
    assert.equal(row(db, id).assigned_driver_id, driverIds[0]);
  } finally { m.restore(); }
});

test('a booking cancelled BEFORE any confirmation cannot be confirmed', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    assert.equal(await cancel(env, id), 200);
    const res = await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
    assert.equal(res.status, 409);
    assert.equal(res.body.current.status, 'cancelled');
    assert.equal(m.guestSends(), 0);
    assert.equal(row(db, id).confirmation_attempt_id, null);
  } finally { m.restore(); }
});

test('PROGRESSED bookings: after en_route and completed the original attempt identity is still readable and a replay still reports the original decision', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
    for (const status of ['en_route', 'completed']) {
      db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, id);
      const rb = await readback(env, id);
      assert.equal(rb.body.status, status);
      assert.equal(rb.body.confirmation_attempt_id, 'attempt_0123456789');
      assert.equal(rb.body.confirmed_operator, 'Ana (ops)');

      const replay = await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.replayed, true);
      assert.equal(replay.body.current.status, status, 'the historical decision is reported together with the CURRENT status, never conflated');
    }
    assert.equal(acceptedEvents(db, id), 1);
    assert.equal(m.guestSends(), 1);
  } finally { m.restore(); }
});

// ---------------------------------------------------------------------------------------------------------------
// Privacy and read-only
// ---------------------------------------------------------------------------------------------------------------

test('the readback is read-only and exposes no guest or driver contact data', async () => {
  const { env, db, driverIds } = freshEnv();
  const m = metaStub();
  try {
    const id = await createBooking(env);
    await assign(env, { driver_id: driverIds[0], booking_id: id, attempt_id: 'attempt_0123456789', operator: 'Ana (ops)' });
    const before = JSON.stringify(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id));
    const eventsBefore = eventTypes(db, id).length;
    const rb = await readback(env, id);
    assert.equal(rb.status, 200);
    assert.deepEqual(Object.keys(rb.body).sort(), ['assigned_driver_id', 'booking_id', 'confirmation_attempt_id', 'confirmed_operator', 'confirmed_operator_attestation', 'ok', 'status']);
    const text = JSON.stringify(rb.body);
    for (const secret of ['Synthetic Guest', '+6799112233', 'synthetic.guest@example.test', 'Driver Alpha', '+6799000000']) assert.equal(text.includes(secret), false, `readback must not contain ${secret}`);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)), before);
    assert.equal(eventTypes(db, id).length, eventsBefore);
    assert.equal((await readback(env, 999999)).status, 404);
  } finally { m.restore(); }
});
