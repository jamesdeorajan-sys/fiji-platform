// Marau integration: read-only GET /admin/bookings/:id carrying the itinerary (return_*) fields. Offline, real worker.js, real
// schema in-memory SQLite, default-deny network. Proposed, NOT deployed.
// Run: node --test nadi-marketplace/worker/booking_read_itinerary.test.mjs
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
const MIGS = ['milestone34-booking-idempotency-and-contact-fields.sql', 'milestone35-revenue-attribution.sql', 'milestone36-admin-notification-retry-state.sql', 'milestone37-driver-broadcast-claim-state.sql'];
const ADMIN = 'test-admin-token';
function shim(db) {
  return { prepare(sql) { let a = []; const api = { bind(...x) { a = x; return api; }, async first() { const r = db.prepare(sql).get(...a); return r === undefined ? null : r; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { const i = db.prepare(sql).run(...a); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; } }; return api; } };
}
function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_SQL);
  for (const f of MIGS) db.exec(readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  db.prepare(`UPDATE platform_settings SET value = ? WHERE key = 'admin_alert_phone'`).run('+6799999999');
  return { db, env: { DB: shim(db), ADMIN_TOKEN: ADMIN, WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'p' } };
}
const insert = (db, over = {}) => Number(db.prepare(
  `INSERT INTO bookings (guest_name, guest_phone, guest_email, pickup_zone, destination_zone, distance_km, vehicle_type, quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied, commission_base_fjd, payment_method, status, pickup_date, pickup_time, return_date, return_time, return_pickup_location, notes, client_booking_ref)
   VALUES (?, ?, ?, ?, ?, 10, 'sedan', ?, ?, 1, ?, 1, 0, 'cash', ?, ?, ?, ?, ?, ?, 'private note', ?)`
).run(over.name ?? 'Synthetic Guest', '+15005550101', 'syn@example.test', over.pickup ?? 'Nadi Airport', over.dest ?? 'Denarau', over.currency ?? 'FJD', over.amount ?? 170, over.settlement ?? 170, over.status ?? 'accepted',
  over.pdate ?? '2031-10-05', over.ptime ?? '09:00', over.rdate ?? null, over.rtime ?? null, over.rloc ?? null, over.ref ?? `FD-${Math.random().toString(36).slice(2, 8)}`).lastInsertRowid);
const get = (env, p, token = ADMIN) => worker.fetch(new Request('http://nadi.test' + p, { headers: token ? { authorization: `Bearer ${token}` } : {} }), env);

test('the read is admin-only, 404s unknown ids, and ignores non-numeric ids', async () => {
  const { db, env } = fresh(); const id = insert(db);
  assert.equal((await get(env, `/admin/bookings/${id}`, null)).status, 401);
  assert.equal((await get(env, `/admin/bookings/${id}`, 'wrong')).status, 401);
  assert.equal((await get(env, '/admin/bookings/99999')).status, 404);
  const odd = await get(env, '/admin/bookings/12abc');
  assert.notEqual(odd.status, 200, 'a non-numeric id never reaches the booking read');
});

test('a round trip is ONE row: both legs\' itinerary fields come back together with the single quoted amount - and no separate return amount exists', async () => {
  const { db, env } = fresh();
  const id = insert(db, { rdate: '2031-10-12', rtime: '10:30', rloc: 'Sofitel Denarau lobby', amount: 170, settlement: 170 });
  const b = (await (await get(env, `/admin/bookings/${id}`)).json()).booking;
  assert.deepEqual([b.pickup_zone, b.destination_zone, b.pickup_date, b.pickup_time], ['Nadi Airport', 'Denarau', '2031-10-05', '09:00']);
  assert.deepEqual([b.return_date, b.return_time, b.return_pickup_location], ['2031-10-12', '10:30', 'Sofitel Denarau lobby']);
  assert.equal(b.quoted_amount, 170);
  const keys = Object.keys(b);
  assert.equal(keys.some((k) => /return.*(amount|fare|price)/i.test(k)), false, 'the source schema has no return amount');
  for (const forbidden of ['guest_name', 'notes', 'source_ip', 'first_source', 'last_source']) assert.equal(keys.includes(forbidden), false, forbidden);
});

test('a one-way booking returns null return fields; the existing LIST endpoint omits them (why this read exists)', async () => {
  const { db, env } = fresh(); const id = insert(db);
  const b = (await (await get(env, `/admin/bookings/${id}`)).json()).booking;
  assert.deepEqual([b.return_date, b.return_time, b.return_pickup_location], [null, null, null]);
  const list = (await (await get(env, '/admin/bookings')).json()).bookings[0];
  assert.equal('return_date' in list, false, 'the list view cannot represent a round trip');
});

test('the read mutates nothing and is not a write route', async () => {
  const { db, env } = fresh(); const id = insert(db, { rdate: '2031-10-12', rtime: '10:30' });
  const before = JSON.stringify(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id));
  await get(env, `/admin/bookings/${id}`); await get(env, `/admin/bookings/${id}`);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM bookings WHERE id = ?').get(id)), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM booking_events').get().n, 0, 'no event written');
  const post = await worker.fetch(new Request(`http://nadi.test/admin/bookings/${id}`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` } }), env);
  assert.notEqual(post.status, 200);
});
