// Missions 4+5: polling discovery, visible missing-email refusals, source-fidelity labels. SYNTHETIC only; the NAT source is a faithful double of the patched read-only routes (the real routes are tested in the NAT worker suite). No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';
import { mkEnv, call, one, count, cutover, staff, ADMIN } from './m3_helpers.mjs';
import { natBooking, NAT_ORIGIN } from './source_fixtures.mjs';
import { fieldProvenance } from './source_fidelity.js';
import { collectHealth } from './health.js';
import { loadConfig } from './config.js';

const TOKEN = 'synthetic-source-token';
function nat(store, ctl = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(String(url)); calls.push({ method: init.method || 'GET', path: u.pathname + u.search, redirect: init.redirect, hasBody: init.body != null });
    if ((init.method || 'GET') !== 'GET') throw new Error('SYNTHETIC NAT IS READ-ONLY');
    if (ctl.down) return new Response('down', { status: 503 });
    const auth = (init.headers || {}).authorization; if (auth !== `Bearer ${ctl.token ?? TOKEN}`) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    if (u.pathname === '/admin/bookings/recent') {
      const ids = [...store.keys()].sort((a, b) => a - b); const maxId = ids.length ? ids[ids.length - 1] : 0;
      const afterQ = u.searchParams.get('after'); const limit = Number(u.searchParams.get('limit') || 50);
      if (ctl.malformed) return new Response(JSON.stringify({ ok: true, items: 'nope' }), { status: 200 });
      if (afterQ === null) return new Response(JSON.stringify({ ok: true, items: [], next_after: maxId, max_id: maxId, has_more: false, server_time: 'x' }), { status: 200 });
      const after = Number(afterQ); const rows = ids.filter((i) => i > after); const page = rows.slice(0, limit);
      let items = page.map((i) => ({ id: i, created_at: store.get(i).created_at, status: store.get(i).status }));
      if (ctl.dupes) items = [...items, ...items];
      return new Response(JSON.stringify({ ok: true, items, next_after: page.length ? page[page.length - 1] : after, max_id: maxId, has_more: rows.length > page.length, server_time: 'x' }), { status: 200 });
    }
    const id = Number(u.pathname.split('/').pop()); if (ctl.failRead && ctl.failRead.has(id)) return new Response('x', { status: 503 });
    const row = store.get(id); return row ? new Response(JSON.stringify({ ok: true, booking: row }), { status: 200 }) : new Response(JSON.stringify({ ok: false }), { status: 404 });
  };
  f.calls = calls; return f;
}
function setup(over = {}, ctl = {}) {
  const store = new Map(); const f = nat(store, ctl);
  const env = mkEnv({ BULA_SOURCE_DISCOVERY: 'on', NADI_SOURCE_FETCH: f, NADI_SOURCE_ADMIN_TOKEN: ctl.envToken ?? TOKEN, ...over });
  env.__store = store; env.__ctl = ctl; env.__f = f; return { env, store, f, ctl };
}
const poll = async (env) => { let p; await worker.scheduled({}, env, { waitUntil: (x) => { p = x; } }); await p; };
const state = (env) => env.DB.prepare('SELECT * FROM bula_source_discovery_state WHERE id = 1').first();
const add = (store, id, over = {}) => store.set(id, natBooking(id, over));
const sessions = (env) => count(env, 'marau_real_booking_links');
const refusals = (env, w = '1=1') => count(env, 'bula_source_refusals', w);
async function boot(t) { add(t.store, 1); add(t.store, 2); await poll(t.env); return state(t.env); }   // bootstrap at max_id 2 (history is not mirrored)

