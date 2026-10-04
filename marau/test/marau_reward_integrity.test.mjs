/* Marau (PREVIEW/TEST ONLY) - reward integrity regressions (October round 2). Synthetic guests only; default-deny network.
 * Evidence label: LOCAL, AUTHOR-RUN. Reward amounts (FJ$10 / cap FJ$20) are SYNTHETIC TEST VALUES, not an approved rule.
 *
 * These tests were written RED FIRST against commit e9b7d2e (see docs/MARAU_REWARD_INTEGRITY_ROUND.md for the
 * before/after table). They prove WORKFLOW consistency - credit state, fare adjustment and staff-attention state agreeing
 * after every interruption - not merely that each single SQL statement is atomic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest } from './fixtures.mjs';
import worker from '../worker/worker.js';

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

const POLICY = { mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 20, min_purchase_fjd: 50, qualify_on: 'fulfilled', require_payment: 'paid_in_full' };

async function setup(policy = POLICY, { capacity = 20 } = {}) {
  const env = makeEnv();
  for (const [tok, name] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: tok, operator_name: name } });
  if (policy) { const r = await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: policy }); assert.equal(r.status, 200, JSON.stringify(r.data)); }
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Reef Tours', fulfilment_owner: 'Ana (ops)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
  const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title: 'Synthetic snorkel', location: 'Mamanuca reef (synthetic)', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity, price_per_place_fjd: 120, cost_per_place_fjd: 80 } });
  await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });
  return { env, offerId: offer.data.offer_id };
}
async function newGuest(env, over = {}) {
  const res = await call(env, '/preview/bookings', { method: 'POST', body: synthGuest({ leg_type: 'arrival', ...over }) });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const s = await one(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', res.data.access_token);
  return { token: res.data.access_token, sessionId: s.session_id };
}
async function addReturnLeg(env, sessionId, { amount = 100, days = 12, status = 'pending' } = {}) {
  const g = await one(env, 'SELECT guest_email, guest_phone FROM guest_sessions WHERE session_id = ?', sessionId);
  const ref = `RET-${Math.random().toString(36).slice(2, 8)}`;
  await env.DB.prepare(`INSERT INTO marau_test_bookings (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, test_data, created_at, updated_at, leg_type) VALUES (?, ?, ?, ?, 'DENARAU', 'NAD_AIRPORT', 'Sedan', ?, ?, ?, 1, ?, ?, 'return')`)
    .bind(ref, sessionId, g.guest_email, g.guest_phone, inDays(days), amount, status, new Date().toISOString(), new Date().toISOString()).run();
  return (await one(env, 'SELECT id FROM marau_test_bookings WHERE client_booking_ref = ?', ref)).id;
}
const friendJoins = async (env, code) => {
  const res = await call(env, '/preview/bookings', { method: 'POST', body: { ...synthGuest({ leg_type: 'arrival' }), referral_code: code } });
  assert.equal(res.status, 201);
  const s = await one(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', res.data.access_token);
  return { token: res.data.access_token, sessionId: s.session_id };
};
const codeOf = async (env, token) => (await call(env, '/preview/referral', { headers: guestH(token) })).data.code;
const buy = (env, token, offerId, places = 1) => call(env, `/preview/offers/${offerId}/request`, { method: 'POST', headers: guestH(token), body: { places } });
const act = (env, rid, action, body = {}, tok = 'staff-tok-ana') => call(env, `/preview/admin/offers/requests/${rid}/${action}`, { method: 'POST', headers: staffH(env, tok), body });
// MARAU_RED_BASELINE=1 stubs ONLY the payment-evidence endpoint (which did not exist at e9b7d2e) so the apply/reversal tests
// below exercise the OLD workflow's real behaviour instead of failing early in shared setup. Never set in normal runs.
const BASELINE = process.env.MARAU_RED_BASELINE === '1';
const pay = (env, rid, body, tok = 'staff-tok-ana') => BASELINE ? Promise.resolve({ status: 200, data: {} }) : call(env, `/preview/admin/offers/requests/${rid}/payment`, { method: 'POST', headers: staffH(env, tok), body });
const apply = (env, creditId, bookingId, tok = 'staff-tok-ana') => call(env, `/preview/admin/rewards/credits/${creditId}/apply`, { method: 'POST', headers: staffH(env, tok), body: { booking_id: bookingId } });
const credits = (env) => all(env, 'SELECT * FROM marau_reward_credits ORDER BY created_at, credit_id');

/** One friend who has purchased (confirmed) an experience, so a pending credit exists for `referrer`. Returns the request id. */
async function qualifyingFriend(env, offerId, referrerToken, { pay_ = true, fulfil = true } = {}) {
  const friend = await friendJoins(env, await codeOf(env, referrerToken));
  const rid = (await buy(env, friend.token, offerId, 1)).data.request.request_id;
  assert.equal((await act(env, rid, 'confirm')).status, 200);
  if (pay_) assert.equal((await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'cash', event_key: `pay-${rid}` })).status, 200);
  if (fulfil) assert.equal((await act(env, rid, 'fulfil')).status, 200);
  return rid;
}

