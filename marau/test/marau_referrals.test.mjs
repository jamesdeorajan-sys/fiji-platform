/* Marau (PREVIEW/TEST ONLY) - referral -> qualifying purchase -> return-transfer credit. Synthetic guests only; nothing is
 * sent, charged, or reaches outside this in-memory database. Evidence label: LOCAL, AUTHOR-RUN.
 *
 * The reward amount used below (FJ$10) is a SYNTHETIC TEST VALUE - an illustration, not an approved commercial rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest } from './fixtures.mjs';
import worker from '../worker/worker.js';
import { qrMatrix, qrSvg } from '../worker/qr.js';
import { generateReferralCode, isWellFormedCode } from '../worker/referrals.js';

installNetworkGuard();

const call = async (env, path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await worker.fetch(new Request('http://marau.test' + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text, headers: res.headers };
};
const admin = (env) => ({ authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}` });
const staffH = (env, token = 'staff-tok-ana') => ({ ...admin(env), 'x-marau-staff-token': token });
const guestH = (t) => ({ authorization: `Bearer ${t}` });
const inDays = (d, h = 0) => new Date(Date.now() + d * 86400_000 + h * 3600_000).toISOString();
const db = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;

async function setup(policy = { mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 20, min_purchase_fjd: 50, qualify_on: 'fulfilled' }) {
  const env = makeEnv();
  for (const [tok, name] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: tok, operator_name: name } });
  if (policy) {
    const res = await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: policy });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  }
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Reef Tours', fulfilment_owner: 'Ana (ops)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
  const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title: 'Synthetic snorkel morning', location: 'Mamanuca reef (synthetic)', inclusions: ['boat', 'lunch'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 20, price_per_place_fjd: 120, cost_per_place_fjd: 80 } });
  await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });
  return { env, offerId: offer.data.offer_id };
}

// A guest with an arrival transfer; the return leg is attached the way the real-booking mirror would attach it.
async function newGuest(env, over = {}) {
  const res = await call(env, '/preview/bookings', { method: 'POST', body: synthGuest({ leg_type: 'arrival', ...over }) });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const session = await db(env, 'SELECT * FROM guest_sessions WHERE access_token = ?', res.data.access_token);
  return { token: res.data.access_token, sessionId: session.session_id, res };
}
async function addReturnLeg(env, sessionId, { amount = 100, days = 12, status = 'pending' } = {}) {
  const guest = await db(env, 'SELECT guest_email, guest_phone FROM guest_sessions WHERE session_id = ?', sessionId);
  const ref = `RET-${Math.random().toString(36).slice(2, 8)}`;
  await env.DB.prepare(`INSERT INTO marau_test_bookings (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, test_data, created_at, updated_at, leg_type) VALUES (?, ?, ?, ?, 'DENARAU', 'NAD_AIRPORT', 'Sedan', ?, ?, ?, 1, ?, ?, 'return')`)
    .bind(ref, sessionId, guest.guest_email, guest.guest_phone, inDays(days), amount, status, new Date().toISOString(), new Date().toISOString()).run();
  return (await db(env, 'SELECT id FROM marau_test_bookings WHERE client_booking_ref = ?', ref)).id;
}
const referralOf = (env, token) => call(env, '/preview/referral', { headers: guestH(token) });
async function friendJoins(env, code, over = {}) {
  const res = await call(env, '/preview/bookings', { method: 'POST', body: { ...synthGuest({ leg_type: 'arrival', ...over }), referral_code: code } });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const session = await db(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', res.data.access_token);
  return { token: res.data.access_token, sessionId: session.session_id, applied: res.data.referral_applied };
}
const purchase = (env, token, offerId, places = 1) => call(env, `/preview/offers/${offerId}/request`, { method: 'POST', headers: guestH(token), body: { places } });
const act = (env, requestId, action, body = {}, tok = 'staff-tok-ana') => call(env, `/preview/admin/offers/requests/${requestId}/${action}`, { method: 'POST', headers: staffH(env, tok), body });
const credits = (env) => all(env, 'SELECT * FROM marau_reward_credits ORDER BY created_at');
const apply = (env, creditId, bookingId, tok = 'staff-tok-ana') => call(env, `/preview/admin/rewards/credits/${creditId}/apply`, { method: 'POST', headers: staffH(env, tok), body: { booking_id: bookingId } });

// ============================================================ THE ACCEPTANCE JOURNEY

test('JOURNEY: transfer guest -> trip -> deal -> friend referral -> qualifying synthetic purchase -> exactly ONE credit adjustment', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env);
  const returnId = await addReturnLeg(env, referrer.sessionId, { amount: 100 });

  // The guest has a Marau trip and can see the deal beside it.
  const trip = await call(env, '/preview/trip', { headers: guestH(referrer.token) });
  assert.equal(trip.data.bookings.length, 2);
  assert.equal((await call(env, '/preview/offers', { headers: guestH(referrer.token) })).data.offers.length, 1);

  // They share a PUBLIC link; a friend joins through it.
  const ref = (await referralOf(env, referrer.token)).data;
  assert.match(ref.share_url, /\/r\/[A-Z2-9]{8}$/);
  const friend = await friendJoins(env, ref.code);
  assert.equal(friend.applied, true);
  assert.equal((await referralOf(env, referrer.token)).data.friends_joined, 1);

  // Saving a pay-later request earns NOTHING.
  const bought = await purchase(env, friend.token, offerId, 1);
  assert.equal(bought.status, 201);
  assert.equal((await credits(env)).length, 0, 'a saved request is not a qualifying purchase');

  // Human confirmation: credit exists but is only PENDING (policy: earn on fulfilment).
  const rid = bought.data.request.request_id;
  await act(env, rid, 'confirm');
  assert.deepEqual((await credits(env)).map((c) => c.status), ['pending']);
  assert.equal((await call(env, `/preview/admin/rewards/credits/${(await credits(env))[0].credit_id}/apply`, { method: 'POST', headers: staffH(env), body: { booking_id: returnId } })).status, 409, 'a pending credit cannot be applied');

  // Fulfilment earns it.
  await act(env, rid, 'fulfil');
  const [credit] = await credits(env);
  assert.equal(credit.status, 'earned');
  assert.equal(credit.amount_cents, 1000);
  assert.equal(credit.funding_source, 'marau_marketing_budget', 'reward funding is recorded on the credit');
  assert.deepEqual((await referralOf(env, referrer.token)).data.credits.map((c) => [c.status, c.amount_fjd]), [['earned', 10]]);

  // Staff apply it to the return transfer: exactly one adjustment, three separate numbers, history preserved.
  const applied = await apply(env, credit.credit_id, returnId);
  assert.equal(applied.status, 200);
  assert.equal(applied.data.fare.original_fare_fjd, 100);
  assert.equal(applied.data.fare.referral_credit_fjd, 10);
  assert.equal(applied.data.fare.amount_due_fjd, 90);
  assert.equal(applied.data.fare.operator_payout_unchanged, true);
  assert.deepEqual(applied.data.fare.quote_history.map((h) => h.event), ['original_quote', 'referral_credit_applied']);
  assert.equal((await all(env, 'SELECT * FROM marau_booking_adjustments')).length, 1);
  assert.equal((await db(env, 'SELECT quoted_amount FROM marau_test_bookings WHERE id = ?', returnId)).quoted_amount, 100, 'the ORIGINAL quote is never rewritten');

  // And the guest sees it on their trip.
  const returnLeg = (await call(env, '/preview/trip', { headers: guestH(referrer.token) })).data.bookings.find((b) => b.id === returnId);
  assert.deepEqual([returnLeg.fare.original_fare_fjd, returnLeg.fare.referral_credit_fjd, returnLeg.fare.amount_due_fjd], [100, 10, 90]);

  // Repeats change nothing: still exactly one credit and one adjustment.
  assert.equal((await apply(env, credit.credit_id, returnId)).data.repeated, true);
  await act(env, rid, 'fulfil');
  assert.equal((await credits(env)).length, 1);
  assert.equal((await all(env, 'SELECT * FROM marau_booking_adjustments')).length, 1);
  assert.equal((await credits(env))[0].status, 'applied');
});

// ============================================================ public vs private

test('PUBLIC referral link/QR is separate from the PRIVATE trip link and reveals nothing about any booking or guest', async () => {
  const { env } = await setup();
  const g = await newGuest(env);
  const ref = (await referralOf(env, g.token)).data;
  assert.notEqual(ref.code, g.token);
  assert.equal(ref.share_url.includes(g.token), false, 'the public link never contains the private access token');
  assert.equal(JSON.stringify(ref).includes(g.token), false);
  for (const secret of ['preview.guest', '+15005550', g.sessionId, 'NAD_AIRPORT']) assert.equal(ref.share_url.includes(secret) || ref.qr_svg_url.includes(secret), false);
  assert.equal(isWellFormedCode(ref.code), true);

  // Landing page and validation are public and anonymous - and disclose only "valid".
  const landing = await call(env, `/r/${ref.code}`);
  assert.equal(landing.status, 200);
  assert.match(landing.headers.get('content-type'), /html/);
  for (const secret of ['preview.guest', g.sessionId, g.token]) assert.equal(landing.text.includes(secret), false);
  const valid = await call(env, `/preview/referral/validate/${ref.code}`);
  assert.deepEqual(valid.data, { valid: true });
  assert.deepEqual((await call(env, '/preview/referral/validate/ZZZZZZZZ')).data, { valid: false });

  // The QR encodes the PUBLIC link only.
  const qr = await call(env, `/preview/referral/qr.svg?code=${ref.code}`);
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get('content-type'), /svg/);
  assert.match(qr.text, /^<svg /);
  assert.equal(qr.text.includes(g.token), false);
  assert.equal((await call(env, '/preview/referral/qr.svg?code=ZZZZZZZZ')).status, 404);
  assert.equal((await call(env, '/preview/referral/qr.svg')).status, 404);

  assert.equal((await call(env, '/preview/referral')).status, 401, 'the guest view needs the private token');
  assert.equal((await call(env, '/preview/referral', { headers: guestH('tok_bad') })).status, 401);
  assert.equal((await referralOf(env, g.token)).data.code, ref.code, 'the code is stable per guest');
});

test('QR encoder: deterministic, scannable-by-construction structure for the public URL', () => {
  const url = 'https://myfiji.app/r/ABCD2345';
  const m = qrMatrix(url);
  assert.equal(m.length, m[0].length);
  assert.ok(m.length >= 21 && (m.length - 17) % 4 === 0, 'a valid QR version size');
  assert.deepEqual(qrMatrix(url), m, 'deterministic');
  // finder pattern: 7x7 dark ring with a 3x3 dark centre, at the top-left
  for (let i = 0; i < 7; i += 1) { assert.equal(m[0][i], true); assert.equal(m[6][i], true); assert.equal(m[i][0], true); assert.equal(m[i][6], true); }
  assert.equal(m[1][1], false); assert.equal(m[3][3], true);
  const svg = qrSvg(url);
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /role="img"/);
  assert.equal(svg.includes('script'), false);
});

test('referral codes are unambiguous, well-formed, and not derived from guest data', () => {
  const a = generateReferralCode(); const b = generateReferralCode();
  assert.equal(a.length, 8);
  assert.notEqual(a, b);
  assert.equal(/[01OIL]/.test(a + b), false);
  assert.equal(isWellFormedCode('ABCDEFGH'), true);
  assert.equal(isWellFormedCode('ABCDEFG0'), false);
  assert.equal(isWellFormedCode('abc'), false);
});

// ============================================================ policy gate

test('rewards ship OFF with no amount: nothing is earned or promised until a policy is configured', async () => {
  const { env, offerId } = await setup(null);
  const pol = (await call(env, '/preview/admin/rewards/policy', { headers: staffH(env) })).data.policy;
  assert.equal(pol.mode, 'off');
  assert.equal(pol.amount_fjd, null, 'no amount is pre-approved - FJ$10 was an illustration');
  const a = await newGuest(env);
  const code = (await referralOf(env, a.token)).data;
  assert.equal(code.policy.rewards_active, false);
  assert.match(code.policy.message, /not switched on/);
  const f = await friendJoins(env, code.code);
  const r = await purchase(env, f.token, offerId, 1);
  await act(env, r.data.request.request_id, 'confirm');
  await act(env, r.data.request.request_id, 'fulfil');
  assert.equal((await credits(env)).length, 0);
});

test('policy gate: incomplete policy, preview rewards for non-synthetic guests, and LIVE mode all earn nothing', async () => {
  // preview mode but no cap -> not configured
  let { env, offerId } = await setup({ mode: 'preview', amount_fjd: 10 });
  let a = await newGuest(env); let code = (await referralOf(env, a.token)).data.code;
  let f = await friendJoins(env, code);
  let r = await purchase(env, f.token, offerId); await act(env, r.data.request.request_id, 'confirm'); await act(env, r.data.request.request_id, 'fulfil');
  assert.equal((await credits(env)).length, 0, 'an amount without a cap is not a complete policy');

  // preview mode never rewards a REAL (non-test) referrer
  ({ env, offerId } = await setup());
  a = await newGuest(env); code = (await referralOf(env, a.token)).data.code;
  await env.DB.prepare('UPDATE guest_sessions SET test_data = 0 WHERE session_id = ?').bind(a.sessionId).run();
  f = await friendJoins(env, code);
  r = await purchase(env, f.token, offerId); await act(env, r.data.request.request_id, 'confirm'); await act(env, r.data.request.request_id, 'fulfil');
  assert.equal((await credits(env)).length, 0, 'preview mode only ever rewards synthetic guests');

  // live cannot be switched on through the API
  const live = await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: { mode: 'live' } });
  assert.equal(live.status, 409);
  assert.equal(live.data.error, 'LIVE_REWARDS_REQUIRE_OWNER_APPROVAL');
  // even a hand-edited live policy without the owner approval earns nothing
  await env.DB.prepare(`UPDATE marau_reward_policy SET mode = 'live' WHERE id = 1`).run();
  const f2 = await friendJoins(env, (await referralOf(env, (await newGuest(env)).token)).data.code);
  r = await purchase(env, f2.token, offerId); await act(env, r.data.request.request_id, 'confirm'); await act(env, r.data.request.request_id, 'fulfil');
  assert.equal((await credits(env)).length, 0);
});

test('policy validation and staff-only access', async () => {
  const { env } = await setup(null);
  const post = (body, h = staffH(env)) => call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: h, body });
  assert.equal((await post({ mode: 'sometimes' })).status, 400);
  assert.equal((await post({ amount_fjd: -5 })).status, 400);
  assert.equal((await post({ amount_fjd: 5, qualify_on: 'whenever' })).status, 400);
  assert.equal((await post({ amount_fjd: 5 }, admin(env))).status, 401, 'the shared credential alone cannot change policy');
  assert.equal((await call(env, '/preview/admin/rewards/policy')).status, 401);
  const ok = await post({ mode: 'preview', amount_fjd: 5, cap_per_referrer_fjd: 5, funding_source: 'synthetic_test_budget' });
  assert.equal(ok.data.policy.updated_by, 'Ana (ops)');
  assert.equal(ok.data.policy.funding_source, 'synthetic_test_budget');
});

// ============================================================ attribution abuse

test('self-referral is prevented: same phone, same email, and a code used by its own owner never attribute or earn', async () => {
  const { env, offerId } = await setup();
  const a = await newGuest(env);
  const code = (await referralOf(env, a.token)).data.code;
  const guest = await db(env, 'SELECT guest_phone, guest_email FROM guest_sessions WHERE session_id = ?', a.sessionId);

  const samePhone = await friendJoins(env, code, { guest_phone: guest.guest_phone, guest_email: 'someone.else@example.test' });
  const sameEmail = await friendJoins(env, code, { guest_email: guest.guest_email.toUpperCase(), guest_phone: '+15005559111' });
  assert.equal(samePhone.applied, false);
  assert.equal(sameEmail.applied, false);
  assert.deepEqual((await all(env, 'SELECT status FROM marau_referrals ORDER BY created_at')).map((r) => r.status), ['rejected_self_referral', 'rejected_self_referral']);
  for (const friend of [samePhone, sameEmail]) {
    const r = await purchase(env, friend.token, offerId);
    await act(env, r.data.request.request_id, 'confirm'); await act(env, r.data.request.request_id, 'fulfil');
  }
  assert.equal((await credits(env)).length, 0);
  assert.equal((await referralOf(env, a.token)).data.friends_joined, 0);
});

test('only a NEW guest can be referred, attribution is first-touch, and bad/unknown codes never fail the booking', async () => {
  const { env, offerId } = await setup();
  const a = await newGuest(env); const b = await newGuest(env);
  const codeA = (await referralOf(env, a.token)).data.code; const codeB = (await referralOf(env, b.token)).data.code;
  const friend = await friendJoins(env, codeA, { guest_phone: '+15005558888', guest_email: 'friend@example.test' });
  assert.equal(friend.applied, true);

  // The same friend books again later via ANOTHER guest's code: they are no longer new, so nothing is re-attributed.
  const again = await friendJoins(env, codeB, { guest_phone: '+15005558888', guest_email: 'friend@example.test' });
  assert.equal(again.applied, false);
  assert.equal((await referralOf(env, b.token)).data.friends_joined, 0);

  // Unknown / malformed codes are ignored without failing the booking.
  for (const bad of ['NOPE', 'ZZZZZZZZ', '!!!', '']) {
    const res = await call(env, '/preview/bookings', { method: 'POST', body: { ...synthGuest(), referral_code: bad } });
    assert.equal(res.status, 201);
    assert.equal(res.data.referral_applied, false);
  }
  // The attributed friend still earns for A, once.
  const r = await purchase(env, friend.token, offerId); await act(env, r.data.request.request_id, 'confirm'); await act(env, r.data.request.request_id, 'fulfil');
  assert.deepEqual((await credits(env)).map((c) => c.beneficiary_session_id), [a.sessionId]);
});

// ============================================================ qualification rules

test('qualification: minimum purchase, earn-on-confirm policy, one credit per friend however many purchases, and per-referrer cap', async () => {
  // below minimum purchase (FJ$120 offer vs min FJ$200)
  let { env, offerId } = await setup({ mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 20, min_purchase_fjd: 200, qualify_on: 'fulfilled' });
  let a = await newGuest(env); let f = await friendJoins(env, (await referralOf(env, a.token)).data.code);
  let r = await purchase(env, f.token, offerId, 1); await act(env, r.data.request.request_id, 'confirm'); await act(env, r.data.request.request_id, 'fulfil');
  assert.equal((await credits(env)).length, 0, 'below the minimum purchase');
  r = await purchase(env, f.token, offerId, 1); // same live request returned: still 1 place
  assert.equal(r.data.existing, true);

  // earn on confirmation
  ({ env, offerId } = await setup({ mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 20, min_purchase_fjd: 0, qualify_on: 'confirmed' }));
  a = await newGuest(env); f = await friendJoins(env, (await referralOf(env, a.token)).data.code);
  r = await purchase(env, f.token, offerId, 1); await act(env, r.data.request.request_id, 'confirm');
  assert.deepEqual((await credits(env)).map((c) => c.status), ['earned']);

  // per-referrer cap: cap 15, reward 10 -> the second friend's purchase is capped
  ({ env, offerId } = await setup({ mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 15, min_purchase_fjd: 0, qualify_on: 'fulfilled' }));
  a = await newGuest(env); const code = (await referralOf(env, a.token)).data.code;
  const f1 = await friendJoins(env, code); const f2 = await friendJoins(env, code);
  for (const friend of [f1, f2]) { const p = await purchase(env, friend.token, offerId); await act(env, p.data.request.request_id, 'confirm'); await act(env, p.data.request.request_id, 'fulfil'); }
  assert.equal((await credits(env)).length, 1, 'the cap stops the second credit');
  assert.deepEqual((await all(env, 'SELECT status FROM marau_referrals ORDER BY created_at')).map((x) => x.status), ['attributed', 'capped']);

  // a friend who makes TWO purchases still yields one credit (UNIQUE referral)
  ({ env, offerId } = await setup());
  a = await newGuest(env); f = await friendJoins(env, (await referralOf(env, a.token)).data.code);
  const second = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: (await db(env, 'SELECT supplier_id FROM marau_suppliers')).supplier_id, title: 'Second synthetic offer', location: 'Denarau', inclusions: 'x', starts_at: inDays(7), book_by: inDays(6), expires_at: inDays(6, 12), capacity: 5, price_per_place_fjd: 90 } });
  await call(env, `/preview/admin/offers/${second.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });
  for (const o of [offerId, second.data.offer_id]) { const p = await purchase(env, f.token, o); await act(env, p.data.request.request_id, 'confirm'); await act(env, p.data.request.request_id, 'fulfil'); }
  assert.equal((await credits(env)).length, 1);
});

// ============================================================ cancellation / reversal

test('CANCELLATION rules: pending and earned credits are reversed; an APPLIED credit is flagged for a human and the fare is never silently increased', async () => {
  const { env, offerId } = await setup();
  const a = await newGuest(env); const returnId = await addReturnLeg(env, a.sessionId, { amount: 100 });
  const code = (await referralOf(env, a.token)).data.code;
  const stat = async () => (await credits(env)).map((c) => c.status);

  // 1) cancelled while PENDING
  let f = await friendJoins(env, code); let r = (await purchase(env, f.token, offerId)).data.request.request_id;
  await act(env, r, 'confirm');
  assert.deepEqual(await stat(), ['pending']);
  await act(env, r, 'cancel', { note: 'guest changed plans' });
  assert.deepEqual(await stat(), ['reversed']);

  // 2) friend cancels THEMSELVES while pending (guest path also reverses)
  f = await friendJoins(env, code); r = (await purchase(env, f.token, offerId)).data.request.request_id;
  await act(env, r, 'confirm');
  assert.equal((await call(env, `/preview/offers/requests/${r}/cancel`, { method: 'POST', headers: guestH(f.token) })).data.request.status, 'cancelled_by_guest');
  assert.deepEqual((await stat()).slice(-1), ['reversed']);

  // 3) earned, unapplied, then reversed
  f = await friendJoins(env, code); r = (await purchase(env, f.token, offerId)).data.request.request_id;
  await act(env, r, 'confirm'); await act(env, r, 'fulfil');
  assert.deepEqual((await stat()).slice(-1), ['earned']);
  await act(env, r, 'cancel', { note: 'refunded - supplier no-show' });
  assert.deepEqual((await stat()).slice(-1), ['reversed']);
  assert.equal((await credits(env)).at(-1).needs_manual_adjustment, 0);

  // 4) applied, then the purchase is reversed -> flagged, fare NOT silently changed
  f = await friendJoins(env, code); r = (await purchase(env, f.token, offerId)).data.request.request_id;
  await act(env, r, 'confirm'); await act(env, r, 'fulfil');
  const credit = (await credits(env)).at(-1);
  await apply(env, credit.credit_id, returnId);
  await act(env, r, 'cancel', { note: 'refund after the discount was given' });
  const after = await db(env, 'SELECT * FROM marau_reward_credits WHERE credit_id = ?', credit.credit_id);
  assert.equal(after.status, 'reversed');
  assert.equal(after.needs_manual_adjustment, 1);
  const list = (await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) })).data.credits.find((c) => c.credit_id === credit.credit_id);
  assert.equal(list.needs_manual_adjustment, true);
  const fare = (await call(env, '/preview/trip', { headers: guestH(a.token) })).data.bookings.find((b) => b.id === returnId).fare;
  assert.equal(fare.adjustment_status, 'reversal_pending_staff');
  assert.equal(fare.amount_due_fjd, 90, 'no automatic change to the amount due - a human decides');
  assert.equal((await db(env, 'SELECT quoted_amount FROM marau_test_bookings WHERE id = ?', returnId)).quoted_amount, 100);
});

test('saved, declined and expired purchases never earn: pay-later requests alone are not qualifying', async () => {
  const { env, offerId } = await setup();
  const a = await newGuest(env); const code = (await referralOf(env, a.token)).data.code;
  const f1 = await friendJoins(env, code); const f2 = await friendJoins(env, code); const f3 = await friendJoins(env, code);
  await purchase(env, f1.token, offerId); // saved only
  const declined = (await purchase(env, f2.token, offerId)).data.request.request_id; await act(env, declined, 'decline', { note: 'x' });
  const lapsing = (await purchase(env, f3.token, offerId)).data.request.request_id;
  await env.DB.prepare(`UPDATE marau_offer_requests SET hold_expires_at = ? WHERE request_id = ?`).bind(inDays(0, -1), lapsing).run();
  assert.equal((await act(env, lapsing, 'confirm')).status, 409);
  assert.equal((await credits(env)).length, 0);
});

// ============================================================ applying a credit

test('only the holder\'s own upcoming, uncancelled RETURN transfer can receive a credit; credit is capped at the fare', async () => {
  const { env, offerId } = await setup({ mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 100, min_purchase_fjd: 0, qualify_on: 'fulfilled' });
  const a = await newGuest(env); const other = await newGuest(env);
  const code = (await referralOf(env, a.token)).data.code;
  const makeCredit = async () => { const f = await friendJoins(env, code); const r = (await purchase(env, f.token, offerId)).data.request.request_id; await act(env, r, 'confirm'); await act(env, r, 'fulfil'); return (await credits(env)).at(-1).credit_id; };

  const credit = await makeCredit();
  const arrivalId = (await db(env, `SELECT id FROM marau_test_bookings WHERE guest_session_id = ? AND leg_type = 'arrival'`, a.sessionId)).id;
  const othersReturn = await addReturnLeg(env, other.sessionId);
  const cancelledReturn = await addReturnLeg(env, a.sessionId, { status: 'cancelled' });
  const pastReturn = await addReturnLeg(env, a.sessionId, { days: -2 });
  for (const [label, id] of [['arrival leg', arrivalId], ["another guest's return", othersReturn], ['cancelled return', cancelledReturn], ['past return', pastReturn], ['unknown', 999999]]) {
    const res = await apply(env, credit, id);
    assert.equal(res.status, 409, label);
    assert.equal(res.data.error, 'NOT_AN_ELIGIBLE_RETURN_TRANSFER', label);
  }
  assert.equal((await db(env, 'SELECT status FROM marau_reward_credits WHERE credit_id = ?', credit)).status, 'earned', 'a refused application leaves the credit usable');
  assert.equal((await call(env, `/preview/admin/rewards/credits/${credit}/apply`, { method: 'POST', headers: admin(env), body: { booking_id: 1 } })).status, 401, 'staff identity required');
  assert.equal((await call(env, `/preview/admin/rewards/credits/${credit}/apply`, { method: 'POST', headers: staffH(env), body: {} })).status, 400);

  const cheap = await addReturnLeg(env, a.sessionId, { amount: 6 }); // fare below the credit
  const res = await apply(env, credit, cheap);
  assert.equal(res.data.fare.referral_credit_fjd, 6, 'the credit applied never exceeds the fare');
  assert.equal(res.data.fare.amount_due_fjd, 0);
});

test('CONCURRENT redemption: one credit cannot go to two bookings; two credits cannot both land on one booking; nothing is double-applied', async () => {
  const { env, offerId } = await setup({ mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 100, min_purchase_fjd: 0, qualify_on: 'fulfilled' });
  const a = await newGuest(env); const code = (await referralOf(env, a.token)).data.code;
  const makeCredit = async () => { const f = await friendJoins(env, code); const r = (await purchase(env, f.token, offerId)).data.request.request_id; await act(env, r, 'confirm'); await act(env, r, 'fulfil'); return (await credits(env)).at(-1).credit_id; };
  const c1 = await makeCredit(); const c2 = await makeCredit();
  const b1 = await addReturnLeg(env, a.sessionId); const b2 = await addReturnLeg(env, a.sessionId);

  // one credit, two bookings, at once
  const [x, y] = await Promise.all([apply(env, c1, b1, 'staff-tok-ana'), apply(env, c1, b2, 'staff-tok-bala')]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  assert.equal((await all(env, 'SELECT * FROM marau_booking_adjustments WHERE credit_id = ?', c1)).length, 1);

  // two credits, one booking, at once (b2 is free unless c1 landed there)
  const target = (await db(env, 'SELECT booking_id FROM marau_booking_adjustments WHERE credit_id = ?', c1)).booking_id === b1 ? b2 : b1;
  const c3 = await makeCredit();
  const [p, q] = await Promise.all([apply(env, c2, target, 'staff-tok-ana'), apply(env, c3, target, 'staff-tok-bala')]);
  assert.deepEqual([p.status, q.status].sort(), [200, 409]);
  assert.equal((await all(env, 'SELECT * FROM marau_booking_adjustments WHERE booking_id = ?', target)).length, 1);
  const states = (await credits(env)).map((c) => c.status);
  assert.equal(states.filter((s) => s === 'applied').length, 2, 'exactly the credits that landed are applied');
  assert.equal(states.filter((s) => s === 'earned').length, 1, 'the loser was handed back, still usable');
  assert.equal((await all(env, 'SELECT * FROM marau_booking_adjustments')).length, 2);
});

test('concurrent qualification: simultaneous fulfilment/confirmation events create exactly one credit', async () => {
  const { env, offerId } = await setup({ mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 100, min_purchase_fjd: 0, qualify_on: 'confirmed' });
  const a = await newGuest(env); const f = await friendJoins(env, (await referralOf(env, a.token)).data.code);
  const r = (await purchase(env, f.token, offerId)).data.request.request_id;
  await Promise.all([act(env, r, 'confirm', {}, 'staff-tok-ana'), act(env, r, 'confirm', {}, 'staff-tok-bala'), act(env, r, 'confirm', {}, 'staff-tok-ana')]);
  assert.equal((await credits(env)).length, 1);
});

// ============================================================ staff visibility, funding, reporting

test('staff see referral/credit status with holder contact and follow-up channel (email fallback, no WhatsApp); guests and the public never do', async () => {
  const { env, offerId } = await setup();
  const a = await newGuest(env, { whatsapp_available: false });
  const f = await friendJoins(env, (await referralOf(env, a.token)).data.code);
  const r = (await purchase(env, f.token, offerId)).data.request.request_id; await act(env, r, 'confirm'); await act(env, r, 'fulfil');
  await addReturnLeg(env, a.sessionId);
  const staff = (await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) })).data.credits[0];
  assert.equal(staff.holder.follow_up.channel, 'email');
  assert.ok(staff.holder.phone && staff.holder.email);
  assert.equal(staff.eligible_return_transfers.length, 1);
  const guestView = JSON.stringify((await referralOf(env, a.token)).data);
  for (const hidden of ['preview.guest', 'follow_up', 'holder', f.sessionId, f.token]) assert.equal(guestView.includes(hidden), false, `guest referral view leaked ${hidden}`);
  assert.equal((await call(env, '/preview/admin/rewards/credits', { headers: admin(env) })).status, 401);
});

test('report: additional sales and contribution are separate from requests, shares and quoted value; reward funding is recorded and totalled', async () => {
  const { env, offerId } = await setup();
  const a = await newGuest(env); const returnId = await addReturnLeg(env, a.sessionId, { amount: 100 });
  const code = (await referralOf(env, a.token)).data.code;
  await call(env, '/preview/referral/share', { method: 'POST', headers: guestH(a.token) });
  await call(env, '/preview/referral/share', { method: 'POST', headers: guestH(a.token) });
  const f = await friendJoins(env, code); const open = await friendJoins(env, code);
  const r = (await purchase(env, f.token, offerId, 2)).data.request.request_id; await act(env, r, 'confirm'); await act(env, r, 'fulfil');
  await purchase(env, open.token, offerId, 1); // saved only
  await apply(env, (await credits(env))[0].credit_id, returnId);

  const rep = (await call(env, '/preview/admin/offers/report', { headers: staffH(env) })).data;
  assert.equal(rep.referral_shares_tapped, 2, 'shares are a separate measure');
  assert.equal(rep.referral_friends_attributed, 2);
  assert.equal(rep.requests_total, 2);
  assert.equal(rep.requests_fulfilled, 1);
  assert.equal(rep.quoted_value_open_fjd, 120, 'the saved-only request is quoted value, not a sale');
  assert.equal(rep.confirmed_sales_value_fjd, 240);
  assert.equal(rep.realised_contribution_fjd_before_rewards, 80, '2 places x (120 - 80)');
  assert.deepEqual(rep.reward_credits, { pending: 0, earned: 0, applied: 1, reversed: 0 });
  assert.equal(rep.reward_funding_committed_fjd, 10);
  assert.equal(rep.reward_funding_applied_fjd, 10);
  assert.match(rep.reward_funding_note, /operator payout is never reduced/);
  assert.match(rep.labels.quoted_value, /NOT revenue/);
});
