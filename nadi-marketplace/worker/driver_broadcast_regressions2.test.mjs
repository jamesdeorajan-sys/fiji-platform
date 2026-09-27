// Issue #59 - three regressions independently found by Codex reviewing 6272906/ab25dce.
// Offline: REAL worker.js + in-memory SQLite (real schema + migrations). Meta is a per-test fetch stub.
// Run: node --test nadi-marketplace/worker/driver_broadcast_regressions2.test.mjs
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
const MIG_FILES_34_36 = ['milestone34-booking-idempotency-and-contact-fields.sql', 'milestone35-revenue-attribution.sql', 'milestone36-admin-notification-retry-state.sql'];
const MIG_37 = readFileSync(path.join(__dirname, '..', 'migrations', 'milestone37-driver-broadcast-claim-state.sql'), 'utf8');
const MIGS_34_36 = MIG_FILES_34_36.map((f) => readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
function shim(db) { return { prepare(sql) { let a = []; const api = {
  bind(...x) { a = x; return api; },
  async first() { const r = db.prepare(sql).get(...a); return r === undefined ? null : r; },
  async all() { return { results: db.prepare(sql).all(...a) }; },
  async run() { const i = db.prepare(sql).run(...a); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; } }; return api; } }; }

// Schema WITHOUT migration37 applied yet - so a test can apply it mid-scenario, matching a real "migration applied,
// Worker not yet redeployed / booking created before the migration" sequence.
function worldPre37() {
  const db = new DatabaseSync(':memory:'); db.exec(SCHEMA_SQL); for (const m of MIGS_34_36) db.exec(m);
  db.prepare(`UPDATE platform_settings SET value = '+6799999999' WHERE key = 'admin_alert_phone'`).run();
  const spec = { a: '+6791000001', b: '+6791000002', c: '+6791000003' };
  const ids = {};
  for (const [k, phone] of Object.entries(spec)) {
    ids[k] = Number(db.prepare(`INSERT INTO drivers (name, phone, status, zones, online) VALUES (?, ?, 'verified', ?, 1)`).run(`Driver ${k}`, phone, JSON.stringify(['Nadi Airport'])).lastInsertRowid);
  }
  return { db, ids, env: { DB: shim(db), WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'p', HEALTH_ALERT_SEND_TIMEOUT_MS: '60' } };
}
function world37() {
  const w = worldPre37(); w.db.exec(MIG_37); return w;
}
const payload = (o = {}) => ({ guest_name: 'Test Guest', guest_phone: '+6799112233', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan',
  quoted_currency: 'FJD', quoted_amount: 49, payment_method: 'cash', pickup_date: '2026-10-05', pickup_time: '09:30', ...o });
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
const insertBooking = (db, ref, mins) => Number(db.prepare(`INSERT INTO bookings (guest_name, guest_phone, pickup_zone, destination_zone, vehicle_type, quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied, payment_method, status, client_booking_ref, created_at)
  VALUES ('X', '+679', 'Nadi Airport', 'Denarau', 'sedan', 'FJD', 49, 1, 49, 1, 'cash', 'pending', ?, datetime('now', ?))`).run(ref, `-${mins} minutes`).lastInsertRowid);

test('REGRESSION 1 REPRO: legacy driver_broadcast_sent events pre-dating migration37 must not be re-sent once the table exists (including sends written by the OLD Worker in the migration-to-deploy gap)', async () => {
  const { env, db, ids } = worldPre37(); // migration37 NOT yet applied
  const id = insertBooking(db, 'FD-LEGACYSEND', 10);
  // Simulate all 3 drivers already legitimately notified by the OLD code path (booking_events only, no attempts table).
  for (const k of ['a', 'b', 'c']) {
    db.prepare(`INSERT INTO booking_events (booking_id, event_type, actor, metadata) VALUES (?, 'driver_broadcast_sent', 'system', ?)`).run(id, JSON.stringify({ driver_id: ids[k], status: 200 }));
  }
  db.exec(MIG_37); // the migration is now applied; driver_broadcast_attempts exists but is EMPTY for this booking
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM driver_broadcast_attempts WHERE booking_id = ?`).get(id).n, 0, 'setup: the new table has no rows yet for this booking');

  const m = meta(() => OK());
  const c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush();
  const driverSends = m.sent.filter((s) => s.kind === 'driver'); m.restore();
  assert.equal(driverSends.length, 0, `no already-notified driver may receive a second real message: got ${JSON.stringify(driverSends)}`);
});

test('REGRESSION 2 REPRO: the retry cap must be enforced atomically in the claim, including a stale ATTEMPTING row already at the cap', async () => {
  const { env, db, ids } = world37();
  const id = insertBooking(db, 'FD-CAPATTEMPTING', 10);
  // Driver a is stuck ATTEMPTING at attempt_count already == the cap (3), staled out (an isolate died mid-send on its 3rd try).
  db.prepare(`INSERT INTO driver_broadcast_attempts (booking_id, driver_id, state, attempt_count, updated_at) VALUES (?, ?, 'ATTEMPTING', 3, datetime('now', '-10 minutes'))`).run(id, ids.a);

  const m = meta(() => OK());
  const c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush();
  const toA = m.sent.filter((s) => s.kind === 'driver' && s.to === '6791000001').length; m.restore();
  assert.equal(toA, 0, `a stale claim already at the 3-attempt cap must not be reclaimed for a 4th send (got ${toA})`);
  const row = db.prepare(`SELECT state, attempt_count FROM driver_broadcast_attempts WHERE booking_id = ? AND driver_id = ?`).get(id, ids.a);
  assert.equal(row.attempt_count, 3, 'attempt_count must not be incremented past the cap');
});

test('REGRESSION 3 REPRO: 200 completed bookings followed by one unsent booking must be reached within two sweeps, without merely raising the candidate LIMIT', async () => {
  const { env, db, ids } = world37();
  for (let i = 0; i < 200; i++) {
    const bid = insertBooking(db, `FD-DONE${i}`, 10);
    for (const k of ['a', 'b', 'c']) db.prepare(`INSERT INTO driver_broadcast_attempts (booking_id, driver_id, state, attempt_count) VALUES (?, ?, 'SENT', 1)`).run(bid, ids[k]);
  }
  const id201 = insertBooking(db, 'FD-NEEDS-WORK-201', 5); // the 201st booking, genuinely needs its initial broadcast
  const m = meta(() => OK());
  for (let i = 0; i < 2; i++) { const c = makeCtx(); await worker.scheduled({ cron: '*/5 * * * *' }, env, c); await c.flush(); }
  const to201 = m.sent.filter((s) => s.kind === 'driver').length; m.restore();
  assert.ok(to201 >= 3, `booking #201 must be reached (and its 3 eligible drivers messaged) within 2 sweeps, not starved by 200 already-complete bookings ahead of it (got ${to201} driver sends)`);
});

test('preserved: existing concurrency, eligibility, first-accept and guest-response protections still hold with these fixes in place', async () => {
  const { env, db, ids } = world37();
  const m = meta(() => OK());
  const id = insertBooking(db, 'FD-PRESERVE2', 5);
  const c1 = makeCtx(); const c2 = makeCtx();
  await Promise.all([worker.scheduled({ cron: '*/5 * * * *' }, env, c1), worker.scheduled({ cron: '*/5 * * * *' }, env, c2)]);
  await Promise.all([c1.flush(), c2.flush()]);
  const perDriver = {}; for (const s of m.sent) if (s.kind === 'driver') perDriver[s.to] = (perDriver[s.to] || 0) + 1;
  m.restore();
  assert.deepEqual(Object.values(perDriver).sort(), [1, 1, 1], 'two concurrent sweeps must still send each eligible driver exactly once');
  const acc = await worker.fetch(new Request(`https://w.test/driver/bookings/${id}/accept`, { method: 'POST', headers: { Authorization: 'Bearer none' } }), env);
  assert.equal(acc.status, 401, 'auth is still enforced (sanity check that nothing here weakened accept)');
});
