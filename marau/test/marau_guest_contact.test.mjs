/* Marau (PREVIEW/TEST ONLY) - human sales and contact: both phone and email validated server-side, WhatsApp availability
 * recorded separately, email fallback with a NAMED staff owner, essential vs promotional consent, and staff-visible status.
 * Synthetic guests only; nothing is sent. Evidence label: LOCAL, AUTHOR-RUN.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest } from './fixtures.mjs';
import worker from '../worker/worker.js';
import { validatePhone, validateEmail, followUpChannel, followUpPlan, maySend, MESSAGE_PURPOSES } from '../worker/contact_policy.js';

installNetworkGuard();

const call = async (env, path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await worker.fetch(new Request('http://marau.test' + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text };
};
const admin = (env) => ({ authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}` });
const staffH = (env, tok = 'staff-tok-ana') => ({ ...admin(env), 'x-marau-staff-token': tok });
const guestH = (t) => ({ authorization: `Bearer ${t}` });
const db = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;

async function setup() {
  const env = makeEnv();
  for (const [tok, name] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: tok, operator_name: name } });
  return env;
}
async function guest(env, over = {}) {
  const res = await call(env, '/preview/bookings', { method: 'POST', body: synthGuest(over) });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const s = await db(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', res.data.access_token);
  return { token: res.data.access_token, sessionId: s.session_id };
}

// ---------------------------------------------------------------- pure validation

test('validatePhone: plausible international/national numbers pass; junk, placeholders, and oversized numbers do not', () => {
  for (const ok of ['+679 936 9435', '+61 478 886 145', '(02) 9999 8888', '+15005550100', '936-9435']) assert.ok(validatePhone(ok), ok);
  assert.equal(validatePhone('+679 936 9435'), '+6799369435', 'normalised form');
  for (const bad of ['', 'abc', '12345', '+++6799369435', '67+9369435', '0000000', '1111111111', '+1234567890123456', '123 456 7x', null, undefined, 6799369435]) assert.equal(validatePhone(bad), null, String(bad));
});

test('validateEmail: plausible addresses pass and are lower-cased; malformed ones do not', () => {
  assert.equal(validateEmail('  Guest.One@Example.TEST '), 'guest.one@example.test');
  for (const bad of ['', 'a@b', 'no-at.example.test', 'two@@example.test', 'a b@example.test', 'a..b@example.test', '.a@example.test', 'a.@example.test', 'a@-bad.test', 'a@bad-.test', 'a@exa mple.test', 'a@example.t', `${'x'.repeat(65)}@example.test`, null, 42]) assert.equal(validateEmail(bad), null, String(bad));
});

// ---------------------------------------------------------------- server-side enforcement

test('BOTH phone and email are required and validated by the SERVER at booking - a direct API call cannot skip either', async () => {
  const env = await setup();
  const post = (over) => call(env, '/preview/bookings', { method: 'POST', body: { ...synthGuest(), ...over } });
  const noEmail = await post({ guest_email: undefined });
  assert.equal(noEmail.status, 400);
  assert.ok(noEmail.data.details.some((d) => /guest_email/.test(d)));
  const noPhone = await post({ guest_phone: undefined });
  assert.equal(noPhone.status, 400);
  assert.ok(noPhone.data.details.some((d) => /guest_phone/.test(d)));
  assert.equal((await post({ guest_email: 'not-an-email' })).status, 400);
  assert.equal((await post({ guest_phone: '0000000000' })).status, 400);
  assert.equal((await post({ guest_phone: '12345' })).status, 400);
  assert.equal((await post({ marketing_consent: 'yes please' })).status, 400);
  assert.equal((await all(env, 'SELECT * FROM marau_test_bookings')).length, 0, 'a rejected request writes nothing');
  assert.equal((await post({})).status, 201);
});

// ---------------------------------------------------------------- WhatsApp availability + email fallback + owner

test('WhatsApp availability is recorded separately and never blocks a booking; no WhatsApp -> email fallback; unknown -> try WhatsApp then email', async () => {
  const env = await setup();
  const yes = await guest(env, { whatsapp_available: true });
  const no = await guest(env, { whatsapp_available: false });
  const unknown = await guest(env, { whatsapp_available: undefined });
  const byId = Object.fromEntries((await call(env, '/preview/admin/guests', { headers: staffH(env) })).data.guests.map((g) => [g.session_id, g]));
  assert.equal(byId[yes.sessionId].follow_up.channel, 'whatsapp');
  assert.equal(byId[no.sessionId].follow_up.channel, 'email');
  assert.equal(byId[no.sessionId].follow_up.fallback, 'phone');
  assert.match(byId[no.sessionId].follow_up.reason, /no WhatsApp/);
  assert.equal(byId[unknown.sessionId].follow_up.channel, 'whatsapp');
  assert.match(byId[unknown.sessionId].follow_up.reason, /unknown/);
  assert.equal(byId[no.sessionId].contact.whatsapp_available, false);
  assert.equal(byId[unknown.sessionId].contact.whatsapp_available, null);

  // The guest can correct it later; staff can record what they learn (e.g. after an undelivered message).
  const updated = await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(unknown.token), body: { whatsapp_available: false } });
  assert.equal(updated.data.whatsapp_available, false);
  assert.equal((await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(unknown.token), body: { whatsapp_available: 'maybe' } })).status, 400);
  const rec = await call(env, `/preview/admin/guests/${yes.sessionId}/whatsapp`, { method: 'POST', headers: staffH(env), body: { whatsapp_available: false } });
  assert.equal(rec.data.recorded_by, 'Ana (ops)');
  assert.equal((await call(env, `/preview/admin/guests/${yes.sessionId}/whatsapp`, { method: 'POST', headers: admin(env), body: { whatsapp_available: false } })).status, 401);
});

test('a guest with no WhatsApp and no named owner is surfaced; assigning a NAMED staff member clears it; a stranger name is refused', async () => {
  const env = await setup();
  const g = await guest(env, { whatsapp_available: false });
  const flagged = (await call(env, '/preview/admin/guests?attention=1', { headers: staffH(env) })).data.guests;
  assert.ok(flagged.find((x) => x.session_id === g.sessionId).attention.includes('no_whatsapp_and_no_named_owner'));
  assert.equal(flagged.find((x) => x.session_id === g.sessionId).follow_up.owner_missing, true);

  const bad = await call(env, `/preview/admin/guests/${g.sessionId}/follow-up-owner`, { method: 'POST', headers: staffH(env), body: { owner: 'Nobody Real' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, 'OWNER_MUST_BE_A_NAMED_STAFF_MEMBER');
  assert.equal((await call(env, `/preview/admin/guests/${g.sessionId}/follow-up-owner`, { method: 'POST', headers: admin(env), body: { owner: 'Ana (ops)' } })).status, 401);
  assert.equal((await call(env, '/preview/admin/guests/gs_missing/follow-up-owner', { method: 'POST', headers: staffH(env), body: { owner: 'Ana (ops)' } })).status, 404);

  const ok = await call(env, `/preview/admin/guests/${g.sessionId}/follow-up-owner`, { method: 'POST', headers: staffH(env, 'staff-tok-bala'), body: { owner: 'Ana (ops)' } });
  assert.equal(ok.data.assigned_by, 'Bala (ops)');
  const after = (await call(env, '/preview/admin/guests', { headers: staffH(env) })).data.guests.find((x) => x.session_id === g.sessionId);
  assert.equal(after.follow_up.owner, 'Ana (ops)');
  assert.equal(after.follow_up.owner_missing, false);
  assert.equal(after.attention.includes('no_whatsapp_and_no_named_owner'), false);
  assert.equal((await call(env, '/preview/trip/contact', { headers: guestH(g.token) })).data.contact_person, 'Ana (ops)');
});

// ---------------------------------------------------------------- consent

test('essential vs promotional: essential is always allowed; promotional needs explicit consent, never assumed, withdrawable, and evidenced', async () => {
  const env = await setup();
  const none = await guest(env);                                  // consent omitted -> unknown
  const yes = await guest(env, { marketing_consent: 'granted' }); // opted in on the booking form
  const no = await guest(env, { marketing_consent: 'withheld' });
  const check = (g, purpose) => call(env, '/preview/admin/messages/check', { method: 'POST', headers: staffH(env), body: { session_id: g.sessionId, purpose } });

  for (const g of [none, yes, no]) {
    for (const purpose of MESSAGE_PURPOSES.essential) assert.equal((await check(g, purpose)).data.allowed, true, `${purpose} must always be allowed`);
  }
  const promo = MESSAGE_PURPOSES.promotional[0];
  assert.equal((await check(none, promo)).data.allowed, false, 'unknown consent does not permit promotion');
  assert.match((await check(none, promo)).data.reason, /unknown/);
  assert.equal((await check(no, promo)).data.allowed, false);
  assert.equal((await check(yes, promo)).data.allowed, true);
  assert.equal((await check(yes, 'something_unrecognised')).data.allowed, false, 'an unrecognised purpose is never assumed allowed');
  assert.equal((await check(yes, promo)).data.nothing_was_sent, true);

  // Withdrawal is always possible, takes effect immediately, and is logged.
  const withdraw = await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(yes.token), body: { marketing_consent: 'withheld' } });
  assert.equal(withdraw.data.marketing_consent, 'withheld');
  assert.equal((await check(yes, promo)).data.allowed, false);
  assert.equal((await check(yes, 'booking_confirmation')).data.allowed, true, 'withdrawing marketing never stops trip communication');
  assert.deepEqual((await all(env, 'SELECT from_value, to_value, source FROM marau_consent_events WHERE guest_session_id = ? ORDER BY id', yes.sessionId)).map((e) => `${e.from_value}>${e.to_value}@${e.source}`), ['unknown>granted@booking_form', 'granted>withheld@guest_settings']);

  // A guest can never be put back to "unknown" by a request, and a repeat is not a new event.
  assert.equal((await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(yes.token), body: { marketing_consent: 'unknown' } })).status, 400);
  await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(yes.token), body: { marketing_consent: 'withheld' } });
  assert.equal((await all(env, 'SELECT * FROM marau_consent_events WHERE guest_session_id = ?', yes.sessionId)).length, 2);
  assert.equal((await call(env, '/preview/trip/contact')).status, 401);
  assert.match((await call(env, '/preview/trip/contact', { headers: guestH(none.token) })).data.essential_messages, /always sent/);
});

test('a promotional deal edition reaches only consenting guests - and every guest can still browse every offer', async () => {
  const env = await setup();
  const consenting = await guest(env, { marketing_consent: 'granted', whatsapp_available: false });
  await guest(env); await guest(env, { marketing_consent: 'withheld' });

  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Tours', fulfilment_owner: 'Ana (ops)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
  const inDays = (d, h = 0) => new Date(Date.now() + d * 86400_000 + h * 3600_000).toISOString();
  const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title: 'Synthetic sunset sail', location: 'Denarau', inclusions: 'drinks', starts_at: inDays(5), book_by: inDays(4), expires_at: inDays(4, 12), capacity: 5, price_per_place_fjd: 80 } });
  await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });
  const today = new Date(Date.now() + 12 * 3600_000).toISOString().slice(0, 10);
  await call(env, '/preview/admin/editions', { method: 'POST', headers: staffH(env), body: { fiji_date: today, slot: 'morning', offer_ids: [offer.data.offer_id] } });

  const rec = (await call(env, `/preview/admin/editions/${today}:morning/recipients`, { headers: staffH(env) })).data;
  assert.deepEqual(rec.promotional_eligible, [{ session_id: consenting.sessionId, channel: 'email' }], 'only the opted-in guest, over their fallback channel');
  assert.equal(rec.excluded_without_consent, 2);
  assert.equal(rec.nothing_was_sent, true);
  assert.equal((await call(env, '/preview/admin/editions/2031-01-01:morning/recipients', { headers: staffH(env) })).status, 404);
  assert.equal((await call(env, `/preview/admin/editions/${today}:morning/recipients`, { headers: admin(env) })).status, 401);
  assert.equal((await call(env, '/preview/offers')).data.offers.length, 1, 'browse-anytime does not depend on consent');
});

// ---------------------------------------------------------------- staff-visible status, privacy

test('staff see booking, offer, referral and follow-up status in one place; none of it is reachable publicly or by another guest', async () => {
  const env = await setup();
  const g = await guest(env, { whatsapp_available: false });
  const friend = await guest(env);
  await db(env, 'SELECT 1');
  const listed = (await call(env, '/preview/admin/guests', { headers: staffH(env) })).data.guests.find((x) => x.session_id === g.sessionId);
  assert.ok(listed.contact.phone && listed.contact.email, 'both channels are held for staff');
  assert.equal(listed.trips.bookings, 1);
  assert.deepEqual(Object.keys(listed).sort(), ['attention', 'contact', 'follow_up', 'marketing_consent', 'offers', 'referral', 'session_id', 'trips']);
  assert.equal((await call(env, '/preview/admin/guests')).status, 401);
  assert.equal((await call(env, '/preview/admin/guests', { headers: admin(env) })).status, 401);
  assert.equal((await call(env, '/preview/admin/guests', { headers: guestH(friend.token) })).status, 401, 'a guest token is not staff access');
  const publicText = (await call(env, '/preview/offers')).text + (await call(env, '/preview/health')).text;
  assert.equal(publicText.includes(listed.contact.phone) || publicText.includes(listed.contact.email), false);
});

test('contact policy helpers: channel, plan, and the consent gate in isolation', () => {
  assert.equal(followUpChannel(false), 'email');
  assert.equal(followUpChannel(0), 'email');
  assert.equal(followUpChannel(true), 'whatsapp');
  assert.equal(followUpChannel(null), 'whatsapp');
  assert.deepEqual(followUpPlan({ whatsappAvailable: false, owner: null }).owner_missing, true);
  assert.equal(followUpPlan({ whatsappAvailable: true, owner: 'Ana (ops)' }).owner_missing, false);
  assert.equal(maySend({ purpose: 'safety', marketingConsent: 'withheld' }), true);
  assert.equal(maySend({ purpose: 'win_back', marketingConsent: 'unknown' }), false);
  assert.equal(maySend({ purpose: 'win_back', marketingConsent: 'granted' }), true);
  assert.equal(maySend({ purpose: 'made_up', marketingConsent: 'granted' }), false);
});
