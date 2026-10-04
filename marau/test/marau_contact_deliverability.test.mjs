/* Marau (PREVIEW/TEST ONLY) - staff ownership of follow-up, the explicit unassigned queue, the no-WhatsApp email path, and the
 * difference between COLLECTING valid contact details and PROVING deliverability. Nothing here sends anything.
 * Synthetic guests only; default-deny network. Evidence label: LOCAL, AUTHOR-RUN.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest } from './fixtures.mjs';
import worker from '../worker/worker.js';
import { sendDecision } from '../worker/contact_policy.js';

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

async function setup() {
  const env = makeEnv();
  for (const [tok, name] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: tok, operator_name: name } });
  await call(env, '/preview/admin/rewards/policy', { method: 'POST', headers: staffH(env), body: { mode: 'preview', amount_fjd: 10, cap_per_referrer_fjd: 20, min_purchase_fjd: 0, qualify_on: 'fulfilled', require_payment: 'paid_in_full' } });
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Reef Tours', fulfilment_owner: 'Ana (ops)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
  const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title: 'Synthetic snorkel', location: 'Reef (synthetic)', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 20, price_per_place_fjd: 120, cost_per_place_fjd: 80 } });
  await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });
  return { env, offerId: offer.data.offer_id };
}
async function newGuest(env, over = {}) {
  const res = await call(env, '/preview/bookings', { method: 'POST', body: synthGuest({ leg_type: 'arrival', ...over }) });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const s = await one(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', res.data.access_token);
  return { token: res.data.access_token, sessionId: s.session_id };
}
const assign = (env, sid, owner, tok = 'staff-tok-ana') => call(env, `/preview/admin/guests/${sid}/follow-up-owner`, { method: 'POST', headers: staffH(env, tok), body: { owner } });

/** A referrer WITHOUT WhatsApp whose friend's paid, fulfilled purchase earned them a credit. */
async function creditHolderWithoutWhatsapp() {
  const ctx = await setup();
  const { env, offerId } = ctx;
  const holder = await newGuest(env, { whatsapp_available: false });
  const code = (await call(env, '/preview/referral', { headers: guestH(holder.token) })).data.code;
  const res = await call(env, '/preview/bookings', { method: 'POST', body: { ...synthGuest({ leg_type: 'arrival' }), referral_code: code } });
  const friendTok = res.data.access_token;
  const rid = (await call(env, `/preview/offers/${offerId}/request`, { method: 'POST', headers: guestH(friendTok), body: { places: 1 } })).data.request.request_id;
  await call(env, `/preview/admin/offers/requests/${rid}/confirm`, { method: 'POST', headers: staffH(env), body: {} });
  await call(env, `/preview/admin/offers/requests/${rid}/payment`, { method: 'POST', headers: staffH(env), body: { event: 'paid', amount_fjd: 120, method: 'cash', event_key: 'p1' } });
  await call(env, `/preview/admin/offers/requests/${rid}/fulfil`, { method: 'POST', headers: staffH(env), body: {} });
  return { ...ctx, holder, rid };
}

test('the referral staff view shows the PERSISTED follow-up owner (it used to pass owner: null and always read unassigned)', async () => {
  const { env, holder } = await creditHolderWithoutWhatsapp();
  const before = (await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) })).data.credits[0];
  assert.equal(before.holder.follow_up.owner, null);
  assert.equal(before.holder.follow_up.owner_missing, true);
  assert.equal((await assign(env, holder.sessionId, 'Bala (ops)')).status, 200);
  const after = (await call(env, '/preview/admin/rewards/credits', { headers: staffH(env) })).data.credits[0];
  assert.equal(after.holder.follow_up.owner, 'Bala (ops)');
  assert.equal(after.holder.follow_up.owner_missing, false);
  assert.equal(after.holder.follow_up.channel, 'email', 'no WhatsApp -> email');
});

test('the follow-up queue has an EXPLICIT unassigned section, and items move to their owner once assigned', async () => {
  const { env, holder } = await creditHolderWithoutWhatsapp();
  const q1 = await call(env, '/preview/admin/follow-ups', { headers: staffH(env) });
  assert.equal(q1.status, 200, JSON.stringify(q1.data));
  const credit = q1.data.unassigned.find((i) => i.kind === 'earned_credit_ready_to_apply');
  assert.ok(credit, 'the earned credit appears in the unassigned queue');
  assert.equal(credit.channel, 'email');
  assert.equal(credit.session_id, holder.sessionId);
  assert.deepEqual(q1.data.by_owner, {});
  await assign(env, holder.sessionId, 'Bala (ops)');
  const q2 = (await call(env, '/preview/admin/follow-ups', { headers: staffH(env) })).data;
  assert.equal(q2.unassigned.filter((i) => i.session_id === holder.sessionId).length, 0, 'assigned items leave the unassigned queue');
  assert.ok(q2.by_owner['Bala (ops)'].some((i) => i.kind === 'earned_credit_ready_to_apply'));
  assert.equal((await call(env, '/preview/admin/follow-ups', { headers: admin(env) })).status, 401, 'staff identity required');
  assert.equal((await call(env, '/preview/admin/follow-ups', { headers: guestH(holder.token) })).status, 401);
});

