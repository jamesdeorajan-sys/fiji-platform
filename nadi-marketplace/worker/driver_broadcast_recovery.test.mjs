// Issue #59 - Codex-reproduced gaps in the driver-broadcast recovery on 87816a5, plus overlapping-sweep safety.
// Offline: REAL worker.js + in-memory SQLite (real schema + migrations). Meta is a per-test fetch stub.
// Run: node --test nadi-marketplace/worker/driver_broadcast_recovery.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const MIG_FILES = ['milestone34-booking-idempotency-and-contact-fields.sql', 'milestone35-revenue-attribution.sql', 'milestone36-admin-notification-retry-state.sql', 'milestone37-driver-broadcast-claim-state.sql'];
const MIGS = MIG_FILES.map((f) => readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
function shim(db) { return { prepare(sql) { let a = []; const api = {
  bind(...x) { a = x; return api; },
  async first() { const r = db.prepare(sql).get(...a); return r === undefined ? null : r; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async run() { const i = db.prepare(sql).run(...a); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; } }; return api; } }; }

function world({ timeoutMs = 60, applyMigration37 = true } = {}) {
  const db = new DatabaseSync(':memory:'); db.exec(SCHEMA_SQL);
  for (const m of (applyMigration37 ? MIGS : MIGS.slice(0, 3))) db.exec(m);
  db.prepare(`UPDATE platform_settings SET value = '+6799999999' WHERE key = 'admin_alert_phone'`).run();
  const spec = { a: '+6791000001', b: '+6791000002', c: '+6791000003' };
  const ids = {}, tok = {};
  for (const [k, phone] of Object.entries(spec)) {
    ids[k] = Number(db.prepare(`INSERT INTO drivers (name, phone, status, zones, online) VALUES (?, ?, 'verified', ?, 1)`).run(`Driver ${k}`, phone, JSON.stringify(['Nadi Airport'])).lastInsertRowid);
    tok[k] = `tok-${k}`; db.prepare(`INSERT INTO driver_login_tokens (driver_id, token, expires_at) VALUES (?, ?, datetime('now', '+1 day'))`).run(ids[k], tok[k]);
  }
  return { db, ids, tok, env: { DB: shim(db), WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'p', HEALTH_ALERT_SEND_TIMEOUT_MS: String(timeoutMs) } };
}
const payload = (o = {}) => ({ guest_name: 'Test Guest', guest_phone: '+6799112233', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan',
  quoted_currency: 'FJD', quoted_amount: 49, payment_method: 'cash', pickup_date: '2026-10-05', pickup_time: '09:30', ...o });
const post = async (env, b, ctx) => { const r = await worker.fetch(new Request('https://w.test/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify(b) }), env, ctx); return { status: r.status, body: await r.json() }; };
function makeCtx() { const jobs = []; return { waitUntil: (p) => jobs.push(p), flush: async () => { await Promise.all(jobs.splice(0)); } }; }
const OK = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'w' }] }) });
function meta(handler) {
  const sent = []; const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const b = JSON.parse(opts.body); const text = b.template.components[0].parameters[0].text;
    const kind = b.to.startsWith('679100') && !text.startsWith('NEW') ? 'driver' : (text.startsWith('NEW BOOKING') ? 'full' : 'short');
    sent.push({ kind, to: b.to, at: Date.now() });
    return handler(kind, b.to, opts);
  };
  return { sent, restore: () => { globalThis.fetch = original; } };
}
const age = (db, id, mins) => db.prepare(`UPDATE bookings SET created_at = datetime('now', ?) WHERE id = ?`).run(`-${mins} minutes`, id);
const hang = (opts) => new Promise((_, rej) => { if (opts && opts.signal) opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
// Reliable "isolate died before any driver work ran" simulation, matching broadcast_bounded.test.mjs's own proven
// crash-recovery test: DB calls the broadcast path needs are made to throw while `killed` is true; the booking POST
// (ctx-based, so it responds without waiting for the background broadcast) is awaited, then a tick lets the
// already-started background work (fire-started by ctx.waitUntil's argument, even though the argument itself is
// never awaited by the caller) actually reach and fail on the killed DB call, before DB access is restored.
async function postWithDriverWorkKilled(env, body) {
  const realDB = env.DB; let killed = true;
  env.DB = { prepare(sql) { if (killed && /driver_broadcast_attempts|FROM drivers WHERE status/i.test(sql)) throw new Error('isolate terminated'); return realDB.prepare(sql); } };
  const res = await post(env, body, makeCtx());
  await tick();
  killed = false; env.DB = realDB;
  return res;
}

test('CODEX GAP 1 REPRO: one driver has driver_broadcast_sent, two eligible drivers have no outcome at all; the sweep must send the two missing messages', async () => {
  const { env, db, ids } = world();
  // Reproduce the exact reported shape directly: booking exists, driver a's broadcast completed (SENT, logged), drivers
  // b and c were never even attempted (no driver_broadcast_attempts row, no booking_events row at all) - the isolate
  // died between driver a's send resolving and drivers b/c's sends ever starting.
  const id = Number(db.prepare(`INSERT INTO bookings (guest_name, guest_phone, pickup_zone, destination_zone, vehicle_type, quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied, payment_method, status, client_booking_ref, created_at)
    VALUES ('Test Guest', '+6799112233', 'Nadi Airport', 'Denarau', 'sedan', 'FJD', 49, 1, 49, 1, 'cash', 'pending', 'FD-GAP1', datetime('now'))`).run().lastInsertRowid);
  db.prepare(`INSERT INTO driver_broadcast_attempts (booking_id, driver_id, state, attempt_count) VALUES (?, ?, 'SENT', 1)`).run(id, ids.a);
  db.prepare(`INSERT INTO booking_events (booking_id, event_type, actor, metadata) VALUES (?, 'driver_broadcast_sent', 'system', ?)`).run(id, JSON.stringify({ driver_id: ids.a, status: 200 }));
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM driver_broadcast_attempts WHERE booking_id = ?`).get(id).n, 1, 'setup: only driver a has any row at all');

  age(db, id, 10);
  const m2 = meta(() => OK());
  const c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush();
  const toB = m2.sent.filter((s) => s.kind === 'driver' && s.to === '6791000002').length;
  const toC = m2.sent.filter((s) => s.kind === 'driver' && s.to === '6791000003').length;
  const toA = m2.sent.filter((s) => s.kind === 'driver' && s.to === '6791000001').length;
  m2.restore();
  assert.equal(toB, 1, 'driver b (no prior outcome) must receive the missing message');
  assert.equal(toC, 1, 'driver c (no prior outcome) must receive the missing message');
  assert.equal(toA, 0, 'driver a (already sent) must NOT be re-messaged');
});

test('CODEX GAP 2 REPRO: 10 older pending bookings with fully-completed broadcasts must not occupy every recovery slot; an 11th booking needing its initial broadcast is reached in the same sweep', async () => {
  const { env, db } = world(); const m = meta(() => OK());
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const r = await post(env, payload({ client_booking_ref: `FD-DONE-${i}` }));
    ids.push(r.body.booking_id);
    age(db, r.body.booking_id, 10); // complete broadcast, old, still pending/unassigned - exactly the starving shape
  }
  const r11 = await postWithDriverWorkKilled(env, payload({ client_booking_ref: 'FD-NEEDSWORK' })); // 11th: worker "died", zero driver messages sent
  const id11 = r11.body.booking_id;
  age(db, id11, 5);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM booking_events WHERE booking_id = ? AND event_type LIKE 'driver_broadcast%'`).get(id11).n, 0, 'setup: #11 has zero driver-broadcast outcomes');
  m.sent.length = 0;
  const c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush();
  const to11 = m.sent.filter((s) => s.kind === 'driver' && s.to.startsWith('679100')).length;
  m.restore();
  assert.ok(to11 >= 3, `#11 must receive its initial broadcast in this sweep even with 10 already-complete older bookings ahead of it (got ${to11} driver sends)`);

  // must not merely be delayed: confirm it is not still stuck after a second sweep either (it should already be done by now)
  const m2 = meta(() => OK());
  const c2 = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c2); await c2.flush();
  const again = m2.sent.filter((s) => s.kind === 'driver').length; m2.restore();
  assert.equal(again, 0, 'once #11 is fully delivered, no further sends happen for it or the 10 completed bookings');
});