/** The workflow invariant: credit state, fare adjustment and staff-attention state must always agree. */
async function assertLedgerConsistent(env, label = '') {
  const LIVE = ['applied', 'reversal_pending_staff'];
  for (const c of await credits(env)) {
    const adjs = await all(env, 'SELECT * FROM marau_booking_adjustments WHERE credit_id = ?', c.credit_id);
    const live = adjs.filter((a) => LIVE.includes(a.status));
    const where = `${label} credit ${c.credit_id} status=${c.status}`;
    if (c.status === 'applied') {
      assert.equal(live.length, 1, `${where}: an applied credit must have exactly one live adjustment (has ${live.length})`);
      assert.equal(live[0].status, 'applied', where);
      assert.equal(c.applied_booking_id, live[0].booking_id, where);
      assert.equal(c.applied_by, live[0].created_by, `${where}: operator attribution must match`);
      assert.equal(c.applied_cents, live[0].credit_cents, where);
      assert.equal(c.needs_manual_adjustment, 0, where);
      const b = await one(env, 'SELECT status FROM marau_test_bookings WHERE id = ?', c.applied_booking_id);
      assert.ok(!['cancelled', 'declined'].includes(b.status), `${where}: applied to a cancelled booking`);
    } else if (c.status === 'reversed') {
      if (live.length) {
        assert.equal(c.needs_manual_adjustment, 1, `${where}: a live discount on a reversed credit must be flagged`);
        assert.ok(live.every((a) => a.status === 'reversal_pending_staff'), `${where}: its adjustment must be pending staff review`);
      }
    } else {
      assert.equal(live.length, 0, `${where}: a ${c.status} credit must not carry a live adjustment`);
      assert.equal(c.applied_booking_id, null, where);
    }
  }
  const bookings = await all(env, `SELECT DISTINCT booking_id FROM marau_booking_adjustments`);
  for (const { booking_id: id } of bookings) {
    const b = await one(env, 'SELECT quoted_amount FROM marau_test_bookings WHERE id = ?', id);
    const used = (await one(env, `SELECT COALESCE(SUM(credit_cents), 0) AS n FROM marau_booking_adjustments WHERE booking_id = ? AND status IN ('applied', 'reversal_pending_staff')`, id)).n;
    assert.ok(used <= Math.round(b.quoted_amount * 100), `${label} booking ${id}: credits (${used}) exceed the fare`);
  }
}

/** Pauses at the FIRST statement (or batch containing a statement) matching `matcher` - before it runs, or right after with {after:true} - until released, to force an interleaving. */
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
  return {
    async reachedWithin(ms = 200) { return Promise.race([reached, new Promise((r) => setTimeout(() => r(false), ms))]); },
    release() { release(); },
    restore() { env.DB = real; },
  };
}

// ====================================================================== 1. PAYMENT EVIDENCE

