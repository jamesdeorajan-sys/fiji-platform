// Issue #59 - attempt fencing + durable recovery for admin notifications (continues e9f9f99 / PR #55).
// Offline: REAL worker.js against in-memory SQLite (real schema + migrations); Meta is a per-test fetch stub whose
// responses are DEFERRED so the tests control exactly how two attempts interleave.
// Run: node --test nadi-marketplace/worker/notification_fencing.test.mjs
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
const MIGRATIONS_SQL = ['milestone34-booking-idempotency-and-contact-fields.sql', 'milestone35-revenue-attribution.sql', 'milestone36-admin-notification-retry-state.sql']
  .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));

function createD1Shim(db) {
  return { prepare(sql) { let args = []; const api = {
    bind(...a) { args = a; return api; },
    async first() { const r = db.prepare(sql).get(...args); return r === undefined ? null : r; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const i = db.prepare(sql).run(...args); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; },
  }; return api; } };
}
function freshEnv() {
  const db = new DatabaseSync(':memory:'); db.exec(SCHEMA_SQL); for (const s of MIGRATIONS_SQL) db.exec(s);
  db.prepare(`UPDATE platform_settings SET value = ? WHERE key = 'admin_alert_phone'`).run('+6799999999');
  return { db, env: { DB: createD1Shim(db), WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'p', HEALTH_ALERT_SEND_TIMEOUT_MS: '5000' } };
}
const payload = (o = {}) => ({ guest_name: 'Test Guest', guest_phone: '+6799112233', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan',
  quoted_currency: 'FJD', quoted_amount: 49, payment_method: 'cash', pickup_date: '2026-10-05', pickup_time: '09:30', ...o });
const req = (b) => new Request('https://worker.test/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' }, body: JSON.stringify(b) });
function makeCtx() { const jobs = []; return { waitUntil: (p) => jobs.push(p), flush: async () => { await Promise.all(jobs.splice(0)); } }; }
async function post(env, b, ctx) { const r = await worker.fetch(req(b), env, ctx); return { status: r.status, body: await r.json() }; }

const OK = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.T' }] }) });
const BAD = () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: '(#132018) parameters', code: 132018 } }) });
const isFull = (o) => JSON.parse(o.body).template.components[0].parameters[0].text.startsWith('NEW BOOKING');
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

// Short alerts always succeed immediately; each FULL alert gets its own deferred response, in call order.
function controlledMeta() {
  const fulls = []; const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { if (!isFull(opts)) return OK(); const d = deferred(); fulls.push(d); return d.promise; };
  return { fulls, restore: () => { globalThis.fetch = original; } };
}
const state = (db, id) => db.prepare('SELECT * FROM admin_notification_state WHERE booking_id = ?').get(id);
const events = (db, id) => db.prepare('SELECT event_type, metadata FROM booking_events WHERE booking_id = ? ORDER BY id').all(id);
const expireLease = (db, id) => db.prepare(`UPDATE admin_notification_state SET updated_at = datetime('now', '-10 minutes') WHERE booking_id = ?`).run(id);
const tick = () => new Promise((r) => setTimeout(r, 15));

// Attempt A is left in flight; its claim goes stale; attempt B (a replay) reclaims. Returns everything the tests need.
async function reclaimedScenario(ref) {
  const { env, db } = freshEnv(); const m = controlledMeta();
  const ctxA = makeCtx(); const first = await post(env, payload({ client_booking_ref: ref }), ctxA); await tick();
  const id = first.body.booking_id;
  assert.equal(state(db, id).state, 'ATTEMPTING'); assert.equal(m.fulls.length, 1, 'attempt A is in flight');
  expireLease(db, id);
  const ctxB = makeCtx(); await post(env, payload({ client_booking_ref: ref }), ctxB); await tick();
  assert.equal(m.fulls.length, 2, 'attempt B reclaimed the stale claim and is in flight');
  return { env, db, m, id, ctxA, ctxB };
}

test('REPRO 1 - old failure AFTER new success must not downgrade SENT to FAILED_RETRYABLE', async () => {
  const { db, m, id, ctxA, ctxB } = await reclaimedScenario('FD-FENCE1');
  try {
    m.fulls[1].resolve(OK()); await ctxB.flush();                 // B succeeds
    assert.equal(state(db, id).state, 'SENT');
    m.fulls[0].resolve(BAD()); await ctxA.flush();                 // the OLD attempt fails afterwards
    assert.equal(state(db, id).state, 'SENT', 'a stale failure must never overwrite a newer success');
    assert.ok(events(db, id).some((e) => e.event_type === 'admin_notification_superseded'), 'the stale outcome is recorded as superseded, not applied');
  } finally { m.restore(); }
});

