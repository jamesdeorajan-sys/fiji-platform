// Issue #59 - what actually happens AFTER a hotel-to-airport (departure) booking is saved: driver broadcast, job feed, accept.
// CHARACTERIZATION of current Worker behaviour (real worker.js, in-memory SQLite, Meta stubbed); it changes nothing.
// Run: node --test nadi-marketplace/worker/departure_dispatch.test.mjs
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

function world() {
  const db = new DatabaseSync(':memory:'); db.exec(SCHEMA_SQL); for (const m of MIGS) db.exec(m);
  db.prepare(`UPDATE platform_settings SET value = '+6799999999' WHERE key = 'admin_alert_phone'`).run();
  const drivers = { airport: ['+6791000001', ['Nadi Airport']], denarau: ['+6791000002', ['Denarau']], both: ['+6791000003', ['Denarau', 'Nadi Airport']], suva: ['+6791000004', ['Suva']] };
  const tok = {};
  for (const [k, [phone, zones]] of Object.entries(drivers)) {
    const id = db.prepare(`INSERT INTO drivers (name, phone, status, zones, online) VALUES (?, ?, 'verified', ?, 1)`).run(`Driver ${k}`, phone, JSON.stringify(zones)).lastInsertRowid;
    tok[k] = `tok-${k}`; db.prepare(`INSERT INTO driver_login_tokens (driver_id, token, expires_at) VALUES (?, ?, datetime('now', '+1 day'))`).run(id, tok[k]);
  }
  return { db, tok, env: { DB: shim(db), WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'p' } };
}
function metaCapture() {
  const sent = []; const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const b = JSON.parse(opts.body); sent.push({ to: b.to, template: b.template.name, params: b.template.components[0].parameters.map((p) => p.text) }); return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'w' }] }) }; };
  return { sent, restore: () => { globalThis.fetch = original; } };
}
const departure = { guest_name: 'Test Guest', guest_phone: '+6799112233', client_booking_ref: 'FD-DEP', pickup_zone: 'Denarau', destination_zone: 'Nadi Airport', vehicle_type: 'sedan',
  quoted_currency: 'FJD', quoted_amount: 45, payment_method: 'cash', pickup_date: '2026-10-05', pickup_time: '06:30', trip_type: 'one-way',
  notes: 'Pickup at: Hilton Fiji Beach Resort\nTwo large suitcases', is_custom_address: false };
const arrival = { ...departure, client_booking_ref: 'FD-ARR', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', notes: null };
const post = async (env, b) => { const r = await worker.fetch(new Request('https://w.test/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify(b) }), env); return { status: r.status, body: await r.json() }; };
const api = (env, method, p, token) => worker.fetch(new Request('https://w.test' + p, { method, headers: { Authorization: `Bearer ${token}` } }), env);

test('departure booking is broadcast to drivers registered for the HOTEL zone (pickup_zone), not to airport-only drivers', async () => {
  const { env, db } = world(); const m = metaCapture();
  try {
    const res = await post(env, departure);
    assert.equal(res.status, 201);
    assert.equal(res.body.broadcast.matched_drivers, 2, 'Denarau-only and Denarau+Airport drivers');
    const driverMsgs = m.sent.filter((s) => s.template !== 'admin_alert' && s.to.startsWith('679100'));
    const recipients = driverMsgs.map((s) => s.to).sort();
    assert.deepEqual(recipients, ['6791000002', '6791000003']);
    assert.ok(!recipients.includes('6791000001'), 'an airport-zone-only driver is NOT notified of a hotel departure');
    assert.ok(!recipients.includes('6791000004'), 'out-of-zone drivers are not notified');
    // what the driver is told: zones only, never the exact hotel or the pickup time
    assert.deepEqual(driverMsgs[0].params.slice(0, 4), ['Denarau', 'Nadi Airport', 'sedan', 'FJD 45']);
    assert.ok(!driverMsgs[0].params.join(' ').includes('Hilton'), 'the broadcast carries the zone, not the hotel name');
    const arr = await post(env, arrival);
    assert.equal(arr.body.broadcast.matched_drivers, 2, 'arrival control: airport-zone drivers (airport, both)');
  } finally { m.restore(); }
});

test('the driver job feed shows the departure to in-zone drivers only, without notes or pickup time (same as arrivals today)', async () => {
  const { env, tok } = world(); const m = metaCapture();
  try {
    await post(env, departure);
    const feed = async (k) => (await (await api(env, 'GET', '/driver/jobs', tok[k])).json()).jobs;
    assert.equal((await feed('denarau')).length, 1);
    assert.equal((await feed('both')).length, 1);
    assert.equal((await feed('airport')).length, 0);
    assert.equal((await feed('suva')).length, 0);
    const job = (await feed('denarau'))[0];
    assert.equal(job.pickup_zone, 'Denarau'); assert.equal(job.destination_zone, 'Nadi Airport');
    assert.equal('notes' in job, false, 'exact hotel (in notes) is NOT in the job feed');
    assert.equal('pickup_time' in job, false, 'pickup date/time is NOT in the job feed');
  } finally { m.restore(); }
});

test('accept: an out-of-zone (airport-only) driver is refused; an in-zone driver wins exactly once', async () => {
  const { env, db, tok } = world(); const m = metaCapture();
  try {
    const { body } = await post(env, departure);
    const id = body.booking_id;
    assert.equal((await api(env, 'POST', `/driver/bookings/${id}/accept`, tok.airport)).status, 403);
    assert.equal((await api(env, 'POST', `/driver/bookings/${id}/accept`, tok.denarau)).status, 200);
    assert.equal((await api(env, 'POST', `/driver/bookings/${id}/accept`, tok.both)).status, 409);
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(id).status, 'accepted');
  } finally { m.restore(); }
});

test('admin alert for a departure carries the exact pickup hotel from notes and the real zones', async () => {
  const { env } = world(); const m = metaCapture();
  try {
    await post(env, departure);
    const full = m.sent.filter((s) => s.to === '6799999999').map((s) => s.params[0]).find((t) => t.startsWith('NEW BOOKING'));
    assert.ok(full, 'full alert sent');
    assert.ok(full.includes('Denarau -> Nadi Airport'));
    assert.ok(full.includes('Pickup at: Hilton Fiji Beach Resort'), full);
    assert.ok(full.includes('06:30'));
  } finally { m.restore(); }
});