test('PAYMENT: fulfilled-but-UNPAID does not earn credit under the pay-later policy; payment evidence then earns exactly one', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env);
  const rid = await qualifyingFriend(env, offerId, referrer.token, { pay_: false, fulfil: true });
  assert.deepEqual((await credits(env)).map((c) => c.status), ['pending'], 'fulfilled but unpaid must stay pending');
  assert.equal((await call(env, '/preview/referral', { headers: guestH(referrer.token) })).data.credits.filter((c) => c.status === 'earned').length, 0);
  const p = await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'k1' });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.deepEqual((await credits(env)).map((c) => c.status), ['earned']);
  assert.equal((await credits(env)).length, 1);
});

test('PAYMENT: paid BEFORE fulfilment earns at fulfilment (either order ends in the same state)', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env);
  await qualifyingFriend(env, offerId, referrer.token, { pay_: true, fulfil: false });
  assert.deepEqual((await credits(env)).map((c) => c.status), ['pending'], 'confirmed + paid but not yet delivered');
  const rid = (await all(env, 'SELECT request_id FROM marau_offer_requests'))[0].request_id;
  await act(env, rid, 'fulfil');
  assert.deepEqual((await credits(env)).map((c) => c.status), ['earned']);
});

test('PAYMENT: repeated payment events are idempotent by event key; a different key may not overpay; a key may not change amount', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env);
  const rid = await qualifyingFriend(env, offerId, referrer.token, { pay_: false, fulfil: true });
  const first = await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'card', event_key: 'same' });
  const again = await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'card', event_key: 'same' });
  assert.equal(first.status, 200); assert.equal(again.status, 200); assert.equal(again.data.repeated, true);
  assert.equal((await all(env, 'SELECT * FROM marau_offer_payments WHERE request_id = ?', rid)).length, 1);
  assert.equal((await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'card', event_key: 'other' })).status, 409, 'a second full payment would overpay');
  assert.equal((await pay(env, rid, { event: 'paid', amount_fjd: 50, method: 'card', event_key: 'same' })).status, 409, 'same key, different amount');
  assert.deepEqual((await credits(env)).map((c) => c.status), ['earned']);
  assert.equal((await credits(env)).length, 1);
});

test('PAYMENT: a refund with no recorded payment is refused (events must arrive in a state-consistent order)', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env);
  const rid = await qualifyingFriend(env, offerId, referrer.token, { pay_: false, fulfil: false });
  const r = await pay(env, rid, { event: 'refunded', amount_fjd: 120, method: 'card', event_key: 'rf-first' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'REFUND_EXCEEDS_PAYMENT');
  assert.equal((await all(env, 'SELECT * FROM marau_offer_payments')).length, 0);
});

test('PAYMENT: partial payment does not qualify; completing it does', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env);
  const rid = await qualifyingFriend(env, offerId, referrer.token, { pay_: false, fulfil: true });
  await pay(env, rid, { event: 'paid', amount_fjd: 60, method: 'cash', event_key: 'a' });
  assert.deepEqual((await credits(env)).map((c) => c.status), ['pending']);
  await pay(env, rid, { event: 'paid', amount_fjd: 60, method: 'cash', event_key: 'b' });
  assert.deepEqual((await credits(env)).map((c) => c.status), ['earned']);
});

test('PAYMENT: a refund after earning reverses the credit; after APPLYING it flags the discount for a human and never silently changes the fare', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env);
  const returnId = await addReturnLeg(env, referrer.sessionId, { amount: 100 });
  const rid = await qualifyingFriend(env, offerId, referrer.token);
  const [credit] = await credits(env);
  assert.equal(credit.status, 'earned');
  assert.equal((await apply(env, credit.credit_id, returnId)).status, 200);
  const refund = await pay(env, rid, { event: 'refunded', amount_fjd: 120, method: 'card', event_key: 'refund-1' });
  assert.equal(refund.status, 200, JSON.stringify(refund.data));
  const after = (await credits(env))[0];
  assert.equal(after.status, 'reversed');
  assert.equal(after.needs_manual_adjustment, 1);
  const fare = (await call(env, '/preview/trip', { headers: guestH(referrer.token) })).data.bookings.find((b) => b.id === returnId).fare;
  assert.equal(fare.adjustment_status, 'reversal_pending_staff');
  assert.equal(fare.amount_due_fjd, 90, 'the fare is not silently changed - a human decides');
  await assertLedgerConsistent(env, 'refund-after-apply');
  // A repeated refund event changes nothing.
  assert.equal((await pay(env, rid, { event: 'refunded', amount_fjd: 120, method: 'card', event_key: 'refund-1' })).data.repeated, true);
});

