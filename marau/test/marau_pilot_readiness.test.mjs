/* Marau (PREVIEW/TEST ONLY) - FINAL PILOT READINESS: completed-status ambiguity, the manual-send timing contract, and focused
 * round-trip balance / re-quote / cancel-restore checks. Synthetic data; default-deny network. Evidence label: LOCAL, AUTHOR-RUN.
 * Red-first against branch ceo/marau-roundtrip-legs (tag marau-roundtrip-preview-1).
 *
 * Honest limit, stated once: this app cannot technically prevent a person from sending a message outside it. It can only (a) refuse
 * to hand out a message when the facts say do not send, (b) invalidate stale prepared lists, and (c) record what actually happened,
 * flagging a send made contrary to eligibility instead of hiding it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest } from './fixtures.mjs';
import worker, { createGuestSession, createSessionAndOfferLink, nowIso } from '../worker/worker.js';
import { normalizePickupDatetime } from '../worker/fiji_time.js';
import { syncRealBookingEvent } from '../worker/real_booking_sync.js';

installNetworkGuard();

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

// ---- source booking in the REAL schema's field names, with a call counter so "the source is never written/called by staff verification" is checkable
let n = 0;
const src = (over = {}) => { n += 1; return { id: 8000 + n, client_booking_ref: `FD-PR${n}`, status: 'accepted', assigned_driver_id: 3, guest_phone: `+150055505${String(n).padStart(2, '0')}`, guest_email: `pr${n}@example.test`,
  pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', quoted_currency: 'FJD', quoted_amount: 170, settlement_amount_fjd: 150, commission_base_fjd: 20,
  pickup_date: dayStr(3), pickup_time: '09:00', return_date: dayStr(10), return_time: '10:30', return_pickup_location: 'Sofitel Denarau lobby', flight_number: null, created_at: '2026-10-01T00:00:00Z', ...over }; };
function sourceOf(row) { let cur = { ...row }; const s = { reads: 0, writes: 0, set: (r) => { cur = { ...r }; }, reader: async (ref) => { s.reads += 1; return { ...cur, source_booking_ref: String(ref) }; } }; return s; }
let ev = 300000;
const sync = (env, r, source, type = 'accepted', status = 'accepted') => syncRealBookingEvent(env, String(r.id), { event_type: type, new_status: status, source_event_id: ++ev, booking_id: r.id }, { createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime, reader: source.reader });
const legs = (env, r) => all(env, 'SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? ORDER BY id', String(r.id));
const legOf = (rows, k) => rows.find((x) => x.leg_key === k);
const POLICY = { mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 20, min_purchase_fjd: 0, qualify_on: 'fulfilled', require_payment: 'paid_in_full' };

async function programme({ over = {}, status = 'accepted', allocate = true } = {}) {
  const env = makeEnv();
  for (const [t, nm] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: t, operator_name: nm } });
  await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: POLICY });
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Reef Tours', fulfilment_owner: 'Ana (ops)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
  const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title: 'Synthetic snorkel', location: 'Reef (synthetic)', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 20, price_per_place_fjd: 120, cost_per_place_fjd: 80 } });
  await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });
  if (allocate) { const rl = await call(env, '/preview/admin/rewards/allocation-rules', { method: 'POST', headers: staffH(env), body: { kind: 'percent_of_total', percent: 40 } }); await call(env, `/preview/admin/rewards/allocation-rules/${rl.data.rule.rule_id}/approve`, { method: 'POST', headers: staffH(env), body: { note: 'synthetic' } }); }
  const r = src(over); const source = sourceOf(r);
  const first = await sync(env, r, source, 'created', 'accepted');
  assert.equal(first.ok, true, JSON.stringify(first));
  if (status !== 'accepted') { source.set({ ...r, status }); await sync(env, r, source, status, status); }
  const rows = await legs(env, r);
  const session = await one(env, 'SELECT * FROM guest_sessions WHERE session_id = ?', rows[0].guest_session_id);
  return { env, r, source, offerId: offer.data.offer_id, session, rows };
}
async function earnCredit(ctx) {
  const { env, offerId, session } = ctx;
  const code = (await call(env, '/preview/referral', { headers: guestH(session.access_token) })).data.code;
  const f = await call(env, '/preview/bookings', { method: 'POST', body: { ...synthGuest({ leg_type: 'arrival' }), referral_code: code } });
  const rid = (await call(env, `/preview/offers/${offerId}/request`, { method: 'POST', headers: guestH(f.data.access_token), body: { places: 1 } })).data.request.request_id;
  const act = (a, b = {}) => call(env, `/preview/admin/offers/requests/${rid}/${a}`, { method: 'POST', headers: staffH(env), body: b });
  await act('confirm'); await act('payment', { event: 'paid', amount_fjd: 120, method: 'cash', event_key: `p-${rid}` }); await act('fulfil');
  return { creditId: (await all(env, 'SELECT * FROM marau_reward_credits ORDER BY created_at')).at(-1).credit_id, rid };
}
const apply = (env, creditId, bookingId, tok = 'staff-tok-ana') => call(env, `/preview/admin/rewards/credits/${creditId}/apply`, { method: 'POST', headers: staffH(env, tok), body: { booking_id: bookingId } });
const verify = (env, bookingId, body, tok = 'staff-tok-bala') => call(env, `/preview/admin/bookings/${bookingId}/verify-status`, { method: 'POST', headers: staffH(env, tok), body });
const tripOf = async (ctx) => (await call(ctx.env, '/preview/trip', { headers: guestH(ctx.session.access_token) })).data;

// ====================================================================== 1. COMPLETED-STATUS AMBIGUITY

test('COMPLETED + UPCOMING RETURN: the return stays VISIBLE but carries an explicit status uncertainty - it is NOT shown as confirmed, and nothing about fulfilment is inferred', async () => {
  const ctx = await programme({ status: 'completed' });
  const ret = legOf(await legs(ctx.env, ctx.r), 'return'); const arr = legOf(await legs(ctx.env, ctx.r), 'arrival');
  assert.equal(ret.status, 'pending', 'never inferred as confirmed');
  assert.equal(ret.status_uncertainty, 'source_completed_while_return_upcoming');
  assert.equal(arr.source_status, 'completed');
  const trip = await tripOf(ctx);
  const vis = trip.bookings.find((b) => b.leg_key === 'return');
  assert.ok(vis, 'the guest still sees the upcoming return');
  assert.equal(vis.status_uncertainty, 'source_completed_while_return_upcoming');
  assert.equal(vis.status, 'pending');
  for (const secret of ['status_verified_by', 'status_verification_evidence']) assert.equal(JSON.stringify(trip).includes(secret), false, secret);
  assert.equal((await all(ctx.env, 'SELECT * FROM marau_offer_requests')).length, 0);
});

test('COMPLETED + UPCOMING RETURN: no redemption eligibility is inferred - a credit is refused with LEG_STATUS_UNVERIFIED and the target is flagged for verification', async () => {
  const ctx = await programme({ status: 'completed' });
  const { creditId } = await earnCredit(ctx);
  const ret = legOf(await legs(ctx.env, ctx.r), 'return');
  const r = await apply(ctx.env, creditId, ret.id);
  assert.equal(r.status, 409, JSON.stringify(r.data)); assert.equal(r.data.error, 'LEG_STATUS_UNVERIFIED');
  assert.equal((await one(ctx.env, 'SELECT status FROM marau_reward_credits WHERE credit_id = ?', creditId)).status, 'earned');
  const target = (await call(ctx.env, '/preview/admin/rewards/credits', { headers: staffH(ctx.env) })).data.credits[0].eligible_return_transfers.find((t) => t.booking_id === ret.id);
  assert.ok(target); assert.equal(target.needs_status_verification, true); assert.equal(target.status_uncertainty, 'source_completed_while_return_upcoming');
});

test('STAFF VERIFICATION: a named actor, a timestamp and EVIDENCE are required and recorded; the source is neither called nor changed; then the credit can apply', async () => {
  const ctx = await programme({ status: 'completed' });
  const ret = legOf(await legs(ctx.env, ctx.r), 'return');
  assert.equal((await call(ctx.env, `/preview/admin/bookings/${ret.id}/verify-status`, { method: 'POST', headers: admin(ctx.env), body: { verdict: 'return_upcoming', evidence: 'phoned the driver' } })).status, 401, 'staff identity required');
  assert.equal((await verify(ctx.env, ret.id, { verdict: 'return_upcoming' })).status, 400, 'evidence is required');
  assert.equal((await verify(ctx.env, ret.id, { verdict: 'return_upcoming', evidence: 'ok' })).status, 400, 'evidence must say something');
  assert.equal((await verify(ctx.env, ret.id, { verdict: 'maybe', evidence: 'phoned the driver' })).status, 400);
  const readsBefore = ctx.source.reads;
  const v = await verify(ctx.env, ret.id, { verdict: 'return_upcoming', evidence: 'Driver Alpha confirmed by phone 09:12 that the return on the 15th is still booked' });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.source_unchanged, true);
  assert.deepEqual([v.data.leg.status, v.data.leg.status_uncertainty, v.data.leg.verified_by], ['confirmed', null, 'Bala (ops)']);
  assert.ok(v.data.leg.verified_at);
  assert.equal(ctx.source.reads, readsBefore, 'verification never touches the source');
  const audit = await all(ctx.env, 'SELECT booking_id, verdict, evidence, actor, created_at FROM marau_leg_status_verifications');
  assert.equal(audit.length, 1); assert.equal(audit[0].actor, 'Bala (ops)'); assert.match(audit[0].evidence, /Driver Alpha confirmed/); assert.ok(audit[0].created_at);
  assert.equal(legOf(await legs(ctx.env, ctx.r), 'arrival').source_status, 'completed', 'the source booking is as the source reported it');
  const { creditId } = await earnCredit(ctx);
  const applied = await apply(ctx.env, creditId, ret.id);
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal((await verify(ctx.env, ret.id, { verdict: 'return_upcoming', evidence: 'again, for the record' })).data.error, 'NOTHING_TO_VERIFY');
});

test('VERIFICATION IS ABOUT SPECIFIC FACTS: repeated sync keeps it; a change to the return time or the source status puts the uncertainty back until re-verified', async () => {
  const ctx = await programme({ status: 'completed' });
  const ret0 = legOf(await legs(ctx.env, ctx.r), 'return');
  await verify(ctx.env, ret0.id, { verdict: 'return_upcoming', evidence: 'confirmed by phone with the guest' });
  for (let i = 0; i < 3; i += 1) await sync(ctx.env, ctx.r, ctx.source, 'completed', 'completed');
  let ret = legOf(await legs(ctx.env, ctx.r), 'return');
  assert.deepEqual([ret.status, ret.status_uncertainty], ['confirmed', null], 'repeated sync does not discard a verification');
  ctx.source.set({ ...ctx.r, status: 'completed', return_time: '16:00' });
  await sync(ctx.env, ctx.r, ctx.source, 'completed', 'completed');
  ret = legOf(await legs(ctx.env, ctx.r), 'return');
  assert.deepEqual([ret.status, ret.status_uncertainty], ['pending', 'source_completed_while_return_upcoming'], 'a changed return time invalidates the old verification');
  const { creditId } = await earnCredit(ctx);
  assert.equal((await apply(ctx.env, creditId, ret.id)).data.error, 'LEG_STATUS_UNVERIFIED');
  assert.equal((await verify(ctx.env, ret.id, { verdict: 'return_upcoming', evidence: 'confirmed the new 16:00 time' })).status, 200);
  assert.equal((await apply(ctx.env, creditId, ret.id)).status, 200);
});

test('VERIFICATION "NOT GOING AHEAD": the leg is cancelled on the Marau side only, an applied credit is released, and a later sync does not revive it', async () => {
  const ctx = await programme({ status: 'completed' });
  const ret = legOf(await legs(ctx.env, ctx.r), 'return');
  const v = await verify(ctx.env, ret.id, { verdict: 'return_not_going_ahead', evidence: 'guest flew home early, told us by email' });
  assert.equal(v.status, 200); assert.equal(v.data.leg.status, 'cancelled');
  await sync(ctx.env, ctx.r, ctx.source, 'completed', 'completed');
  assert.equal(legOf(await legs(ctx.env, ctx.r), 'return').status, 'cancelled', 'not revived by the next sync');
  const { creditId } = await earnCredit(ctx);
  assert.equal((await apply(ctx.env, creditId, ret.id)).status, 409);
  assert.equal(legOf(await legs(ctx.env, ctx.r), 'arrival').source_status, 'completed');
});

test('A return that is NOT affected (source accepted, or the return is already past) carries no uncertainty', async () => {
  const ctx = await programme();
  assert.equal(legOf(await legs(ctx.env, ctx.r), 'return').status_uncertainty, null);
  assert.equal(legOf(await legs(ctx.env, ctx.r), 'return').status, 'confirmed');
  const past = await programme({ over: { pickup_date: dayStr(-6), return_date: dayStr(-1) }, status: 'completed' });
  assert.equal(legOf(await legs(past.env, past.r), 'return').status_uncertainty, null, 'a past return is just past, not uncertain');
});

// ====================================================================== 2. MANUAL-SEND TIMING CONTRACT

const EDITION = '2031-03-03:morning'; const E = encodeURIComponent(EDITION);
async function pilot() {
  const env = makeEnv();
  for (const [t, nm] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: t, operator_name: nm } });
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Reef Tours', fulfilment_owner: 'Ana (ops)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
  const mk = async (title, cap = 2) => { const o = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title, location: 'Reef (synthetic)', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: cap, price_per_place_fjd: 100 } }); await call(env, `/preview/admin/offers/${o.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) }); return o.data.offer_id; };
  const a = await mk('Synthetic snorkel'); const b = await mk('Synthetic sunset');
  await call(env, '/preview/admin/editions', { method: 'POST', headers: staffH(env), body: { fiji_date: '2031-03-03', slot: 'morning', offer_ids: [a, b] } });
  await call(env, `/preview/admin/editions/${E}/publish`, { method: 'POST', headers: staffH(env) });
  const guest = async (consent = 'granted') => { const res = await call(env, '/preview/bookings', { method: 'POST', body: synthGuest({ leg_type: 'arrival' }) }); const s = await one(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', res.data.access_token); if (consent !== 'unknown') await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(res.data.access_token), body: { marketing_consent: consent } }); return { token: res.data.access_token, sid: s.session_id }; };
  const review = () => call(env, `/preview/admin/editions/${E}/review`, { method: 'POST', headers: staffH(env), body: { decision: 'approved_for_manual_send', note: 'checked' } });
  const prepare = () => call(env, `/preview/admin/editions/${E}/sends/prepare`, { method: 'POST', headers: staffH(env), body: {} });
  const check = (sid, tok) => call(env, `/preview/admin/editions/${E}/sends/${sid}/check`, { method: 'POST', headers: staffH(env, tok), body: {} });
  const outcome = (sid, status, note = 'by hand', tok) => call(env, `/preview/admin/editions/${E}/sends/${sid}/outcome`, { method: 'POST', headers: staffH(env, tok), body: { status, note } });
  const list = async () => (await call(env, `/preview/admin/editions/${E}/sends`, { headers: staffH(env) })).data;
  return { env, a, b, guest, review, prepare, check, outcome, list };
}

test('PRE-SEND CHECK: immediately before staff copy a message the app rechecks consent, suppression, offers and edition expiry; it hands out the text only when all hold, and says it cannot stop an external send', async () => {
  const p = await pilot(); const g = await p.guest();
  await p.review(); await p.prepare();
  const c = await p.check(g.sid, 'staff-tok-bala');
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(c.data.eligible, true); assert.equal(c.data.channel, 'whatsapp');
  assert.ok(c.data.checked_at);
  assert.match(c.data.message_text, /Synthetic snorkel/); assert.match(c.data.message_text, /Synthetic sunset/);
  assert.equal(/https?:|wa\.me|@|\+\d{6,}/.test(c.data.message_text), false, 'no link, no contact detail in the text');
  assert.equal(c.data.nothing_was_sent, true);
  assert.match(c.data.app_cannot_prevent_external_send, /cannot (technically )?prevent/i);
  const row = (await p.list()).sends.find((s) => s.session_id === g.sid);
  assert.equal(row.checked_by, 'Bala (ops)'); assert.ok(row.message_copied_at);
  assert.equal((await call(p.env, `/preview/admin/editions/${E}/sends/${g.sid}/check`, { method: 'POST', headers: guestH(g.token), body: {} })).status, 401);
});

test('PRE-SEND CHECK refuses and invalidates the entry when consent has been withdrawn or the channel suppressed since preparation', async () => {
  const p = await pilot(); const g1 = await p.guest(); const g2 = await p.guest();
  await p.review(); await p.prepare();
  await call(p.env, '/preview/trip/contact', { method: 'POST', headers: guestH(g1.token), body: { marketing_consent: 'withheld' } });
  const c1 = await p.check(g1.sid);
  assert.equal(c1.status, 409); assert.equal(c1.data.error, 'NOT_ELIGIBLE_TO_SEND'); assert.ok(c1.data.reasons.includes('no_marketing_consent')); assert.equal(c1.data.message_text, undefined);
  for (const ch of ['whatsapp', 'email']) await call(p.env, `/preview/admin/guests/${g2.sid}/suppressions`, { method: 'POST', headers: staffH(p.env), body: { channel: ch, kind: 'delivery_failure' } });
  const c2 = await p.check(g2.sid);
  assert.equal(c2.status, 409); assert.ok(c2.data.reasons.includes('channel_suppressed'));
  const l = await p.list();
  assert.deepEqual(l.sends.map((s) => [s.status, Boolean(s.stale_reason)]), [['prepared', true], ['prepared', true]]);
  assert.match(l.sends.find((s) => s.session_id === g1.sid).stale_reason, /no_marketing_consent/);
  assert.ok(l.summary.stale >= 2);
});

test('STALE LISTS: when offer availability changes the prepared list is invalidated on the next read; re-preparing refreshes it; withdrawing every offer invalidates everything', async () => {
  const p = await pilot(); const g = await p.guest();
  await p.review(); await p.prepare();
  assert.equal((await p.list()).sends[0].stale_reason ?? null, null, 'a fresh list is not stale');
  const buyer = await p.guest('unknown');
  const rq = await call(p.env, `/preview/offers/${p.a}/request`, { method: 'POST', headers: guestH(buyer.token), body: { places: 2 } });
  await call(p.env, `/preview/admin/offers/requests/${rq.data.request.request_id}/confirm`, { method: 'POST', headers: staffH(p.env), body: {} });
  let l = await p.list();
  assert.equal(l.sends[0].stale_reason, 'offer_availability_changed');
  const c = await p.check(g.sid);
  assert.equal(c.status, 409); assert.equal(c.data.error, 'PREPARED_ENTRY_STALE');
  const re = await p.prepare();
  assert.equal(re.status, 200, JSON.stringify(re.data)); assert.ok(re.data.refreshed >= 1);
  l = await p.list();
  assert.equal(l.sends[0].stale_reason ?? null, null);
  const ok = await p.check(g.sid);
  assert.equal(ok.status, 200); assert.match(ok.data.message_text, /Synthetic sunset/); assert.equal(/Synthetic snorkel/.test(ok.data.message_text), false, 'the sold-out offer is no longer in the text');
  for (const o of [p.a, p.b]) await call(p.env, `/preview/admin/offers/${o}/withdraw`, { method: 'POST', headers: staffH(p.env), body: { reason: 'gone' } });
  l = await p.list();
  assert.equal(l.sends[0].stale_reason, 'no_open_offer');
  assert.equal((await p.prepare()).status, 409);
});

test('EDITION EXPIRY: after the slot window the edition is expired - the check refuses, prepare refuses, and the view says so', async () => {
  const p = await pilot(); const g = await p.guest();
  await p.review(); await p.prepare();
  await p.env.DB.prepare(`UPDATE marau_deal_editions SET fiji_date = '2020-01-01' WHERE edition_id = ?`).bind(EDITION).run();
  const c = await p.check(g.sid);
  assert.equal(c.status, 409); assert.ok(c.data.reasons.includes('edition_expired'));
  assert.equal((await p.prepare()).data.error, 'EDITION_EXPIRED');
  const v = (await call(p.env, `/preview/admin/editions/${E}/review`, { headers: staffH(p.env) })).data;
  assert.equal(v.edition.expired, true);
  assert.equal((await p.list()).sends[0].stale_reason, 'edition_expired');
});

test('HONEST OUTCOMES: if consent is withdrawn between preparation and the recorded send, the send is RECORDED as what happened and flagged contrary to eligibility - never refused, never hidden - and distinct from "not sent"', async () => {
  const p = await pilot(); const sentOk = await p.guest(); const sentLate = await p.guest(); const notSent = await p.guest(); const expiredSend = await p.guest();
  await p.review(); await p.prepare();
  await p.check(sentOk.sid);
  const ok = await p.outcome(sentOk.sid, 'sent_manually', 'sent from the ops phone', 'staff-tok-ana');
  assert.equal(ok.status, 200); assert.equal(ok.data.send.sent_eligibility, 'eligible'); assert.equal(ok.data.sent_contrary_to_eligibility, false);

  await call(p.env, '/preview/trip/contact', { method: 'POST', headers: guestH(sentLate.token), body: { marketing_consent: 'withheld' } });
  const late = await p.outcome(sentLate.sid, 'sent_manually', 'sent before I saw the withdrawal', 'staff-tok-bala');
  assert.equal(late.status, 200, JSON.stringify(late.data));
  assert.equal(late.data.sent_contrary_to_eligibility, true);
  assert.equal(late.data.send.status, 'sent_manually'); assert.equal(late.data.send.sent_eligibility, 'contrary_to_eligibility');
  assert.ok(late.data.send.sent_eligibility_reasons.includes('no_marketing_consent'));
  assert.equal(late.data.send.updated_by, 'Bala (ops)');
  assert.match(late.data.note, /cannot (technically )?prevent/i);
  assert.equal((await one(p.env, 'SELECT marketing_consent FROM guest_sessions WHERE session_id = ?', sentLate.sid)).marketing_consent, 'withheld', 'recording a send never re-grants consent');

  await call(p.env, '/preview/trip/contact', { method: 'POST', headers: guestH(notSent.token), body: { marketing_consent: 'withheld' } });
  const ns = await p.outcome(notSent.sid, 'not_sent', 'saw the withdrawal, did not send');
  assert.equal(ns.status, 200); assert.equal(ns.data.send.status, 'not_sent'); assert.equal(ns.data.send.sent_eligibility ?? null, null); assert.equal(ns.data.sent_contrary_to_eligibility, false);

  await p.env.DB.prepare(`UPDATE marau_deal_editions SET fiji_date = '2020-01-01' WHERE edition_id = ?`).bind(EDITION).run();
  const ex = await p.outcome(expiredSend.sid, 'sent_manually', 'sent after the window');
  assert.equal(ex.status, 200); assert.equal(ex.data.sent_contrary_to_eligibility, true); assert.ok(ex.data.send.sent_eligibility_reasons.includes('edition_expired'));

  const l = await p.list();
  assert.equal(l.summary.sent_contrary_to_eligibility, 2);
  assert.equal(l.summary.sent_manually, 3); assert.equal(l.summary.not_sent, 1);
  const repeat = await p.outcome(sentLate.sid, 'sent_manually', 'dup', 'staff-tok-ana');
  assert.equal(repeat.data.repeated, true); assert.equal(repeat.data.send.updated_by, 'Bala (ops)');
});

// ====================================================================== 3. FOCUSED ROUND-TRIP BALANCE / RE-QUOTE / CANCEL-RESTORE

test('BOTH LEGS SHOW THE SAME BOOKING BALANCE after a credit - to the guest and to staff', async () => {
  const ctx = await programme(); const { creditId } = await earnCredit(ctx);
  const ret = legOf(await legs(ctx.env, ctx.r), 'return');
  assert.equal((await apply(ctx.env, creditId, ret.id)).status, 200);
  const trip = await tripOf(ctx);
  const [a, b] = ['arrival', 'return'].map((k) => trip.bookings.find((x) => x.leg_key === k).fare);
  for (const f of [a, b]) assert.deepEqual([f.scope, f.booking_total_fjd, f.referral_credit_fjd, f.amount_due_fjd, f.operator_payout_unchanged], ['round_trip_booking', 170, 10, 160, true]);
  assert.deepEqual(a.adjustments.map((x) => x.adjustment_id), b.adjustments.map((x) => x.adjustment_id), 'the same adjustment list from either leg');
  assert.equal(a.leg, 'arrival'); assert.equal(b.leg, 'return');
});

test('SOURCE QUOTE CHANGES AFTER CREDIT: the booking total follows the source, the credit stays one credit, the return value re-allocates, and the change is shown - never hidden', async () => {
  const ctx = await programme(); const { creditId } = await earnCredit(ctx);
  const ret = legOf(await legs(ctx.env, ctx.r), 'return');
  await apply(ctx.env, creditId, ret.id);
  ctx.source.set({ ...ctx.r, quoted_amount: 200, settlement_amount_fjd: 175 });
  await sync(ctx.env, ctx.r, ctx.source);
  await call(ctx.env, '/preview/admin/rewards/credits', { headers: staffH(ctx.env) });
  const trip = await tripOf(ctx);
  for (const k of ['arrival', 'return']) {
    const f = trip.bookings.find((x) => x.leg_key === k).fare;
    assert.deepEqual([f.booking_total_fjd, f.referral_credit_fjd, f.amount_due_fjd], [200, 10, 190], k);
    assert.equal(f.quote_changed_since_credit, true, k); assert.equal(f.booking_total_at_credit_fjd, 170, k);
  }
  assert.equal(trip.bookings.find((x) => x.leg_key === 'return').fare.return_value.value_fjd, 80, '40% of the NEW total');
  assert.equal((await all(ctx.env, `SELECT * FROM marau_booking_adjustments WHERE status = 'applied'`)).length, 1);
  assert.equal(JSON.stringify(trip).includes('175'), false, 'the operator settlement still never reaches the guest');
  const legRows = await legs(ctx.env, ctx.r);
  assert.deepEqual(legRows.map((x) => [x.source_total_cents, x.source_settlement_fjd_cents]), [[20000, 17500], [20000, 17500]], 'operator figures follow the source verbatim');
  // a re-quote BELOW the credit never makes the amount due negative
  ctx.source.set({ ...ctx.r, quoted_amount: 6 });
  await sync(ctx.env, ctx.r, ctx.source);
  const low = (await tripOf(ctx)).bookings.find((x) => x.leg_key === 'return').fare;
  assert.deepEqual([low.referral_credit_fjd, low.amount_due_fjd], [6, 0]);
});

test('RETURN CANCELLED THEN RESTORED: the credit is released, NOT silently re-applied; staff re-apply gives exactly ONE live adjustment (history kept); a refunded purchase is never revived', async () => {
  const ctx = await programme(); const { creditId } = await earnCredit(ctx);
  const ret = legOf(await legs(ctx.env, ctx.r), 'return');
  await apply(ctx.env, creditId, ret.id);
  const original = { ...ctx.r };
  ctx.source.set({ ...original, return_date: null, return_time: null, return_pickup_location: null });
  await sync(ctx.env, ctx.r, ctx.source);
  await call(ctx.env, '/preview/admin/rewards/credits', { headers: staffH(ctx.env) });
  assert.equal((await one(ctx.env, 'SELECT status FROM marau_reward_credits WHERE credit_id = ?', creditId)).status, 'earned');
  ctx.source.set(original);
  await sync(ctx.env, ctx.r, ctx.source);
  await call(ctx.env, '/preview/admin/rewards/credits', { headers: staffH(ctx.env) });
  const restored = legOf(await legs(ctx.env, ctx.r), 'return');
  assert.deepEqual([restored.id, restored.status], [ret.id, 'confirmed'], 'the SAME leg returns');
  assert.equal((await one(ctx.env, 'SELECT status FROM marau_reward_credits WHERE credit_id = ?', creditId)).status, 'earned', 'restoring the leg does not silently re-apply the credit');
  assert.equal((await all(ctx.env, `SELECT * FROM marau_booking_adjustments WHERE status IN ('applied','reversal_pending_staff')`)).length, 0);
  assert.equal((await tripOf(ctx)).bookings.find((x) => x.leg_key === 'arrival').fare.amount_due_fjd, 170);
  assert.equal((await apply(ctx.env, creditId, ret.id)).status, 200);
  const rows = await all(ctx.env, 'SELECT status FROM marau_booking_adjustments ORDER BY created_at');
  assert.deepEqual(rows.map((x) => x.status).sort(), ['applied', 'released_booking_cancelled']);
  // and: cancel again, refund the purchase while the leg is gone, restore - nothing invalid comes back
  ctx.source.set({ ...original, return_date: null, return_time: null, return_pickup_location: null });
  await sync(ctx.env, ctx.r, ctx.source);
  await call(ctx.env, '/preview/admin/rewards/credits', { headers: staffH(ctx.env) });
  const cur = await one(ctx.env, `SELECT qualifying_request_id AS rid FROM marau_reward_credits WHERE credit_id = ?`, creditId);
  await call(ctx.env, `/preview/admin/offers/requests/${cur.rid}/payment`, { method: 'POST', headers: staffH(ctx.env), body: { event: 'refunded', amount_fjd: 120, method: 'cash', event_key: 'rf' } });
  ctx.source.set(original);
  await sync(ctx.env, ctx.r, ctx.source);
  await call(ctx.env, '/preview/admin/rewards/credits', { headers: staffH(ctx.env) });
  assert.equal((await one(ctx.env, 'SELECT status FROM marau_reward_credits WHERE credit_id = ?', creditId)).status, 'reversed', 'a refunded purchase stays reversed');
  assert.equal((await apply(ctx.env, creditId, ret.id)).status, 409);
  assert.equal((await all(ctx.env, `SELECT * FROM marau_booking_adjustments WHERE status IN ('applied','reversal_pending_staff')`)).length, 0);
});
