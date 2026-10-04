/* Marau (PREVIEW/TEST ONLY) - the trusted Marau -> source BOUNDARY and the RETURN-LEG MIRROR, defined as tests before any
 * production approval is requested. Synthetic data; default-deny network (the source client is exercised with an injected
 * fetch that records what WOULD have been sent). Evidence label: LOCAL, AUTHOR-RUN.
 *
 * What this does NOT prove: that a deployed source honours the contract (milestone38 is not deployed), or anything about
 * production data. The shared-admin-token limitation is unchanged: an operator name sent to the source is ASSERTED by
 * Marau's service, not independently authenticated human identity at the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest } from './fixtures.mjs';
import worker, { createGuestSession, createSessionAndOfferLink, nowIso } from '../worker/worker.js';
import { normalizePickupDatetime } from '../worker/fiji_time.js';
import { syncRealBookingEvent } from '../worker/real_booking_sync.js';
import { createNadiSourceClient } from '../worker/nadi_source_client.js';
import { classifyLeg } from '../worker/leg_type.js';

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

// ================================================================== A. THE MARAU -> SOURCE BOUNDARY

function recordingFetch(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return respond(url, init); };
  return { calls, fetchImpl };
}
const jsonRes = (status, data) => ({ status, json: async () => data });
const WIN = { ok: true, won: true, booking: { id: 7, status: 'accepted', assigned_driver_id: 3, confirmation_attempt_id: 'att_1', confirmed_operator: 'Ana (ops)', guest_phone: '+15005550123', guest_email: 'x@example.test' } };

test('BOUNDARY: the source must be https (or loopback for local tests), with no credentials or query smuggled into the URL', () => {
  const ok = (baseUrl) => createNadiSourceClient({ baseUrl, adminToken: 'tok', fetchImpl: async () => jsonRes(200, {}) });
  assert.doesNotThrow(() => ok('https://dispatch.example.test'));
  assert.doesNotThrow(() => ok('http://127.0.0.1:8787'));
  assert.doesNotThrow(() => ok('http://localhost:8787/'));
  assert.throws(() => ok('http://dispatch.example.test'), /SOURCE_BASE_URL/);
  assert.throws(() => ok('https://user:pw@dispatch.example.test'), /SOURCE_BASE_URL/);
  assert.throws(() => ok('https://dispatch.example.test/?x=1'), /SOURCE_BASE_URL/);
  assert.throws(() => ok('ftp://dispatch.example.test'), /SOURCE_BASE_URL/);
  assert.throws(() => ok('not a url'), /SOURCE_BASE_URL/);
});

test('BOUNDARY: a confirmation sends ONLY the admin credential and the four decision fields - no guest details, no guest token - and never follows a redirect', async () => {
  const { calls, fetchImpl } = recordingFetch(() => jsonRes(200, WIN));
  const client = createNadiSourceClient({ baseUrl: 'https://dispatch.example.test', adminToken: 'ADMIN-T', fetchImpl });
  const out = await client.confirmReservation('7', { driverId: 3, attemptId: 'att_1', operator: 'Ana (ops)' });
  assert.equal(out.won, true);
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://dispatch.example.test/admin/bookings/manual-assign');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'manual', 'a redirect must never be followed with the admin credential attached');
  assert.deepEqual(Object.keys(init.headers).sort(), ['authorization', 'content-type']);
  assert.equal(init.headers.authorization, 'Bearer ADMIN-T');
  assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(), ['attempt_id', 'booking_id', 'driver_id', 'operator']);
  assert.equal(JSON.stringify(out).includes('example.test'), false, 'guest contact in the win response is dropped');
  assert.equal(JSON.stringify(out).includes('+1500'), false);
});

test('BOUNDARY: a redirect, an auth failure, a 5xx, a timeout and a non-JSON body are all AMBIGUOUS (thrown), never read as a decision', async () => {
  for (const [label, respond] of [
    ['302 redirect', () => ({ status: 302, json: async () => { throw new Error('no body'); }, headers: { get: () => 'https://evil.example.test/' } })],
    ['401', () => jsonRes(401, { error: 'unauthorized' })],
    ['403', () => jsonRes(403, { error: 'forbidden' })],
    ['500', () => jsonRes(500, { error: 'boom' })],
    ['501 contract not deployed', () => jsonRes(501, { error: 'CONFIRMATION_IDENTITY_UNSUPPORTED' })],
    ['non-JSON', () => ({ status: 200, json: async () => { throw new SyntaxError('x'); } })],
  ]) {
    const { fetchImpl } = recordingFetch(respond);
    const client = createNadiSourceClient({ baseUrl: 'https://dispatch.example.test', adminToken: 't', fetchImpl });
    await assert.rejects(() => client.confirmReservation('7', { driverId: 3, attemptId: 'a', operator: 'o' }), /SOURCE_/, label);
    await assert.rejects(() => client.getReservation('7'), /SOURCE_/, `${label} (readback)`);
  }
  const client = createNadiSourceClient({ baseUrl: 'https://dispatch.example.test', adminToken: 't', fetchImpl: async () => { const e = new Error('network down'); e.name = 'TypeError'; throw e; } });
  await assert.rejects(() => client.getReservation('7'), /network down/);
});

test('BOUNDARY: only booking ids reach the URL path - path injection through the booking reference is refused before any request', async () => {
  const { calls, fetchImpl } = recordingFetch(() => jsonRes(200, { ok: true, status: 'accepted' }));
  const client = createNadiSourceClient({ baseUrl: 'https://dispatch.example.test', adminToken: 't', fetchImpl });
  for (const bad of ['1/../2', '1?x=2', ' 7', '07x', '-1', '0', '7.5', '', null, undefined, '7/confirmation']) {
    await assert.rejects(() => client.getReservation(bad), /SOURCE_REF_NOT_A_BOOKING_ID/, String(bad));
    await assert.rejects(() => client.confirmReservation(bad, { driverId: 1, attemptId: 'a', operator: 'o' }), /SOURCE_REF_NOT_A_BOOKING_ID/, String(bad));
  }
  assert.equal(calls.length, 0, 'nothing was sent for any malformed reference');
  await client.getReservation('7');
  assert.equal(calls[0].url, 'https://dispatch.example.test/admin/bookings/7/confirmation');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'manual');
});

test('BOUNDARY: the readback exposes the source\'s own operator attestation, so Marau never mistakes an asserted name for authenticated identity', async () => {
  const { fetchImpl } = recordingFetch(() => jsonRes(200, { ok: true, status: 'accepted', assigned_driver_id: 3, confirmation_attempt_id: 'att_1', confirmed_operator: 'Ana (ops)', confirmed_operator_attestation: 'service-asserted' }));
  const client = createNadiSourceClient({ baseUrl: 'https://dispatch.example.test', adminToken: 't', fetchImpl });
  const state = await client.getReservation('7');
  assert.equal(state.confirmed_operator, 'Ana (ops)');
  assert.equal(state.confirmed_operator_attestation, 'service-asserted');
});

// ================================================================== B. THE RETURN-LEG MIRROR: leg classification

test('LEG CLASSIFICATION: airport -> elsewhere is an arrival, elsewhere -> airport is a return, anything else is "other"', () => {
  assert.equal(classifyLeg('Nadi Airport', 'Denarau'), 'arrival');
  assert.equal(classifyLeg('Denarau', 'Nadi Airport'), 'return');
  assert.equal(classifyLeg('NAD_AIRPORT', 'DENARAU'), 'arrival');
  assert.equal(classifyLeg('DENARAU', 'NAD_AIRPORT'), 'return');
  assert.equal(classifyLeg('Nausori Airport', 'Suva'), 'arrival');
  assert.equal(classifyLeg('Nadi Airport', 'Nausori Airport'), 'other', 'airport to airport is not a holiday leg');
  assert.equal(classifyLeg('Denarau', 'Coral Coast'), 'other');
  assert.equal(classifyLeg(null, 'Nadi Airport'), 'other');
  assert.equal(classifyLeg(undefined, undefined), 'other');
});

let n = 0;
const realBooking = (over = {}) => { n += 1; return { id: 9500 + n, source_booking_ref: `mirror-${n}`, guest_email: `mirror${n}@example.test`, guest_phone: `+150055503${String(n).padStart(2, '0')}`, whatsapp_available: null, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', pickup_date: '2031-10-05', pickup_time: '09:00', quoted_amount: 45, assigned_driver_id: 'drv_1', status: 'accepted', ...over }; };
const sourceOf = (...rows) => { const m = new Map(rows.map((r) => [String(r.source_booking_ref), { ...r }])); return { set: (r) => m.set(String(r.source_booking_ref), { ...r }), reader: async (ref) => (m.has(String(ref)) ? { ...m.get(String(ref)) } : null) }; };
const deps = (source) => ({ createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime, reader: source.reader });
let ev = 5000;
const created = (b) => ({ event_type: 'created', new_status: 'accepted', source_event_id: ++ev, booking_id: b.id });

test('RETURN-LEG MIRROR: a mirrored real booking carries its leg type, and a later source change re-classifies it', async () => {
  const env = makeEnv();
  const arr = realBooking(); const ret = realBooking({ pickup_zone: 'Denarau', destination_zone: 'Nadi Airport' });
  const source = sourceOf(arr, ret);
  assert.equal((await syncRealBookingEvent(env, arr.source_booking_ref, created(arr), deps(source))).ok, true);
  assert.equal((await syncRealBookingEvent(env, ret.source_booking_ref, created(ret), deps(source))).ok, true);
  const legs = Object.fromEntries((await all(env, 'SELECT source_booking_ref, leg_type FROM marau_test_bookings WHERE source_booking_ref IS NOT NULL')).map((r) => [r.source_booking_ref, r.leg_type]));
  assert.deepEqual(legs, { [arr.source_booking_ref]: 'arrival', [ret.source_booking_ref]: 'return' });
  // The source later changes the destination: the leg follows the source, never a stale guess.
  source.set({ ...ret, pickup_zone: 'Denarau', destination_zone: 'Coral Coast' });
  await syncRealBookingEvent(env, ret.source_booking_ref, { event_type: 'accepted', new_status: 'accepted', source_event_id: ++ev, booking_id: ret.id }, deps(source));
  assert.equal((await one(env, 'SELECT leg_type FROM marau_test_bookings WHERE source_booking_ref = ?', ret.source_booking_ref)).leg_type, 'other');
});

// ================================================================== C. MERGE: rewards must follow the guest across sessions

async function programme() {
  const env = makeEnv();
  for (const [tok, name] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: tok, operator_name: name } });
  await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: { mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 20, min_purchase_fjd: 0, qualify_on: 'fulfilled', require_payment: 'paid_in_full' } });
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Reef Tours', fulfilment_owner: 'Ana (ops)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
  const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title: 'Synthetic snorkel', location: 'Reef (synthetic)', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 20, price_per_place_fjd: 120, cost_per_place_fjd: 80 } });
  await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });

  // The holder's ARRIVAL booking, made in Marau (session A) - and a friend's paid + fulfilled purchase earns A a credit.
  const a = await call(env, '/preview/bookings', { method: 'POST', body: synthGuest({ leg_type: 'arrival' }) });
  const sessA = await one(env, 'SELECT * FROM guest_sessions WHERE access_token = ?', a.data.access_token);
  const code = (await call(env, '/preview/referral', { headers: guestH(a.data.access_token) })).data.code;
  const f = await call(env, '/preview/bookings', { method: 'POST', body: { ...synthGuest({ leg_type: 'arrival' }), referral_code: code } });
  const rid = (await call(env, `/preview/offers/${offer.data.offer_id}/request`, { method: 'POST', headers: guestH(f.data.access_token), body: { places: 1 } })).data.request.request_id;
  await call(env, `/preview/admin/offers/requests/${rid}/confirm`, { method: 'POST', headers: staffH(env), body: {} });
  await call(env, `/preview/admin/offers/requests/${rid}/payment`, { method: 'POST', headers: staffH(env), body: { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'p' } });
  await call(env, `/preview/admin/offers/requests/${rid}/fulfil`, { method: 'POST', headers: staffH(env), body: {} });
  // A's consent, WhatsApp-less contact, owner and a suppression - all recorded on session A.
  await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(a.data.access_token), body: { marketing_consent: 'withheld' } });
  await call(env, `/preview/admin/guests/${sessA.session_id}/follow-up-owner`, { method: 'POST', headers: staffH(env), body: { owner: 'Bala (ops)' } });
  await call(env, `/preview/admin/guests/${sessA.session_id}/suppressions`, { method: 'POST', headers: staffH(env), body: { channel: 'email', kind: 'delivery_failure' } });

  // The RETURN booking arrives through the real-booking mirror: same phone => a NEW session N + a verified-link offer.
  const ret = realBooking({ pickup_zone: 'Denarau', destination_zone: 'Nadi Airport', guest_phone: sessA.guest_phone, guest_email: sessA.guest_email, quoted_amount: 100, pickup_date: '2031-10-12' });
  const source = sourceOf(ret);
  const sync = await syncRealBookingEvent(env, ret.source_booking_ref, created(ret), deps(source));
  assert.equal(sync.ok, true, JSON.stringify(sync));
  const retRow = await one(env, 'SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?', ret.source_booking_ref);
  const sessN = await one(env, 'SELECT * FROM guest_sessions WHERE session_id = ?', retRow.guest_session_id);
  assert.notEqual(sessN.session_id, sessA.session_id, 'the mirror gives the return booking its own session');
  return { env, a, sessA, sessN, retRow, code, offerId: offer.data.offer_id, rid };
}
async function verifiedLink({ env, a, sessN }) {
  const lr = (await call(env, '/preview/trip/link-requests', { headers: guestH(a.data.access_token) })).data.link_requests[0];
  const r = await call(env, '/preview/trip/link', { method: 'POST', headers: guestH(sessN.access_token), body: { link_request_id: lr.link_request_id, verification_code: lr.verification_code } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

test('MERGE: after the verified link, the holder\'s credit, referral link, consent, owner and suppression all follow them - and the credit can be applied to the MIRRORED return', async () => {
  const ctx = await programme();
  const { env, a, sessA, sessN, retRow, code } = ctx;
  await verifiedLink(ctx);

  assert.equal((await call(env, '/preview/trip', { headers: guestH(a.data.access_token) })).status, 401, 'the old token is revoked');
  const trip = (await call(env, '/preview/trip', { headers: guestH(sessN.access_token) })).data;
  assert.equal(trip.bookings.length, 2, 'arrival and mirrored return are one trip');

  const ref = (await call(env, '/preview/referral', { headers: guestH(sessN.access_token) })).data;
  assert.equal(ref.code, code, 'the SAME public link keeps working for the merged guest');
  assert.equal((await call(env, `/preview/referral/validate/${code}`)).status, 200);
  assert.deepEqual(ref.credits.map((c) => c.status), ['earned'], 'the earned credit is visible to the merged session');

  const credit = (await all(env, 'SELECT credit_id FROM marau_reward_credits'))[0];
  const applied = await call(env, `/preview/admin/rewards/credits/${credit.credit_id}/apply`, { method: 'POST', headers: staffH(env), body: { booking_id: retRow.id } });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.fare.amount_due_fjd, 90);
  const tripAfter = (await call(env, '/preview/trip', { headers: guestH(sessN.access_token) })).data;
  assert.equal(tripAfter.bookings.find((b) => b.id === retRow.id).fare.referral_credit_fjd, 10);

  // Consent, owner and suppression were not dropped by the merge (a merge must never loosen a promise).
  assert.equal((await one(env, 'SELECT marketing_consent FROM guest_sessions WHERE session_id = ?', sessN.session_id)).marketing_consent, 'withheld');
  assert.equal((await one(env, 'SELECT owner FROM marau_follow_up_owners WHERE guest_session_id = ?', sessN.session_id)).owner, 'Bala (ops)');
  const d = (await call(env, '/preview/admin/messages/check', { method: 'POST', headers: staffH(env), body: { session_id: sessN.session_id, purpose: 'booking_confirmation', channel: 'email' } })).data;
  assert.ok(d.reasons.includes('channel_suppressed'), 'the recorded delivery failure still blocks that channel');
  assert.equal((await all(env, `SELECT 1 FROM marau_reward_credits WHERE beneficiary_session_id = ?`, sessA.session_id)).length, 0, 'nothing is left stranded on the revoked session');
});

test('MERGE: a credit is NOT applicable to a return booking of a DIFFERENT, unlinked session, even with the same phone (no access/ownership by phone match)', async () => {
  const ctx = await programme();
  const { env, retRow } = ctx; // deliberately NOT linked
  const credit = (await all(env, 'SELECT credit_id FROM marau_reward_credits'))[0];
  const r = await call(env, `/preview/admin/rewards/credits/${credit.credit_id}/apply`, { method: 'POST', headers: staffH(env), body: { booking_id: retRow.id } });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'NOT_AN_ELIGIBLE_RETURN_TRANSFER');
});

test('MERGE: is one atomic step - a fault part-way leaves the bookings AND the rewards on the original session', async () => {
  const ctx = await programme();
  const { env, a, sessA, sessN } = ctx;
  env.DB.exec(`CREATE TRIGGER fail_merge BEFORE UPDATE ON marau_reward_credits BEGIN SELECT RAISE(ABORT, 'injected merge fault'); END;`);
  const lr = (await call(env, '/preview/trip/link-requests', { headers: guestH(a.data.access_token) })).data.link_requests[0];
  let status;
  try { status = (await call(env, '/preview/trip/link', { method: 'POST', headers: guestH(sessN.access_token), body: { link_request_id: lr.link_request_id, verification_code: lr.verification_code } })).status; } catch { status = 500; }
  env.DB.exec('DROP TRIGGER fail_merge');
  assert.ok(status >= 400, 'the link is reported as failed');
  assert.equal((await one(env, 'SELECT access_token_revoked FROM guest_sessions WHERE session_id = ?', sessA.session_id)).access_token_revoked, 0, 'the old session is NOT revoked');
  assert.equal((await all(env, 'SELECT 1 FROM marau_test_bookings WHERE guest_session_id = ?', sessA.session_id)).length, 1, 'bookings did not half-move');
  assert.equal((await all(env, 'SELECT 1 FROM marau_reward_credits WHERE beneficiary_session_id = ?', sessA.session_id)).length, 1);
  assert.equal((await one(env, 'SELECT status FROM guest_link_requests WHERE link_request_id = ?', lr.link_request_id)).status, 'PENDING', 'and the link can be retried');
});

// ================================================================== D. SOURCE QUOTE CHANGES AFTER A CREDIT

test('QUOTE CHANGE: if the source re-quotes a return after a credit was applied, amount due follows the CURRENT quote and the change is shown, never hidden', async () => {
  const ctx = await programme();
  const { env, sessN, retRow } = ctx;
  await verifiedLink(ctx);
  const credit = (await all(env, 'SELECT credit_id FROM marau_reward_credits'))[0];
  await call(env, `/preview/admin/rewards/credits/${credit.credit_id}/apply`, { method: 'POST', headers: staffH(env), body: { booking_id: retRow.id } });
  await env.DB.prepare('UPDATE marau_test_bookings SET quoted_amount = 120 WHERE id = ?').bind(retRow.id).run(); // the source re-quoted
  const fare = (await call(env, '/preview/trip', { headers: guestH(sessN.access_token) })).data.bookings.find((b) => b.id === retRow.id).fare;
  assert.equal(fare.original_fare_fjd, 120);
  assert.equal(fare.referral_credit_fjd, 10);
  assert.equal(fare.amount_due_fjd, 110);
  assert.equal(fare.quote_changed_since_credit, true);
  assert.equal(fare.quote_at_credit_fjd, 100);
  // A re-quote below the credit never produces a negative amount due.
  await env.DB.prepare('UPDATE marau_test_bookings SET quoted_amount = 4 WHERE id = ?').bind(retRow.id).run();
  const low = (await call(env, '/preview/trip', { headers: guestH(sessN.access_token) })).data.bookings.find((b) => b.id === retRow.id).fare;
  assert.equal(low.amount_due_fjd, 0);
  assert.equal(low.referral_credit_fjd, 4, 'the credit shown never exceeds the current fare');
});