test('PAYMENT: a payment recorded AFTER cancellation never resurrects the credit; cancel-then-pay and pay-then-cancel end the same', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env);
  const rid = await qualifyingFriend(env, offerId, referrer.token, { pay_: false, fulfil: false });
  await act(env, rid, 'cancel', { note: 'guest cancelled before paying' });
  assert.equal((await credits(env))[0].status, 'reversed');
  assert.equal((await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'late' })).status, 200, 'a real payment is still recorded');
  assert.equal((await credits(env))[0].status, 'reversed', 'but the credit stays reversed');
  assert.equal((await credits(env)).length, 1);
});

test('PAYMENT: require_payment is policy-configurable: "none" earns on fulfilment alone; an invalid value is refused; the default is paid_in_full', async () => {
  const fresh = makeEnv();
  await call(fresh, '/preview/admin/staff-identities', { method: 'POST', headers: admin(fresh), body: { token: 'staff-tok-ana', operator_name: 'Ana (ops)' } });
  assert.equal((await call(fresh, '/preview/admin/rewards/policy', { headers: staffH(fresh) })).data.policy.require_payment, 'paid_in_full');
  assert.equal((await call(fresh, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(fresh), body: { require_payment: 'sometimes' } })).status, 400);
  const { env, offerId } = await setup({ ...POLICY, require_payment: 'none' });
  const referrer = await newGuest(env);
  await qualifyingFriend(env, offerId, referrer.token, { pay_: false, fulfil: true });
  assert.deepEqual((await credits(env)).map((c) => c.status), ['earned']);
});

test('PAYMENT: payments need a staff identity; the operator is recorded from the token, not the body; guests cannot post them', async () => {
  const { env, offerId } = await setup();
  const referrer = await newGuest(env);
  const rid = await qualifyingFriend(env, offerId, referrer.token, { pay_: false, fulfil: false });
  assert.equal((await call(env, `/preview/admin/offers/requests/${rid}/payment`, { method: 'POST', headers: admin(env), body: { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'x' } })).status, 401);
  assert.equal((await call(env, `/preview/admin/offers/requests/${rid}/payment`, { method: 'POST', headers: guestH(referrer.token), body: { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'x' } })).status, 401);
  await pay(env, rid, { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'x', recorded_by: 'Impersonated' }, 'staff-tok-bala');
  assert.equal((await one(env, 'SELECT recorded_by FROM marau_offer_payments WHERE request_id = ?', rid)).recorded_by, 'Bala (ops)');
});

// ====================================================================== 2. APPLY / REVERSAL WORKFLOW

async function earnedCredit(policy = POLICY, { returnAmount = 100 } = {}) {
  const ctx = await setup(policy);
  const referrer = await newGuest(ctx.env);
  const returnId = await addReturnLeg(ctx.env, referrer.sessionId, { amount: returnAmount });
  const rid = await qualifyingFriend(ctx.env, ctx.offerId, referrer.token);
  const [credit] = await credits(ctx.env);
  assert.equal(credit.status, 'earned');
  return { ...ctx, referrer, returnId, rid, creditId: credit.credit_id };
}

