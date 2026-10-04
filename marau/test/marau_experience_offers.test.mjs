/* Marau (PREVIEW/TEST ONLY) - the staff-managed experience offer journey. Synthetic guests, suppliers and offers only;
 * nothing is sent, charged, or touched outside this in-memory database. Evidence label: LOCAL, AUTHOR-RUN.
 *
 * Covered: verified supplier + named fulfilment owner gate; staff-authenticated lifecycle with operator derived from the
 * staff token; Fiji-time handling; browse-anytime with non-filtering personalisation; request holds; duplicate and
 * idempotent requests; overselling under concurrency; hold lapse; human confirmation / decline / fulfilment /
 * reversal; booking deadline, expiry and withdrawal; guest cancellation; private WhatsApp handoff (mock); morning and
 * afternoon editions; honestly-labelled reporting; missing-WhatsApp follow-up; and privacy of every public response.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest } from './fixtures.mjs';
import worker from '../worker/worker.js';
import { editionSlotAt } from '../worker/experience_offers.js';
import { toFijiWallClockInputValue } from '../worker/fiji_time.js';

installNetworkGuard();

const call = async (env, path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await worker.fetch(new Request('http://marau.test' + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text };
};
const admin = (env) => ({ authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}` });
const staffH = (env, token) => ({ ...admin(env), 'x-marau-staff-token': token });
const guestH = (token) => ({ authorization: `Bearer ${token}` });

async function setup() {
  const env = makeEnv();
  for (const [tok, name] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) {
    await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: tok, operator_name: name } });
  }
  return env;
}

async function newGuest(env, overrides = {}) {
  const res = await call(env, '/preview/bookings', { method: 'POST', body: synthGuest(overrides) });
  assert.equal(res.status, 201);
  return { token: res.data.access_token };
}

const inDays = (d, h = 0) => new Date(Date.now() + d * 86400_000 + h * 3600_000).toISOString();

async function verifiedSupplier(env, { name = 'Synthetic Reef Tours', owner = 'Ana (ops)' } = {}) {
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env, 'staff-tok-ana'), body: { name, fulfilment_owner: owner } });
  assert.equal(sup.status, 201);
  const v = await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env, 'staff-tok-ana') });
  assert.equal(v.data.supplier.verification_status, 'verified');
  return sup.data.supplier_id;
}

async function publishedOffer(env, supplierId, overrides = {}) {
  const create = await call(env, '/preview/admin/offers', {
    method: 'POST', headers: staffH(env, 'staff-tok-ana'),
    body: { supplier_id: supplierId, title: 'Synthetic snorkel morning', location: 'Mamanuca reef (synthetic)', inclusions: ['boat', 'snorkel gear', 'lunch'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 4, price_per_place_fjd: 120, cost_per_place_fjd: 80, ...overrides },
  });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const pub = await call(env, `/preview/admin/offers/${create.data.offer_id}/publish`, { method: 'POST', headers: staffH(env, 'staff-tok-ana') });
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  return create.data.offer_id;
}

const request = (env, token, offerId, body = {}) => call(env, `/preview/offers/${offerId}/request`, { method: 'POST', headers: guestH(token), body });
const staffAct = (env, requestId, action, body = {}, tok = 'staff-tok-ana') => call(env, `/preview/admin/offers/requests/${requestId}/${action}`, { method: 'POST', headers: staffH(env, tok), body });
const browse = (env, token) => call(env, '/preview/offers', { headers: token ? guestH(token) : {} });
const dbRow = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();

// ---------------------------------------------------------------- supplier / offer gate

test('staff gate: every staff action needs the admin credential AND a per-staff identity; the operator comes from that token', async () => {
  const env = await setup();
  const noAdmin = await call(env, '/preview/admin/suppliers', { method: 'POST', body: { name: 'X Tours', fulfilment_owner: 'Ana (ops)' } });
  assert.equal(noAdmin.status, 401);
  const adminOnly = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: admin(env), body: { name: 'X Tours', fulfilment_owner: 'Ana (ops)' } });
  assert.equal(adminOnly.status, 401, 'the shared credential alone cannot act - an individual identity is required');
  const badStaff = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env, 'nope'), body: { name: 'X Tours', fulfilment_owner: 'Ana (ops)' } });
  assert.equal(badStaff.status, 401);

  const sid = await verifiedSupplier(env);
  const row = await dbRow(env, 'SELECT created_by, verified_by FROM marau_suppliers WHERE supplier_id = ?', sid);
  assert.equal(row.created_by, 'Ana (ops)');
  assert.equal(row.verified_by, 'Ana (ops)');
  const spoof = await call(env, `/preview/admin/suppliers/${sid}/suspend`, { method: 'POST', headers: staffH(env, 'staff-tok-bala'), body: { operator: 'Impersonated' } });
  assert.equal((await dbRow(env, 'SELECT verified_by FROM marau_suppliers WHERE supplier_id = ?', sid)).verified_by, 'Bala (ops)', 'a body operator field is ignored');
  assert.equal(spoof.data.supplier.verification_status, 'suspended');
});

test('verified supplier and named fulfilment owner are required: no owner -> 400, unverified supplier -> cannot publish, suspended supplier hides its offers', async () => {
  const env = await setup();
  const noOwner = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env, 'staff-tok-ana'), body: { name: 'Owner-less Tours', fulfilment_owner: ' ' } });
  assert.equal(noOwner.status, 400);

  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env, 'staff-tok-ana'), body: { name: 'New Tours', fulfilment_owner: 'Bala (ops)' } });
  const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env, 'staff-tok-ana'), body: { supplier_id: sup.data.supplier_id, title: 'Sunset sail', location: 'Denarau', inclusions: 'drinks', starts_at: inDays(5), capacity: 2, price_per_place_fjd: 99 } });
  assert.equal(offer.status, 201);
  const refused = await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env, 'staff-tok-ana') });
  assert.equal(refused.status, 409);
  assert.equal(refused.data.error, 'SUPPLIER_NOT_VERIFIED');
  assert.equal((await browse(env)).data.offers.length, 0);

  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env, 'staff-tok-ana') });
  assert.equal((await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env, 'staff-tok-ana') })).status, 200);
  assert.equal((await browse(env)).data.offers.length, 1);

  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/suspend`, { method: 'POST', headers: staffH(env, 'staff-tok-ana') });
  assert.equal((await browse(env)).data.offers.length, 0, 'a suspended supplier\'s offers disappear immediately');
  const guest = await newGuest(env);
  assert.equal((await request(env, guest.token, offer.data.offer_id)).status, 410);
});

test('offer validation: dates, price, cost, capacity and inclusions are checked; naive times are Fiji local time', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const base = { supplier_id: sid, title: 'Valid title', location: 'Somewhere', inclusions: 'lunch', starts_at: inDays(6), capacity: 3, price_per_place_fjd: 50 };
  const post = (over) => call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env, 'staff-tok-ana'), body: { ...base, ...over } });
  assert.equal((await post({ starts_at: 'not a date' })).status, 400);
  assert.equal((await post({ book_by: inDays(-1) })).status, 400, 'book_by in the past');
  assert.equal((await post({ book_by: inDays(5), expires_at: inDays(4) })).status, 400, 'book_by after expires_at');
  assert.equal((await post({ expires_at: inDays(8) })).status, 400, 'expires_at after the start');
  assert.equal((await post({ price_per_place_fjd: 0 })).status, 400);
  assert.equal((await post({ price_per_place_fjd: 50, cost_per_place_fjd: 60 })).status, 400, 'selling below cost');
  assert.equal((await post({ capacity: 0 })).status, 400);
  assert.equal((await post({ inclusions: '' })).status, 400);

  const naive = await post({ starts_at: '2030-12-01T09:00', book_by: '2030-11-30T09:00', expires_at: '2030-12-01T09:00' });
  assert.equal(naive.status, 201);
  const stored = await dbRow(env, 'SELECT starts_at FROM marau_experience_offers WHERE offer_id = ?', naive.data.offer_id);
  assert.equal(stored.starts_at, '2030-11-30T21:00:00.000Z', '09:00 Fiji time is 21:00 UTC the previous day');
  await call(env, `/preview/admin/offers/${naive.data.offer_id}/publish`, { method: 'POST', headers: staffH(env, 'staff-tok-ana') });
  const listed = (await browse(env)).data.offers[0];
  assert.match(listed.starts_at_fiji.time, /9:00/);
  assert.match(listed.starts_at_fiji.day, /Dec 1/);
});

// ---------------------------------------------------------------- browse anytime, personalisation

test('browse-anytime: every published offer is visible to everyone; personalisation only re-orders and flags, never filters; a stale token still browses', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const near = await publishedOffer(env, sid, { title: 'During-stay offer', starts_at: inDays(3), book_by: inDays(2), expires_at: inDays(2, 12) });
  const far = await publishedOffer(env, sid, { title: 'Later-in-year offer', starts_at: inDays(60), book_by: inDays(59), expires_at: inDays(59, 12) });
  const early = await publishedOffer(env, sid, { title: 'Earliest offer', starts_at: inDays(1), book_by: inDays(0, 5), expires_at: inDays(0, 12) });
  const guest = await newGuest(env, { pickup_datetime: inDays(2).slice(0, 16) });

  const anon = (await browse(env)).data;
  const mine = (await browse(env, guest.token)).data;
  assert.equal(anon.offers.length, 3);
  assert.equal(mine.offers.length, 3, 'personalisation must never hide an offer');
  assert.equal(anon.personalised, false);
  assert.equal(mine.personalised, true);
  assert.deepEqual(new Set(anon.offers.map((o) => o.offer_id)), new Set([near, far, early]));
  const flagged = mine.offers.filter((o) => o.suggested_for_you).map((o) => o.offer_id);
  assert.ok(flagged.includes(near));
  assert.ok(!flagged.includes(far));
  assert.equal(mine.offers[0].suggested_for_you, true, 'suggested offers sort first');

  const stale = await browse(env, 'tok_not_a_real_token');
  assert.equal(stale.status, 200);
  assert.equal(stale.data.offers.length, 3);
  assert.equal(stale.data.personalised, false);
});

test('privacy: public and guest responses never contain cost, fulfilment owner, other guests or staff names', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid);
  const a = await newGuest(env);
  const b = await newGuest(env);
  await request(env, a.token, offerId, { places: 1 });
  const publicText = (await browse(env)).text + (await browse(env, b.token)).text;
  for (const secret of ['cost_per_place', 'fulfilment_owner', 'Ana (ops)', 'Bala (ops)', 'preview.guest', '+15005550']) assert.equal(publicText.includes(secret), false, `public/guest browse leaked ${secret}`);
  const trip = await call(env, '/preview/trip', { headers: guestH(a.token) });
  assert.equal(trip.data.offer_requests.length, 1);
  assert.equal(JSON.stringify(trip.data.offer_requests).includes('cost'), false);
  assert.equal((await call(env, '/preview/trip', { headers: guestH(b.token) })).data.offer_requests.length, 0, 'another guest sees none of it');
});

// ---------------------------------------------------------------- request, holds, duplicates

test('request: holds places, charges nothing, snapshots the price, shows beside the trip, and is idempotent', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid, { price_per_place_fjd: 119.99 });
  const guest = await newGuest(env);

  const first = await request(env, guest.token, offerId, { places: 2, client_request_ref: 'retry-key-1' });
  assert.equal(first.status, 201);
  assert.match(first.data.request.reference, /^OFR-[A-Z0-9]{6}$/);
  assert.equal(first.data.request.status, 'requested');
  assert.equal(first.data.request.total_fjd, 239.98, 'integer-cent arithmetic: no floating-point drift');
  assert.ok(first.data.request.hold_expires_at);

  const retry = await request(env, guest.token, offerId, { places: 2, client_request_ref: 'retry-key-1' });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.existing, true);
  assert.equal(retry.data.request.request_id, first.data.request.request_id);
  const dupe = await request(env, guest.token, offerId, { places: 2 });
  assert.equal(dupe.data.existing, true, 'a repeated request without a key is still the same request');
  const different = await request(env, guest.token, offerId, { places: 3, client_request_ref: 'retry-key-1' });
  assert.equal(different.status, 409);
  assert.equal(different.data.error, 'CLIENT_REQUEST_REF_REUSED_WITH_DIFFERENT_REQUEST');
  assert.equal((await dbRow(env, 'SELECT COUNT(*) AS n FROM marau_offer_requests')).n, 1);

  const listed = (await browse(env, guest.token)).data.offers[0];
  assert.equal(listed.places_left, 2);
  assert.equal(listed.my_request.reference, first.data.request.reference);
  const trip = await call(env, '/preview/trip', { headers: guestH(guest.token) });
  assert.equal(trip.data.offer_requests[0].title, 'Synthetic snorkel morning');
  assert.equal(trip.data.offer_requests[0].status, 'requested');
});

test('request validation: places bounds, unauthenticated, wrong offer', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid, { capacity: 3 });
  const guest = await newGuest(env);
  assert.equal((await request(env, guest.token, offerId, { places: 0 })).status, 400);
  assert.equal((await request(env, guest.token, offerId, { places: 1.5 })).status, 400);
  assert.equal((await request(env, guest.token, offerId, { places: 9 })).status, 400);
  assert.equal((await request(env, 'tok_bad', offerId, { places: 1 })).status, 401);
  assert.equal((await request(env, guest.token, 'off_does_not_exist', { places: 1 })).status, 404);
  const tooMany = await request(env, guest.token, offerId, { places: 4 });
  assert.equal(tooMany.status, 409);
  assert.equal(tooMany.data.error, 'INSUFFICIENT_CAPACITY');
  assert.equal(tooMany.data.places_left, 3);
});

// ---------------------------------------------------------------- overselling

test('OVERSELLING is impossible under concurrency: capacity 2, five guests at once -> exactly 2 places are ever held', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid, { capacity: 2 });
  const guests = await Promise.all([1, 2, 3, 4, 5].map(() => newGuest(env)));
  const results = await Promise.all(guests.map((g) => request(env, g.token, offerId, { places: 1 })));
  assert.equal(results.filter((r) => r.status === 201).length, 2);
  assert.equal(results.filter((r) => r.status === 409 && r.data.error === 'SOLD_OUT').length, 3);
  const held = await dbRow(env, `SELECT COALESCE(SUM(places), 0) AS n FROM marau_offer_requests WHERE offer_id = ? AND status IN ('requested','confirmed','fulfilled')`, offerId);
  assert.equal(held.n, 2);
  const listed = (await browse(env)).data.offers[0];
  assert.equal(listed.places_left, 0);
  assert.equal(listed.state, 'sold_out');

  // And with unequal party sizes: capacity 3, requests of 2 and 2 -> only one fits.
  const offer2 = await publishedOffer(env, sid, { capacity: 3, title: 'Second synthetic offer' });
  const [g1, g2] = await Promise.all([newGuest(env), newGuest(env)]);
  const pair = await Promise.all([request(env, g1.token, offer2, { places: 2 }), request(env, g2.token, offer2, { places: 2 })]);
  assert.deepEqual(pair.map((r) => r.status).sort(), [201, 409]);
});

test('a lapsed hold releases its places and cannot be confirmed (it could oversell)', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid, { capacity: 1 });
  const [a, b] = await Promise.all([newGuest(env), newGuest(env)]);
  const first = await request(env, a.token, offerId, { places: 1 });
  assert.equal((await request(env, b.token, offerId, { places: 1 })).data.error, 'SOLD_OUT');

  await env.DB.prepare(`UPDATE marau_offer_requests SET hold_expires_at = ? WHERE request_id = ?`).bind(inDays(0, -1), first.data.request.request_id).run();
  const late = await staffAct(env, first.data.request.request_id, 'confirm');
  assert.equal(late.status, 409);
  assert.equal(late.data.error, 'HOLD_EXPIRED');
  assert.equal((await dbRow(env, 'SELECT status FROM marau_offer_requests WHERE request_id = ?', first.data.request.request_id)).status, 'expired');

  const second = await request(env, b.token, offerId, { places: 1 });
  assert.equal(second.status, 201, 'the lapsed hold\'s place is available again');
  // A guest whose hold expired can request again.
  await staffAct(env, second.data.request.request_id, 'decline', { note: 'synthetic' });
  assert.equal((await request(env, a.token, offerId, { places: 1 })).status, 201);
});

// ---------------------------------------------------------------- human confirmation

test('human confirmation: operator from the staff token, repeats change nothing, a second staff member cannot re-attribute, decline/fulfil/cancel/reverse are explicit', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid, { capacity: 6 });
  const [g1, g2, g3] = await Promise.all([newGuest(env), newGuest(env), newGuest(env)]);
  const r1 = (await request(env, g1.token, offerId, { places: 2 })).data.request.request_id;
  const r2 = (await request(env, g2.token, offerId, { places: 1 })).data.request.request_id;
  const r3 = (await request(env, g3.token, offerId, { places: 1 })).data.request.request_id;

  assert.equal((await call(env, `/preview/admin/offers/requests/${r1}/confirm`, { method: 'POST', headers: admin(env), body: {} })).status, 401, 'no staff identity, no decision');
  const ok = await staffAct(env, r1, 'confirm', { operator: 'Impersonated' }, 'staff-tok-ana');
  assert.equal(ok.status, 200);
  assert.equal(ok.data.request.status, 'confirmed');
  assert.equal((await dbRow(env, 'SELECT decided_by FROM marau_offer_requests WHERE request_id = ?', r1)).decided_by, 'Ana (ops)');

  const again = await staffAct(env, r1, 'confirm', {}, 'staff-tok-bala');
  assert.equal(again.data.repeated, true);
  assert.equal(again.data.original_operator, 'Ana (ops)');
  assert.equal((await dbRow(env, 'SELECT decided_by FROM marau_offer_requests WHERE request_id = ?', r1)).decided_by, 'Ana (ops)', 'a repeat never re-attributes');

  assert.equal((await staffAct(env, r2, 'decline', { note: 'supplier full that day' })).data.request.status, 'declined');
  assert.equal((await staffAct(env, r2, 'confirm')).status, 409, 'a declined request cannot be confirmed');
  assert.equal((await staffAct(env, r3, 'cancel', {})).status, 400, 'a cancellation needs a reason');
  assert.equal((await staffAct(env, r3, 'fulfil')).status, 409, 'cannot fulfil what was never confirmed');

  assert.equal((await staffAct(env, r1, 'fulfil')).data.request.status, 'fulfilled');
  assert.equal((await dbRow(env, 'SELECT fulfilled_by FROM marau_offer_requests WHERE request_id = ?', r1)).fulfilled_by, 'Ana (ops)');
  const reversal = await staffAct(env, r1, 'cancel', { note: 'guest refunded after no-show by supplier' });
  assert.equal(reversal.data.request.status, 'cancelled_by_staff', 'a fulfilled request can be reversed explicitly');
  const events = await env.DB.prepare(`SELECT event_type FROM marau_offer_events WHERE request_id = ? ORDER BY id`).bind(r1).all();
  assert.deepEqual(events.results.map((e) => e.event_type), ['request_created', 'request_confirmed', 'request_fulfilled', 'request_cancelled_by_staff']);
});

test('concurrent staff decisions on one request: exactly one wins; the loser sees the winner\'s result and nothing is re-attributed', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid);
  const g = await newGuest(env);
  const rid = (await request(env, g.token, offerId, { places: 1 })).data.request.request_id;
  const [a, b] = await Promise.all([staffAct(env, rid, 'confirm', {}, 'staff-tok-ana'), staffAct(env, rid, 'decline', { note: 'x' }, 'staff-tok-bala')]);
  const statuses = [a.status, b.status].sort();
  assert.ok(statuses[0] === 200 && statuses[1] === 409 || statuses[0] === 200 && statuses[1] === 200, JSON.stringify([a.data, b.data]));
  const row = await dbRow(env, 'SELECT status, decided_by FROM marau_offer_requests WHERE request_id = ?', rid);
  assert.ok(['confirmed', 'declined'].includes(row.status));
  assert.equal(row.decided_by, row.status === 'confirmed' ? 'Ana (ops)' : 'Bala (ops)');
});

// ---------------------------------------------------------------- deadline, expiry, withdrawal, cancellation

test('booking deadline and expiry are separate: after book_by the offer stays visible but cannot be requested; after expiry it disappears', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid);
  const guest = await newGuest(env);

  await env.DB.prepare('UPDATE marau_experience_offers SET book_by = ? WHERE offer_id = ?').bind(inDays(0, -1), offerId).run();
  const listed = (await browse(env)).data.offers.find((o) => o.offer_id === offerId);
  assert.equal(listed.state, 'deadline_passed');
  const late = await request(env, guest.token, offerId, { places: 1 });
  assert.equal(late.status, 409);
  assert.equal(late.data.error, 'BOOKING_DEADLINE_PASSED');

  await env.DB.prepare('UPDATE marau_experience_offers SET expires_at = ? WHERE offer_id = ?').bind(inDays(0, -1), offerId).run();
  assert.equal((await browse(env)).data.offers.length, 0);
  const expired = await request(env, guest.token, offerId, { places: 1 });
  assert.equal(expired.status, 410);
  assert.equal(expired.data.error, 'OFFER_EXPIRED');
  assert.equal((await dbRow(env, 'SELECT COUNT(*) AS n FROM marau_offer_requests')).n, 0, 'a refused request leaves no row behind');
});

test('withdrawal: closes the offer, declines open requests, does NOT silently cancel confirmed guests (they are flagged for a human), and blocks new requests and confirmations', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid, { capacity: 5 });
  const [g1, g2, g3] = await Promise.all([newGuest(env), newGuest(env), newGuest(env)]);
  const confirmedId = (await request(env, g1.token, offerId, { places: 1 })).data.request.request_id;
  const openId = (await request(env, g2.token, offerId, { places: 1 })).data.request.request_id;
  await staffAct(env, confirmedId, 'confirm');

  const noReason = await call(env, `/preview/admin/offers/${offerId}/withdraw`, { method: 'POST', headers: staffH(env, 'staff-tok-ana'), body: {} });
  assert.equal(noReason.status, 400);
  const w = await call(env, `/preview/admin/offers/${offerId}/withdraw`, { method: 'POST', headers: staffH(env, 'staff-tok-ana'), body: { reason: 'supplier boat out of service' } });
  assert.equal(w.status, 200);
  assert.equal(w.data.declined_open_requests, 1);
  assert.equal(w.data.confirmed_guests_needing_human_follow_up, 1);

  assert.equal((await dbRow(env, 'SELECT status FROM marau_offer_requests WHERE request_id = ?', openId)).status, 'declined');
  assert.equal((await dbRow(env, 'SELECT status FROM marau_offer_requests WHERE request_id = ?', confirmedId)).status, 'confirmed');
  assert.equal((await browse(env)).data.offers.length, 0);
  assert.equal((await request(env, g3.token, offerId, { places: 1 })).status, 410);
  const flagged = (await call(env, '/preview/admin/offers/requests?status=confirmed', { headers: staffH(env, 'staff-tok-ana') })).data.requests;
  assert.equal(flagged[0].needs_human_follow_up, true);
  const repeat = await call(env, `/preview/admin/offers/${offerId}/withdraw`, { method: 'POST', headers: staffH(env, 'staff-tok-ana'), body: { reason: 'again' } });
  assert.equal(repeat.data.changed, false, 'withdrawing twice is harmless');
});

test('guest cancellation: releases places before the deadline, is blocked after it, is idempotent, and only the owner can cancel', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid, { capacity: 1 });
  const [a, b] = await Promise.all([newGuest(env), newGuest(env)]);
  const rid = (await request(env, a.token, offerId, { places: 1 })).data.request.request_id;
  assert.equal((await call(env, `/preview/offers/requests/${rid}/cancel`, { method: 'POST', headers: guestH(b.token) })).status, 404, 'another guest cannot cancel it');
  const c = await call(env, `/preview/offers/requests/${rid}/cancel`, { method: 'POST', headers: guestH(a.token) });
  assert.equal(c.data.request.status, 'cancelled_by_guest');
  assert.equal((await call(env, `/preview/offers/requests/${rid}/cancel`, { method: 'POST', headers: guestH(a.token) })).data.already, true);
  assert.equal((await request(env, b.token, offerId, { places: 1 })).status, 201, 'the place is free again');

  const rid2 = (await request(env, a.token, offerId, { places: 1 }));
  assert.equal(rid2.data.error, 'SOLD_OUT');
  await env.DB.prepare(`UPDATE marau_experience_offers SET book_by = ? WHERE offer_id = ?`).bind(inDays(0, -1), offerId).run();
  const bReq = await dbRow(env, `SELECT request_id FROM marau_offer_requests WHERE guest_session_id != ? AND status = 'requested'`, (await dbRow(env, 'SELECT guest_session_id FROM marau_offer_requests WHERE request_id = ?', rid)).guest_session_id);
  const after = await call(env, `/preview/offers/requests/${bReq.request_id}/cancel`, { method: 'POST', headers: guestH(b.token) });
  assert.equal(after.status, 409);
  assert.equal(after.data.error, 'CANCELLATION_WINDOW_CLOSED');
});

// ---------------------------------------------------------------- WhatsApp handoff (mock)

test('private WhatsApp enquiry: retains offer and reference, is composed only for the owner, contains no contact details, builds no wa.me link, sends nothing', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid);
  const [a, b] = await Promise.all([newGuest(env), newGuest(env)]);
  const made = (await request(env, a.token, offerId, { places: 2 })).data.request;
  const h = await call(env, `/preview/offers/requests/${made.request_id}/whatsapp-handoff`, { method: 'POST', headers: guestH(a.token) });
  assert.equal(h.status, 200);
  assert.equal(h.data.handoff.reference, made.reference);
  assert.equal(h.data.handoff.offer_id, offerId);
  assert.match(h.data.handoff.message, new RegExp(made.reference));
  assert.match(h.data.handoff.message, /Synthetic snorkel morning/);
  assert.match(h.data.handoff.message, /FJ\$240\.00 total/);
  assert.match(h.data.handoff.message, /Fiji time/);
  assert.match(h.data.handoff.note, /never sends/i);
  assert.equal(/wa\.me|https?:/.test(h.text), false);
  assert.equal(h.text.includes('preview.guest') || h.text.includes('+15005550'), false);
  assert.equal((await call(env, `/preview/offers/requests/${made.request_id}/whatsapp-handoff`, { method: 'POST', headers: guestH(b.token) })).status, 404);
});

// ---------------------------------------------------------------- editions

test('editionSlotAt: Fiji-local morning (07:00) and afternoon (14:00) boundaries', () => {
  const at = (fijiWall) => editionSlotAt(new Date(`${fijiWall}:00+12:00`).getTime(), toFijiWallClockInputValue);
  assert.equal(at('2026-10-10T06:59').current_slot, null);
  assert.equal(at('2026-10-10T06:59').next_slot, 'morning');
  assert.equal(at('2026-10-10T07:00').current_slot, 'morning');
  assert.equal(at('2026-10-10T13:59').current_slot, 'morning');
  assert.equal(at('2026-10-10T13:59').next_slot, 'afternoon');
  assert.equal(at('2026-10-10T14:00').current_slot, 'afternoon');
  assert.equal(at('2026-10-10T23:59').current_slot, 'afternoon');
  assert.equal(at('2026-10-10T23:59').fiji_date, '2026-10-10');
  // 11:30 UTC on the 9th is 23:30 Fiji on the 9th; 12:30 UTC is 00:30 Fiji on the 10th - the Fiji date, not the UTC date, rules.
  assert.equal(editionSlotAt(Date.UTC(2026, 9, 9, 12, 30), toFijiWallClockInputValue).fiji_date, '2026-10-10');
});

test('editions: prepared for a Fiji date, only PUBLISHED editions surface, they cannot contain an unpublished offer, and browsing every offer is unaffected', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const inMorning = await publishedOffer(env, sid, { title: 'Featured in the morning' });
  const inAfternoon = await publishedOffer(env, sid, { title: 'Featured in the afternoon' });
  const featuredNowhere = await publishedOffer(env, sid, { title: 'In no edition' });
  const today = toFijiWallClockInputValue(new Date().toISOString()).slice(0, 10);

  const prep = (slot, ids) => call(env, '/preview/admin/editions', { method: 'POST', headers: staffH(env, 'staff-tok-ana'), body: { fiji_date: today, slot, offer_ids: ids } });
  assert.equal((await prep('morning', [inMorning])).status, 201);
  assert.equal((await prep('midday', [inMorning])).status, 400);
  assert.equal((await prep('morning', [])).status, 400);
  assert.equal((await prep('afternoon', ['off_missing'])).status, 404);

  let pub = (await browse(env)).data;
  assert.deepEqual(pub.editions.morning, [], 'a DRAFT edition is not visible');
  assert.equal(pub.editions.fiji_date, today);

  await call(env, `/preview/admin/editions/${today}:morning/publish`, { method: 'POST', headers: staffH(env, 'staff-tok-ana') });
  assert.equal((await prep('morning', [inMorning, inAfternoon])).status, 409, 'a published edition is immutable');
  await prep('afternoon', [inAfternoon]);
  await call(env, `/preview/admin/editions/${today}:afternoon/publish`, { method: 'POST', headers: staffH(env, 'staff-tok-ana') });

  pub = (await browse(env)).data;
  assert.deepEqual(pub.editions.morning, [inMorning]);
  assert.deepEqual(pub.editions.afternoon, [inAfternoon]);
  assert.deepEqual(pub.offers.find((o) => o.offer_id === inMorning).in_editions, ['morning']);
  assert.equal(pub.offers.length, 3, 'browse-anytime: the offer in no edition is still listed');
  assert.ok(pub.offers.some((o) => o.offer_id === featuredNowhere));

  const draftOffer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env, 'staff-tok-ana'), body: { supplier_id: sid, title: 'Still a draft', location: 'x y', inclusions: 'z', starts_at: inDays(5), capacity: 2, price_per_place_fjd: 30 } });
  await prep('afternoon', [draftOffer.data.offer_id]); // already published -> 409 above; use a fresh date instead
  const otherDate = await call(env, '/preview/admin/editions', { method: 'POST', headers: staffH(env, 'staff-tok-ana'), body: { fiji_date: '2031-01-01', slot: 'morning', offer_ids: [draftOffer.data.offer_id] } });
  assert.equal(otherDate.status, 201);
  const blocked = await call(env, '/preview/admin/editions/2031-01-01:morning/publish', { method: 'POST', headers: staffH(env, 'staff-tok-ana') });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error, 'EDITION_CONTAINS_UNPUBLISHED_OFFER');
});

// ---------------------------------------------------------------- missing WhatsApp, reporting

test('missing WhatsApp: the guest can still book and request; staff see an email fallback with a named owner; contact facts are staff-only', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env, { owner: 'Bala (ops)' });
  const offerId = await publishedOffer(env, sid);
  const guest = await newGuest(env, { whatsapp_available: false });
  assert.equal((await request(env, guest.token, offerId, { places: 1 })).status, 201);
  const staffView = (await call(env, '/preview/admin/offers/requests', { headers: staffH(env, 'staff-tok-ana') })).data.requests[0];
  assert.equal(staffView.contact.whatsapp_available, false);
  assert.equal(staffView.follow_up.channel, 'email');
  assert.equal(staffView.follow_up.owner, 'Bala (ops)');
  assert.equal(staffView.follow_up.owner_missing, false);
  assert.ok(staffView.contact.email && staffView.contact.phone, 'both phone and email are held for staff');
});

test('report: quoted value, confirmed sales and contribution are separate and honestly labelled; nothing is called revenue', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  const offerId = await publishedOffer(env, sid, { capacity: 10, price_per_place_fjd: 100, cost_per_place_fjd: 60 });
  const gs = await Promise.all([1, 2, 3, 4].map(() => newGuest(env)));
  const ids = [];
  for (const [i, g] of gs.entries()) ids.push((await request(env, g.token, offerId, { places: i + 1 })).data.request.request_id); // 1,2,3,4 places
  await staffAct(env, ids[1], 'confirm');             // 2 places confirmed
  await staffAct(env, ids[2], 'confirm');             // 3 places confirmed
  await staffAct(env, ids[2], 'fulfil');              // 3 places fulfilled
  await staffAct(env, ids[3], 'decline', { note: 'n' });

  const rep = (await call(env, '/preview/admin/offers/report', { headers: staffH(env, 'staff-tok-ana') })).data;
  assert.equal(rep.requests_total, 4);
  assert.equal(rep.requests_open_awaiting_human, 1);
  assert.equal(rep.requests_confirmed, 1);
  assert.equal(rep.requests_fulfilled, 1);
  assert.equal(rep.quoted_value_open_fjd, 100, 'one open request of 1 place at FJ$100');
  assert.equal(rep.confirmed_sales_value_fjd, 500, '(2 + 3) places x FJ$100');
  assert.equal(rep.fulfilled_sales_value_fjd, 300);
  assert.equal(rep.expected_contribution_fjd_before_rewards, 200, '5 places x (100 - 60)');
  assert.equal(rep.realised_contribution_fjd_before_rewards, 120, '3 places x (100 - 60)');
  assert.match(rep.labels.quoted_value, /NOT revenue/);
  assert.equal(JSON.stringify(rep).toLowerCase().includes('"revenue'), false, 'no field is named as revenue');
  assert.equal((await call(env, '/preview/admin/offers/report', { headers: admin(env) })).status, 401);
});

test('staff list shows cost and fulfilment owner; requires the staff identity', async () => {
  const env = await setup();
  const sid = await verifiedSupplier(env);
  await publishedOffer(env, sid);
  const staffList = await call(env, '/preview/admin/offers', { headers: staffH(env, 'staff-tok-bala') });
  assert.equal(staffList.data.offers[0].cost_per_place_fjd, 80);
  assert.equal(staffList.data.offers[0].fulfilment_owner, 'Ana (ops)');
  assert.equal((await call(env, '/preview/admin/offers', { headers: admin(env) })).status, 401);
});
