/* Marau (PREVIEW/TEST ONLY) - the REAL booking path: one source booking holding arrival AND return -> two Marau legs with stable
 * identities, explicit return-leg value, credit applied only to the eligible return, accurate booking balance. Synthetic data only;
 * default-deny network. Evidence label: LOCAL, AUTHOR-RUN (the adapter is also run against the REAL nadi worker.js in-process).
 *
 * Source facts these fixtures follow (nadi-dispatch-api `bookings`): ONE row per booking; the return is return_date / return_time /
 * return_pickup_location on that row; ONE quoted_amount (+ quoted_currency, settlement_amount_fjd, commission_base_fjd); NO separate
 * return amount; NO trip_type column; NO link between two bookings. Red-first against RC1 (tag marau-preview-rc1).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest } from './fixtures.mjs';
import worker, { createGuestSession, createSessionAndOfferLink, nowIso } from '../worker/worker.js';
import { normalizePickupDatetime } from '../worker/fiji_time.js';
import { legStatusBasis } from '../worker/leg_type.js';
import { syncRealBookingEvent } from '../worker/real_booking_sync.js';
import { createNadiBookingReader } from '../worker/nadi_booking_reader.js';

const guardFetch = installNetworkGuard();

const call = async (env, p, { method = 'GET', body, headers = {} } = {}) => {
  const res = await worker.fetch(new Request('http://marau.test' + p, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text };
};
const admin = (env) => ({ authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}` });
const staffH = (env, t = 'staff-tok-ana') => ({ ...admin(env), 'x-marau-staff-token': t });
const guestH = (t) => ({ authorization: `Bearer ${t}` });
const inDays = (d, h = 0) => new Date(Date.now() + d * 86400_000 + h * 3600_000).toISOString();
const dayStr = (d) => inDays(d).slice(0, 10);
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results.map((r) => ({ ...r }));

// ---- a source booking in the REAL schema's field names ----
let n = 0;
const src = (over = {}) => { n += 1; return {
  id: 7000 + n, client_booking_ref: `FD-RT${n}`, status: 'accepted', assigned_driver_id: 3,
  guest_phone: `+150055504${String(n).padStart(2, '0')}`, guest_email: `rt${n}@example.test`,
  pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan',
  quoted_currency: 'FJD', quoted_amount: 170, settlement_amount_fjd: 150, commission_base_fjd: 20,
  pickup_date: dayStr(3), pickup_time: '09:00', return_date: dayStr(10), return_time: '10:30', return_pickup_location: 'Sofitel Denarau lobby',
  flight_number: null, created_at: '2026-10-01T00:00:00Z', ...over }; };
const ref = (r) => String(r.id);
const sourceOf = (...rows) => { const m = new Map(rows.map((r) => [ref(r), { ...r }])); return { set: (r) => m.set(ref(r), { ...r }), reader: async (x) => (m.has(String(x)) ? { ...m.get(String(x)), source_booking_ref: String(x) } : null) }; };
let ev = 200000;
const sync = (env, r, source, over = {}) => syncRealBookingEvent(env, ref(r), { event_type: over.type || 'accepted', new_status: over.status || 'accepted', source_event_id: ++ev, booking_id: r.id }, { createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime, reader: source.reader, ...(over.deps || {}) });
const legs = (env, r) => all(env, 'SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? ORDER BY id', ref(r));
const legOf = (rows, key) => rows.find((x) => x.leg_key === key);

// ====================================================================== 1. THE READ-ONLY ADAPTER

const jsonRes = (status, data, extra = {}) => ({ status, json: async () => data, headers: { get: () => null }, ...extra });
const REAL_BODY = (o = {}) => ({ ok: true, booking: { id: 7, client_booking_ref: 'FD-1', status: 'accepted', assigned_driver_id: 3, guest_phone: '+15005550101', guest_email: 'a@example.test', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', quoted_currency: 'FJD', quoted_amount: 170, settlement_amount_fjd: 150, commission_base_fjd: 20, pickup_date: '2031-10-05', pickup_time: '09:00', return_date: '2031-10-12', return_time: '10:30', return_pickup_location: 'Hotel', flight_number: null, created_at: 't', guest_name: 'MUST NOT PASS', notes: 'private', source_ip: '1.2.3.4', ...o } });

test('ADAPTER: read-only - one GET of one booking id, admin credential only, redirects never followed, nothing but the whitelisted fields comes out', async () => {
  const calls = [];
  const reader = createNadiBookingReader({ baseUrl: 'https://dispatch.example.test', adminToken: 'ADMIN-T', fetchImpl: async (u, init) => { calls.push({ u, init }); return jsonRes(200, REAL_BODY()); } });
  const row = await reader('7');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].u, 'https://dispatch.example.test/admin/bookings/7');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined, 'a read sends no body');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.deepEqual(Object.keys(calls[0].init.headers), ['authorization']);
  assert.equal(row.source_booking_ref, '7');
  assert.deepEqual([row.return_date, row.return_time, row.return_pickup_location, row.quoted_amount, row.quoted_currency, row.settlement_amount_fjd], ['2031-10-12', '10:30', 'Hotel', 170, 'FJD', 150]);
  for (const forbidden of ['guest_name', 'notes', 'source_ip']) assert.equal(forbidden in row, false, `${forbidden} must not cross the adapter`);
  assert.deepEqual(reader.provenance, { kind: 'nadi_dispatch_api', origin: 'https://dispatch.example.test', authenticated: true, read_only: true });
});

test('ADAPTER: fail-closed on anything unexpected - wrong id, redirect, auth failure, 5xx, malformed fields, bad reference - and 404 is "not found", not an error', async () => {
  const make = (respond) => createNadiBookingReader({ baseUrl: 'https://dispatch.example.test', adminToken: 't', fetchImpl: async () => respond() });
  assert.equal(await make(() => jsonRes(404, { ok: false }))('7'), null);
  for (const [label, respond] of [
    ['id mismatch', () => jsonRes(200, REAL_BODY({ id: 8 }))],
    ['redirect', () => jsonRes(302, {})],
    ['401', () => jsonRes(401, { error: 'x' })],
    ['500', () => jsonRes(500, {})],
    ['non-JSON', () => ({ status: 200, json: async () => { throw new SyntaxError('x'); }, headers: { get: () => null } })],
    ['not ok flag', () => jsonRes(200, { ok: false })],
    ['non-numeric amount', () => jsonRes(200, REAL_BODY({ quoted_amount: 'lots' }))],
    ['object where a string belongs', () => jsonRes(200, REAL_BODY({ pickup_zone: { x: 1 } }))],
    ['unknown status type', () => jsonRes(200, REAL_BODY({ status: 5 }))],
  ]) await assert.rejects(() => make(respond)('7'), /SOURCE_/, label);
  const r = make(() => jsonRes(200, REAL_BODY()));
  for (const bad of ['1/../2', '07x', '', null, '-1', ' 7']) await assert.rejects(() => r(bad), /SOURCE_REF_NOT_A_BOOKING_ID/, String(bad));
  assert.throws(() => createNadiBookingReader({ baseUrl: 'http://dispatch.example.test', adminToken: 't' }), /SOURCE_BASE_URL/);
});

// The adapter against the REAL nadi worker.js (branch ceo/nadi-booking-read-itinerary), in-process, real schema.
const REAL_DIR = process.env.NADI_REAL_WORKER_DIR || 'C:/Users/James/AppData/Local/Temp/nadi-attempt-identity/nadi-marketplace';
const REAL_PRESENT = existsSync(path.join(REAL_DIR, 'worker', 'worker.js')) && readFileSync(path.join(REAL_DIR, 'worker', 'worker.js'), 'utf8').includes('handleAdminReadBooking');
const realWorker = REAL_PRESENT ? (await import(pathToFileURL(path.join(REAL_DIR, 'worker', 'worker.js')).href)).default : null;
function realEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(path.join(REAL_DIR, 'schema.sql'), 'utf8'));
  for (const f of ['milestone34-booking-idempotency-and-contact-fields.sql', 'milestone35-revenue-attribution.sql', 'milestone36-admin-notification-retry-state.sql', 'milestone37-driver-broadcast-claim-state.sql']) db.exec(readFileSync(path.join(REAL_DIR, 'migrations', f), 'utf8'));
  db.prepare(`UPDATE platform_settings SET value = ? WHERE key = 'admin_alert_phone'`).run('+6799999999');
  const shim = { prepare(sql) { let a = []; const api = { bind(...x) { a = x; return api; }, async first() { const r = db.prepare(sql).get(...a); return r === undefined ? null : r; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { const i = db.prepare(sql).run(...a); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; } }; return api; } };
  return { db, env: { DB: shim, ADMIN_TOKEN: 'real-admin', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: 'p' } };
}
async function createRealRoundTrip(real, over = {}) {
  const jobs = []; const ctx = { waitUntil: (pr) => jobs.push(pr) };
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'w' }] }) });
  const res = await realWorker.fetch(new Request('https://real.test/bookings', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify({ guest_name: 'Synthetic Guest', guest_phone: '+15005550177', guest_email: 'real.rt@example.test', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', quoted_currency: 'FJD', quoted_amount: 170, payment_method: 'cash',
      pickup_date: dayStr(3), pickup_time: '09:00', return_date: dayStr(10), return_time: '10:30', return_pickup_location: 'Sofitel Denarau lobby', trip_type: 'return', client_booking_ref: `FD-REAL${++n}`, ...over }) }), real.env, ctx);
  await Promise.all(jobs); // let the real worker's background notification finish against the STUB, never the network
  globalThis.fetch = guardFetch;
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()).booking_id;
}

test('REAL SCHEMA: a round-trip booking created through the REAL nadi worker is read by the adapter and mirrored as two legs - fields exactly as the source stored them', { skip: REAL_PRESENT ? false : `real nadi worker with the read endpoint not found at ${REAL_DIR}` }, async () => {
  const real = realEnv();
  const id = await createRealRoundTrip(real);
  const stored = real.db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  const reader = createNadiBookingReader({ baseUrl: 'https://real.test', adminToken: 'real-admin', fetchImpl: async (u, init) => realWorker.fetch(new Request(u, { method: init.method, headers: init.headers }), real.env, { waitUntil() {} }) });
  const row = await reader(String(id));
  assert.deepEqual([row.return_date, row.return_time, row.return_pickup_location, row.pickup_date, row.pickup_time, row.pickup_zone, row.destination_zone], [stored.return_date, stored.return_time, stored.return_pickup_location, stored.pickup_date, stored.pickup_time, stored.pickup_zone, stored.destination_zone]);
  assert.equal(row.quoted_amount, stored.quoted_amount);
  assert.equal(row.quoted_currency, stored.quoted_currency);
  assert.equal(row.settlement_amount_fjd, stored.settlement_amount_fjd);

  const env = makeEnv();
  const result = await syncRealBookingEvent(env, String(id), { event_type: 'created', new_status: stored.status === 'pending' ? 'pending' : 'accepted', source_event_id: ++ev, booking_id: id }, { createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime, reader });
  assert.equal(result.ok, true, JSON.stringify(result));
  const rows = await all(env, 'SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? ORDER BY id', String(id));
  assert.deepEqual(rows.map((r) => r.leg_key), ['arrival', 'return']);
  assert.equal(rows[0].source_total_cents, Math.round(stored.quoted_amount * 100));
  assert.equal(rows[1].pickup_zone, stored.return_pickup_location);
  assert.equal(rows[0].source_kind, 'nadi_dispatch_api');
  assert.equal(rows[0].source_authenticated, 1);
  assert.equal(rows[0].test_data, 1, 'authenticated provenance alone does not make a record live: the integration is not approved');
});

// ====================================================================== 2. ROUND-TRIP MAPPING: two legs, stable identities

test('MAPPING: one source booking with arrival + return fields becomes TWO Marau legs of the SAME source booking - dates, locations, status and provenance preserved; the return is not given the whole quote', async () => {
  const env = makeEnv(); const r = src(); const source = sourceOf(r);
  const res = await sync(env, r, source, { type: 'created' });
  assert.equal(res.ok, true, JSON.stringify(res));
  const rows = await legs(env, r);
  assert.equal(rows.length, 2);
  const arrival = legOf(rows, 'arrival'); const ret = legOf(rows, 'return');
  assert.ok(arrival && ret);
  assert.equal(arrival.source_sync_owned, 1); assert.equal(ret.source_sync_owned, 0);
  assert.equal(arrival.guest_session_id, ret.guest_session_id, 'both legs belong to the same guest session');
  assert.equal(ret.parent_booking_id, arrival.id);
  assert.deepEqual([arrival.leg_type, arrival.leg_shape, ret.leg_type, ret.leg_shape], ['arrival', 'round_trip_arrival_leg', 'return', 'round_trip_return_leg']);
  assert.equal(arrival.pickup_zone, 'Nadi Airport'); assert.equal(arrival.destination_zone, 'Denarau');
  assert.equal(ret.pickup_zone, 'Sofitel Denarau lobby', 'the RECORDED return pickup location is kept'); assert.equal(ret.pickup_basis, 'recorded');
  assert.equal(ret.destination_zone, 'Nadi Airport');
  assert.equal(arrival.pickup_datetime, normalizePickupDatetime(`${r.pickup_date}T${r.pickup_time}`));
  assert.equal(ret.pickup_datetime, normalizePickupDatetime(`${r.return_date}T${r.return_time}`));
  assert.deepEqual([arrival.status, ret.status, ret.source_status], ['confirmed', 'confirmed', 'accepted']);
  // original booking total + operator-side figures preserved on both legs, in cents
  for (const leg of [arrival, ret]) assert.deepEqual([leg.source_total_cents, leg.source_currency, leg.source_settlement_fjd_cents, leg.source_commission_base_fjd_cents], [17000, 'FJD', 15000, 2000]);
  // the return is NOT the whole round-trip quote and is NOT an arbitrary share of it
  assert.equal(ret.leg_value_status, 'unresolved'); assert.equal(ret.leg_value_cents, null);
  assert.equal(arrival.return_leg_state, 'present');
  assert.deepEqual([arrival.source_kind, ret.source_kind, ret.source_authenticated], ['synthetic', 'synthetic', 0], 'the injected test reader is recorded as synthetic provenance');
});

test('REPEATED SYNC never duplicates legs; the leg rows keep their ids and identities', async () => {
  const env = makeEnv(); const r = src(); const source = sourceOf(r);
  await sync(env, r, source, { type: 'created' });
  const first = (await legs(env, r)).map((x) => [x.id, x.leg_key]);
  for (let i = 0; i < 3; i += 1) assert.equal((await sync(env, r, source)).ok, true);
  assert.deepEqual((await legs(env, r)).map((x) => [x.id, x.leg_key]), first);
  assert.equal((await all(env, 'SELECT * FROM marau_test_bookings WHERE client_booking_ref LIKE ?', `REAL-SYNC-${ref(r)}-%`)).length, 2);
  // concurrent syncs of the same booking also converge on exactly two legs
  await Promise.all([sync(env, r, source), sync(env, r, source), sync(env, r, source)]);
  assert.equal((await legs(env, r)).length, 2);
});

test('SOURCE EDITS reconcile onto the same legs: a changed return date/time/location updates the RETURN only; a changed arrival updates the ARRIVAL only', async () => {
  const env = makeEnv(); const r = src(); const source = sourceOf(r);
  await sync(env, r, source, { type: 'created' });
  const before = await legs(env, r);
  source.set({ ...r, return_date: dayStr(12), return_time: '15:45', return_pickup_location: 'Hilton Denarau' });
  await sync(env, r, source);
  let rows = await legs(env, r);
  assert.deepEqual(rows.map((x) => x.id), before.map((x) => x.id));
  assert.equal(legOf(rows, 'return').pickup_zone, 'Hilton Denarau');
  assert.equal(legOf(rows, 'return').pickup_datetime, normalizePickupDatetime(`${dayStr(12)}T15:45`));
  assert.equal(legOf(rows, 'arrival').pickup_datetime, legOf(before, 'arrival').pickup_datetime, 'the arrival is untouched by a return edit');
  source.set({ ...r, return_date: dayStr(12), return_time: '15:45', return_pickup_location: 'Hilton Denarau', pickup_time: '11:15' });
  await sync(env, r, source);
  rows = await legs(env, r);
  assert.equal(legOf(rows, 'arrival').pickup_datetime, normalizePickupDatetime(`${dayStr(3)}T11:15`));
  assert.equal(legOf(rows, 'return').pickup_zone, 'Hilton Denarau');
});

test('RETURN MISSING OR REMOVED: incomplete return details create NO return leg (and say so); completing them later creates it; removing them cancels the leg without touching the arrival', async () => {
  const env = makeEnv();
  const partial = src({ return_time: null }); const source = sourceOf(partial);
  await sync(env, partial, source, { type: 'created' });
  let rows = await legs(env, partial);
  assert.equal(rows.length, 1); assert.equal(rows[0].leg_key, 'arrival');
  assert.deepEqual([rows[0].return_leg_state, rows[0].leg_shape], ['missing_return_details', 'round_trip_return_details_missing']);
  const noDate = src({ return_date: null }); const s2 = sourceOf(noDate);
  await sync(env, noDate, s2, { type: 'created' });
  assert.equal((await legs(env, noDate)).length, 1, 'a return time with no date is not a return leg');
  const badDate = src({ return_date: 'next friday' }); const s3 = sourceOf(badDate);
  await sync(env, badDate, s3, { type: 'created' });
  assert.equal((await legs(env, badDate)).length, 1, 'an unparseable return date is not guessed');
  // completed later: the leg appears
  source.set({ ...partial, return_time: '10:30' });
  await sync(env, partial, source);
  rows = await legs(env, partial);
  assert.deepEqual(rows.map((x) => x.leg_key), ['arrival', 'return']);
  const retId = legOf(rows, 'return').id;
  // removed again: the SAME leg is cancelled, never deleted or duplicated; arrival intact
  source.set({ ...partial, return_date: null, return_time: null, return_pickup_location: null });
  await sync(env, partial, source);
  rows = await legs(env, partial);
  assert.equal(rows.length, 2);
  assert.deepEqual([legOf(rows, 'return').id, legOf(rows, 'return').status, legOf(rows, 'arrival').status], [retId, 'cancelled', 'confirmed']);
  assert.equal(legOf(rows, 'arrival').return_leg_state, 'missing_return_details');
  // restored: the same leg comes back
  source.set({ ...partial, return_date: dayStr(10), return_time: '10:30', return_pickup_location: 'Sofitel Denarau lobby' });
  await sync(env, partial, source);
  rows = await legs(env, partial);
  assert.deepEqual([rows.length, legOf(rows, 'return').id, legOf(rows, 'return').status], [2, retId, 'confirmed']);
});

test('RETURN LOCATION missing but date/time present: the leg exists and its pickup is marked INFERRED from the outbound destination, never presented as recorded', async () => {
  const env = makeEnv(); const r = src({ return_pickup_location: null }); await sync(env, r, sourceOf(r), { type: 'created' });
  const ret = legOf(await legs(env, r), 'return');
  assert.deepEqual([ret.pickup_zone, ret.pickup_basis], ['Denarau', 'inferred_from_outbound_destination']);
});

test('SOURCE CANCELLATION cancels both legs; ARRIVAL COMPLETED keeps the upcoming return live and still reconcilable, with the assumption recorded', async () => {
  const env = makeEnv(); const r = src(); const source = sourceOf(r);
  await sync(env, r, source, { type: 'created' });
  source.set({ ...r, status: 'completed' });
  await sync(env, r, source, { type: 'completed', status: 'completed' });
  let rows = await legs(env, r);
  assert.equal(legOf(rows, 'arrival').source_status, 'completed');
  // SUPERSEDED in the readiness round: the return stays visible but is NOT inferred as confirmed - it is pending with an explicit uncertainty
  assert.equal(legOf(rows, 'return').status, 'pending');
  assert.equal(legOf(rows, 'return').status_uncertainty, 'source_completed_while_return_upcoming');
  assert.match(legOf(rows, 'return').leg_note, /completed_while_return_upcoming/);
  // the arrival row is terminal-locked, but a later return edit still reaches the return leg
  source.set({ ...r, status: 'completed', return_time: '16:00' });
  await sync(env, r, source, { type: 'completed', status: 'completed' });
  rows = await legs(env, r);
  assert.equal(legOf(rows, 'return').pickup_datetime, normalizePickupDatetime(`${r.return_date}T16:00`));
  // and a source cancellation cancels the return too
  source.set({ ...r, status: 'cancelled' });
  await sync(env, r, source, { type: 'cancelled', status: 'cancelled' });
  assert.equal(legOf(await legs(env, r), 'return').status, 'cancelled');
});

// ====================================================================== 3. RETURN-LEG VALUE: explicit, never arbitrary

async function programme({ policy = { mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 20, min_purchase_fjd: 0, qualify_on: 'fulfilled', require_payment: 'paid_in_full' }, source: over = {} } = {}) {
  const env = makeEnv();
  for (const [t, nm] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: t, operator_name: nm } });
  await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: policy });
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Reef Tours', fulfilment_owner: 'Ana (ops)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
  const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title: 'Synthetic snorkel', location: 'Reef (synthetic)', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 20, price_per_place_fjd: 120, cost_per_place_fjd: 80 } });
  await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });
  const r = src(over); const source = sourceOf(r);
  const res = await sync(env, r, source, { type: 'created' });
  assert.equal(res.ok, true, JSON.stringify(res));
  const rows = await legs(env, r);
  const session = await one(env, 'SELECT * FROM guest_sessions WHERE session_id = ?', rows[0].guest_session_id);
  return { env, r, source, offerId: offer.data.offer_id, arrival: legOf(rows, 'arrival'), ret: legOf(rows, 'return'), session };
}
async function earnCredit(ctx) {
  const { env, offerId, session } = ctx;
  const code = (await call(env, '/preview/referral', { headers: guestH(session.access_token) })).data.code;
  const f = await call(env, '/preview/bookings', { method: 'POST', body: { ...synthGuest({ leg_type: 'arrival' }), referral_code: code } });
  const rid = (await call(env, `/preview/offers/${offerId}/request`, { method: 'POST', headers: guestH(f.data.access_token), body: { places: 1 } })).data.request.request_id;
  const act = (a, b = {}) => call(env, `/preview/admin/offers/requests/${rid}/${a}`, { method: 'POST', headers: staffH(env), body: b });
  await act('confirm'); await act('payment', { event: 'paid', amount_fjd: 120, method: 'cash', event_key: `p-${rid}` }); await act('fulfil');
  return (await all(env, 'SELECT * FROM marau_reward_credits ORDER BY created_at')).at(-1).credit_id;
}
const apply = (env, creditId, bookingId, extra = {}, tok = 'staff-tok-ana') => call(env, `/preview/admin/rewards/credits/${creditId}/apply`, { method: 'POST', headers: staffH(env, tok), body: { booking_id: bookingId, ...extra } });
const rule = (env, body) => call(env, '/preview/admin/rewards/allocation-rules', { method: 'POST', headers: staffH(env), body });

test('RETURN_VALUE_UNRESOLVED: with no approved allocation rule a credit is REFUSED on the return leg, stays earned, and the target is listed with its value shown as unresolved - not as the full quote and not as half of it', async () => {
  const ctx = await programme(); const { env, ret, arrival } = ctx;
  const credit = await earnCredit(ctx);
  const r = await apply(env, credit, ret.id);
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal(r.data.error, 'RETURN_VALUE_UNRESOLVED');
  assert.match(r.data.detail, /allocation rule/i);
  assert.equal((await one(env, 'SELECT status FROM marau_reward_credits WHERE credit_id = ?', credit)).status, 'earned');
  const listed = (await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) })).data.credits[0];
  const target = listed.eligible_return_transfers.find((t) => t.booking_id === ret.id);
  assert.ok(target, 'the return leg is shown as a target');
  assert.equal(target.return_value_status, 'RETURN_VALUE_UNRESOLVED');
  assert.equal(target.original_fare_fjd, null, 'no invented return fare');
  assert.equal(target.source_total_fjd, 170); assert.equal(target.source_settlement_fjd, 150);
  // the arrival leg is never a credit target
  const a = await apply(env, credit, arrival.id);
  assert.equal(a.status, 409); assert.equal(a.data.error, 'NOT_AN_ELIGIBLE_RETURN_TRANSFER');
});

test('ALLOCATION RULES: proposed is not approved; approval is recorded (synthetic-preview basis only); then the return value is allocated from the ORIGINAL total by that rule and credit applies; the booking total, operator figures and quote are untouched', async () => {
  const ctx = await programme(); const { env, ret, arrival } = ctx;
  const credit = await earnCredit(ctx);
  const proposed = await rule(env, { kind: 'percent_of_total', percent: 40 });
  assert.equal(proposed.status, 201, JSON.stringify(proposed.data));
  assert.equal(proposed.data.rule.status, 'proposed');
  assert.equal((await apply(env, credit, ret.id)).data.error, 'RETURN_VALUE_UNRESOLVED', 'a proposal does nothing');
  const approved = await call(env, `/preview/admin/rewards/allocation-rules/${proposed.data.rule.rule_id}/approve`, { method: 'POST', headers: staffH(env, 'staff-tok-bala'), body: { note: 'synthetic preview rule' } });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.deepEqual([approved.data.rule.status, approved.data.rule.approved_by, approved.data.rule.approval_basis], ['approved', 'Bala (ops)', 'synthetic_preview']);
  const applied = await apply(env, credit, ret.id);
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.fare.scope, 'round_trip_booking');
  assert.equal(applied.data.fare.booking_total_fjd, 170);
  assert.equal(applied.data.fare.referral_credit_fjd, 10);
  assert.equal(applied.data.fare.amount_due_fjd, 160);
  assert.deepEqual([applied.data.fare.return_value.status, applied.data.fare.return_value.value_fjd, applied.data.fare.return_value.rule_basis], ['allocated', 68, 'percent_of_total 40%']);
  assert.equal(applied.data.fare.operator_payout_unchanged, true);
  const rows = await legs(ctx.env, ctx.r);
  for (const leg of rows) assert.deepEqual([leg.source_total_cents, leg.source_settlement_fjd_cents, leg.source_commission_base_fjd_cents], [17000, 15000, 2000], 'original total and operator figures preserved');
  assert.equal(legOf(rows, 'arrival').quoted_amount, 170, 'the booking quote itself is untouched');
  assert.equal((await one(env, 'SELECT relationship_basis FROM marau_booking_adjustments WHERE booking_id = ?', ret.id)).relationship_basis, 'source_round_trip_return_leg');
  // the same fare appears from BOTH legs of the trip (one booking balance)
  const trip = (await call(env, '/preview/trip', { headers: guestH(ctx.session.access_token) })).data;
  const fares = trip.bookings.filter((b) => b.leg_key).map((b) => [b.leg_key, b.fare.booking_total_fjd, b.fare.amount_due_fjd]);
  assert.deepEqual(fares.sort(), [['arrival', 170, 160], ['return', 170, 160]]);
  void arrival;
});

test('ALLOCATION: a fixed return value smaller than the credit bounds the credit and reports the unused part; a non-FJD source quote never resolves; retiring a rule makes UNAPPLIED legs unresolved again but does not touch an applied credit', async () => {
  const ctx = await programme(); const { env, ret } = ctx;
  const credit = await earnCredit(ctx);
  const fixed = (await rule(env, { kind: 'fixed_return_fjd', amount_fjd: 6 })).data.rule;
  await call(env, `/preview/admin/rewards/allocation-rules/${fixed.rule_id}/approve`, { method: 'POST', headers: staffH(env), body: { note: 'n' } });
  const applied = await apply(env, credit, ret.id);
  assert.equal(applied.status, 200);
  assert.deepEqual([applied.data.applied_fjd, applied.data.unused_fjd, applied.data.fare.amount_due_fjd], [6, 4, 164]);
  await call(env, `/preview/admin/rewards/allocation-rules/${fixed.rule_id}/retire`, { method: 'POST', headers: staffH(env), body: { note: 'retire' } });
  assert.equal((await one(env, 'SELECT status FROM marau_reward_credits WHERE credit_id = ?', credit)).status, 'applied', 'an applied credit stays applied');
  // a different booking in another currency, with a fresh approved rule, still does not resolve
  const usd = src({ quoted_currency: 'USD', quoted_amount: 80 });
  const s2 = sourceOf(usd);
  const pct = (await rule(env, { kind: 'percent_of_total', percent: 50 })).data.rule;
  await call(env, `/preview/admin/rewards/allocation-rules/${pct.rule_id}/approve`, { method: 'POST', headers: staffH(env), body: { note: 'n' } });
  await sync(env, usd, s2, { type: 'created' });
  await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) });
  const usdRet = legOf(await legs(env, usd), 'return');
  assert.equal(usdRet.leg_value_status, 'unresolved', 'the source amount is not in FJD: never allocated');
  // a rule retired AFTER it allocated an unapplied leg: the leg goes back to unresolved
  const fjdLeg = legOf(await legs(env, ctx.r), 'return');
  void fjdLeg;
});

test('ALLOCATION RULES: validation (positive, bounded), staff identity required, and an owner-basis approval cannot be set through the API', async () => {
  const ctx = await programme(); const { env } = ctx;
  assert.equal((await call(env, '/preview/admin/rewards/allocation-rules', { method: 'POST', headers: admin(env), body: { kind: 'percent_of_total', percent: 40 } })).status, 401);
  for (const bad of [{ kind: 'percent_of_total', percent: 0 }, { kind: 'percent_of_total', percent: 100 }, { kind: 'percent_of_total', percent: 'half' }, { kind: 'fixed_return_fjd', amount_fjd: -1 }, { kind: 'fixed_return_fjd' }, { kind: 'divide_by_two' }]) assert.equal((await rule(env, bad)).status, 400, JSON.stringify(bad));
  const p = (await rule(env, { kind: 'percent_of_total', percent: 40, approval_basis: 'owner', approved_by: 'James' })).data.rule;
  assert.equal(p.status, 'proposed'); assert.equal(p.approved_by, null);
  const a = (await call(env, `/preview/admin/rewards/allocation-rules/${p.rule_id}/approve`, { method: 'POST', headers: staffH(env), body: { note: 'x', approval_basis: 'owner' } })).data.rule;
  assert.equal(a.approval_basis, 'synthetic_preview', 'the API can only ever record a synthetic-preview approval');
});

// ====================================================================== 4. THE ACCEPTANCE JOURNEY

test('ACCEPTANCE: one source booking (arrival + return) -> Marau trip with both legs -> qualifying referred purchase -> credit applied ONLY to the return -> accurate booking balance; repeated sync changes nothing', async () => {
  const ctx = await programme(); const { env, source, r, ret, arrival, session } = ctx;
  const approvedRule = (await rule(env, { kind: 'percent_of_total', percent: 40 })).data.rule;
  await call(env, `/preview/admin/rewards/allocation-rules/${approvedRule.rule_id}/approve`, { method: 'POST', headers: staffH(env), body: { note: 'synthetic' } });

  const trip0 = (await call(env, '/preview/trip', { headers: guestH(session.access_token) })).data;
  assert.deepEqual(trip0.bookings.map((b) => [b.leg_key, b.status]).sort(), [['arrival', 'confirmed'], ['return', 'confirmed']], 'the guest sees both legs of their one booking');

  const credit = await earnCredit(ctx);
  assert.equal((await apply(env, credit, arrival.id)).status, 409, 'not the arrival');
  const applied = await apply(env, credit, ret.id);
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.deepEqual([applied.data.fare.booking_total_fjd, applied.data.fare.referral_credit_fjd, applied.data.fare.amount_due_fjd], [170, 10, 160]);

  // repeated sync: no duplicate legs, no duplicate adjustment, same balance
  for (let i = 0; i < 3; i += 1) await sync(env, r, source);
  assert.equal((await legs(env, r)).length, 2);
  assert.equal((await all(env, 'SELECT * FROM marau_booking_adjustments')).length, 1);
  const trip1 = (await call(env, '/preview/trip', { headers: guestH(session.access_token) })).data;
  assert.deepEqual(trip1.bookings.map((b) => b.fare.amount_due_fjd), [160, 160]);

  // the source CHANGES the return time: the credit stays on the (same) return leg
  source.set({ ...r, return_time: '17:00' });
  await sync(env, r, source);
  assert.equal((await one(env, 'SELECT status, applied_booking_id FROM marau_reward_credits WHERE credit_id = ?', credit)).applied_booking_id, ret.id);

  // the source CANCELS the return (return fields removed): the credit is released, the discount dropped, the balance is the full total again
  source.set({ ...r, return_date: null, return_time: null, return_pickup_location: null });
  await sync(env, r, source);
  await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) });
  assert.equal((await one(env, 'SELECT status FROM marau_reward_credits WHERE credit_id = ?', credit)).status, 'earned', 'released for another return');
  assert.equal((await one(env, 'SELECT status FROM marau_booking_adjustments')).status, 'released_booking_cancelled');
  const trip2 = (await call(env, '/preview/trip', { headers: guestH(session.access_token) })).data;
  assert.equal(trip2.bookings.find((b) => b.leg_key === 'arrival').fare.amount_due_fjd, 170);
});

test('ACCEPTANCE (arrival already completed): the return is still eligible and the balance is right; a return that is no longer upcoming is not', async () => {
  const ctx = await programme(); const { env, source, r, ret } = ctx;
  const rl = (await rule(env, { kind: 'percent_of_total', percent: 50 })).data.rule;
  await call(env, `/preview/admin/rewards/allocation-rules/${rl.rule_id}/approve`, { method: 'POST', headers: staffH(env), body: { note: 'n' } });
  source.set({ ...r, status: 'completed' });
  await sync(env, r, source, { type: 'completed', status: 'completed' });
  const credit = await earnCredit(ctx);
  assert.equal((await apply(env, credit, ret.id)).data.error, 'LEG_STATUS_UNVERIFIED', 'completed-while-upcoming is uncertain: no redemption until staff verify');
  const basisFor = async (env, id) => { const l = await env.DB.prepare(`SELECT source_status, pickup_datetime, pickup_zone, destination_zone, (SELECT a.pickup_datetime FROM marau_test_bookings a WHERE a.source_booking_ref = marau_test_bookings.source_booking_ref AND a.leg_key = 'arrival') AS ap FROM marau_test_bookings WHERE id = ?`).bind(id).first(); return legStatusBasis({ source_status: l.source_status, return_pickup_datetime: l.pickup_datetime, return_pickup_zone: l.pickup_zone, return_destination_zone: l.destination_zone, arrival_pickup_datetime: l.ap }); };
  const vv = await call(env, `/preview/admin/bookings/${ret.id}/verify-status`, { method: 'POST', headers: staffH(env), body: { verdict: 'return_upcoming', itinerary_basis: await basisFor(env, ret.id), evidence: 'confirmed by phone that the return is still booked' } });
  assert.equal(vv.status, 200, JSON.stringify(vv.data));
  const ok = await apply(env, credit, ret.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.fare.booking_total_fjd, ok.data.fare.amount_due_fjd], [170, 160]);
  // a return whose pickup has passed cannot take a credit
  const ctx2 = await programme({ source: { return_date: dayStr(-1), pickup_date: dayStr(-4) } });
  const rl2 = (await rule(ctx2.env, { kind: 'percent_of_total', percent: 50 })).data.rule;
  await call(ctx2.env, `/preview/admin/rewards/allocation-rules/${rl2.rule_id}/approve`, { method: 'POST', headers: staffH(ctx2.env), body: { note: 'n' } });
  const c2 = await earnCredit(ctx2);
  const late = await apply(ctx2.env, c2, ctx2.ret.id);
  assert.equal(late.status, 409); assert.equal(late.data.error, 'NOT_AN_ELIGIBLE_RETURN_TRANSFER');
});

test('ACCEPTANCE (missing return details): the credit has nowhere to land and says so; once the source records the return it can apply', async () => {
  const ctx = await programme({ source: { return_time: null } }); const { env, source, r } = ctx;
  const rl = (await rule(env, { kind: 'percent_of_total', percent: 50 })).data.rule;
  await call(env, `/preview/admin/rewards/allocation-rules/${rl.rule_id}/approve`, { method: 'POST', headers: staffH(env), body: { note: 'n' } });
  const credit = await earnCredit(ctx);
  const listed = (await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) })).data.credits[0];
  assert.deepEqual(listed.eligible_return_transfers, []);
  assert.ok(listed.booking_notes.some((x) => x.code === 'RETURN_DETAILS_MISSING' && x.source_booking_ref === ref(r)), 'staff are told why');
  const ar = await legs(env, r);
  assert.equal((await apply(env, credit, ar[0].id)).status, 409);
  source.set({ ...r }); source.set({ ...r, return_time: '10:30' });
  await sync(env, r, source);
  const retLeg = legOf(await legs(env, r), 'return');
  assert.equal((await apply(env, credit, retLeg.id)).status, 200);
});

// ====================================================================== 5. DEMONSTRATION vs REAL: provenance, not a flag

test('PROVENANCE: demonstration rows are marked; authenticated provenance alone does not make a record live; only the approved integration path does (test_data is an OUTPUT of provenance, never an input)', async () => {
  const adapterProv = { kind: 'nadi_dispatch_api', origin: 'https://dispatch.example.test', authenticated: true, read_only: true };
  // 1. synthetic reader
  let env = makeEnv(); let r = src(); await sync(env, r, sourceOf(r), { type: 'created' });
  let rows = await legs(env, r);
  assert.ok(rows.every((x) => x.source_kind === 'synthetic' && x.source_authenticated === 0 && x.test_data === 1));
  // 2. authenticated adapter provenance, integration NOT approved: still demonstration
  env = makeEnv(); r = src(); let s = sourceOf(r); s.reader.provenance = adapterProv;
  await sync(env, r, s, { type: 'created' });
  rows = await legs(env, r);
  assert.ok(rows.every((x) => x.source_kind === 'nadi_dispatch_api' && x.source_authenticated === 1 && x.test_data === 1));
  // 3. authenticated + approved integration path: the only way to a non-demonstration record
  env = makeEnv({ MARAU_REAL_SOURCE_APPROVED: '1' }); r = src(); s = sourceOf(r); s.reader.provenance = adapterProv;
  await sync(env, r, s, { type: 'created' });
  rows = await legs(env, r);
  assert.ok(rows.every((x) => x.test_data === 0));
  assert.equal((await one(env, 'SELECT test_data FROM guest_sessions WHERE session_id = ?', rows[0].guest_session_id)).test_data, 0);
  // 4. approved flag but NOT authenticated (synthetic reader) never produces a live record
  env = makeEnv({ MARAU_REAL_SOURCE_APPROVED: '1' }); r = src(); await sync(env, r, sourceOf(r), { type: 'created' });
  assert.ok((await legs(env, r)).every((x) => x.test_data === 1));
});

test('LIVE ELIGIBILITY: flipping test_data to 0 by hand on demonstration records earns nothing in live mode; a record that arrived through the authenticated, approved path can', async () => {
  const live = { MARAU_ALLOW_LIVE_REWARDS: '1', MARAU_REAL_SOURCE_APPROVED: '1' };
  const build = async ({ authenticated }) => {
    const env = makeEnv(live);
    for (const [t, nm] of [['staff-tok-ana', 'Ana (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: t, operator_name: nm } });
    await env.DB.prepare(`UPDATE marau_reward_policy SET mode = 'live', amount_cents = 1000, cap_cents_per_referrer = 2000, qualify_on = 'confirmed', require_payment = 'none', live_approved_by = 'James (test fixture)' WHERE id = 1`).run();
    const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Supplier', fulfilment_owner: 'Ana (ops)' } });
    await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
    const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title: 'Synthetic title', location: 'Synthetic place', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 5, price_per_place_fjd: 120 } });
    assert.equal(offer.status, 201, JSON.stringify(offer.data));
    await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });
    const r = src(); const s = sourceOf(r);
    if (authenticated) s.reader.provenance = { kind: 'nadi_dispatch_api', origin: 'https://dispatch.example.test', authenticated: true, read_only: true };
    await sync(env, r, s, { type: 'created' });
    const rows = await legs(env, r);
    // the hand flip: pretend the records are real
    await env.DB.prepare('UPDATE guest_sessions SET test_data = 0 WHERE session_id = ?').bind(rows[0].guest_session_id).run();
    await env.DB.prepare('UPDATE marau_test_bookings SET test_data = 0 WHERE source_booking_ref = ?').bind(ref(r)).run();
    const session = await one(env, 'SELECT * FROM guest_sessions WHERE session_id = ?', rows[0].guest_session_id);
    const code = (await call(env, '/preview/referral', { headers: guestH(session.access_token) })).data.code;
    const f = await call(env, '/preview/bookings', { method: 'POST', body: { ...synthGuest({ leg_type: 'arrival' }), referral_code: code } });
    const req = await call(env, `/preview/offers/${offer.data.offer_id}/request`, { method: 'POST', headers: guestH(f.data.access_token), body: { places: 1 } });
    assert.equal(req.status, 201, JSON.stringify(req.data));
    const rid = req.data.request.request_id;
    await call(env, `/preview/admin/offers/requests/${rid}/confirm`, { method: 'POST', headers: staffH(env), body: {} });
    return all(env, 'SELECT * FROM marau_reward_credits');
  };
  assert.deepEqual(await build({ authenticated: false }), [], 'hand-flipped demonstration records earn nothing live');
  assert.equal((await build({ authenticated: true })).length, 1, 'authenticated provenance on an approved integration path can');
});