test('APPLY: two OVERLAPPING apply calls for the same credit + booking both succeed, make one adjustment, and report the WINNER as operator', async () => {
  const { env, creditId, returnId } = await earnedCredit();
  const [a, b] = await Promise.all([apply(env, creditId, returnId, 'staff-tok-ana'), apply(env, creditId, returnId, 'staff-tok-bala')]);
  assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.data, b.data]));
  assert.equal([a, b].filter((r) => r.data.repeated).length, 1, 'exactly one is the replay');
  assert.equal((await all(env, 'SELECT * FROM marau_booking_adjustments')).length, 1);
  const winner = (await one(env, 'SELECT applied_by FROM marau_reward_credits WHERE credit_id = ?', creditId)).applied_by;
  assert.equal(a.data.operator, winner); assert.equal(b.data.operator, winner, 'the retry reports the original operator');
  await assertLedgerConsistent(env, 'overlapping apply');
});

test('APPLY: a retry that follows success keeps the winning operator and creates nothing', async () => {
  const { env, creditId, returnId } = await earnedCredit();
  assert.equal((await apply(env, creditId, returnId, 'staff-tok-ana')).status, 200);
  const again = await apply(env, creditId, returnId, 'staff-tok-bala');
  assert.equal(again.status, 200);
  assert.equal(again.data.repeated, true);
  assert.equal(again.data.operator, 'Ana (ops)');
  assert.equal((await all(env, 'SELECT * FROM marau_booking_adjustments')).length, 1);
  assert.equal((await apply(env, creditId, returnId + 999)).status, 409, 'a different booking after success is refused');
});

test('APPLY: a FAULT after the credit is claimed but before the adjustment exists leaves NOTHING half-done (no applied credit without an adjustment)', async () => {
  const { env, creditId, returnId } = await earnedCredit();
  env.DB.exec(`CREATE TRIGGER inject_fault BEFORE INSERT ON marau_booking_adjustments BEGIN SELECT RAISE(ABORT, 'injected adjustment fault'); END;`);
  let threw = false; let res;
  try { res = await apply(env, creditId, returnId); } catch { threw = true; }
  assert.ok(threw || res.status >= 500 || res.status === 409, 'the failure is reported, never a success');
  env.DB.exec('DROP TRIGGER inject_fault');
  const c = await one(env, 'SELECT status, applied_by, applied_booking_id FROM marau_reward_credits WHERE credit_id = ?', creditId);
  assert.equal(c.status, 'earned', `credit must be back to / still 'earned' (is '${c.status}')`);
  assert.equal(c.applied_booking_id, null);
  assert.equal((await all(env, 'SELECT * FROM marau_booking_adjustments')).length, 0);
  await assertLedgerConsistent(env, 'after fault');
  // The retry then succeeds, attributed to whoever completes it.
  const retry = await apply(env, creditId, returnId, 'staff-tok-bala');
  assert.equal(retry.status, 200, JSON.stringify(retry.data));
  assert.equal(retry.data.operator, 'Bala (ops)');
  await assertLedgerConsistent(env, 'after retry');
});

test('APPLY: a PARTIAL state left by the old workflow (applied, no adjustment) is repaired by a same-booking retry with the ORIGINAL operator', async () => {
  const { env, creditId, returnId } = await earnedCredit();
  await env.DB.prepare(`UPDATE marau_reward_credits SET status = 'applied', applied_at = ?, applied_by = 'Ana (ops)', applied_booking_id = ?, applied_cents = 1000 WHERE credit_id = ?`).bind(new Date().toISOString(), returnId, creditId).run();
  const retry = await apply(env, creditId, returnId, 'staff-tok-bala');
  assert.equal(retry.status, 200, JSON.stringify(retry.data));
  assert.equal(retry.data.operator, 'Ana (ops)', 'the retry never takes over attribution');
  assert.equal((await all(env, 'SELECT created_by FROM marau_booking_adjustments'))[0].created_by, 'Ana (ops)');
  await assertLedgerConsistent(env, 'repair');
});

