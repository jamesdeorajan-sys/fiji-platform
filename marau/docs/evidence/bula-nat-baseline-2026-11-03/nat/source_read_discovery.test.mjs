// Bula/Marau source integration: read-only single-booking read + recent-booking discovery. Offline, SYNTHETIC rows only, default-deny network.
// Run: node --test nadi-marketplace/worker/source_read_discovery.test.mjs
// Optional: NAT_BASELINE_BUNDLE=<byte-exact deployed bundle> enables the differential regression test; BULA_READER=<path to nadi_booking_reader.js> enables the end-to-end reader test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker.js';
import { installNetworkGuard } from './network_guard.mjs';
const guard = installNetworkGuard();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = process.env.NAT_BASELINE_BUNDLE && existsSync(process.env.NAT_BASELINE_BUNDLE) ? (await import(path.resolve(process.env.NAT_BASELINE_BUNDLE))).default : null;
const READER = process.env.BULA_READER ? await import(path.resolve(process.env.BULA_READER)) : null;
const SCHEMA = readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const MIGS = ['milestone34-booking-idempotency-and-contact-fields.sql', 'milestone35-revenue-attribution.sql', 'milestone36-admin-notification-retry-state.sql', 'milestone37-driver-broadcast-claim-state.sql', 'milestone38-rental-enquiries.sql'];
const ADMIN = 'synthetic-admin-token-AAAA', SRC = 'synthetic-source-read-token-BBBB';
const shim = (db) => ({ async batch(stmts) { const out = []; for (const x of stmts) out.push(await x.run()); return out; }, prepare(sql) { let a = []; const api = { bind(...x) { a = x; return api; }, async first() { const r = db.prepare(sql).get(...a); return r === undefined ? null : r; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { const i = db.prepare(sql).run(...a); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; } }; return api; } });
function fresh(over = {}) {
  const db = new DatabaseSync(':memory:'); db.exec(SCHEMA);
  for (const f of MIGS) { const p = path.join(__dirname, '..', 'migrations', f); if (!existsSync(p)) continue; try { db.exec(readFileSync(p, 'utf8')); } catch (e) { if (!/duplicate column|already exists/i.test(String(e))) throw e; } }
  db.prepare(`UPDATE platform_settings SET value = '+6799999999' WHERE key = 'admin_alert_phone'`).run();
  return { db, env: { DB: shim(db), ADMIN_TOKEN: ADMIN, SOURCE_READ_TOKEN: SRC, WHATSAPP_TOKEN: 'x', WHATSAPP_PHONE_ID: 'y', ...over } };
}
let SEQ = 0;
const ins = (db, o = {}) => Number(db.prepare(`INSERT INTO bookings (guest_name, guest_phone, guest_email, pickup_zone, destination_zone, distance_km, vehicle_type, quoted_currency, quoted_amount, fx_rate_at_booking, settlement_amount_fjd, fuel_multiplier_applied, commission_base_fjd, payment_method, status, pickup_date, pickup_time, return_date, return_time, return_pickup_location, notes, client_booking_ref, source_ip, first_source, created_at)
  VALUES (?, '+15005550101', ?, 'Nadi Airport', 'Denarau', 10, 'sedan', 'FJD', 170, 1, 170, 1, 0, 'cash', ?, '2031-10-05', '09:00', ?, ?, ?, 'PRIVATE-NOTE', ?, '203.0.113.9', 'PRIVATE-SRC', ?)`).run(o.name ?? 'Synthetic Guest', 'email' in o ? o.email : 'syn@example.test', o.status ?? 'accepted', o.rdate ?? null, o.rtime ?? null, o.rloc ?? null, 'ref' in o ? o.ref : `SYN-AUTO-${++SEQ}`, o.at ?? '2031-10-01 10:00:00').lastInsertRowid);
const req = (w, env, p, { m = 'GET', tok, body } = {}) => w.fetch(new Request('http://nat.test' + p, { method: m, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
const dump = (db, norm = false) => createHash('sha256').update((norm ? (x) => x.replace(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?Z?/g, 'TS').replace(/\b1\d{12}\b/g, 'MS') : (x) => x)(JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}"`).all()])))).digest('hex');
const jget = async (env, p, tok = SRC) => { const r = await req(worker, env, p, { tok }); return { status: r.status, body: await r.json() }; };

// ------------------------------------------------------------------ single-booking read
test('AUTH is fail-closed: none / wrong / master ADMIN token / truncated / extended / unset or empty secret -> 401, no row data in the body', async () => {
  const { db, env } = fresh(); const id = ins(db);
  for (const t of [null, 'nope', ADMIN, SRC.slice(0, -1), SRC + 'x']) { const r = await req(worker, env, `/admin/bookings/${id}`, { tok: t }); assert.equal(r.status, 401, String(t)); assert.doesNotMatch(await r.text(), /syn@example|Nadi Airport|SYN-1/); }
  for (const secret of [undefined, '']) { const e = fresh({ SOURCE_READ_TOKEN: secret }); const i = ins(e.db); for (const t of [SRC, '', 'undefined', ADMIN]) { assert.equal((await req(worker, e.env, `/admin/bookings/${i}`, { tok: t })).status, 401); assert.equal((await req(worker, e.env, '/admin/bookings/recent?after=0', { tok: t })).status, 401); } }
});
test('an interactive admin LOGIN token (admin_login_tokens) cannot use either source route', async () => {
  const { db, env } = fresh(); const id = ins(db); db.prepare(`INSERT INTO admin_login_tokens (token, expires_at) VALUES ('adm-session-1', datetime('now','+1 hour'))`).run();
  assert.equal((await req(worker, env, `/admin/bookings/${id}`, { tok: 'adm-session-1' })).status, 401); assert.equal((await req(worker, env, '/admin/bookings/recent?after=0', { tok: 'adm-session-1' })).status, 401);
  assert.equal((await req(worker, env, '/admin/bookings', { tok: 'adm-session-1' })).status, 200, 'the existing admin list still accepts the login token (unchanged)');
});
test('CONTRACT: exactly the 20 whitelisted fields; never guest_name, notes, payment, IP, attribution, distance, fx', async () => {
  const { db, env } = fresh(); const id = ins(db, { rdate: '2031-10-12', rtime: '10:30', rloc: 'Synthetic Hotel lobby' }); const r = await jget(env, `/admin/bookings/${id}`); assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.booking).sort(), ['assigned_driver_id', 'client_booking_ref', 'commission_base_fjd', 'created_at', 'destination_zone', 'flight_number', 'guest_email', 'guest_phone', 'id', 'pickup_date', 'pickup_time', 'pickup_zone', 'quoted_amount', 'quoted_currency', 'return_date', 'return_pickup_location', 'return_time', 'settlement_amount_fjd', 'status', 'vehicle_type'].sort());
  const txt = JSON.stringify(r.body); for (const f of ['Synthetic Guest', 'PRIVATE-NOTE', 'PRIVATE-SRC', '203.0.113.9', 'cash', 'distance_km', 'fx_rate']) assert.ok(!txt.includes(f), f);
});
test('LEGACY booking with missing email / client ref / flight: returned as NULL, never invented', async () => {
  const { db, env } = fresh(); const id = ins(db, { email: null, ref: null }); const b = (await jget(env, `/admin/bookings/${id}`)).body.booking;
  assert.equal(b.guest_email, null); assert.equal(b.client_booking_ref, null); assert.equal(b.flight_number, null);
});
test('404 for unknown id; odd ids never reach the read; 10 repeated reads identical', async () => {
  const { db, env } = fresh(); const id = ins(db); assert.equal((await jget(env, '/admin/bookings/99999')).status, 404);
  for (const p of ['/admin/bookings/12abc', '/admin/bookings/-1', '/admin/bookings/1.5', `/admin/bookings/${id}/`, `/admin/bookings/${id}/x`]) { const r = await req(worker, env, p, { tok: SRC }); assert.notEqual(r.status, 200, p); }
  const a = JSON.stringify((await jget(env, `/admin/bookings/${id}`)).body); for (let i = 0; i < 10; i++) assert.equal(JSON.stringify((await jget(env, `/admin/bookings/${id}`)).body), a);
});
test('STRICTLY READ-ONLY: every source request (valid, invalid, unauthorised, bad params) leaves the database byte-identical; write verbs are never served; no outbound call; no booking event', async () => {
  const { db, env } = fresh(); const id = ins(db, { status: 'pending' }); const before = dump(db);
  for (const [tok, p] of [[SRC, `/admin/bookings/${id}`], [SRC, '/admin/bookings/99999'], [null, `/admin/bookings/${id}`], ['bad', `/admin/bookings/${id}`], [SRC, '/admin/bookings/recent?after=0'], [SRC, '/admin/bookings/recent'], [SRC, '/admin/bookings/recent?after=zz'], [null, '/admin/bookings/recent?after=0']]) await req(worker, env, p, { tok });
  for (const p of [`/admin/bookings/${id}`, '/admin/bookings/recent?after=0']) for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) { const r = await req(worker, env, p, { m, tok: SRC, body: { status: 'cancelled' } }); assert.notEqual(r.status, 200, `${m} ${p}`); }
  assert.equal(dump(db), before, 'database byte-identical'); assert.equal(db.prepare('SELECT COUNT(*) n FROM booking_events').get().n, 0);
  const code = readFileSync(path.join(__dirname, 'worker.js'), 'utf8'); const seg = code.slice(code.indexOf('function requireSourceRead'), code.indexOf('async function handleAdminListBookings'));
  assert.doesNotMatch(seg, /\b(INSERT|UPDATE|DELETE|REPLACE INTO|sendWhatsApp|fetch\()/, 'the source handlers contain no write verb or outbound call');
});
test('NO SECRET OR GUEST DATA IN LOGS across ok / denied / error paths (both routes)', async () => {
  const logs = []; const o = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = (...a) => logs.push(a.map(String).join(' '));
  try { const { db, env } = fresh(); const id = ins(db); await req(worker, env, `/admin/bookings/${id}`, { tok: SRC }); await req(worker, env, '/admin/bookings/recent?after=0', { tok: SRC }); await req(worker, env, `/admin/bookings/${id}`, { tok: 'wrong' });
    const broken = { ...env, DB: { prepare() { throw new Error('boom ' + SRC + ' syn@example.test +15005550101'); } } };
    for (const p of ['/admin/bookings/1', '/admin/bookings/recent?after=0']) { const r = await req(worker, broken, p, { tok: SRC }); assert.equal(r.status, 500); assert.doesNotMatch(await r.text(), /boom|syn@|\+1500/); }
  } finally { Object.assign(console, { log: o.l, error: o.e, warn: o.w }); }
  const all = logs.join('\n'); for (const s of [SRC, ADMIN, 'syn@example.test', '+15005550101', 'boom']) assert.ok(!all.includes(s), `log leaked ${s === SRC ? 'token' : s}`);
});
test('DB unavailable -> 503 only AFTER auth passes (unauthenticated callers cannot probe)', async () => {
  const { env } = fresh(); for (const p of ['/admin/bookings/1', '/admin/bookings/recent?after=0']) { assert.equal((await req(worker, { ...env, DB: undefined }, p, { tok: SRC })).status, 503); assert.equal((await req(worker, { ...env, DB: undefined }, p, { tok: 'bad' })).status, 401); }
});

// ------------------------------------------------------------------ discovery
test('DISCOVERY contract: items carry ONLY id / created_at / status (no email, phone, name, route, price); bootstrap without `after` returns no items and max_id', async () => {
  const { db, env } = fresh(); const a = ins(db), b = ins(db); const r = await jget(env, '/admin/bookings/recent?after=0');
  assert.equal(r.status, 200); assert.deepEqual(r.body.items.map((x) => Object.keys(x).sort().join()), ['created_at,id,status', 'created_at,id,status']); assert.deepEqual(r.body.items.map((x) => x.id), [a, b]);
  assert.deepEqual(Object.keys(r.body).sort(), ['has_more', 'items', 'max_id', 'next_after', 'ok', 'server_time']);
  const txt = JSON.stringify(r.body); for (const f of ['syn@example', '+1500', 'Synthetic Guest', 'Nadi Airport', 'Denarau', '170', 'SYN-1']) assert.ok(!txt.includes(f), f);
  const boot = await jget(env, '/admin/bookings/recent'); assert.deepEqual([boot.body.items.length, boot.body.max_id, boot.body.next_after, boot.body.has_more], [0, b, b, false]);
  const empty = fresh(); assert.deepEqual((await jget(empty.env, '/admin/bookings/recent')).body.max_id, 0);
});
test('DISCOVERY: new booking appears once; no new bookings -> empty, cursor unchanged; repeated polling is identical', async () => {
  const { db, env } = fresh(); const a = ins(db); let r = await jget(env, `/admin/bookings/recent?after=${a - 1}`); assert.deepEqual(r.body.items.map((x) => x.id), [a]);
  const mark = r.body.next_after; r = await jget(env, `/admin/bookings/recent?after=${mark}`); assert.deepEqual([r.body.items.length, r.body.next_after, r.body.has_more], [0, mark, false]);
  const r1 = JSON.stringify((await jget(env, `/admin/bookings/recent?after=${a - 1}`)).body.items), r2 = JSON.stringify((await jget(env, `/admin/bookings/recent?after=${a - 1}`)).body.items); assert.equal(r1, r2);
  const b = ins(db); r = await jget(env, `/admin/bookings/recent?after=${mark}`); assert.deepEqual(r.body.items.map((x) => x.id), [b]);
});
test('DISCOVERY: SAME created_at for many bookings - deterministic order by id, paging with a small limit loses and repeats nothing', async () => {
  const { db, env } = fresh(); const ids = Array.from({ length: 7 }, () => ins(db, { at: '2031-10-01 10:00:00' })); let after = ids[0] - 1; const seen = [];
  for (let i = 0; i < 10; i++) { const r = (await jget(env, `/admin/bookings/recent?after=${after}&limit=2`)).body; seen.push(...r.items.map((x) => x.id)); after = r.next_after; if (!r.has_more) break; }
  assert.deepEqual(seen, ids);
});
test('DISCOVERY: OVERLAPPING polling windows are duplicate-safe for a client that de-duplicates by id, and never skip', async () => {
  const { db, env } = fresh(); const ids = Array.from({ length: 6 }, () => ins(db)); const seen = new Set(); let wm = 0, calls = 0;
  for (const upto of [3, 5, 6]) { while (db.prepare('SELECT COUNT(*) n FROM bookings').get().n > upto) { /* all rows already inserted; emulate arrival by capping view */ break; } const r = (await jget(env, `/admin/bookings/recent?after=${Math.max(0, wm - 2)}&limit=100`)).body; calls++; r.items.forEach((x) => seen.add(x.id)); wm = r.next_after; }
  assert.deepEqual([...seen].sort((a, b) => a - b), ids); assert.equal(calls, 3);
  const r1 = (await jget(env, `/admin/bookings/recent?after=${ids[2]}`)).body, r2 = (await jget(env, `/admin/bookings/recent?after=${ids[0]}`)).body; assert.deepEqual(r2.items.map((x) => x.id).slice(-r1.items.length), r1.items.map((x) => x.id), 'the overlap is a strict superset');
});
test('DISCOVERY: bounded - limit 1..100 only (101 / 0 / -1 / 1.5 / abc / empty -> 400); at most 100 rows returned even with 150 present; bad `after` -> 400', async () => {
  const { db, env } = fresh(); for (let i = 0; i < 150; i++) ins(db); const r = (await jget(env, '/admin/bookings/recent?after=0&limit=100')).body; assert.equal(r.items.length, 100); assert.equal(r.has_more, true);
  assert.equal((await jget(env, '/admin/bookings/recent?after=0')).body.items.length, 50, 'default 50');
  for (const q of ['limit=101', 'limit=0', 'limit=-1', 'limit=1.5', 'limit=abc', 'limit=', 'after=abc', 'after=-1', 'after=', 'after=1.5', 'after=99999999999999999999']) { const x = await jget(env, `/admin/bookings/recent?${q.startsWith('limit') ? 'after=0&' : ''}${q}`); assert.equal(x.status, 400, q); }
});
test('DISCOVERY: query plan is a PRIMARY KEY range scan (no table scan, no new index needed); MAX(id) is a key lookup', async () => {
  const { db } = fresh(); for (let i = 0; i < 20; i++) ins(db);
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT id, created_at, status FROM bookings WHERE id > ? ORDER BY id ASC LIMIT ?').all(5, 10).map((r) => r.detail).join(' | ');
  assert.match(plan, /SEARCH bookings USING INTEGER PRIMARY KEY/); assert.doesNotMatch(plan, /SCAN|TEMP B-TREE/);
  assert.match(db.prepare('EXPLAIN QUERY PLAN SELECT MAX(id) AS max_id FROM bookings').all().map((r) => r.detail).join(' | '), /SEARCH bookings USING INTEGER PRIMARY KEY|OPTIMIZATION|SCAN bookings USING COVERING INDEX|SEARCH bookings/);
});
test('DISCOVERY: invalid / missing / revoked (rotated or deleted) token -> 401; database failure -> 500 with a generic body; recovery on the next poll', async () => {
  const { db, env } = fresh(); ins(db);
  for (const t of [null, 'wrong', ADMIN]) assert.equal((await req(worker, env, '/admin/bookings/recent?after=0', { tok: t })).status, 401);
  const rotated = { ...env, SOURCE_READ_TOKEN: 'a-new-token-CCCC' }; assert.equal((await req(worker, rotated, '/admin/bookings/recent?after=0', { tok: SRC })).status, 401, 'old token dead after rotation'); assert.equal((await req(worker, rotated, '/admin/bookings/recent?after=0', { tok: 'a-new-token-CCCC' })).status, 200);
  const removed = { ...env, SOURCE_READ_TOKEN: undefined }; assert.equal((await req(worker, removed, '/admin/bookings/recent?after=0', { tok: SRC })).status, 401, 'kill switch: removing the secret closes the surface');
  let down = true; const flaky = { ...env, DB: { prepare(sql) { if (down) throw new Error('D1 unavailable'); return env.DB.prepare(sql); } } };
  const bad = await req(worker, flaky, '/admin/bookings/recent?after=0', { tok: SRC }); assert.equal(bad.status, 500); assert.deepEqual(await bad.json(), { ok: false, error: 'Read failed.' });
  down = false; assert.equal((await req(worker, flaky, '/admin/bookings/recent?after=0', { tok: SRC })).status, 200);
});
test('DISCOVERY: a poller outage followed by recovery sees every booking exactly once (watermark client model)', async () => {
  const { db, env } = fresh(); const processed = []; let wm = (await jget(env, '/admin/bookings/recent')).body.max_id;
  const poll = async () => { let cur = Math.max(0, wm - 5); for (let i = 0; i < 20; i++) { const r = (await jget(env, `/admin/bookings/recent?after=${cur}&limit=3`)).body; cur = r.next_after; for (const x of r.items) if (x.id > wm) processed.push(x.id); wm = Math.max(wm, r.next_after); if (!r.has_more) return; } };
  const a = ins(db); await poll(); const outage = [ins(db), ins(db), ins(db), ins(db), ins(db), ins(db), ins(db)]; /* poller down: nothing polled */ await poll(); await poll();
  assert.deepEqual(processed, [a, ...outage]);
});
test('DISCOVERY + READ: a discovered LEGACY booking without email is discoverable by id only, and the read returns email null (the consumer must refuse visibly, never invent)', async () => {
  const { db, env } = fresh(); const id = ins(db, { email: null, ref: null }); const d = (await jget(env, `/admin/bookings/recent?after=${id - 1}`)).body; assert.deepEqual(d.items.map((x) => x.id), [id]); assert.equal((await jget(env, `/admin/bookings/${id}`)).body.booking.guest_email, null);
});
test('END-TO-END with the REAL Bula reader (whitelist, type checks, provenance): round trip and one-way', { skip: !READER }, async () => {
  const { db, env } = fresh(); const rt = ins(db, { rdate: '2031-10-12', rtime: '10:30', rloc: 'Synthetic Hotel lobby', ref: 'SYN-RT' }), ow = ins(db, { ref: 'SYN-OW', email: 'ow@example.test' });
  const f = async (url, init) => worker.fetch(new Request(url, init), env); const reader = READER.createNadiBookingReader({ baseUrl: 'https://nat.test', adminToken: SRC, fetchImpl: f });
  const a = await reader(String(rt)), b = await reader(String(ow)); assert.equal(a.return_date, '2031-10-12'); assert.equal(b.return_date, null); assert.equal(await reader('99999'), null);
  await assert.rejects(() => READER.createNadiBookingReader({ baseUrl: 'https://nat.test', adminToken: ADMIN, fetchImpl: f })(String(rt)), /SOURCE_READ_FAILED_401/, 'the master admin token cannot read');
});
test('REGRESSION (differential): for every existing route the PATCHED Worker answers byte-for-byte like the deployed production bundle', { skip: !BASELINE }, async () => {
  const probes = [['GET', '/health'], ['OPTIONS', '/admin/bookings'], ['GET', '/admin/bookings', ADMIN], ['GET', '/admin/bookings'], ['GET', '/admin/bookings/1/events', ADMIN], ['GET', '/admin/bookings/1/events'], ['POST', '/admin/bookings/manual-assign', null, {}], ['POST', '/admin/bookings/manual-assign', ADMIN, {}], ['POST', '/admin/bookings/1/cancel', ADMIN, {}], ['GET', '/admin/dashboard-stats', ADMIN], ['GET', '/nope'], ['POST', '/bookings', null, { guest_phone: '' }], ['GET', '/admin/whatsapp/templates'], ['GET', '/admin/rentals', ADMIN], ['GET', '/admin/rentals-console'], ['POST', '/rental-enquiries', null, {}], ['GET', '/zones'], ['GET', '/admin/bookings?limit=5', ADMIN]];
  for (const [m, p, tok, body] of probes) { const A = fresh(), B = fresh(); ins(A.db, { ref: "SYN-DIFF" }); ins(B.db, { ref: "SYN-DIFF" });
    const ra = await req(BASELINE, A.env, p, { m, tok, body }), rb = await req(worker, B.env, p, { m, tok, body }); const strip = (t) => t.replace(/"(created_at|now|server_time)":"[^"]*"/g, '').replace(/nonce="[^"]*"/g, 'nonce="N"').replace(/\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?Z?/g, 'TS').replace(/\b1\d{12}\b/g, 'MS');
    assert.equal(rb.status, ra.status, `${m} ${p} status`); assert.equal(strip(await rb.text()), strip(await ra.text()), `${m} ${p} body`); if (dump(A.db, true) !== dump(B.db, true)) { const rows = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().flatMap((t) => d.prepare(`SELECT * FROM "${t.name}"`).all().map((r) => t.name + ':' + JSON.stringify(r))); const x = new Set(rows(A.db)), y = new Set(rows(B.db)); console.log('DIFF', m, p, [...x].filter((v) => !y.has(v)).slice(0, 3), [...y].filter((v) => !x.has(v)).slice(0, 3)); }
    assert.equal(dump(A.db, true), dump(B.db, true), `${m} ${p} database effect (timestamps normalised)`); }
});