test('NO-WHATSAPP email path: the guest can book, request and earn; staff are told to use email, with phone as the fallback', async () => {
  const { env, holder, rid } = await creditHolderWithoutWhatsapp();
  const queue = (await call(env, '/preview/admin/follow-ups', { headers: staffH(env) })).data;
  const item = queue.unassigned.find((i) => i.session_id === holder.sessionId);
  assert.equal(item.channel, 'email');
  assert.equal(item.fallback, 'phone');
  const decision = await call(env, '/preview/admin/messages/check', { method: 'POST', headers: staffH(env), body: { session_id: holder.sessionId, purpose: 'booking_confirmation' } });
  assert.equal(decision.data.channel, 'email');
  assert.equal(decision.data.allowed, true);
  const onWa = await call(env, '/preview/admin/messages/check', { method: 'POST', headers: staffH(env), body: { session_id: holder.sessionId, purpose: 'booking_confirmation', channel: 'whatsapp' } });
  assert.equal(onWa.data.allowed, false);
  assert.ok(onWa.data.reasons.includes('whatsapp_unavailable'));
  assert.equal(onWa.data.suggested_channel, 'email');
  assert.ok(rid);
});

test('valid contact details COLLECTED is not DELIVERABILITY PROVEN: every contact is labelled unverified', async () => {
  const { env, holder } = await creditHolderWithoutWhatsapp();
  const g = (await call(env, '/preview/admin/guests', { headers: staffH(env) })).data.guests.find((x) => x.session_id === holder.sessionId);
  assert.equal(g.contact.details_valid.phone, true);
  assert.equal(g.contact.details_valid.email, true);
  assert.equal(g.contact.deliverability.status, 'unverified');
  assert.match(g.contact.deliverability.note, /not proof|not verified|unverified/i);
  const d = (await call(env, '/preview/admin/messages/check', { method: 'POST', headers: staffH(env), body: { session_id: holder.sessionId, purpose: 'booking_confirmation' } })).data;
  assert.equal(d.deliverability, 'unverified');
  assert.equal(d.nothing_was_sent, true);
});

test('"essential" is not universal delivery permission: relationship, channel capability and suppression are all checked', async () => {
  const { env } = await setup();
  const g = await newGuest(env);
  const check = (purpose, extra = {}) => call(env, '/preview/admin/messages/check', { method: 'POST', headers: staffH(env), body: { session_id: g.sessionId, purpose, ...extra } });
  assert.equal((await check('booking_confirmation')).data.allowed, true);

  // a recorded DELIVERY FAILURE on the channel blocks even essential messages there
  const sup = await call(env, `/preview/admin/guests/${g.sessionId}/suppressions`, { method: 'POST', headers: staffH(env, 'staff-tok-bala'), body: { channel: 'whatsapp', kind: 'delivery_failure', reason: 'number not on WhatsApp (synthetic)' } });
  assert.equal(sup.status, 201, JSON.stringify(sup.data));
  const blocked = (await check('booking_confirmation', { channel: 'whatsapp' })).data;
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.reasons.includes('channel_suppressed'));
  assert.equal(blocked.suggested_channel, 'email');
  assert.equal((await check('booking_confirmation', { channel: 'email' })).data.allowed, true, 'the other channel is unaffected');

  // a MARKETING OPT-OUT blocks promotional only
  await call(env, `/preview/admin/guests/${g.sessionId}/suppressions`, { method: 'POST', headers: staffH(env), body: { channel: 'email', kind: 'marketing_opt_out' } });
  assert.equal((await check('booking_confirmation', { channel: 'email' })).data.allowed, true, 'an opt-out of marketing never stops essential trip messages');
  await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(g.token), body: { marketing_consent: 'granted' } });
  const promo = (await check('deal_edition', { channel: 'email' })).data;
  assert.equal(promo.allowed, false, 'consent granted, but the guest also opted out of marketing on email');
  assert.ok(promo.reasons.includes('channel_suppressed'));

  // lifting a suppression restores it, attributed
  const row = await one(env, `SELECT id FROM marau_suppressions WHERE channel = 'whatsapp' AND kind = 'delivery_failure'`);
  assert.equal((await call(env, `/preview/admin/suppressions/${row.id}/lift`, { method: 'POST', headers: staffH(env, 'staff-tok-bala'), body: {} })).status, 200);
  assert.equal((await check('booking_confirmation', { channel: 'whatsapp' })).data.allowed, true);
  assert.equal((await one(env, 'SELECT lifted_by FROM marau_suppressions WHERE id = ?', row.id)).lifted_by, 'Bala (ops)');
  assert.equal((await call(env, `/preview/admin/guests/${g.sessionId}/suppressions`, { method: 'POST', headers: admin(env), body: { channel: 'email', kind: 'delivery_failure' } })).status, 401, 'staff identity required');
});