test('APPLY: two RETRIES overlapping the adjustment insert of a partial state never error and never double-insert', async () => {
  const { env, creditId, returnId } = await earnedCredit();
  await env.DB.prepare(`UPDATE marau_reward_credits SET status = 'applied', applied_at = ?, applied_by = 'Ana (ops)', applied_booking_id = ?, applied_cents = 1000 WHERE credit_id = ?`).bind(new Date().toISOString(), returnId, creditId).run();
  const g = gate(env, /INSERT INTO marau_booking_adjustments/);
  const first = apply(env, creditId, returnId, 'staff-tok-ana');
  await g.reachedWithin();
  const second = apply(env, creditId, returnId, 'staff-tok-bala');
  await new Promise((r) => setTimeout(r, 20));
  g.release(); g.restore();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.data, b.data]));
  assert.equal((await all(env, 'SELECT * FROM marau_booking_adjustments')).length, 1);
  await assertLedgerConsistent(env, 'overlapping retries');
});

test('REVERSAL RACE (a): purchase reversed AFTER it read the credit as earned but BEFORE its write, while redemption wins in between', async () => {
  const { env, creditId, returnId, rid } = await earnedCredit();
  const g = gate(env, /FROM marau_reward_credits WHERE qualifying_request_id/, { after: true }); // pause the reversal right AFTER it read the credit
  const reversal = act(env, rid, 'cancel', { note: 'refund while being redeemed' });
  await g.reachedWithin();
  const redemption = await apply(env, creditId, returnId);
  g.release(); g.restore();
  await reversal;
  assert.ok([200, 409].includes(redemption.status));
  await assertLedgerConsistent(env, 'reversal-race-a');
  const c = (await credits(env))[0];
  assert.equal(c.status, 'reversed');
  if (redemption.status === 200) {
    assert.equal(c.needs_manual_adjustment, 1);
    assert.equal((await one(env, 'SELECT status FROM marau_booking_adjustments')).status, 'reversal_pending_staff');
  }
});

test('REVERSAL RACE (b): redemption claimed the credit and is about to write the adjustment when the purchase is reversed', async () => {
  const { env, creditId, returnId, rid } = await earnedCredit();
  const g = gate(env, /INSERT INTO marau_booking_adjustments/);
  const redemption = apply(env, creditId, returnId);
  await g.reachedWithin();
  assert.equal((await act(env, rid, 'cancel', { note: 'refund mid redemption' })).status, 200);
  g.release(); g.restore();
  const r = await redemption;
  assert.ok([200, 409].includes(r.status), JSON.stringify(r.data));
  await assertLedgerConsistent(env, 'reversal-race-b');
  assert.equal((await credits(env))[0].status, 'reversed');
});

test('REVERSAL RACE (c): the two run fully concurrently - whichever order wins, every state agrees', async () => {
  for (let i = 0; i < 6; i += 1) {
    const { env, creditId, returnId, rid } = await earnedCredit();
    await Promise.all([apply(env, creditId, returnId), act(env, rid, 'cancel', { note: `race ${i}` })]);
    await assertLedgerConsistent(env, `concurrent ${i}`);
  }
});

test('RETURN CANCELLED DURING REDEMPTION: the booking is cancelled after the redemption checked it but before the adjustment is written', async () => {
  const { env, creditId, returnId } = await earnedCredit();
  const g = gate(env, /INSERT INTO marau_booking_adjustments/);
  const redemption = apply(env, creditId, returnId);
  await g.reachedWithin();
  await env.DB.prepare(`UPDATE marau_test_bookings SET status = 'cancelled' WHERE id = ?`).bind(returnId).run();
  g.release(); g.restore();
  const r = await redemption;
  assert.equal(r.status, 409, JSON.stringify(r.data));
  assert.equal((await credits(env))[0].status, 'earned', 'the credit is not burned on a cancelled booking');
  await assertLedgerConsistent(env, 'cancel-during-redemption');
});

