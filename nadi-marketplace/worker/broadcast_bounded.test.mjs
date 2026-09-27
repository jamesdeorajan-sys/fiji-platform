// Issue #59 - driver broadcast must never block the guest's saved-booking response or the admin notification.
// Offline: REAL worker.js + in-memory SQLite (real schema + migrations); Meta is a per-test fetch stub.
// Run: node --test nadi-marketplace/worker/broadcast_bounded.test.mjs
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
const SCHEMA_SQL = readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const MIGS = ['milestone34-booking-idempotency-and-contact-fields.sql', 'milestone35-revenue-attribution.sql', 'milestone36-admin-notification-retry-state.sql']
  .map((f) => readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
function shim(db) { return { prepare(sql) { let a = []; const api = {
  bind(...x) { a = x; return api; },
  async first() { const r = db.prepare(sql).get(...a); return r === undefined ? null : r; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async run() { const i = db.prepare(sql).run(...a); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; } }; return api; } }; }

function world({ timeoutMs = 60 } = {}) {
  const db = new DatabaseSync(':memory:'); db.exec(SCHEMA_SQL); for (const m of MIGS) db.exec(m);
  db.prepare(`UPDATE platform_settings SET value = '+6799999999' WHERE key = 'admin_alert_phone'`).run();
  const spec = { a: ['+6791000001', ['Nadi Airport'], 1, 'verified'], b: ['+6791000002', ['Nadi Airport'], 1, 'verified'], c: ['+6791000003', ['Nadi Airport', 'Denarau'], 1, 'verified'],
    off: ['+6791000004', ['Nadi Airport'], 0, 'verified'], pend: ['+6791000005', ['Nadi Airport'], 1, 'pending'], far: ['+6791000006', ['Suva'], 1, 'verified'] };
  const ids = {}, tok = {};
  for (const [k, [phone, zones, online, status]] of Object.entries(spec)) {
    ids[k] = Number(db.prepare(`INSERT INTO drivers (name, phone, status, zones, online) VALUES (?, ?, ?, ?, ?)`).run(`Driver ${k}`, phone, status, JSON.stringify(zones), online).lastInsertRowid);
    tok[k] = `tok-${k}`; db.prepare(`INSERT INTO driver_login_tokens (driver_id, token, expires_at) VALUES (?, ?, datetime('now', '+1 day'))`).run(ids[k], tok[k]);
  }
  return { db, ids, tok, env: { DB: shim(db), WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'p', HEALTH_ALERT_SEND_TIMEOUT_MS: String(timeoutMs) } };
}
const payload = (o = {}) => ({ guest_name: 'Test Guest', guest_phone: '+6799112233', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan',
  quoted_currency: 'FJD', quoted_amount: 49, payment_method: 'cash', pickup_date: '2026-10-05', pickup_time: '09:30', ...o });
const post = async (env, b, ctx) => { const r = await worker.fetch(new Request('https://w.test/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify(b) }), env, ctx); return { status: r.status, body: await r.json() }; };
const api = (env, method, p, token) => worker.fetch(new Request('https://w.test' + p, { method, headers: { Authorization: `Bearer ${token}` } }), env);
function makeCtx() { const jobs = []; return { waitUntil: (p) => jobs.push(p), flush: async () => { await Promise.all(jobs.splice(0)); } }; }
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const OK = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'w' }] }) });
const BAD = () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { code: 131026 } }) });