test('OVERLAPPING SWEEPS cannot create a duplicate send to the same driver for the same booking', async () => {
  const { env, db } = world(); const m = meta(() => OK());
  const r = await postWithDriverWorkKilled(env, payload({ client_booking_ref: 'FD-OVERLAP' })); // zero driver messages sent yet
  const id = r.body.booking_id; age(db, id, 5);
  m.sent.length = 0;
  const c1 = makeCtx(); const c2 = makeCtx();
  await Promise.all([worker.scheduled({ cron: '*/5 * * * *' }, env, c1), worker.scheduled({ cron: '*/5 * * * *' }, env, c2)]);
  await Promise.all([c1.flush(), c2.flush()]);
  const perDriver = {}; for (const s of m.sent) if (s.kind === 'driver') perDriver[s.to] = (perDriver[s.to] || 0) + 1;
  m.restore();
  assert.deepEqual(Object.values(perDriver).sort(), [1, 1, 1], `each of the 3 eligible drivers must be messaged EXACTLY once despite two concurrent sweeps: ${JSON.stringify(perDriver)}`);
});

test('OVERLAPPING creation-time broadcast and a sweep cannot double-send either', async () => {
  const { env, db } = world();
  let releaseDriverA; const gate = new Promise((r) => { releaseDriverA = r; });
  const m = meta(async (k, to) => { if (k === 'driver' && to === '6791000001') { await gate; } return OK(); });
  const ctx = makeCtx();
  const createP = post(env, payload({ client_booking_ref: 'FD-RACE' }), ctx); // creation-time broadcast in flight, stalled on driver a
  await new Promise((r) => setTimeout(r, 30));
  const created = db.prepare(`SELECT id FROM bookings WHERE client_booking_ref = 'FD-RACE'`).get();
  age(db, created.id, 5); // old enough for the sweep to also consider it while creation-time broadcast is still in flight
  const c2 = makeCtx(); const sweepP = worker.scheduled({ cron: '*/5 * * * *' }, env, c2);
  await Promise.all([createP, sweepP]);
  await new Promise((r) => setTimeout(r, 30)); // let both the creation-time claim and the sweep's claim attempt run and settle who (if anyone) is genuinely in flight
  releaseDriverA(); // now let driver a's stalled send(s) resolve
  await Promise.all([ctx.flush(), c2.flush()]);
  const perDriver = {}; for (const s of m.sent) if (s.kind === 'driver') perDriver[s.to] = (perDriver[s.to] || 0) + 1;
  m.restore();
  for (const v of Object.values(perDriver)) assert.ok(v <= 1, `no driver may receive more than one message: ${JSON.stringify(perDriver)}`);
});