test('RETURN CANCELLED AFTER APPLICATION (even if no cancellation hook ever ran): the next read releases the credit and drops the discount', async () => {
  const { env, creditId, returnId, referrer } = await earnedCredit();
  assert.equal((await apply(env, creditId, returnId)).status, 200);
  await env.DB.prepare(`UPDATE marau_test_bookings SET status = 'cancelled' WHERE id = ?`).bind(returnId).run(); // e.g. the source cancelled it
  const listed = await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) });
  assert.equal(listed.status, 200);
  assert.equal((await credits(env))[0].status, 'earned', 'the credit is released for another return transfer');
  assert.equal((await one(env, 'SELECT status FROM marau_booking_adjustments')).status, 'released_booking_cancelled');
  await assertLedgerConsistent(env, 'released');
  const second = await addReturnLeg(env, referrer.sessionId, { amount: 80, days: 20 });
  assert.equal((await apply(env, creditId, second)).status, 200, 'and can be used on the next return transfer');
  await assertLedgerConsistent(env, 'reused');
});

test('RETURN CANCELLED BEFORE APPLICATION: refused as not eligible', async () => {
  const { env, creditId, returnId } = await earnedCredit();
  await env.DB.prepare(`UPDATE marau_test_bookings SET status = 'declined' WHERE id = ?`).bind(returnId).run();
  const r = await apply(env, creditId, returnId);
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'NOT_AN_ELIGIBLE_RETURN_TRANSFER');
});

// ====================================================================== 3. MULTIPLE CREDITS ON ONE RETURN

async function twoCredits({ returnAmount = 100, cap = 20 } = {}) {
  const ctx = await setup({ ...POLICY, cap_per_referrer_fjd: cap });
  const referrer = await newGuest(ctx.env);
  const returnId = await addReturnLeg(ctx.env, referrer.sessionId, { amount: returnAmount });
  await qualifyingFriend(ctx.env, ctx.offerId, referrer.token);
  await qualifyingFriend(ctx.env, ctx.offerId, referrer.token);
  const cs = await credits(ctx.env);
  assert.deepEqual(cs.map((c) => c.status), ['earned', 'earned']);
  return { ...ctx, referrer, returnId, cs };
}

test('MULTIPLE CREDITS: two earned credits apply to ONE return booking, bounded by the amount due; quote and payout untouched', async () => {
  const { env, cs, returnId, referrer } = await twoCredits({ returnAmount: 100 });
  assert.equal((await apply(env, cs[0].credit_id, returnId)).status, 200);
  const second = await apply(env, cs[1].credit_id, returnId);
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.fare.original_fare_fjd, 100);
  assert.equal(second.data.fare.referral_credit_fjd, 20);
  assert.equal(second.data.fare.amount_due_fjd, 80);
  assert.equal(second.data.fare.adjustments.length, 2);
  assert.equal((await one(env, 'SELECT quoted_amount FROM marau_test_bookings WHERE id = ?', returnId)).quoted_amount, 100);
  assert.equal((await call(env, '/preview/trip', { headers: guestH(referrer.token) })).data.bookings.find((b) => b.id === returnId).fare.amount_due_fjd, 80);
  await assertLedgerConsistent(env, 'two credits');
});

test('MULTIPLE CREDITS: credits can never exceed the amount due - the second is capped at the remainder and the unused part is reported, not hidden', async () => {
  const { env, cs, returnId } = await twoCredits({ returnAmount: 15 });
  assert.equal((await apply(env, cs[0].credit_id, returnId)).status, 200);
  const second = await apply(env, cs[1].credit_id, returnId);
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.equal(second.data.fare.amount_due_fjd, 0);
  assert.equal(second.data.applied_fjd, 5);
  assert.equal(second.data.unused_fjd, 5);
  await assertLedgerConsistent(env, 'bounded');
});

test('MULTIPLE CREDITS: a fully covered booking refuses further credits and leaves them earned', async () => {
  const ctx = await twoCredits({ returnAmount: 10 });
  const { env, cs, returnId } = ctx;
  assert.equal((await apply(env, cs[0].credit_id, returnId)).status, 200);
  const second = await apply(env, cs[1].credit_id, returnId);
  assert.equal(second.status, 409);
  assert.equal(second.data.error, 'BOOKING_FULLY_COVERED');
  assert.equal((await credits(env)).filter((c) => c.status === 'earned').length, 1);
});