// handler(kind, to, opts) where kind is 'driver' | 'short' | 'full'
function meta(handler) {
  const sent = []; const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const b = JSON.parse(opts.body); const text = b.template.components[0].parameters[0].text;
    const kind = b.template.name === 'vakaviti_booking_broadcast' || (b.to.startsWith('679100') && !text.startsWith('NEW')) ? 'driver' : (text.startsWith('NEW BOOKING') ? 'full' : 'short');
    sent.push({ kind, to: b.to, at: Date.now() });
    return handler(kind, b.to, opts);
  };
  return { sent, restore: () => { globalThis.fetch = original; } };
}
const hang = (opts) => new Promise((_, rej) => opts.signal && opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
const hangForever = () => new Promise(() => {});
const ev = (db, id) => db.prepare('SELECT event_type, metadata FROM booking_events WHERE booking_id = ? ORDER BY id').all(id);

test('REPRO: hanging driver sends must not hold the guest response (production path with ctx)', async () => {
  const { env } = world(); const ctx = makeCtx();
  const m = meta((k, to, o) => (k === 'driver' ? hangForever() : OK()));
  try {
    const started = Date.now();
    const res = await Promise.race([post(env, payload({ client_booking_ref: 'FD-BC1' }), ctx), tick(400).then(() => 'STILL WAITING')]);
    assert.notEqual(res, 'STILL WAITING', 'the guest response was held by unbounded driver sends');
    assert.equal(res.status, 201);
    assert.ok(Date.now() - started < 300);
    assert.equal(res.body.broadcast.matched_drivers, 3, 'matched count still returned (one cheap read)');
  } finally { m.restore(); }
});

test('REPRO: driver-message stalls must not delay or block the admin notification', async () => {
  const { env, db } = world(); const ctx = makeCtx();
  const m = meta((k, to, o) => (k === 'driver' ? hang(o) : OK()));
  try {
    const res = await post(env, payload({ client_booking_ref: 'FD-BC2' }), ctx);
    await ctx.flush();
    assert.equal(db.prepare('SELECT state FROM admin_notification_state WHERE booking_id = ?').get(res.body.booking_id).state, 'SENT');
    const full = m.sent.find((s) => s.kind === 'full'); const firstDriver = m.sent.find((s) => s.kind === 'driver');
    assert.ok(full && firstDriver);
    assert.ok(Math.abs(full.at - firstDriver.at) < 40, 'the admin alert starts alongside the driver sends, not after them');
  } finally { m.restore(); }
});

test('driver sends run concurrently and are each bounded: 3 stalled drivers take ~1 timeout, not 3', async () => {
  const { env, db } = world({ timeoutMs: 80 }); const ctx = makeCtx();
  const m = meta((k, to, o) => (k === 'driver' ? hang(o) : OK()));
  try {
    const t0 = Date.now(); const res = await post(env, payload({ client_booking_ref: 'FD-BC3' }), ctx); await ctx.flush();
    const took = Date.now() - t0;
    assert.ok(took < 200, `expected ~80 ms (parallel), took ${took} ms`);
    const failed = ev(db, res.body.booking_id).filter((e) => e.event_type === 'driver_broadcast_failed').map((e) => JSON.parse(e.metadata));
    assert.equal(failed.length, 3);
    assert.ok(failed.every((f) => f.outcome === 'TIMEOUT_UNKNOWN'), 'timeouts are recorded as unknown-outcome, not as provider rejection');
  } finally { m.restore(); }
});

test('eligibility is unchanged: only verified, online, in-zone drivers are messaged (offline, pending and out-of-zone are not)', async () => {
  const { env } = world(); const ctx = makeCtx(); const m = meta(() => OK());
  try {
    await post(env, payload({ client_booking_ref: 'FD-BC4' }), ctx); await ctx.flush();
    assert.deepEqual(m.sent.filter((s) => s.kind === 'driver').map((s) => s.to).sort(), ['6791000001', '6791000002', '6791000003']);
  } finally { m.restore(); }
});

test('first-accept protection and zone ownership are unchanged', async () => {
  const { env, db, tok } = world(); const ctx = makeCtx(); const m = meta(() => OK());
  try {
    const { body } = await post(env, payload({ client_booking_ref: 'FD-BC5' }), ctx); await ctx.flush(); const id = body.booking_id;
    assert.equal((await api(env, 'POST', `/driver/bookings/${id}/accept`, tok.far)).status, 403, 'out-of-zone driver refused');
    const results = await Promise.all([api(env, 'POST', `/driver/bookings/${id}/accept`, tok.a), api(env, 'POST', `/driver/bookings/${id}/accept`, tok.b), api(env, 'POST', `/driver/bookings/${id}/accept`, tok.c)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409], 'exactly one winner');
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(id).status, 'accepted');
  } finally { m.restore(); }
});