test('DEFAULT OFF: with the flag unset the scheduled run makes no discovery call and creates nothing', async () => {
  const t = setup({ BULA_SOURCE_DISCOVERY: undefined }); add(t.store, 1); await poll(t.env); assert.equal(t.f.calls.length, 0); assert.equal(await state(t.env), null); assert.equal(loadConfig({}).sourceDiscoveryEnabled, false);
  for (const v of ['yes', 'ON', '0', 'false', '']) assert.equal(loadConfig({ BULA_SOURCE_DISCOVERY: v }).sourceDiscoveryEnabled, false, v);
});
test('BOOTSTRAP: first poll only records the watermark (max id); existing history is NOT mirrored', async () => {
  const t = setup(); const s = await boot(t); assert.equal(s.watermark, 2); assert.equal(await sessions(t.env), 0); assert.equal(await refusals(t.env), 0);
});
test('NEW BOOKING: discovered, mirrored through the existing idempotent path, one guest journey, snapshot carries field provenance; poll is GET-only, redirect-manual, bodyless', async () => {
  const t = setup(); await cutover(t.env); await boot(t); add(t.store, 3); await poll(t.env);
  assert.equal(await sessions(t.env), 1); assert.equal((await state(t.env)).watermark, 3);
  assert.equal(await count(t.env, 'bula_credit_ledger', "type = 'granted'"), 1, 'one welcome grant'); assert.ok(await count(t.env, 'bula_outbox') >= 1);
  const snap = await t.env.DB.prepare('SELECT provenance_json FROM bula_booking_snapshots').first(); const fp = JSON.parse(snap.provenance_json).fieldProvenance;
  assert.equal(fp.flight, 'SOURCE_CONFIRMED'); assert.equal(fp.passengers, 'NOT_APPLICABLE'); assert.equal(fp.returnDate, 'SOURCE_MISSING');
  for (const c of t.f.calls) { assert.equal(c.method, 'GET'); assert.equal(c.redirect, 'manual'); assert.equal(c.hasBody, false); }
});
test('MULTIPLE bookings with the SAME timestamp: all mirrored exactly once, in id order', async () => {
  const t = setup(); await boot(t); for (const i of [3, 4, 5, 6]) add(t.store, i, { created_at: '2026-11-01T01:00:00Z' }); await poll(t.env);
  assert.equal(await sessions(t.env), 4); assert.equal((await state(t.env)).watermark, 6);
  const { results } = await t.env.DB.prepare('SELECT source_booking_ref r FROM marau_real_booking_links ORDER BY rowid').all(); assert.deepEqual(results.map((x) => x.r), ['3', '4', '5', '6']);
});
test('REPEATED polling and OVERLAPPING windows create no duplicate session, mirror row, grant or job; no new bookings -> nothing changes', async () => {
  const t = setup(); await cutover(t.env); await boot(t); add(t.store, 3); add(t.store, 4); await poll(t.env);
  const snap = async () => JSON.stringify([await sessions(t.env), await count(t.env, 'marau_test_bookings'), await count(t.env, 'bula_credit_ledger'), await count(t.env, 'bula_outbox'), await count(t.env, 'bula_booking_snapshots'), (await state(t.env)).watermark]);
  const a = await snap(); for (let i = 0; i < 4; i++) await poll(t.env); assert.equal(await snap(), a);
  assert.ok(t.f.calls.some((c) => /after=0&|after=1&|after=2&/.test(c.path)), 'the overlap window re-reads earlier ids');
});
test('DUPLICATE source results (the same id twice in one response) are collapsed', async () => {
  const t = setup({}, { dupes: true }); await boot(t); add(t.store, 3); await poll(t.env); assert.equal(await sessions(t.env), 1); assert.equal(await count(t.env, 'marau_test_bookings'), 1);
});
test('AUTH FAILURES fail closed and recover: wrong / missing / revoked token -> no mirror, watermark unchanged, failure counted with a CODE only; then recovery picks up everything', async () => {
  const t = setup(); await boot(t); add(t.store, 3); add(t.store, 4);
  for (const envToken of ['wrong-token', '', undefined]) { t.env.NADI_SOURCE_ADMIN_TOKEN = envToken; await poll(t.env); }
  assert.equal(await sessions(t.env), 0); const s = await state(t.env); assert.equal(s.watermark, 2); assert.match(s.last_error, /^DISCOVERY_HTTP_401$|^POLL_FAILED$/);
  t.ctl.token = 'rotated'; t.env.NADI_SOURCE_ADMIN_TOKEN = TOKEN; await poll(t.env);   // NAT revoked the old token
  assert.ok((await state(t.env)).consecutive_failures >= 1); assert.equal(await sessions(t.env), 0);
  t.ctl.token = TOKEN; await poll(t.env); assert.equal(await sessions(t.env), 2); const ok = await state(t.env); assert.deepEqual([ok.consecutive_failures, ok.last_error, ok.watermark], [0, null, 4]);
});
test('NAT OUTAGE then Bula recovery: bookings saved while NAT discovery/db is down are all mirrored exactly once afterwards', async () => {
  const t = setup(); await boot(t); add(t.store, 3); await poll(t.env); t.ctl.down = true; for (const i of [4, 5, 6, 7]) add(t.store, i); await poll(t.env); await poll(t.env);
  assert.equal(await sessions(t.env), 1); assert.equal((await state(t.env)).consecutive_failures, 2); assert.equal((await state(t.env)).watermark, 3);
  t.ctl.down = false; await poll(t.env); assert.equal(await sessions(t.env), 5); assert.equal(await count(t.env, 'marau_test_bookings'), 5);
});
test('MALFORMED discovery response fails closed (nothing mirrored, watermark unchanged)', async () => {
  const t = setup({}, {}); await boot(t); add(t.store, 3); t.ctl.malformed = true; await poll(t.env); assert.equal(await sessions(t.env), 0); assert.equal((await state(t.env)).watermark, 2); assert.match((await state(t.env)).last_error, /DISCOVERY_MALFORMED/);
});
test('TRANSIENT single-booking read failure: the watermark does NOT pass the failed booking; later bookings are not lost; recovery mirrors it', async () => {
  const t = setup({}, { failRead: new Set([4]) }); await boot(t); add(t.store, 3); add(t.store, 4); add(t.store, 5); await poll(t.env);
  assert.equal((await state(t.env)).watermark, 3); assert.equal(await sessions(t.env), 2, '3 and 5 mirrored'); assert.equal(await refusals(t.env, "source_booking_ref = '4' AND reason = 'SOURCE_READ_FAILED'"), 1);
  t.ctl.failRead.clear(); await poll(t.env); assert.equal(await sessions(t.env), 3); assert.equal((await state(t.env)).watermark, 5);
  assert.equal(await refusals(t.env, "state = 'open'"), 0, 'the transient refusal auto-resolved'); assert.equal(await refusals(t.env, "resolved_by = 'auto:mirrored'"), 1);
});
test('PERSISTENT read failure cannot block discovery forever (attempt cap) and stays staff-visible', async () => {
  const t = setup({}, { failRead: new Set([3]) }); await boot(t); add(t.store, 3); for (let i = 0; i < 11; i++) await poll(t.env); add(t.store, 4); await poll(t.env);
  assert.equal(await sessions(t.env), 1, 'booking 4 flowed past the stuck booking 3'); assert.equal((await state(t.env)).watermark, 4); assert.equal(await refusals(t.env, "source_booking_ref = '3' AND state = 'open'"), 1);
});
test('LEGACY booking WITHOUT EMAIL: counted, staff-visible refusal with the reason, NO guest journey, NO invented email, NOTHING sent; the next booking is unaffected', async () => {
  const t = setup(); await cutover(t.env); await boot(t); add(t.store, 3, { guest_email: null, client_booking_ref: null }); add(t.store, 4); await poll(t.env);
  assert.equal(await sessions(t.env), 1, 'only the booking with contact was activated'); assert.equal(await count(t.env, 'marau_real_booking_links', "source_booking_ref = '3'"), 0);
  assert.equal(await count(t.env, 'guest_sessions'), 1); assert.equal(await count(t.env, 'bula_outbox', "booking_ref LIKE '%-3'"), 0); assert.equal(await count(t.env, 'bula_credit_ledger', "party_key LIKE '%-3'"), 0);
  const r = await t.env.DB.prepare("SELECT * FROM bula_source_refusals WHERE source_booking_ref = '3'").first(); assert.deepEqual([r.reason, r.detail, r.state, r.source_status], ['MISSING_GUEST_CONTACT', 'missing:guest_email', 'open', 'pending']);
  assert.ok(!JSON.stringify(r).includes('@'), 'no address stored');
  assert.equal((await state(t.env)).watermark, 4, 'a permanent refusal does not block discovery');
  for (let i = 0; i < 3; i++) await poll(t.env); assert.equal(await refusals(t.env), 1, 'one row however often it is re-seen'); assert.equal(await count(t.env, 'bula_audit', "action LIKE 'email%'"), 0);
  assert.ok(t.f.calls.every((c) => c.method === 'GET'));
});
test('MISSING-EMAIL VISIBILITY: staff queue shows the count and item (no contact data); health raises an alert; staff can mark it handled with a note (audited); guests cannot', async () => {
  const t = setup(); await boot(t); add(t.store, 3, { guest_email: '', guest_phone: null }); await poll(t.env);
  const tok = await staff(t.env, 'ops1', 'ops'); const q = await one(await call(t.env, 'GET', '/preview/admin/bula/queue', { staff: tok }));
  assert.equal(q.status, 200); assert.equal(q.data.sourceRefusals.open, 1); assert.deepEqual(q.data.sourceRefusals.items.map((x) => [x.ref, x.reason, x.detail]), [['3', 'MISSING_GUEST_CONTACT', 'missing:guest_email,missing:guest_phone']]); assert.ok(!JSON.stringify(q.data.sourceRefusals).includes('guest3'));
  const h = await collectHealth(t.env.DB, Date.now()); assert.ok(h.alerts.some((a) => a.code === 'SOURCE_BOOKING_REFUSED_NEEDS_STAFF' && a.count === 1));
  assert.equal((await call(t.env, 'POST', '/preview/admin/bula/source-refusals/3/resolve', { admin: false, body: { note: 'x' } })).status, 401);
  const done = await one(await call(t.env, 'POST', '/preview/admin/bula/source-refusals/3/resolve', { staff: tok, body: { note: 'Phoned guest; manual follow-up' } })); assert.equal(done.status, 200);
  assert.equal((await one(await call(t.env, 'POST', '/preview/admin/bula/source-refusals/3/resolve', { staff: tok, body: { note: 'again' } }))).status, 409);
  assert.equal(await count(t.env, 'bula_audit', "action = 'source_refusal_resolved'"), 1); const q2 = await one(await call(t.env, 'GET', '/preview/admin/bula/queue', { staff: tok })); assert.equal(q2.data.sourceRefusals.open, 0);
  assert.ok((await collectHealth(t.env.DB, Date.now())).alerts.every((a) => a.code !== 'SOURCE_BOOKING_REFUSED_NEEDS_STAFF'));
});
test('MISSING QUOTED AMOUNT is also a visible refusal, never a guessed price', async () => {
  const t = setup(); await boot(t); add(t.store, 3, { quoted_amount: null }); await poll(t.env);
  assert.equal(await sessions(t.env), 0); assert.equal((await t.env.DB.prepare("SELECT reason FROM bula_source_refusals WHERE source_booking_ref = '3'").first()).reason, 'MISSING_QUOTED_AMOUNT');
});
test('SOURCE FIDELITY: labels never infer - missing flight / client ref / dates stay SOURCE_MISSING; passengers, luggage, add-ons, discount are NOT_APPLICABLE; a supplied value is SOURCE_CONFIRMED', () => {
  const fp = fieldProvenance(natBooking(9, { flight_number: null, client_booking_ref: ' ', pickup_time: null, guest_email: null }));
  assert.deepEqual([fp.flight, fp.clientReference, fp.pickupTime, fp.guestEmail], ['SOURCE_MISSING', 'SOURCE_MISSING', 'SOURCE_MISSING', 'SOURCE_MISSING']);
  assert.deepEqual([fp.passengers, fp.luggage, fp.addOns, fp.discount], ['NOT_APPLICABLE', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'NOT_APPLICABLE']);
  assert.deepEqual([fp.guestPhone, fp.pickupDate, fp.quotedAmount, fp.quotedCurrency, fp.bookingCreatedAt], Array(5).fill('SOURCE_CONFIRMED'));
  assert.equal(fieldProvenance({ passengers: 3 }).passengers, 'SOURCE_CONFIRMED'); assert.equal(fieldProvenance(null).flight, 'SOURCE_MISSING'); assert.equal(fieldProvenance(undefined).passengers, 'NOT_APPLICABLE');
  assert.ok(Object.values(fp).every((v) => ['SOURCE_CONFIRMED', 'SOURCE_MISSING', 'NOT_APPLICABLE'].includes(v)));
});
test('SOURCE FIDELITY end to end: a booking with no flight is stored with a NULL flight (not a default) and labelled SOURCE_MISSING', async () => {
  const t = setup(); await boot(t); add(t.store, 3, { flight_number: null }); await poll(t.env);
  const s = await t.env.DB.prepare('SELECT flight_number, passengers, luggage, add_ons_json, provenance_json FROM bula_booking_snapshots').first();
  assert.deepEqual([s.flight_number, s.passengers, s.luggage, s.add_ons_json], [null, null, null, null]); const fp = JSON.parse(s.provenance_json).fieldProvenance; assert.deepEqual([fp.flight, fp.passengers, fp.addOns, fp.discount], ['SOURCE_MISSING', 'NOT_APPLICABLE', 'NOT_APPLICABLE', 'NOT_APPLICABLE']);
});
test('NO SECRETS in logs or stored state across success and failure polls', async () => {
  const logs = []; const o = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = (...a) => logs.push(a.map(String).join(' '));
  try { const t = setup(); await boot(t); add(t.store, 3); add(t.store, 4, { guest_email: null }); await poll(t.env); t.ctl.down = true; await poll(t.env); t.env.NADI_SOURCE_ADMIN_TOKEN = 'bad'; t.ctl.down = false; await poll(t.env);
    const dump = JSON.stringify([await t.env.DB.prepare('SELECT * FROM bula_source_discovery_state').all(), await t.env.DB.prepare('SELECT * FROM bula_source_refusals').all()]); for (const s of [TOKEN, 'guest3@example.test', 'bad']) assert.ok(!dump.includes(s) && !logs.join('\n').includes(s), s);
  } finally { Object.assign(console, { log: o.l, error: o.e, warn: o.w }); }
});
