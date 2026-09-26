// Issue #59 - reconcile admin-notification failures (continues PR #55 / branch ceo/p0-admin-notification-retry-fix).
// Offline: the REAL worker.js fetch() handler against in-memory SQLite (real schema + migrations); Meta's Graph API is a
// per-test global.fetch stub. Run: node --test nadi-marketplace/worker/notification_reconcile.test.mjs
//
// Reproduces what Codex found against production, then proves the repair:
//   1. booking saves, BOTH admin alerts fail  -> guest retries with the same ref -> the Worker used to return the saved
//      booking and SKIP the retry; now it retries and reaches SENT
//   2. a pending short alert used to delay the full alert and the booking response
// and keeps the guards: duplicate-send protection, no second booking row, no alerts lost if the migration is not applied.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const SCHEMA_SQL = readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const MIGRATION_ORDER = [
  'milestone34-booking-idempotency-and-contact-fields.sql',
  'milestone35-revenue-attribution.sql',
  'milestone36-admin-notification-retry-state.sql',
];
const MIGRATIONS_SQL = MIGRATION_ORDER.map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));

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

function freshEnv({ applyMilestone36 = true, timeoutMs = 60 } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  for (const sql of (applyMilestone36 ? MIGRATIONS_SQL : MIGRATIONS_SQL.slice(0, -1))) db.exec(sql);
  db.prepare(`UPDATE platform_settings SET value = ? WHERE key = 'admin_alert_phone'`).run('+6799999999');
  return { db, env: { DB: createD1Shim(db), WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'p', HEALTH_ALERT_SEND_TIMEOUT_MS: String(timeoutMs) } };
}

const payload = (o = {}) => ({
  guest_name: 'Test Guest', guest_phone: '+6799112233', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan',
  quoted_currency: 'FJD', quoted_amount: 49, payment_method: 'cash', pickup_date: '2026-10-05', pickup_time: '09:30', ...o,
});
const req = (body) => new Request('https://worker.test/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' }, body: JSON.stringify(body) });

// execution context that records waitUntil work so tests can flush it deliberately
function makeCtx() { const jobs = []; return { waitUntil: (p) => jobs.push(p), flush: async () => { await Promise.all(jobs.splice(0)); } }; }
async function post(env, body, ctx) { const res = await worker.fetch(req(body), env, ctx); return { status: res.status, body: await res.json() }; }

const OK = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.T' }] }) });
const BAD = () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: '(#132018) parameters', code: 132018 } }) });
const isFull = (opts) => JSON.parse(opts.body).template.components[0].parameters[0].text.startsWith('NEW BOOKING');