test('RECOVERY: a driver whose message failed is retried by the cron sweep (only that driver, only while the job is still pending), capped at 3 tries', async () => {
  const { env, db, ids } = world(); const ctx = makeCtx();
  const m = meta((k, to) => (k === 'driver' && to === '6791000002' ? BAD() : OK()));   // driver b's message is refused every time
  try {
    const res = await post(env, payload({ client_booking_ref: 'FD-BC6' }), ctx); await ctx.flush(); const id = res.body.booking_id;
    const driverSends = () => m.sent.filter((s) => s.kind === 'driver');
    assert.equal(driverSends().length, 3);
    db.prepare(`UPDATE bookings SET created_at = datetime('now', '-10 minutes') WHERE id = ?`).run(id);
    for (let i = 0; i < 4; i++) { const c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush(); }
    const toB = driverSends().filter((s) => s.to === '6791000002').length;
    assert.equal(toB, 3, 'initial + 2 retries = 3 total tries for the failing driver, then it stops');
    assert.equal(driverSends().filter((s) => s.to === '6791000001').length, 1, 'a driver who already received it is NOT messaged again');
    assert.equal(driverSends().filter((s) => s.to === '6791000003').length, 1);
    // once the job is taken, no more retries
    db.prepare(`UPDATE bookings SET status = 'accepted', assigned_driver_id = ? WHERE id = ?`).run(ids.a, id);
    const before = driverSends().length; const c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush();
    assert.equal(driverSends().length, before);
  } finally { m.restore(); }
});

test('RECOVERY: worker killed before any driver was messaged -> the sweep performs the initial broadcast once (guest never retries)', async () => {
  const { env, db } = world(); const m = meta(() => OK());
  try {
    const realDB = env.DB; let killed = true;
    env.DB = { prepare(sql) { if (killed && /driver_broadcast|FROM drivers WHERE status/i.test(sql)) throw new Error('isolate terminated'); return realDB.prepare(sql); } };
    const res = await post(env, payload({ client_booking_ref: 'FD-BC7' }), makeCtx()); await tick(); killed = false;
    const id = res.body.booking_id;
    assert.equal(m.sent.filter((s) => s.kind === 'driver').length, 0);
    let c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush();
    assert.equal(m.sent.filter((s) => s.kind === 'driver').length, 0, 'too young to sweep');
    db.prepare(`UPDATE bookings SET created_at = datetime('now', '-10 minutes') WHERE id = ?`).run(id);
    c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush();
    assert.equal(m.sent.filter((s) => s.kind === 'driver').length, 3, 'the three eligible drivers are notified');
    c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush();
    assert.equal(m.sent.filter((s) => s.kind === 'driver').length, 3, 'not again');
  } finally { m.restore(); }
});

test('offline path (no ctx) is still bounded and keeps the original response shape with per-driver results', async () => {
  const { env } = world({ timeoutMs: 60 }); const m = meta((k, to, o) => (k === 'driver' ? hang(o) : OK()));
  try {
    const t0 = Date.now(); const res = await post(env, payload({ client_booking_ref: 'FD-BC8' }));
    assert.equal(res.status, 201); assert.ok(Date.now() - t0 < 1500);
    assert.equal(res.body.broadcast.matched_drivers, 3); assert.equal(res.body.broadcast.results.length, 3);
  } finally { m.restore(); }
});

test('exhausted notification rows do not starve the sweep batch', async () => {
  const { env, db } = world(); const m = meta(() => OK());
  try {
    for (let i = 0; i < 12; i++) {
      const id = Number(db.prepare(`INSERT INTO bookings (guest_name, guest_phone, pickup_zone, destination_zone, vehicle_type, quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied, payment_method, status, client_booking_ref, created_at)
        VALUES ('X', '+679', 'Nadi Airport', 'Denarau', 'sedan', 'FJD', 49, 1, 49, 1, 'cash', 'accepted', ?, datetime('now', '-30 minutes'))`).run(`EX-${i}`).lastInsertRowid);
      db.prepare(`INSERT INTO admin_notification_state (booking_id, client_booking_ref, state, attempt_count, updated_at) VALUES (?, ?, 'FAILED_RETRYABLE', 6, datetime('now', '-5 hours'))`).run(id, `EX-${i}`);
      db.prepare(`INSERT INTO booking_events (booking_id, event_type) VALUES (?, 'admin_notification_exhausted')`).run(id);
    }
    const live = Number(db.prepare(`INSERT INTO bookings (guest_name, guest_phone, pickup_zone, destination_zone, vehicle_type, quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied, payment_method, status, client_booking_ref, created_at)
      VALUES ('Y', '+679', 'Nadi Airport', 'Denarau', 'sedan', 'FJD', 49, 1, 49, 1, 'cash', 'accepted', 'LIVE-1', datetime('now', '-30 minutes'))`).run().lastInsertRowid);
    const c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush();
    assert.equal(db.prepare('SELECT state FROM admin_notification_state WHERE booking_id = ?').get(live)?.state, 'SENT', 'the eligible booking was reached despite 12 exhausted rows ahead of it');
  } finally { m.restore(); }
});
