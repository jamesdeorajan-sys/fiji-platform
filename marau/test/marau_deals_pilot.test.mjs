/* Marau (PREVIEW/TEST ONLY) - the smallest HUMAN-LED deals pilot: staff review a published morning/afternoon edition, check offer
 * availability, select consent-eligible recipients, and RECORD manual send/outcome status. Nothing is sent, scheduled or delivered by
 * this code; every response says so. Synthetic data; default-deny network (any outbound call fails the file). Red-first against RC1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest } from './fixtures.mjs';
import worker from '../worker/worker.js';

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
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results.map((r) => ({ ...r }));
const EDITION = '2031-03-03:morning';

async function setup() {
  const env = makeEnv();
  for (const [t, n] of [['staff-tok-ana', 'Ana (ops)'], ['staff-tok-bala', 'Bala (ops)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: t, operator_name: n } });
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: staffH(env), body: { name: 'Synthetic Reef Tours', fulfilment_owner: 'Ana (ops)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: staffH(env) });
  const mkOffer = async (title, over = {}) => {
    const o = await call(env, '/preview/admin/offers', { method: 'POST', headers: staffH(env), body: { supplier_id: sup.data.supplier_id, title, location: 'Reef (synthetic)', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 2, price_per_place_fjd: 100, ...over } });
    await call(env, `/preview/admin/offers/${o.data.offer_id}/publish`, { method: 'POST', headers: staffH(env) });
    return o.data.offer_id;
  };
  const a = await mkOffer('Synthetic snorkel'); const b = await mkOffer('Synthetic sunset');
  const ed = await call(env, '/preview/admin/editions', { method: 'POST', headers: staffH(env), body: { fiji_date: '2031-03-03', slot: 'morning', offer_ids: [a, b] } });
  assert.equal(ed.status, 201, JSON.stringify(ed.data));
  await call(env, `/preview/admin/editions/${encodeURIComponent(EDITION)}/publish`, { method: 'POST', headers: staffH(env) });
  return { env, a, b };
}
async function guest(env, { consent = 'granted', whatsapp = true } = {}) {
  const res = await call(env, '/preview/bookings', { method: 'POST', body: synthGuest({ whatsapp_available: whatsapp, leg_type: 'arrival' }) });
  const s = await one(env, 'SELECT session_id FROM guest_sessions WHERE access_token = ?', res.data.access_token);
  if (consent !== 'unknown') await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(res.data.access_token), body: { marketing_consent: consent } });
  return { token: res.data.access_token, sid: s.session_id };
}
const review = (env, body = { decision: 'approved_for_manual_send', note: 'checked' }, t) => call(env, `/preview/admin/editions/${encodeURIComponent(EDITION)}/review`, { method: 'POST', headers: staffH(env, t), body });
const view = (env) => call(env, `/preview/admin/editions/${encodeURIComponent(EDITION)}/review`, { headers: staffH(env) });
const prepare = (env) => call(env, `/preview/admin/editions/${encodeURIComponent(EDITION)}/sends/prepare`, { method: 'POST', headers: staffH(env), body: {} });
const outcome = (env, sid, status, note = 'recorded by hand', t) => call(env, `/preview/admin/editions/${encodeURIComponent(EDITION)}/sends/${sid}/outcome`, { method: 'POST', headers: staffH(env, t), body: { status, note } });

test('REVIEW: staff see each offer\'s live availability and the consent-eligible recipients (with the reasons others are excluded); nothing is sent', async () => {
  const { env, a, b } = await setup();
  const ok = await guest(env); const noConsent = await guest(env, { consent: 'unknown' }); const noWa = await guest(env, { whatsapp: false });
  await call(env, `/preview/admin/guests/${noWa.sid}/suppressions`, { method: 'POST', headers: staffH(env), body: { channel: 'email', kind: 'delivery_failure' } });
  await call(env, `/preview/admin/guests/${noWa.sid}/suppressions`, { method: 'POST', headers: staffH(env), body: { channel: 'whatsapp', kind: 'marketing_opt_out' } });
  const r = await view(env);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.nothing_was_sent, true);
  assert.match(r.data.level, /manual|human/i);
  assert.deepEqual(r.data.offers.map((o) => [o.offer_id, o.state, o.places_left]).sort(), [[a, 'open', 2], [b, 'open', 2]].sort());
  assert.deepEqual(r.data.recipients.map((x) => x.session_id), [ok.sid]);
  assert.equal(r.data.recipients[0].channel, 'whatsapp');
  assert.ok(r.data.recipients[0].contact.phone && r.data.recipients[0].contact.email, 'staff get the contact details they need to send by hand');
  assert.equal(r.data.excluded_by_reason.no_marketing_consent, 1);
  assert.equal(r.data.excluded_by_reason.channel_suppressed, 1);
  assert.equal(r.data.review, null);
  void noConsent;
  assert.equal((await call(env, `/preview/admin/editions/${encodeURIComponent(EDITION)}/review`, { headers: admin(env) })).status, 401, 'staff identity required');
});

test('AVAILABILITY is live: sold-out, withdrawn and expired offers are reported as such, and an edition with NO open offer cannot be approved or prepared', async () => {
  const { env, a, b } = await setup();
  await guest(env);
  // sell out offer a (capacity 2) with a confirmed request
  const g = await guest(env, { consent: 'unknown' });
  const req = await call(env, `/preview/offers/${a}/request`, { method: 'POST', headers: guestH(g.token), body: { places: 2 } });
  await call(env, `/preview/admin/offers/requests/${req.data.request.request_id}/confirm`, { method: 'POST', headers: staffH(env), body: {} });
  await call(env, `/preview/admin/offers/${b}/withdraw`, { method: 'POST', headers: staffH(env), body: { reason: 'supplier cancelled' } });
  const v = (await view(env)).data;
  assert.deepEqual(Object.fromEntries(v.offers.map((o) => [o.offer_id, o.state])), { [a]: 'sold_out', [b]: 'withdrawn' });
  assert.deepEqual(v.sendable_offers, []);
  const rv = await review(env);
  assert.equal(rv.status, 409); assert.equal(rv.data.error, 'EDITION_HAS_NO_OPEN_OFFERS');
  assert.equal((await prepare(env)).status, 409);
});

test('WORKFLOW: review -> prepare -> record manual send -> record outcome; every step is attributed to the named staff member and idempotent; repeats change nothing', async () => {
  const { env } = await setup();
  const g1 = await guest(env); const g2 = await guest(env);
  assert.equal((await prepare(env)).data.error, 'EDITION_NOT_REVIEWED', 'prepare needs an approved review first');
  const rv = await review(env, { decision: 'approved_for_manual_send', note: 'offers checked at 08:55' }, 'staff-tok-bala');
  assert.equal(rv.status, 200, JSON.stringify(rv.data));
  assert.deepEqual([rv.data.review.decision, rv.data.review.reviewed_by], ['approved_for_manual_send', 'Bala (ops)']);
  assert.equal(rv.data.review.availability.length, 2, 'the availability seen at review time is kept');
  const p = await prepare(env);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.deepEqual([p.data.prepared, p.data.already_prepared], [2, 0]);
  assert.equal((await prepare(env)).data.already_prepared, 2, 'preparing twice never duplicates');
  assert.equal(p.data.nothing_was_sent, true);

  const sent = await outcome(env, g1.sid, 'sent_manually', 'sent from the ops phone', 'staff-tok-ana');
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.send.status, 'sent_manually'); assert.equal(sent.data.send.updated_by, 'Ana (ops)');
  const again = await outcome(env, g1.sid, 'sent_manually', 'dup', 'staff-tok-bala');
  assert.equal(again.data.repeated, true); assert.equal(again.data.send.updated_by, 'Ana (ops)', 'the original operator stands');
  assert.equal((await outcome(env, g1.sid, 'replied', 'asked about the sunset')).data.send.status, 'replied');
  assert.equal((await outcome(env, g1.sid, 'sent_manually')).status, 409, 'no going backwards from replied');
  assert.equal((await outcome(env, g2.sid, 'replied')).status, 409, 'cannot reply before it was sent');
  assert.equal((await outcome(env, g2.sid, 'not_sent', 'phone was off')).data.send.status, 'not_sent');
  const list = (await call(env, `/preview/admin/editions/${encodeURIComponent(EDITION)}/sends`, { headers: staffH(env) })).data;
  assert.deepEqual(list.summary, { prepared: 0, sent_manually: 0, not_sent: 1, replied: 1, bounced: 0, opted_out: 0 });
  assert.equal(list.nothing_was_sent, true);
  const events = await all(env, 'SELECT to_status, actor FROM marau_edition_send_events ORDER BY id');
  assert.equal(events.length, 3, 'one event per real transition; repeats and refused moves log nothing'); assert.ok(events.every((e) => e.actor));
});

test('A SEND IS RE-CHECKED AT THE MOMENT IT IS RECORDED: withdrawn consent, a new suppression, or no open offer blocks it, and the row stays prepared', async () => {
  const { env, a, b } = await setup();
  const g1 = await guest(env); const g2 = await guest(env); const g3 = await guest(env);
  await review(env); await prepare(env);
  await call(env, '/preview/trip/contact', { method: 'POST', headers: guestH(g1.token), body: { marketing_consent: 'withheld' } });
  const blocked = await outcome(env, g1.sid, 'sent_manually');
  assert.equal(blocked.status, 409); assert.equal(blocked.data.error, 'RECIPIENT_NO_LONGER_ELIGIBLE'); assert.ok(blocked.data.reasons.includes('no_marketing_consent'));
  await call(env, `/preview/admin/guests/${g2.sid}/suppressions`, { method: 'POST', headers: staffH(env), body: { channel: 'whatsapp', kind: 'marketing_opt_out' } });
  await call(env, `/preview/admin/guests/${g2.sid}/suppressions`, { method: 'POST', headers: staffH(env), body: { channel: 'email', kind: 'marketing_opt_out' } });
  assert.equal((await outcome(env, g2.sid, 'sent_manually')).data.error, 'RECIPIENT_NO_LONGER_ELIGIBLE');
  assert.equal((await one(env, 'SELECT status FROM marau_edition_sends WHERE guest_session_id = ?', g1.sid)).status, 'prepared');
  for (const o of [a, b]) await call(env, `/preview/admin/offers/${o}/withdraw`, { method: 'POST', headers: staffH(env), body: { reason: 'gone' } });
  const none = await outcome(env, g3.sid, 'sent_manually');
  assert.equal(none.status, 409); assert.equal(none.data.error, 'EDITION_HAS_NO_OPEN_OFFERS');
  assert.equal((await outcome(env, g3.sid, 'not_sent', 'deal ended before I could send')).status, 200, 'recording that it was NOT sent is always allowed');
});

test('OUTCOMES FEED CONSENT AND SUPPRESSION: a bounce records a delivery failure on that channel; an opt-out reply withholds marketing consent - both attributed - so the guest drops out of later recipient lists', async () => {
  const { env } = await setup();
  const g1 = await guest(env); const g2 = await guest(env);
  await review(env); await prepare(env);
  await outcome(env, g1.sid, 'sent_manually'); await outcome(env, g2.sid, 'sent_manually');
  assert.equal((await outcome(env, g1.sid, 'bounced', 'number not on WhatsApp')).data.send.status, 'bounced');
  const sup = await all(env, `SELECT channel, kind, recorded_by FROM marau_suppressions WHERE guest_session_id = ?`, g1.sid);
  assert.deepEqual(sup, [{ channel: 'whatsapp', kind: 'delivery_failure', recorded_by: 'Ana (ops)' }]);
  assert.equal((await outcome(env, g2.sid, 'opted_out', 'replied STOP')).data.send.status, 'opted_out');
  assert.equal((await one(env, 'SELECT marketing_consent FROM guest_sessions WHERE session_id = ?', g2.sid)).marketing_consent, 'withheld');
  assert.equal((await one(env, 'SELECT source FROM marau_consent_events WHERE guest_session_id = ? ORDER BY id DESC', g2.sid)).source, 'edition_reply');
  const v = (await view(env)).data;
  const byId = Object.fromEntries(v.recipients.map((r) => [r.session_id, r.channel]));
  assert.equal(byId[g1.sid], 'email', 'a bounced WhatsApp falls back to the usable email address');
  assert.equal(g2.sid in byId, false, 'an opt-out is excluded from every channel');
});

test('NOTHING AUTOMATIC: the pilot makes no outbound call, schedules nothing, and is invisible to guests', async () => {
  const { env } = await setup();
  const g = await guest(env);
  await review(env); await prepare(env); await outcome(env, g.sid, 'sent_manually');
  // the network guard fails the file on any outbound call; assert the structural facts too
  assert.equal(typeof worker.scheduled, 'undefined');
  for (const path of [`/preview/admin/editions/${encodeURIComponent(EDITION)}/review`, `/preview/admin/editions/${encodeURIComponent(EDITION)}/sends`]) {
    assert.equal((await call(env, path, { headers: guestH(g.token) })).status, 401, 'a guest token cannot read the pilot');
    assert.equal((await call(env, path)).status, 401);
  }
  const trip = await call(env, '/preview/trip', { headers: guestH(g.token) });
  assert.equal(/edition_sends|prepared|sent_manually/.test(trip.text), false, 'the guest trip carries no pilot state');
});

test('TRIP PRIVACY: the guest trip never carries operator-side figures or source provenance of a mirrored booking', async () => {
  const env = makeEnv();
  const g = await guest(env);
  await env.DB.prepare(`UPDATE marau_test_bookings SET source_settlement_fjd_cents = 15000, source_commission_base_fjd_cents = 2000, source_kind = 'nadi_dispatch_api', source_origin = 'https://x.test', source_authenticated = 1, leg_value_rule_id = 'rule_x', leg_note = 'internal' WHERE guest_session_id = ?`).bind(g.sid).run();
  const trip = await call(env, '/preview/trip', { headers: guestH(g.token) });
  for (const secret of ['source_settlement_fjd_cents', 'source_commission_base_fjd_cents', 'source_kind', 'source_origin', 'source_authenticated', 'leg_value_rule_id', 'leg_note', '15000', 'nadi_dispatch_api']) assert.equal(trip.text.includes(secret), false, secret);
});