test('promotional consent stays separate: unknown/withheld never allow promotion; granted allows it only on a usable, unsuppressed channel', async () => {
  const { env } = await setup();
  const g = await newGuest(env);
  const promo = () => call(env, '/preview/admin/messages/check', { method: 'POST', headers: staffH(env), body: { session_id: g.sessionId, purpose: 'deal_edition' } });
  const r0 = (await promo()).data;
  assert.equal(r0.allowed, false); assert.ok(r0.reasons.includes('no_marketing_consent'));
  await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(g.token), body: { marketing_consent: 'withheld' } });
  assert.equal((await promo()).data.allowed, false);
  await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(g.token), body: { marketing_consent: 'granted' } });
  assert.equal((await promo()).data.allowed, true);
  // The same guest still receives essential messages when consent is later withheld.
  await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(g.token), body: { marketing_consent: 'withheld' } });
  assert.equal((await call(env, '/preview/admin/messages/check', { method: 'POST', headers: staffH(env), body: { session_id: g.sessionId, purpose: 'schedule_change' } })).data.allowed, true);
});

test('edition recipients honour suppression as well as consent, and say why people are excluded; nothing is sent', async () => {
  const { env, offerId } = await setup();
  const a = await newGuest(env); const b = await newGuest(env);
  for (const g of [a, b]) await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(g.token), body: { marketing_consent: 'granted' } });
  await call(env, `/preview/admin/guests/${b.sessionId}/suppressions`, { method: 'POST', headers: staffH(env), body: { channel: 'whatsapp', kind: 'marketing_opt_out' } });
  await call(env, `/preview/admin/guests/${b.sessionId}/suppressions`, { method: 'POST', headers: staffH(env), body: { channel: 'email', kind: 'marketing_opt_out' } });
  const ed = await call(env, '/preview/admin/editions', { method: 'POST', headers: staffH(env), body: { fiji_date: '2031-03-03', slot: 'morning', offer_ids: [offerId] } });
  assert.equal(ed.status, 201, JSON.stringify(ed.data));
  const r = (await call(env, `/preview/admin/editions/${encodeURIComponent('2031-03-03:morning')}/recipients`, { headers: staffH(env) })).data;
  assert.deepEqual(r.promotional_eligible.map((x) => x.session_id), [a.sessionId]);
  assert.equal(r.excluded_by_reason.channel_suppressed, 1);
  assert.equal(r.nothing_was_sent, true);
  assert.match(r.level, /grouping/i, 'states what "edition" means today');
});

test('sendDecision (pure): relationship, capability, suppression and consent are each enforced; an unknown purpose is never allowed', () => {
  const base = { purpose: 'booking_confirmation', marketingConsent: 'unknown', whatsappAvailable: true, phone: '+15005550123', email: 'a@example.test', hasBookingRelationship: true, suppressions: [] };
  assert.equal(sendDecision(base).allowed, true);
  assert.deepEqual(sendDecision({ ...base, hasBookingRelationship: false }).reasons, ['no_booking_relationship']);
  assert.ok(sendDecision({ ...base, purpose: 'made_up' }).reasons.includes('unrecognised_purpose'));
  assert.ok(sendDecision({ ...base, channel: 'email', email: 'not-an-email' }).reasons.includes('no_valid_email'));
  assert.ok(sendDecision({ ...base, channel: 'whatsapp', phone: '12' }).reasons.includes('no_valid_phone'));
  assert.ok(sendDecision({ ...base, channel: 'whatsapp', whatsappAvailable: false }).reasons.includes('whatsapp_unavailable'));
  assert.ok(sendDecision({ ...base, suppressions: [{ channel: 'whatsapp', kind: 'delivery_failure' }] }).reasons.includes('channel_suppressed'));
  assert.equal(sendDecision({ ...base, suppressions: [{ channel: 'whatsapp', kind: 'marketing_opt_out' }] }).allowed, true);
  assert.equal(sendDecision({ ...base, purpose: 'deal_edition', marketingConsent: 'granted' }).allowed, true);
  assert.ok(sendDecision({ ...base, purpose: 'deal_edition' }).reasons.includes('no_marketing_consent'));
  assert.equal(sendDecision({ ...base, deliverability: undefined }).deliverability, 'unverified');
});