test('REPRO 2 - new failure AFTER old success must not downgrade SENT either (success is monotonic)', async () => {
  const { db, m, id, ctxA, ctxB } = await reclaimedScenario('FD-FENCE2');
  try {
    m.fulls[0].resolve(OK()); await ctxA.flush();                  // the OLD attempt actually delivered
    assert.equal(state(db, id).state, 'SENT');
    m.fulls[1].resolve(BAD()); await ctxB.flush();                 // the newer attempt then fails
    assert.equal(state(db, id).state, 'SENT', 'a later failure must not undo a real delivery (it would trigger a needless re-alert)');
  } finally { m.restore(); }
});

test('old success after reclaim while the new attempt is still in flight: SENT wins and the new attempt cannot downgrade it', async () => {
  const { db, m, id, ctxA, ctxB } = await reclaimedScenario('FD-FENCE3');
  try {
    m.fulls[0].resolve(OK()); await ctxA.flush();
    assert.equal(state(db, id).state, 'SENT');
    m.fulls[1].resolve(OK()); await ctxB.flush();                  // both delivered: a duplicate alert, but state stays SENT and it is recorded
    assert.equal(state(db, id).state, 'SENT');
    assert.equal(events(db, id).filter((e) => e.event_type === 'admin_notification_sent').length, 2, 'both provider acceptances are recorded as facts');
    assert.ok(events(db, id).some((e) => e.event_type === 'admin_notification_duplicate_delivery'), 'the duplicate alert is flagged for operators');
  } finally { m.restore(); }
});

test('concurrent replays of a FAILED booking: exactly one claim wins, exactly one alert is sent', async () => {
  const { env, db } = freshEnv(); const m = controlledMeta();
  try {
    const ref = 'FD-CONCUR'; const ctx0 = makeCtx();
    const first = await post(env, payload({ client_booking_ref: ref }), ctx0); await tick();
    m.fulls[0].resolve(BAD()); await ctx0.flush();
    assert.equal(state(db, first.body.booking_id).state, 'FAILED_RETRYABLE');
    const c1 = makeCtx(); const c2 = makeCtx(); const c3 = makeCtx();
    await Promise.all([post(env, payload({ client_booking_ref: ref }), c1), post(env, payload({ client_booking_ref: ref }), c2), post(env, payload({ client_booking_ref: ref }), c3)]);
    await tick();
    assert.equal(m.fulls.length, 2, 'original + exactly ONE retry, not three');
    m.fulls[1].resolve(OK()); await Promise.all([c1.flush(), c2.flush(), c3.flush()]);
    assert.equal(state(db, first.body.booking_id).state, 'SENT');
    assert.equal(events(db, first.body.booking_id).filter((e) => e.event_type === 'admin_notification_sent').length, 1);
  } finally { m.restore(); }
});

test('worker terminated after saving but BEFORE any notification, guest never retries: the */5 cron sweep delivers it once', async () => {
  const { env, db } = freshEnv(); const m = controlledMeta();
  try {
    // Simulate the isolate dying at the start of the notification step: everything up to and including the booking
    // insert + 'created' event runs, then every notification-related statement fails (nothing after that point runs).
    const realDB = env.DB; let killed = true;
    env.DB = { prepare(sql) { if (killed && /admin_notification_state|admin_alert_phone/i.test(sql)) throw new Error('isolate terminated'); return realDB.prepare(sql); } };
    const first = await post(env, payload({ client_booking_ref: 'FD-KILLED' }), makeCtx()); await tick();
    killed = false;
    const id = first.body.booking_id;
    assert.equal(first.status, 201);
    assert.equal(state(db, id), undefined, 'no state row, no events: the booking is silent');
    assert.equal(events(db, id).filter((e) => e.event_type.startsWith('admin_notification')).length, 0, 'no full-alert outcome of any kind was recorded');
    assert.equal(m.fulls.length, 0);
    // fresh booking (<3 min old) is left alone so the sweep cannot race the first attempt
    let ctx = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, ctx); await ctx.flush();
    assert.equal(m.fulls.length, 0, 'too young: not swept');
    db.prepare(`UPDATE bookings SET created_at = datetime('now', '-10 minutes') WHERE id = ?`).run(id);
    ctx = makeCtx(); const sweep = worker.scheduled({ cron: '*/5 * * * *' }, env, ctx); await tick(); await tick();
    assert.equal(m.fulls.length, 1, 'the sweep sent the missing full alert');
    m.fulls[0].resolve(OK()); await sweep; await ctx.flush();
    assert.equal(state(db, id).state, 'SENT');
    ctx = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, ctx); await ctx.flush();
    assert.equal(m.fulls.length, 1, 'once SENT the next sweep does nothing');
  } finally { m.restore(); }
});