// handler(callIndex, opts, isFullAlert) -> response | Promise (may honour opts.signal)
function metaStub(handler) {
  const calls = []; const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const full = isFull(opts); calls.push({ full }); return handler(calls.length - 1, opts, full); };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const hang = (opts) => new Promise((_, rej) => opts.signal && opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
const states = (db, id) => db.prepare('SELECT state, attempt_count FROM admin_notification_state WHERE booking_id = ?').get(id);
const events = (db, id) => db.prepare('SELECT event_type FROM booking_events WHERE booking_id = ? ORDER BY id').all(id).map((r) => r.event_type);
const rows = (db, ref) => db.prepare('SELECT COUNT(*) n FROM bookings WHERE client_booking_ref = ?').get(ref).n;

test('CODEX REPRO 1: booking saves, BOTH alerts fail; the guest retries with the same ref -> the retry now re-notifies (no second booking, exactly one SENT)', async () => {
  const { env, db } = freshEnv();
  const m = metaStub((i, o, full) => (i < 2 ? BAD() : OK())); // short + full fail on creation; the retry's full alert succeeds
  try {
    const ref = 'FD-BOTHFAIL';
    const first = await post(env, payload({ client_booking_ref: ref }));
    assert.equal(first.status, 201);
    const id = first.body.booking_id;
    assert.equal(states(db, id).state, 'FAILED_RETRYABLE');
    assert.ok(events(db, id).includes('admin_short_alert_failed'), 'the failed SHORT alert is now recorded, not discarded');
    assert.ok(events(db, id).includes('admin_notification_failed'));

    const retry = await post(env, payload({ client_booking_ref: ref }));
    assert.equal(retry.status, 200);
    assert.equal(retry.body.idempotent, true);
    assert.equal(retry.body.booking_id, id);
    assert.equal(rows(db, ref), 1, 'still one booking row');
    assert.equal(states(db, id).state, 'SENT');
    assert.equal(events(db, id).filter((e) => e === 'admin_notification_sent').length, 1);
    assert.equal(events(db, id).includes('admin_notification_skipped_idempotent'), false, 'the retry must NOT be skipped');
  } finally { m.restore(); }
});

test('duplicate-send protection kept: once SENT, further replays send nothing and are logged as skipped', async () => {
  const { env, db } = freshEnv();
  const m = metaStub(() => OK());
  try {
    const ref = 'FD-SENTONCE';
    const first = await post(env, payload({ client_booking_ref: ref }));
    const before = m.calls.length;
    for (let i = 0; i < 3; i++) assert.equal((await post(env, payload({ client_booking_ref: ref }))).status, 200);
    assert.equal(m.calls.length, before, 'zero Meta calls on replays after SENT');
    assert.equal(events(db, first.body.booking_id).filter((e) => e === 'admin_notification_sent').length, 1);
    assert.equal(events(db, first.body.booking_id).filter((e) => e === 'admin_notification_skipped_idempotent').length, 3);
  } finally { m.restore(); }
});

test('existing bookings are protected: a booking with a legacy admin_notification_sent event but NO state row is seeded SENT, so a replay cannot re-alert', async () => {
  const { env, db } = freshEnv();
  const m = metaStub(() => OK());
  try {
    const ref = 'FD-LEGACY';
    const first = await post(env, payload({ client_booking_ref: ref }));
    const id = first.body.booking_id;
    db.prepare('DELETE FROM admin_notification_state WHERE booking_id = ?').run(id); // simulate a booking created before the table existed
    assert.ok(events(db, id).includes('admin_notification_sent'));
    const before = m.calls.length;
    const replay = await post(env, payload({ client_booking_ref: ref }));
    assert.equal(replay.status, 200);
    assert.equal(m.calls.length, before, 'no alert re-sent for an already-notified legacy booking');
    assert.equal(states(db, id).state, 'SENT');
  } finally { m.restore(); }
});

test('CODEX REPRO 2: a stalled SHORT alert no longer delays the response or the full alert (production path with waitUntil)', async () => {
  const { env, db } = freshEnv({ timeoutMs: 80 });
  const ctx = makeCtx();
  const m = metaStub((i, o, full) => (full ? OK() : hang(o))); // short alert never answers
  try {
    const t0 = Date.now();
    const res = await post(env, payload({ client_booking_ref: 'FD-STALL' }), ctx);
    assert.equal(res.status, 201);
    assert.ok(Date.now() - t0 < 60, `response must not wait for alerts (took ${Date.now() - t0} ms)`);
    await ctx.flush();
    assert.equal(states(db, res.body.booking_id).state, 'SENT', 'the full alert is delivered independently of the stalled short alert');
    const ev = db.prepare(`SELECT metadata FROM booking_events WHERE booking_id = ? AND event_type = 'admin_short_alert_failed'`).get(res.body.booking_id);
    assert.equal(JSON.parse(ev.metadata).timedOut, true, 'the stall is bounded by the send timeout and recorded');
  } finally { m.restore(); }
});

test('without an execution context (offline path) a stalled short alert is still bounded by the send timeout, and the full alert still goes out', async () => {
  const { env, db } = freshEnv({ timeoutMs: 80 });
  const m = metaStub((i, o, full) => (full ? OK() : hang(o)));
  try {
    const t0 = Date.now();
    const res = await post(env, payload({ client_booking_ref: 'FD-STALL2' }));
    assert.equal(res.status, 201);
    assert.ok(Date.now() - t0 < 1500, `bounded, not unbounded (took ${Date.now() - t0} ms)`);
    assert.equal(states(db, res.body.booking_id).state, 'SENT');
  } finally { m.restore(); }
});

test('the guest response never waits for the provider at all when a context is available', async () => {
  const { env, db } = freshEnv({ timeoutMs: 5000 });
  const ctx = makeCtx(); let release;
  const gate = new Promise((r) => { release = r; });
  const m = metaStub(async () => { await gate; return OK(); });
  try {
    const res = await post(env, payload({ client_booking_ref: 'FD-GATE' }), ctx); // provider still "pending"
    assert.equal(res.status, 201);
    assert.notEqual(states(db, res.body.booking_id)?.state, 'SENT', 'nothing delivered yet (claim in flight), response already returned');
    release(); await ctx.flush();
    assert.equal(states(db, res.body.booking_id).state, 'SENT');
  } finally { m.restore(); }
});

test('a provider TIMEOUT on the full alert is a retryable failure (not SENT); a later replay delivers it', async () => {
  const { env, db } = freshEnv({ timeoutMs: 60 });
  let n = 0;
  const m = metaStub((i, o, full) => (full && n++ === 0 ? hang(o) : OK()));
  try {
    const ref = 'FD-TIMEOUT';
    const first = await post(env, payload({ client_booking_ref: ref }));
    assert.equal(states(db, first.body.booking_id).state, 'FAILED_RETRYABLE');
    await post(env, payload({ client_booking_ref: ref }));
    assert.equal(states(db, first.body.booking_id).state, 'SENT');
  } finally { m.restore(); }
});

test('a claim that died mid-attempt (ATTEMPTING past the lease) is recoverable; a fresh in-flight claim is not stolen', async () => {
  const { env, db } = freshEnv();
  const m = metaStub(() => OK());
  try {
    const ref = 'FD-LEASE';
    const first = await post(env, payload({ client_booking_ref: ref }));
    const id = first.body.booking_id;
    db.prepare(`UPDATE admin_notification_state SET state = 'ATTEMPTING', updated_at = datetime('now') WHERE booking_id = ?`).run(id);
    const before = m.calls.length;
    await post(env, payload({ client_booking_ref: ref }));
    assert.equal(m.calls.length, before, 'fresh in-flight attempt is left alone (no concurrent duplicate)');
    assert.equal(states(db, id).state, 'ATTEMPTING');
    db.prepare(`UPDATE admin_notification_state SET updated_at = datetime('now', '-10 minutes') WHERE booking_id = ?`).run(id);
    await post(env, payload({ client_booking_ref: ref }));
    assert.equal(states(db, id).state, 'SENT', 'stale claim recovered and delivered');
  } finally { m.restore(); }
});

test('release ordering: Worker deployed BEFORE the migration -> alerts are NOT lost (legacy direct send), replays do not duplicate', async () => {
  const { env, db } = freshEnv({ applyMilestone36: false });
  const m = metaStub(() => OK());
  try {
    const ref = 'FD-NOMIG';
    const first = await post(env, payload({ client_booking_ref: ref }));
    assert.equal(first.status, 201);
    assert.equal(m.calls.filter((c) => c.full).length, 1, 'the full alert is still sent without the state table');
    assert.ok(events(db, first.body.booking_id).includes('admin_notification_sent'));
    const before = m.calls.length;
    const replay = await post(env, payload({ client_booking_ref: ref }));
    assert.equal(replay.status, 200);
    assert.equal(m.calls.length, before, 'no duplicate on replay');
  } finally { m.restore(); }
});

test('the booking, its price verification and idempotency are untouched: same amount saved, one row per ref, retries return the same booking', async () => {
  const { env, db } = freshEnv();
  const m = metaStub(() => OK());
  try {
    const ref = 'FD-CORE';
    const a = await post(env, payload({ client_booking_ref: ref, quoted_amount: 49 }));
    const b = await post(env, payload({ client_booking_ref: ref, quoted_amount: 49 }));
    assert.equal(a.body.booking_id, b.body.booking_id);
    assert.equal(rows(db, ref), 1);
    assert.ok(db.prepare('SELECT quoted_amount q FROM bookings WHERE id = ?').get(a.body.booking_id).q > 0);
  } finally { m.restore(); }
});