test('preserved: eligibility, assignment checks and the 3-attempt retry cap still hold', async () => {
  const { env, db, tok } = world(); const m = meta((k, to) => (k === 'driver' && to === '6791000002' ? { ok: false, status: 400, text: async () => JSON.stringify({ error: { code: 131026 } }) } : OK()));
  const dropped = { waitUntil: () => {} };
  const r = await post(env, payload({ client_booking_ref: 'FD-CAPPRESERVE' }), dropped); const id = r.body.booking_id;
  for (let i = 0; i < 5; i++) { age(db, id, 10); const c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush(); }
  const toB = m.sent.filter((s) => s.kind === 'driver' && s.to === '6791000002').length;
  m.restore();
  assert.ok(toB <= 3, `driver b's failing send must stop being retried once its cap (3) is reached (got ${toB})`);
  // out-of-zone / offline / unverified drivers are still never messaged
  assert.ok(!m.sent.some((s) => s.kind === 'driver' && !['6791000001', '6791000002', '6791000003'].includes(s.to)));
  const acc = await worker.fetch(new Request(`https://w.test/driver/bookings/${id}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${tok.a}` } }), env);
  assert.equal(acc.status, 200);
  const before = m.sent.length; const c = makeCtx(); age(db, id, 10); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush();
  assert.equal(m.sent.length, before, 'no further driver messages once the booking is accepted (assignment check preserved)');
});

test('missing-table fallback: without migration37 applied, initial broadcast still sends and does not throw', async () => {
  const { env } = world({ applyMigration37: false }); const m = meta(() => OK());
  try {
    const r = await post(env, payload({ client_booking_ref: 'FD-NOMIG37' }));
    assert.equal(r.status, 201);
    assert.equal(m.sent.filter((s) => s.kind === 'driver').length, 3);
  } finally { m.restore(); }
});