test('guest never retries after a FAILED alert: the sweep retries with backoff, then stops and escalates after the attempt cap', async () => {
  const { env, db } = freshEnv(); const m = controlledMeta();
  try {
    const ctx0 = makeCtx(); const first = await post(env, payload({ client_booking_ref: 'FD-CAP' }), ctx0); await tick();
    const id = first.body.booking_id; m.fulls[0].resolve(BAD()); await ctx0.flush();
    assert.equal(state(db, id).state, 'FAILED_RETRYABLE');
    db.prepare(`UPDATE bookings SET created_at = datetime('now', '-10 minutes') WHERE id = ?`).run(id);
    let ctx = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, ctx); await ctx.flush();
    assert.equal(m.fulls.length, 1, 'backoff: not retried immediately after the failure');
    let sweeps = 0;
    for (let i = 0; i < 12 && state(db, id).attempt_count < 6; i++) {
      db.prepare(`UPDATE admin_notification_state SET updated_at = datetime('now', '-3 hours') WHERE booking_id = ?`).run(id);
      ctx = makeCtx(); const p = worker.scheduled({ cron: '*/5 * * * *' }, env, ctx); await tick(); await tick();
      if (m.fulls.length > 1 + sweeps) { m.fulls[m.fulls.length - 1].resolve(BAD()); sweeps++; }
      await p; await ctx.flush();
    }
    assert.equal(state(db, id).attempt_count, 6, 'capped at 6 attempts in total');
    assert.equal(state(db, id).state, 'FAILED_RETRYABLE');
    db.prepare(`UPDATE admin_notification_state SET updated_at = datetime('now', '-3 hours') WHERE booking_id = ?`).run(id);
    const before = m.fulls.length; ctx = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, ctx); await ctx.flush();
    assert.equal(m.fulls.length, before, 'no attempts beyond the cap');
    assert.equal(events(db, id).filter((e) => e.event_type === 'admin_notification_exhausted').length, 1, 'exhaustion recorded exactly once');
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM escalations WHERE booking_id = ?`).get(id).n, 1, 'a human-visible escalation is raised');
  } finally { m.restore(); }
});

test('a timeout is recorded as TIMEOUT_UNKNOWN (may have been delivered), distinct from PROVIDER_REJECTED (Meta refused it)', async () => {
  const { env, db } = freshEnv(); env.HEALTH_ALERT_SEND_TIMEOUT_MS = '40'; const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, opts) => { if (!isFull(opts)) return OK(); n++; if (n === 1) return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))); return BAD(); };
  try {
    const first = await post(env, payload({ client_booking_ref: 'FD-OUTCOME' })); const id = first.body.booking_id;
    assert.equal(state(db, id).last_outcome, 'TIMEOUT_UNKNOWN');
    const failed = events(db, id).filter((e) => e.event_type === 'admin_notification_failed').map((e) => JSON.parse(e.metadata));
    assert.equal(failed[0].outcome, 'TIMEOUT_UNKNOWN'); assert.equal(failed[0].possibly_delivered, true);
    await post(env, payload({ client_booking_ref: 'FD-OUTCOME' }));   // replay: Meta rejects with 400
    assert.equal(state(db, id).last_outcome, 'PROVIDER_REJECTED');
    const failed2 = events(db, id).filter((e) => e.event_type === 'admin_notification_failed').map((e) => JSON.parse(e.metadata));
    assert.equal(failed2[1].outcome, 'PROVIDER_REJECTED'); assert.equal(failed2[1].possibly_delivered, false);
  } finally { globalThis.fetch = original; }
});
