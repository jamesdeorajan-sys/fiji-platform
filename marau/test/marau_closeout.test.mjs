/* Marau (PREVIEW/TEST ONLY) - CLOSEOUT round: refund-before-payment, late-write interleavings, mirror source shapes, policy-change
 * behaviour. Synthetic data; default-deny network. Evidence label: LOCAL, AUTHOR-RUN. Reward amounts are SYNTHETIC test values.
 * Written red-first against commit 83e... see docs/MARAU_RELEASE_CANDIDATE.md for the before/after table.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest } from './fixtures.mjs';
import worker, { createGuestSession, createSessionAndOfferLink, nowIso } from '../worker/worker.js';
import { normalizePickupDatetime } from '../worker/fiji_time.js';
import { syncRealBookingEvent } from '../worker/real_booking_sync.js';
import { classifyLeg, classifyMirroredShape } from '../worker/leg_type.js';

installNetworkGuard();

const call = async (env, path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await worker.fetch(new Request('http://marau.test' + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text };
};
const admin = (env) => ({ authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}` });
const staffH = (env, token = 'staff-tok-ana') => ({ ...admin(env), 'x-marau-staff-token': token });
const guestH = (t) => ({ authorization: `Bearer ${t}` });
const inDays = (d, h = 0) => new Date(Date.now() + d * 86400_000 + h * 3600_000).toISOString();
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results.map((r) => ({ ...r }));
const POLICY = { mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 20, min_purchase_fjd: 0, qualify_on: 'fulfilled', require_payment: 'paid_in_full' };

async function setup(policy = POLICY) {
  const env = makeEnv();
  for (const [tok, name] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: tok, operator_name: name } });
  const p = await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: policy }); assert.equal(p.status, 200, JSON.stringify(p.data));
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Reef Tours', fulfilment_owner: 'Ana (ops)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
  const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title: 'Synthetic snorkel', location: 'Reef (synthetic)', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 20, price_per_place_fjd: 120, cost_per_place_fjd: 80 } });
  await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });
  return { env, offerId: offer.data.offer_id };
}
async function newGuest(env, over = {}) {
  const res = await call(env, '/preview/bookings', { method: 'POST', body: synthGuest({ leg_type: 'arrival', ...over }) });
  assert.equal(res.status, 201);
  const s = await one(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', res.data.access_token);
  return { token: res.data.access_token, sessionId: s.session_id };
}
async function addReturnLeg(env, sessionId, { amount = 100, days = 12, leg = 'return' } = {}) {
  const g = await one(env, 'SELECT guest_email, guest_phone FROM guest_sessions WHERE session_id = ?', sessionId);
  const ref = `RET-${Math.random().toString(36).slice(2, 8)}`;
  await env.DB.prepare(`INSERT INTO marau_test_bookings (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, test_data, created_at, updated_at, leg_type) VALUES (?, ?, ?, ?, 'DENARAU', 'NAD_AIRPORT', 'Sedan', ?, ?, 'pending', 1, ?, ?, ?)`)
    .bind(ref, sessionId, g.guest_email, g.guest_phone, inDays(days), amount, new Date().toISOString(), new Date().toISOString(), leg).run();
  return (await one(env, 'SELECT id FROM marau_test_bookings WHERE client_booking_ref = ?', ref)).id;
}
const codeOf = async (env, token) => (await call(env, '/preview/referral', { headers: guestH(token) })).data.code;
async function friendOf(env, referrerToken) {
  const res = await call(env, '/preview/bookings', { method: 'POST', body: { ...synthGuest({ leg_type: 'arrival' }), referral_code: await codeOf(env, referrerToken) } });
  return { token: res.data.access_token };
}
const buy = async (env, token, offerId) => (await call(env, `/preview/offers/${offerId}/request`, { method: 'POST', headers: guestH(token), body: { places: 1 } })).data.request.request_id;
const act = (env, rid, action, body = {}, tok = 'staff-tok-ana') => call(env, `/preview/admin/offers/requests/${rid}/${action}`, { method: 'POST', headers: staffH(env, tok), body });
const pay = (env, rid, body, tok = 'staff-tok-ana') => call(env, `/preview/admin/offers/requests/${rid}/payment`, { method: 'POST', headers: staffH(env, tok), body });
const apply = (env, creditId, bookingId, extra = {}, tok = 'staff-tok-ana') => call(env, `/preview/admin/rewards/credits/${creditId}/apply`, { method: 'POST', headers: staffH(env, tok), body: { booking_id: bookingId, ...extra } });
const credits = (env) => all(env, 'SELECT * FROM marau_reward_credits ORDER BY created_at, credit_id');

function gate(env, matcher, { after = false } = {}) {
  const real = env.DB;
  let release; const hold = new Promise((r) => { release = r; });
  let reachedResolve; const reached = new Promise((r) => { reachedResolve = r; });
  let armed = true;
  const pause = async () => { armed = false; reachedResolve(true); await hold; };
  const wrap = (st) => {
    const m = (name) => async (...a) => { if (armed && matcher.test(st.sql)) { if (after) { const out = await st[name](...a); await pause(); return out; } await pause(); } return st[name](...a); };
    return { sql: st.sql, boundArgs: st.boundArgs, bind: (...a) => wrap(st.bind(...a)), first: m('first'), all: m('all'), run: m('run'), __raw: st };
  };
  env.DB = { ...real, prepare: (sql) => wrap(real.prepare(sql)), batch: async (stmts) => { if (armed && stmts.some((s) => matcher.test(s.sql))) await pause(); return real.batch(stmts.map((s) => s.__raw || s)); } };
  return { reachedWithin: (ms = 300) => Promise.race([reached, new Promise((r) => setTimeout(() => r(false), ms))]), release, restore() { env.DB = real; } };
}

// ============================================================ 1. REFUND BEFORE PAYMENT

test('ORDERING: a refund delivered BEFORE its payment record is retained, flagged as awaiting its payment, and reconciles when the payment arrives - the refund is never lost', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env); const friend = await friendOf(env, referrer.token);
  const rid = await buy(env, friend.token, offerId);
  await act(env, rid, 'confirm');
  assert.deepEqual((await credits(env)).map((c) => c.status), ['pending']);

  const refund = await pay(env, rid, { event: 'refunded', amount_fjd: 120, method: 'card', event_key: 'rf-1' });
  assert.equal(refund.status, 200, JSON.stringify(refund.data));
  assert.equal(refund.data.reconciliation.status, 'refund_awaiting_payment_record');
  assert.equal(refund.data.reconciliation.unmatched_refund_fjd, 120);
  assert.equal((await all(env, 'SELECT * FROM marau_offer_payments')).length, 1, 'the refund is stored');
  assert.deepEqual((await credits(env)).map((c) => c.status), ['reversed'], 'a refund can never leave a promised credit standing, even before its payment is recorded');

  const paid = await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'card', event_key: 'pd-1' });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal(paid.data.reconciliation.status, 'matched');
  assert.equal(paid.data.totals.net_paid_fjd, 0);
  assert.equal((await all(env, 'SELECT * FROM marau_offer_payments')).length, 2, 'both events kept');
  await act(env, rid, 'fulfil');
  assert.deepEqual((await credits(env)).map((c) => c.status), ['reversed'], 'the late payment record never resurrects the credit');
  const view = (await call(env, '/preview/admin/offers/requests', { headers: staffH(env) })).data.requests[0];
  assert.equal(view.payment.status, 'refunded');
  assert.equal(view.payment.reconciliation, 'matched');
});

test('ORDERING: the supported matrix - replays are no-ops, a refund may not exceed the purchase total, gross payments may not exceed it, an unpayable request refuses evidence', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env); const friend = await friendOf(env, referrer.token);
  const rid = await buy(env, friend.token, offerId);
  assert.equal((await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'x' })).status, 409, 'still only requested: not payable');
  await act(env, rid, 'confirm');
  assert.equal((await pay(env, rid, { event: 'refunded', amount_fjd: 130, method: 'card', event_key: 'big' })).data.error, 'REFUND_EXCEEDS_TOTAL');
  const r1 = await pay(env, rid, { event: 'refunded', amount_fjd: 120, method: 'card', event_key: 'rf' });
  const r2 = await pay(env, rid, { event: 'refunded', amount_fjd: 120, method: 'card', event_key: 'rf' });
  assert.equal(r1.status, 200); assert.equal(r2.data.repeated, true);
  assert.equal((await pay(env, rid, { event: 'refunded', amount_fjd: 10, method: 'card', event_key: 'more' })).data.error, 'REFUND_EXCEEDS_TOTAL', 'cumulative refunds are bounded by the total');
  assert.equal((await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'card', event_key: 'p1' })).status, 200);
  assert.equal((await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'card', event_key: 'p2' })).data.error, 'OVERPAYMENT', 'a re-payment after a refund must be a NEW purchase');
  assert.equal((await all(env, 'SELECT * FROM marau_offer_payments')).length, 2);
});

// ============================================================ 2. LATE WRITES / INTERLEAVINGS

const EARN_ON_CONFIRM = { ...POLICY, qualify_on: 'confirmed', require_payment: 'none' };
const readCredit = /SELECT credit_id, status FROM marau_reward_credits WHERE qualifying_request_id/;

test('LATE WRITE (insert): a cancellation lands after the qualification facts were read but before the credit is inserted - no redeemable credit may result', async () => {
  const { env, offerId } = await setup(EARN_ON_CONFIRM);
  const referrer = await newGuest(env); const returnId = await addReturnLeg(env, (await one(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', referrer.token)).session_id);
  const friend = await friendOf(env, referrer.token);
  const rid = await buy(env, friend.token, offerId);
  const g = gate(env, readCredit, { after: true });
  const confirming = act(env, rid, 'confirm');
  assert.ok(await g.reachedWithin(), 'the confirm hook has read its facts and is paused before writing');
  assert.equal((await act(env, rid, 'cancel', { note: 'cancelled mid qualification' })).status, 200);
  g.release(); g.restore();
  await confirming;
  const live = (await credits(env)).filter((c) => c.status !== 'reversed');
  assert.deepEqual(live, [], `no live credit may exist for a cancelled purchase (found ${JSON.stringify(live.map((c) => c.status))})`);
  for (const c of await credits(env)) assert.equal((await apply(env, c.credit_id, returnId)).status, 409);
});

test('LATE WRITE (insert): a REFUND recorded in the same window cannot leave an earned credit either', async () => {
  const { env, offerId } = await setup({ ...POLICY, qualify_on: 'confirmed', require_payment: 'none' });
  const referrer = await newGuest(env); const friend = await friendOf(env, referrer.token);
  const rid = await buy(env, friend.token, offerId);
  const g = gate(env, readCredit, { after: true });
  const confirming = act(env, rid, 'confirm');
  assert.ok(await g.reachedWithin());
  await env.DB.prepare(`INSERT INTO marau_offer_payments (payment_id, request_id, event_type, amount_cents, method, event_key, recorded_by, created_at) VALUES ('pay_r', ?, 'refunded', 12000, 'card', 'late-refund', 'Bala (ops)', ?)`).bind(rid, new Date().toISOString()).run();
  g.release(); g.restore();
  await confirming;
  assert.deepEqual((await credits(env)).filter((c) => c.status === 'earned' || c.status === 'pending'), []);
});

test('LATE WRITE (promotion): a refund lands between reading the facts and promoting a pending credit to earned - the credit never becomes redeemable', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env); const returnId = await addReturnLeg(env, (await one(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', referrer.token)).session_id);
  const friend = await friendOf(env, referrer.token);
  const rid = await buy(env, friend.token, offerId);
  await act(env, rid, 'confirm');
  await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'p' });
  assert.deepEqual((await credits(env)).map((c) => c.status), ['pending']);
  const g = gate(env, readCredit, { after: true });
  const fulfilling = act(env, rid, 'fulfil');
  assert.ok(await g.reachedWithin(), 'paused after the facts were read (paid + fulfilled => would promote)');
  await env.DB.prepare(`INSERT INTO marau_offer_payments (payment_id, request_id, event_type, amount_cents, method, event_key, recorded_by, created_at) VALUES ('pay_r2', ?, 'refunded', 12000, 'card', 'late-refund', 'Bala (ops)', ?)`).bind(rid, new Date().toISOString()).run();
  g.release(); g.restore();
  await fulfilling;
  const [c] = await credits(env);
  assert.notEqual(c.status, 'earned', `the credit must not be earned for a refunded purchase (is ${c.status})`);
  assert.equal((await apply(env, c.credit_id, returnId)).status, 409);
});

test('RECOVERY WITHOUT GUEST ACTION: a stale redeemable credit for an ineligible purchase is reversed by the next STAFF read, and apply refuses it in the same statement', async () => {
  const { env, offerId } = await setup(EARN_ON_CONFIRM);
  const referrer = await newGuest(env); const sid = (await one(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', referrer.token)).session_id;
  const returnId = await addReturnLeg(env, sid);
  const friend = await friendOf(env, referrer.token);
  const rid = await buy(env, friend.token, offerId);
  await act(env, rid, 'confirm');
  const [credit] = await credits(env);
  assert.equal(credit.status, 'earned');
  // The purchase is cancelled by a path that never ran the hook (a crash after the status write).
  await env.DB.prepare(`UPDATE marau_offer_requests SET status = 'cancelled_by_staff' WHERE request_id = ?`).bind(rid).run();
  assert.equal((await apply(env, credit.credit_id, returnId)).status, 409, 'apply itself refuses a credit whose purchase is no longer eligible');
  const listed = await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) });
  assert.equal(listed.status, 200);
  assert.equal((await credits(env))[0].status, 'reversed', 'the staff read swept it - no guest interaction was needed');
  // And a refund row whose hook never ran (crash after the ledger insert):
  const f2 = await friendOf(env, referrer.token);
  const rid2 = await buy(env, f2.token, offerId);
  await act(env, rid2, 'confirm');
  await env.DB.prepare(`INSERT INTO marau_offer_payments (payment_id, request_id, event_type, amount_cents, method, event_key, recorded_by, created_at) VALUES ('pay_r3', ?, 'refunded', 12000, 'card', 'orphan-refund', 'Bala (ops)', ?)`).bind(rid2, new Date().toISOString()).run();
  await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) });
  assert.equal((await all(env, 'SELECT status FROM marau_reward_credits WHERE qualifying_request_id = ?', rid2))[0].status, 'reversed');
});

test('RECOVERY: a credit whose qualifying facts are all true but whose promotion never ran (payment recorded, hook lost) is promoted by the next staff read', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env); const friend = await friendOf(env, referrer.token);
  const rid = await buy(env, friend.token, offerId);
  await act(env, rid, 'confirm'); await act(env, rid, 'fulfil');
  assert.deepEqual((await credits(env)).map((c) => c.status), ['pending']);
  await env.DB.prepare(`INSERT INTO marau_offer_payments (payment_id, request_id, event_type, amount_cents, method, event_key, recorded_by, created_at) VALUES ('pay_p', ?, 'paid', 12000, 'cash', 'lost-hook', 'Ana (ops)', ?)`).bind(rid, new Date().toISOString()).run();
  await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) });
  assert.deepEqual((await credits(env)).map((c) => c.status), ['earned']);
});

// ============================================================ 3. THE RETURN MIRROR: source record shapes

const row = (over = {}) => ({ id: 9900 + Math.floor(Math.random() * 1e5), source_booking_ref: `shape-${Math.random().toString(36).slice(2, 9)}`, guest_email: `shape${Math.random().toString(36).slice(2, 7)}@example.test`, guest_phone: `+15005550${Math.floor(100 + Math.random() * 899)}`, whatsapp_available: null, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', pickup_date: '2031-10-05', pickup_time: '09:00', quoted_amount: 90, assigned_driver_id: 'drv_1', status: 'accepted', return_date: null, return_time: null, return_pickup_location: null, trip_type: 'one-way', ...over });
const sourceOf = (...rows) => { const m = new Map(rows.map((r) => [String(r.source_booking_ref), { ...r }])); return { reader: async (ref) => (m.has(String(ref)) ? { ...m.get(String(ref)) } : null) }; };
let ev = 90000;
async function mirror(env, r) {
  const res = await syncRealBookingEvent(env, r.source_booking_ref, { event_type: 'created', new_status: 'accepted', source_event_id: ++ev, booking_id: r.id }, { createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime, reader: sourceOf(r).reader });
  const m = await one(env, 'SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?', r.source_booking_ref);
  return { res, m };
}

test('MIRROR SHAPES: the classifier reports each representative source shape explicitly - direction is never equated with a round-trip relationship', () => {
  const cases = [
    ['one-way arrival', row(), { leg_type: 'arrival', shape: 'one_way_arrival', credit_basis: 'none' }],
    ['arrival AND return held in ONE booking', row({ trip_type: 'return', return_date: '2031-10-12', return_time: '10:00', return_pickup_location: 'Denarau' }), { leg_type: 'round_trip', shape: 'round_trip_single_booking', credit_basis: 'unsupported' }],
    ['round trip, direction not airport related', row({ pickup_zone: 'Denarau', destination_zone: 'Coral Coast', return_date: '2031-10-12' }), { leg_type: 'round_trip', shape: 'round_trip_single_booking', credit_basis: 'unsupported' }],
    ['standalone hotel-to-airport departure', row({ pickup_zone: 'Denarau', destination_zone: 'Nadi Airport' }), { leg_type: 'departure', shape: 'standalone_departure', credit_basis: 'needs_staff_confirmation' }],
    ['a field that LOOKS like a link to an original booking is ignored (the source has no such contract)', row({ pickup_zone: 'Denarau', destination_zone: 'Nadi Airport', original_booking_id: 123, parent_booking_ref: 'x' }), { leg_type: 'departure', shape: 'standalone_departure', credit_basis: 'needs_staff_confirmation' }],
    ['airport to airport', row({ pickup_zone: 'Nadi Airport', destination_zone: 'Nausori Airport' }), { leg_type: 'other', shape: 'direction_not_a_holiday_leg', credit_basis: 'unsupported' }],
    ['neither end is an airport', row({ pickup_zone: 'Denarau', destination_zone: 'Coral Coast' }), { leg_type: 'other', shape: 'direction_not_a_holiday_leg', credit_basis: 'unsupported' }],
    ['a missing location', row({ pickup_zone: '' }), { leg_type: 'unclassified', shape: 'missing_or_ambiguous_location', credit_basis: 'unsupported' }],
    ['source row does not provide the itinerary fields at all (cannot rule out a round trip)', (() => { const r = row(); delete r.return_date; delete r.return_time; delete r.return_pickup_location; delete r.trip_type; return r; })(), { leg_type: 'unclassified', shape: 'itinerary_fields_not_provided', credit_basis: 'unsupported' }],
  ];
  for (const [label, r, expected] of cases) {
    const c = classifyMirroredShape(r);
    assert.deepEqual({ leg_type: c.leg_type, shape: c.shape, credit_basis: c.credit_basis }, expected, label);
  }
  assert.equal(classifyLeg('Denarau', 'Nadi Airport'), 'departure');
  assert.equal(classifyLeg('Nadi Airport', 'Denarau'), 'arrival');
});

test('MIRROR SHAPES: through the real sync path each shape lands with its leg type and shape recorded; unusable rows are refused, never guessed', async () => {
  const env = makeEnv();
  const shapes = [
    ['one-way arrival', row(), 'arrival', 'one_way_arrival'],
    ['round trip in one booking', row({ trip_type: 'return', return_date: '2031-10-12', return_time: '10:00' }), 'round_trip', 'round_trip_single_booking'],
    ['standalone departure', row({ pickup_zone: 'Denarau', destination_zone: 'Nadi Airport' }), 'departure', 'standalone_departure'],
    ['airport to airport', row({ pickup_zone: 'Nadi Airport', destination_zone: 'Nausori Airport' }), 'other', 'direction_not_a_holiday_leg'],
  ];
  for (const [label, r, leg, shape] of shapes) {
    const { res, m } = await mirror(env, r);
    assert.equal(res.ok, true, `${label}: ${JSON.stringify(res)}`);
    assert.deepEqual([m.leg_type, m.leg_shape], [leg, shape], label);
  }
  const noDate = await mirror(env, row({ pickup_date: null, pickup_time: null }));
  assert.equal(noDate.res.ok, false); assert.equal(noDate.m, null, 'a row with no pickup date/time is not mirrored');
  const noZone = await mirror(env, row({ destination_zone: null }));
  assert.equal(noZone.res.ok, false); assert.equal(noZone.m, null, 'a row with a missing location is not mirrored');
  const bad = await mirror(env, row({ pickup_date: 'next tuesday' }));
  assert.equal(bad.res.ok, false); assert.equal(bad.m, null, 'an ambiguous date is not mirrored');
  // When a later source read re-shapes the booking (a return is added to a one-way), the stored shape follows the source.
  const arr = row();
  await mirror(env, arr);
  const updated = { ...arr, trip_type: 'return', return_date: '2031-10-12', return_time: '10:00' };
  await syncRealBookingEvent(env, arr.source_booking_ref, { event_type: 'accepted', new_status: 'accepted', source_event_id: ++ev, booking_id: arr.id }, { createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime, reader: sourceOf(updated).reader });
  assert.deepEqual(Object.values(await one(env, 'SELECT leg_type, leg_shape FROM marau_test_bookings WHERE source_booking_ref = ?', arr.source_booking_ref)), ['round_trip', 'round_trip_single_booking']);
});

test('CREDIT ELIGIBILITY BY SHAPE: a declared Marau return applies; a standalone departure needs explicit staff confirmation (recorded); a round trip and an unclassified row never apply', async () => {
  const { env, offerId } = await setup({ ...POLICY, cap_per_referrer_fjd: 100 });
  const referrer = await newGuest(env); const sid = (await one(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', referrer.token)).session_id;
  const earned = async () => { const f = await friendOf(env, referrer.token); const r = await buy(env, f.token, offerId); await act(env, r, 'confirm'); await pay(env, r, { event: 'paid', amount_fjd: 120, method: 'cash', event_key: `p-${r}` }); await act(env, r, 'fulfil'); return (await credits(env)).at(-1).credit_id; };
  const give = async (r) => { const { m } = await mirror(env, r); await env.DB.prepare('UPDATE marau_test_bookings SET guest_session_id = ? WHERE id = ?').bind(sid, m.id).run(); return m.id; };

  const declared = await addReturnLeg(env, sid, { leg: 'return' });
  const departure = await give(row({ pickup_zone: 'Denarau', destination_zone: 'Nadi Airport', pickup_date: '2031-11-01' }));
  const roundTrip = await give(row({ pickup_zone: 'Denarau', destination_zone: 'Nadi Airport', return_date: '2031-11-09', trip_type: 'return', pickup_date: '2031-11-02' }));
  const unclassified = await give(row({ pickup_zone: 'Denarau', destination_zone: 'Coral Coast', pickup_date: '2031-11-03' }));

  const c1 = await earned();
  assert.equal((await apply(env, c1, declared)).status, 200, 'a return declared in Marau applies as before');
  const c2 = await earned();
  const noConfirm = await apply(env, c2, departure);
  assert.equal(noConfirm.status, 409); assert.equal(noConfirm.data.error, 'RELATIONSHIP_NOT_CONFIRMED');
  const confirmed = await apply(env, c2, departure, { relationship_confirmed: true }, 'staff-tok-bala');
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  assert.equal((await one(env, 'SELECT relationship_basis FROM marau_booking_adjustments WHERE booking_id = ?', departure)).relationship_basis, 'staff_confirmed_departure');
  assert.equal((await one(env, 'SELECT relationship_basis FROM marau_booking_adjustments WHERE booking_id = ?', declared)).relationship_basis, 'declared_return_leg');
  const c3 = await earned();
  const rt = await apply(env, c3, roundTrip, { relationship_confirmed: true });
  assert.equal(rt.status, 409); assert.equal(rt.data.error, 'UNSUPPORTED_SHAPE');
  const un = await apply(env, c3, unclassified, { relationship_confirmed: true });
  assert.equal(un.status, 409); assert.equal(un.data.error, 'UNSUPPORTED_SHAPE');
  assert.equal((await one(env, 'SELECT status FROM marau_reward_credits WHERE credit_id = ?', c3)).status, 'earned', 'a refusal leaves the credit usable');
  const listing = (await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) })).data.credits.find((c) => c.credit_id === c3);
  const byId = Object.fromEntries(listing.eligible_return_transfers.map((t) => [t.booking_id, t]));
  assert.equal(byId[roundTrip], undefined, 'unsupported shapes are not offered as targets');
  assert.equal(byId[unclassified], undefined);
  assert.equal(byId[departure].needs_staff_confirmation, true);
});

// ============================================================ 4. POLICY CHANGES vs EXISTING CREDITS

test('POLICY SNAPSHOT: an existing credit keeps the terms it was promised under (amount, stage, payment requirement); later policy changes affect NEW credits only', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env); const friend = await friendOf(env, referrer.token);
  const rid = await buy(env, friend.token, offerId);
  await act(env, rid, 'confirm');
  const [c0] = await credits(env);
  assert.equal(c0.amount_cents, 1000);
  // Commercial terms loosened/changed afterwards.
  await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: { amount_fjd: 25, qualify_on: 'confirmed', require_payment: 'none', min_purchase_fjd: 500, cap_per_referrer_fjd: 1 } });
  await act(env, rid, 'fulfil');
  assert.equal((await credits(env))[0].status, 'pending', 'fulfilled but unpaid stays pending: the ORIGINAL promise required payment');
  await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'p' });
  const [c1] = await credits(env);
  assert.deepEqual([c1.status, c1.amount_cents], ['earned', 1000], 'earned under the original terms and the original amount; the new min purchase/cap do not void it');
  // And the reverse: tightening never removes an earned credit.
  await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: { require_payment: 'paid_in_full', amount_fjd: 1, qualify_on: 'fulfilled' } });
  assert.equal((await credits(env))[0].status, 'earned');
  const p = (await call(env, '/preview/admin/rewards/policy', { headers: staffH(env) })).data;
  assert.match(p.policy_change_note, /new credits only/i);
  assert.match(p.policy_change_note, /off.*(freez|pause)/i);
});

test('POLICY SNAPSHOT: a credit created before payment evidence existed (no require_payment in its snapshot) keeps the original fulfilled-only promise', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env); const friend = await friendOf(env, referrer.token);
  const rid = await buy(env, friend.token, offerId);
  await act(env, rid, 'confirm');
  await env.DB.prepare(`UPDATE marau_reward_credits SET policy_snapshot = json_remove(policy_snapshot, '$.require_payment')`).run();
  await act(env, rid, 'fulfil');
  assert.equal((await credits(env))[0].status, 'earned');
});

test('POLICY OFF is a FREEZE: no new credits, no promotion, no application; nothing is deleted or reversed; turning it back on resumes under the stored terms', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env); const sid = (await one(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', referrer.token)).session_id;
  const returnId = await addReturnLeg(env, sid);
  const f1 = await friendOf(env, referrer.token); const r1 = await buy(env, f1.token, offerId);
  await act(env, r1, 'confirm'); await pay(env, r1, { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'a' });
  const f2 = await friendOf(env, referrer.token); const r2 = await buy(env, f2.token, offerId);
  await act(env, r2, 'confirm'); await pay(env, r2, { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'b' }); await act(env, r2, 'fulfil');
  const [pendingOne, earnedOne] = await credits(env);
  assert.deepEqual([pendingOne.status, earnedOne.status], ['pending', 'earned']);

  await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: { mode: 'off' } });
  const f3 = await friendOf(env, referrer.token); const r3 = await buy(env, f3.token, offerId); await act(env, r3, 'confirm');
  assert.equal((await credits(env)).length, 2, 'no new credit while off');
  await act(env, r1, 'fulfil'); await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) });
  assert.equal((await one(env, 'SELECT status FROM marau_reward_credits WHERE credit_id = ?', pendingOne.credit_id)).status, 'pending', 'no promotion while off');
  const blocked = await apply(env, earnedOne.credit_id, returnId);
  assert.equal(blocked.status, 409); assert.equal(blocked.data.error, 'REWARDS_OFF');
  assert.deepEqual((await credits(env)).map((c) => c.status), ['pending', 'earned'], 'frozen, not deleted or reversed');

  await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: { mode: 'preview' } });
  await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) });
  assert.equal((await one(env, 'SELECT status FROM marau_reward_credits WHERE credit_id = ?', pendingOne.credit_id)).status, 'earned', 'resumes: the fulfilled+paid credit is promoted under its stored terms');
  assert.equal((await apply(env, earnedOne.credit_id, returnId)).status, 200);
});
