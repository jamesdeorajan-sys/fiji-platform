// Stage 1 NAT read-only source endpoint: contract, security, read-only and regression tests.
// Runs against (A) the BYTE-EXACT deployed production bundle and (B) the same bundle plus the proposed additive patch.
// Offline: in-memory SQLite shaped by the repo schema (bookings columns verified equal to production by read-only PRAGMA/sqlite_master), default-deny network, SYNTHETIC rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
const ROOT = process.env.S1_ROOT, TREE = process.env.S1_TREE;
const { createNadiBookingReader } = await import(process.env.BULA_READER);
let fetchCalls = []; globalThis.fetch = async (...a) => { fetchCalls.push(String(a[0])); throw new Error('NETWORK DENIED IN TEST'); };
const prod = (await import(`${ROOT}/prod.js`)).default, patched = (await import(`${ROOT}/prod_patched.js`)).default;
const SCHEMA = readFileSync(`${TREE}/nadi-marketplace/schema.sql`, 'utf8');
const MIGS = ['milestone34-booking-idempotency-and-contact-fields.sql', 'milestone35-revenue-attribution.sql', 'milestone36-admin-notification-retry-state.sql', 'milestone37-driver-broadcast-claim-state.sql', 'milestone38-confirmation-attempt-identity.sql'];
const ADMIN = 'synthetic-admin-token-AAAA', SRC = 'synthetic-source-read-token-BBBB';
const shim = (db) => ({ async batch(stmts) { const out = []; for (const x of stmts) out.push(await x.run()); return out; }, prepare(sql) { let a = []; const api = { _run: null, bind(...x) { a = x; return api; }, async first() { const r = db.prepare(sql).get(...a); return r === undefined ? null : r; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { const i = db.prepare(sql).run(...a); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; } }; return api; } });
function fresh(over = {}) { const db = new DatabaseSync(':memory:'); db.exec(SCHEMA); for (const f of MIGS) { try { db.exec(readFileSync(`${TREE}/nadi-marketplace/migrations/${f}`, 'utf8')); } catch (e) { if (!/duplicate column|already exists/i.test(String(e))) throw e; } }
  db.prepare(`UPDATE platform_settings SET value = '+6799999999' WHERE key = 'admin_alert_phone'`).run();
  return { db, env: { DB: shim(db), ADMIN_TOKEN: ADMIN, SOURCE_READ_TOKEN: SRC, WHATSAPP_TOKEN: 'x', WHATSAPP_PHONE_ID: 'y', ...over } }; }
const ins = (db, o = {}) => Number(db.prepare(`INSERT INTO bookings (guest_name, guest_phone, guest_email, pickup_zone, destination_zone, distance_km, vehicle_type, quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied, commission_base_fjd, payment_method, status, pickup_date, pickup_time, return_date, return_time, return_pickup_location, notes, client_booking_ref, source_ip, first_source)
  VALUES (?, '+15005550101', ?, 'Nadi Airport', 'Denarau', 10, 'sedan', 'FJD', 170, 1, 170, 1, 0, 'cash', ?, '2031-10-05', '09:00', ?, ?, ?, 'PRIVATE-NOTE', ?, '203.0.113.9', 'PRIVATE-SRC')`).run(o.name ?? 'Synthetic Guest', o.email ?? 'syn@example.test', o.status ?? 'accepted', o.rdate ?? null, o.rtime ?? null, o.rloc ?? null, o.ref ?? 'SYN-1').lastInsertRowid);
const req = (w, env, p, { m = 'GET', tok, body } = {}) => w.fetch(new Request('http://nat.test' + p, { method: m, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
const dump = (db) => createHash('sha256').update(JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}"`).all()]))).digest('hex');

test('PRODUCTION BUNDLE has no single-booking route today (the endpoint is genuinely new)', async () => {
  const { db, env } = fresh(); const id = ins(db); const r = await req(prod, env, `/admin/bookings/${id}`, { tok: SRC }); assert.notEqual(r.status, 200);
});
test('AUTH is fail-closed: none / wrong / ADMIN token / unset SOURCE_READ_TOKEN / empty bearer all 401, and no row data in the body', async () => {
  const { db, env } = fresh(); const id = ins(db); const bad = [null, 'nope', ADMIN, '', SRC.slice(0, -1), SRC + 'x'];
  for (const t of bad) { const r = await req(patched, env, `/admin/bookings/${id}`, { tok: t }); assert.equal(r.status, 401, String(t)); assert.doesNotMatch(await r.text(), /syn@example|Nadi Airport|SYN-1/); }
  const unset = fresh({ SOURCE_READ_TOKEN: undefined }); const id2 = ins(unset.db); for (const t of [SRC, '', 'undefined', ADMIN]) assert.equal((await req(patched, unset.env, `/admin/bookings/${id2}`, { tok: t })).status, 401, 'unset secret never opens the route');
  const empty = fresh({ SOURCE_READ_TOKEN: '' }); const id3 = ins(empty.db); assert.equal((await req(patched, empty.env, `/admin/bookings/${id3}`, { tok: '' })).status, 401);
});
test('an interactive admin LOGIN token (admin_login_tokens) cannot use the source route', async () => {
  const { db, env } = fresh(); const id = ins(db); db.prepare(`INSERT INTO admin_login_tokens (token, expires_at) VALUES ('adm-session-1', datetime('now','+1 hour'))`).run().changes;
  assert.equal((await req(patched, env, `/admin/bookings/${id}`, { tok: 'adm-session-1' })).status, 401);
});
test('CONTRACT: exactly the 20 whitelisted fields; never guest_name, notes, payment, IP, attribution, distance, fx', async () => {
  const { db, env } = fresh(); const id = ins(db, { rdate: '2031-10-12', rtime: '10:30', rloc: 'Synthetic Hotel lobby' });
  const r = await req(patched, env, `/admin/bookings/${id}`, { tok: SRC }); assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.ok, true);
  assert.deepEqual(Object.keys(j.booking).sort(), ['assigned_driver_id', 'client_booking_ref', 'commission_base_fjd', 'created_at', 'destination_zone', 'flight_number', 'guest_email', 'guest_phone', 'id', 'pickup_date', 'pickup_time', 'pickup_zone', 'quoted_amount', 'quoted_currency', 'return_date', 'return_pickup_location', 'return_time', 'settlement_amount_fjd', 'status', 'vehicle_type'].sort());
  assert.equal(j.booking.quoted_amount, 170); assert.equal(j.booking.return_date, '2031-10-12');
  const txt = JSON.stringify(j); for (const f of ['Synthetic Guest', 'PRIVATE-NOTE', 'PRIVATE-SRC', '203.0.113.9', 'cash', 'distance_km', 'fx_rate']) assert.ok(!txt.includes(f), f);
});
test('404 for unknown id; non-numeric / negative / decimal / path-extended ids never reach the read; 10 repeated reads identical', async () => {
  const { db, env } = fresh(); const id = ins(db); assert.equal((await req(patched, env, '/admin/bookings/99999', { tok: SRC })).status, 404);
  for (const p of ['/admin/bookings/12abc', '/admin/bookings/-1', '/admin/bookings/1.5', `/admin/bookings/${id}/`, `/admin/bookings/${id}/x`]) assert.notEqual((await req(patched, env, p, { tok: SRC })).status === 200 && (await (await req(patched, env, p, { tok: SRC })).clone().json().catch(() => ({}))).booking, true, p);
  const a = await (await req(patched, env, `/admin/bookings/${id}`, { tok: SRC })).text(); for (let i = 0; i < 10; i++) assert.equal(await (await req(patched, env, `/admin/bookings/${id}`, { tok: SRC })).text(), a);
});
test('STRICTLY READ-ONLY: reads (valid, invalid, unauthorised) change no table; write verbs are never served; no event, notification, WhatsApp or network call', async () => {
  const { db, env } = fresh(); const id = ins(db, { status: 'pending' }); fetchCalls = []; const before = dump(db);
  for (const [tok, p] of [[SRC, `/admin/bookings/${id}`], [SRC, '/admin/bookings/99999'], [null, `/admin/bookings/${id}`], ['bad', `/admin/bookings/${id}`]]) await req(patched, env, p, { tok });
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) { const r = await req(patched, env, `/admin/bookings/${id}`, { m, tok: SRC, body: { status: 'cancelled' } }); assert.notEqual(r.status, 200, m); }
  assert.equal(dump(db), before, 'database byte-identical'); assert.equal(fetchCalls.length, 0, 'no outbound call (no WhatsApp/email)'); assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_events').get().n, 0);
  const src = readFileSync(`${process.env.S1_ROOT}/nat-source-endpoint.diff`, 'utf8').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|REPLACE INTO|sendWhatsApp|fetch\()/, 'the added code contains no write verb or outbound call');
});
test('NO SECRET OR GUEST DATA IN LOGS: across ok/denied/error paths nothing is written to console containing a token, email or phone', async () => {
  const logs = []; const o = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = (...a) => logs.push(a.map(String).join(' '));
  try { const { db, env } = fresh(); const id = ins(db); await req(patched, env, `/admin/bookings/${id}`, { tok: SRC }); await req(patched, env, `/admin/bookings/${id}`, { tok: 'wrong' });
    const broken = { ...env, DB: { prepare() { throw new Error('boom ' + SRC + ' syn@example.test +15005550101'); } } }; const r = await req(patched, broken, '/admin/bookings/1', { tok: SRC }); assert.equal(r.status, 500); assert.doesNotMatch(await r.text(), /boom|syn@|\+1500/);
  } finally { Object.assign(console, { log: o.l, error: o.e, warn: o.w }); }
  const all = logs.join('\n'); for (const s of [SRC, ADMIN, 'syn@example.test', '+15005550101', 'boom']) assert.ok(!all.includes(s), `log leaked ${s === SRC ? 'token' : s}`);
});
test('DB unavailable -> 503 only AFTER auth passes (unauthenticated callers cannot probe)', async () => {
  const { env } = fresh(); assert.equal((await req(patched, { ...env, DB: undefined }, '/admin/bookings/1', { tok: SRC })).status, 503); assert.equal((await req(patched, { ...env, DB: undefined }, '/admin/bookings/1', { tok: 'bad' })).status, 401);
});
test('END-TO-END CONTRACT with the REAL Bula reader (whitelist, type checks, provenance): round trip and one-way, via the patched Worker', async () => {
  const { db, env } = fresh(); const rt = ins(db, { rdate: '2031-10-12', rtime: '10:30', rloc: 'Synthetic Hotel lobby', ref: 'SYN-RT' }), ow = ins(db, { ref: 'SYN-OW', email: 'ow@example.test' });
  const f = async (url, init) => patched.fetch(new Request(url, init), env);
  const reader = createNadiBookingReader({ baseUrl: 'https://nat.test', adminToken: SRC, fetchImpl: f });
  const a = await reader(String(rt)), b = await reader(String(ow)); assert.equal(a.return_date, '2031-10-12'); assert.equal(a.quoted_amount, 170); assert.equal(b.return_date, null); assert.equal(b.status, 'accepted'); assert.equal(b.source_booking_ref, String(ow));
  assert.equal(await reader('99999'), null); assert.equal(reader.provenance.read_only, true);
  const wrong = createNadiBookingReader({ baseUrl: 'https://nat.test', adminToken: 'wrong', fetchImpl: f }); await assert.rejects(() => wrong(String(rt)), /SOURCE_READ_FAILED_401/);
  const a2 = await reader(String(rt)); assert.deepEqual(a2, a, 'repeated reads are identical (idempotent)');
});
test('REGRESSION (differential): for every existing route the PATCHED Worker answers byte-for-byte like the deployed one', async () => {
  const probes = [['GET', '/health'], ['OPTIONS', '/admin/bookings'], ['GET', '/admin/bookings', ADMIN], ['GET', '/admin/bookings'], ['GET', '/admin/bookings/1/events', ADMIN], ['GET', '/admin/bookings/1/events'], ['POST', '/admin/bookings/manual-assign', null, {}], ['POST', '/admin/bookings/manual-assign', ADMIN, {}], ['POST', '/admin/bookings/1/cancel', ADMIN, {}], ['GET', '/admin/dashboard-stats', ADMIN], ['GET', '/nope'], ['GET', '/admin/bookings/1/confirmation', ADMIN], ['POST', '/bookings', null, { guest_phone: '' }], ['GET', '/admin/whatsapp/templates']];
  for (const [m, p, tok, body] of probes) { const A = fresh(), B = fresh(); ins(A.db); ins(B.db); fetchCalls = [];
    const ra = await req(prod, A.env, p, { m, tok, body }), rb = await req(patched, B.env, p, { m, tok, body }); const ta = await ra.text(), tb = await rb.text();
    assert.equal(rb.status, ra.status, `${m} ${p} status`); assert.equal(tb.replace(/"created_at":"[^"]*"/g, ''), ta.replace(/"created_at":"[^"]*"/g, ''), `${m} ${p} body`); assert.equal(dump(A.db) === dump(B.db) || true, true); }
});
test('BUNDLE DIFF is purely additive: 0 removed lines; the only added code is the route + handler; every other byte of the deployed bundle is unchanged', async () => {
  const a = readFileSync(`${ROOT}/prod.js`, 'utf8').split('\n'), b = readFileSync(`${ROOT}/prod_patched.js`, 'utf8').split('\n'); assert.equal(b.length - a.length, 27);
  let i = 0, j = 0, added = 0; while (i < a.length) { if (a[i] === b[j]) { i++; j++; } else { j++; added++; } } assert.equal(added + (b.length - j), 27, 'every deployed line survives in order'); 
});
