// SYNTHETIC end-to-end JOURNEY through the real Worker (no email is ever sent: the capture sender records what WOULD be sent; the live sender does not exist):
// saved synthetic transfer -> captured guest + team receipts -> private trip (from the receipt's own link) -> activity request -> staff claim + confirmation -> guest sees it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkEnv, syncCreated, syncStatus, call, one, count, staff, offer, reserve } from './m3_helpers.mjs';
import { createCaptureSender } from './outbox_d1.js';

test('JOURNEY: saved transfer -> receipts -> private trip -> request -> staff confirmation -> guest sees the update', async () => {
  const sender = createCaptureSender(); const env = mkEnv({ BULA_CAPTURE_SENDER: sender, BULA_SUPPORT_WHATSAPP: '+679 000 0000', BULA_SUPPORT_VERIFIED: 'on' }); await offer(env);
  // 1. the source saves a transfer; the existing sync mirrors it; the adapter records snapshot + jobs + grant
  const s = await syncCreated(env, 2001, { guest_email: 'visitor@example.test' }); assert.equal(s.data.created, true);
  assert.equal(await count(env, 'bula_outbox'), 2);
  // 2. the outbox runs (capture sender): one guest receipt, one team receipt
  const run = await one(await call(env, 'POST', '/preview/bula/outbox/run', { body: {} })); assert.equal(run.status, 200); assert.equal(run.data.accepted, 2);
  const g = sender.sent.find((m) => m.to === 'visitor@example.test'), t = sender.sent.find((m) => m.to === 'team@example.test'); assert.ok(g && t);
  assert.match(g.text, /NOT confirmed yet/); assert.match(g.text, /Reference: 2001\n/); assert.match(g.text, /Nadi Airport/); assert.match(g.text, /Denarau/); assert.match(g.text, /Friday, Nov 20, 2026, 2:30 PM/); assert.doesNotMatch(g.text, /\[object/);
  assert.match(g.text, /Flight: FJ391/); assert.match(g.text, /FJD 85\.00/); assert.match(g.text, /Welcome promotional credit: FJ\$500\.00/); assert.match(g.text, /\+679 000 0000/); assert.doesNotMatch(g.text, /Passengers|Luggage|Add-ons|Discount/, 'unavailable details are omitted, never invented');
  assert.match(t.text, /ACTION: confirm or decline/);
  const tok = /#tok=([\w-]+)/.exec(g.text)[1];
  // 3. the guest opens the private link from the receipt
  const trip = await one(await call(env, 'GET', '/preview/bula/trip', { tok, admin: false })); assert.equal(trip.status, 200); assert.equal(trip.data.trips[0].reference, '2001', 'the receipt and My trip quote the same reference'); assert.equal(trip.data.trips[0].legs[0].statusLabel, 'Received — our team has not confirmed it yet'); assert.equal(trip.data.support.whatsapp, '+679 000 0000');
  // 4. the guest requests an activity using the welcome credit
  const rq = await one(await reserve(env, tok, 'j1', { expected_net_cents: 12500 })); assert.equal(rq.status, 201); assert.equal(rq.data.hold.chip, 'Requested'); assert.equal(rq.data.hold.message, 'Requested — not confirmed until our team confirms it.');
  // 5. staff: queue -> claim -> confirm
  const ana = await staff(env, 'ana', 'ops'); const q = (await one(await call(env, 'GET', '/preview/admin/bula/queue', { staff: ana }))).data; assert.equal(q.requests.length, 1); assert.equal(q.requests[0].transfer.from, 'Nadi Airport');
  const id = q.requests[0].holdId; assert.equal((await call(env, 'POST', `/preview/admin/bula/holds/${id}/claim`, { staff: ana, body: {} })).status, 200);
  assert.equal((await one(await call(env, 'GET', '/preview/bula/trip', { tok, admin: false }))).data.requests[0].message, 'Our team is reviewing this request. It is not confirmed yet.');
  assert.equal((await call(env, 'POST', `/preview/admin/bula/holds/${id}/confirm`, { staff: ana, body: { evidence_note: 'operator ref OP-77' } })).status, 200);
  // 6. the guest sees the updated status (My trip and My bookings agree)
  const after = (await one(await call(env, 'GET', '/preview/bula/trip', { tok, admin: false }))).data; const mine = (await one(await call(env, 'GET', '/preview/bula/holds', { tok, admin: false }))).data.holds;
  assert.equal(after.requests[0].chip, 'Confirmed'); assert.equal(after.requests[0].message, 'Confirmed.'); assert.deepEqual(mine.map((h) => [h.holdId, h.chip]), after.requests.map((h) => [h.holdId, h.chip]));
  assert.equal(after.trips[0].legs[0].status, 'pending', 'the TRANSFER is still pending: confirming an activity never confirms the transfer');
  await syncStatus(env, 2001, 'accepted'); assert.equal((await one(await call(env, 'GET', '/preview/bula/trip', { tok, admin: false }))).data.trips[0].legs[0].statusLabel, 'Confirmed');
  // nothing duplicated, nothing real was touched
  assert.equal(sender.sent.length, 2); assert.equal(await count(env, 'guest_sessions'), 1); assert.equal(await count(env, 'bula_credit_ledger', "type = 'granted'"), 1);
  assert.ok(env.__fetch.calls.every((c) => c.method === 'GET' && c.url.startsWith('https://nat-source.synthetic.test/')), 'only synthetic read-only source calls');
});