test('MULTIPLE CREDITS: two different credits applied to the same booking concurrently never exceed the fare', async () => {
  for (let i = 0; i < 4; i += 1) {
    const { env, cs, returnId } = await twoCredits({ returnAmount: 12 });
    const [a, b] = await Promise.all([apply(env, cs[0].credit_id, returnId, 'staff-tok-ana'), apply(env, cs[1].credit_id, returnId, 'staff-tok-bala')]);
    assert.ok(a.status === 200 || b.status === 200);
    await assertLedgerConsistent(env, `concurrent-two ${i}`);
    const due = (await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) })).status;
    assert.equal(due, 200);
  }
});

test('MULTIPLE CREDITS: the per-referrer cap still bounds how many credits can be EARNED at all', async () => {
  const ctx = await setup({ ...POLICY, cap_per_referrer_fjd: 20 });
  const referrer = await newGuest(ctx.env);
  for (let i = 0; i < 3; i += 1) await qualifyingFriend(ctx.env, ctx.offerId, referrer.token);
  assert.equal((await credits(ctx.env)).length, 2, 'FJ$10 x 2 = the FJ$20 test cap; the third friend earns nothing');
  assert.equal((await all(ctx.env, `SELECT * FROM marau_referrals WHERE status = 'capped'`)).length, 1);
});

test('MULTIPLE CREDITS: staff resolving a flagged reversal clears the attention state and restores the amount due, with attribution', async () => {
  const { env, cs, returnId, rid } = await (async () => {
    const t = await twoCredits({ returnAmount: 100 });
    const rid = (await all(t.env, 'SELECT qualifying_request_id FROM marau_reward_credits ORDER BY created_at'))[0].qualifying_request_id;
    return { ...t, rid };
  })();
  await apply(env, cs[0].credit_id, returnId); await apply(env, cs[1].credit_id, returnId);
  await act(env, rid, 'cancel', { note: 'refunded after discount' });
  await assertLedgerConsistent(env, 'flagged');
  const adj = await one(env, `SELECT adjustment_id FROM marau_booking_adjustments WHERE status = 'reversal_pending_staff'`);
  assert.ok(adj, 'one adjustment awaits a staff decision');
  const r = await call(env, `/preview/admin/rewards/adjustments/${adj.adjustment_id}/resolve`, { method: 'POST', headers: staffH(env, 'staff-tok-bala'), body: { note: 'collected the extra FJ$10 by cash' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.fare.amount_due_fjd, 90, 'only the reversed credit is removed from the discount');
  assert.equal((await one(env, 'SELECT needs_manual_adjustment FROM marau_reward_credits WHERE status = ?', 'reversed')).needs_manual_adjustment, 0);
  await assertLedgerConsistent(env, 'resolved');
});

// ====================================================================== 4. WHAT A GUEST IS TOLD (found in the guest-browser run)

test('PUBLIC PROMISE: a reward is described only to a guest who could actually earn it (a non-synthetic session in preview mode is told rewards are not on), and the wording says the friend must PAY when payment is required', async () => {
  const { env } = await setup();
  const synthetic = await newGuest(env);
  const real = await newGuest(env);
  await env.DB.prepare('UPDATE guest_sessions SET test_data = 0 WHERE session_id = ?').bind(real.sessionId).run();
  const s = (await call(env, '/preview/referral', { headers: guestH(synthetic.token) })).data.policy;
  const r = (await call(env, '/preview/referral', { headers: guestH(real.token) })).data.policy;
  assert.equal(s.rewards_active, true);
  assert.equal(s.requires_payment, true, 'the friend must pay - the guest is told so');
  assert.equal(r.rewards_active, false, 'a guest who cannot earn is never promised a reward');
  assert.match(r.message, /not switched on/);
  // The off state promises nothing at all.
  await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: { mode: 'off' } });
  assert.equal((await call(env, '/preview/referral', { headers: guestH(synthetic.token) })).data.policy.rewards_active, false);
});
