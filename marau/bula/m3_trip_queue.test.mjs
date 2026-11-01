// SYNTHETIC. Guest "My trip" + staff request queue (claim / confirm / decline) + withdrawal wording + verified credit return. Real Worker. Run from marau/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkEnv, syncCreated, syncStatus, call, one, count, tokenFor, staff, offer, reserve } from './m3_helpers.mjs';

async function world(over = {}) {
  const env = mkEnv(over); await offer(env); await syncCreated(env, 1001); await syncCreated(env, 1002, { pickup_zone: 'Suva', destination_zone: 'Pacific Harbour', flight_number: null });
  const A = await tokenFor(env, 1001), B = await tokenFor(env, 1002);
  return { env, A, B, ana: await staff(env, 'ana', 'ops'), ben: await staff(env, 'ben', 'ops'), ceo: await staff(env, 'james', 'ceo') };
}
const trip = async (env, tok) => one(await call(env, 'GET', '/preview/bula/trip', { tok, admin: false }));
const queue = async (env, st) => one(await call(env, 'GET', '/preview/admin/bula/queue', { staff: st }));
const act = (env, st, id, a, body = {}) => call(env, 'POST', `/preview/admin/bula/holds/${id}/${a}`, { staff: st, body });
const wallet = async (env, tok) => (await one(await call(env, 'GET', '/preview/bula/offers', { tok, admin: false }))).data.wallet;

test('MY TRIP shows the saved itinerary, the source details that exist, and says plainly which are unavailable', async () => {
  const { env, A, B } = await world(); const r = await trip(env, A); assert.equal(r.status, 200);
  const t = r.data.trips[0]; assert.equal(t.reference, '1001'); assert.equal(t.from, 'booking_system'); assert.equal(t.legs[0].from, 'Nadi Airport'); assert.equal(t.legs[0].to, 'Denarau');
  assert.match(t.legs[0].pickupFijiTime, /2026|Nov/); assert.equal(t.legs[0].status, 'pending'); assert.match(t.legs[0].statusLabel, /not confirmed it yet/);
  assert.deepEqual(t.details.total, { available: true, value: { currency: 'FJD', cents: 8500 } }); assert.deepEqual(t.details.flightNumber, { available: true, value: 'FJ391' });
  for (const k of ['passengers', 'luggage', 'addOns', 'discount']) assert.deepEqual(t.details[k], { available: false }, k);
  assert.equal(t.snapshot.source, 'booking system');
  const rb = await trip(env, B); assert.deepEqual(rb.data.trips[0].details.flightNumber, { available: false }, 'a missing flight number stays missing');
  assert.equal(rb.data.trips[0].legs[0].from, 'Suva');
});

test('MY TRIP status follows the transfer honestly (pending -> confirmed) and driver assignment is not invented', async () => {
  const { env, A } = await world(); assert.equal((await trip(env, A)).data.trips[0].legs[0].driverAssigned, false);
  await syncStatus(env, 1001, 'accepted'); const t = (await trip(env, A)).data.trips[0].legs[0]; assert.equal(t.status, 'confirmed'); assert.equal(t.statusLabel, 'Confirmed');
});

test('GUEST ISOLATION: each guest sees only their own trip and requests; no parameter can reach another; unauthenticated is refused', async () => {
  const { env, A, B } = await world(); await reserve(env, A, 'a1');
  const ra = await trip(env, A), rb = await trip(env, B); assert.equal(ra.data.requests.length, 1); assert.equal(rb.data.requests.length, 0); assert.equal(rb.data.trips.length, 1); assert.equal(rb.data.trips[0].reference, '1002');
  const probe = await one(await call(env, 'GET', '/preview/bula/trip?booking_ref=1001&session_id=x', { tok: B, admin: false })); assert.equal(probe.data.trips[0].reference, '1002');
  assert.equal((await one(await call(env, 'GET', '/preview/bula/trip', { admin: false }))).status, 401); assert.equal((await one(await call(env, 'GET', '/preview/bula/trip', { tok: 'nope', admin: false }))).status, 401);
  assert.doesNotMatch(JSON.stringify(ra.data), /example\.test|\+1555|partyKey|access_token/, 'no contact details or credentials in the guest view');
});

test('SUPPORT: unconfigured says so; configured-but-unverified is NOT shown; verified is shown', async () => {
  let w = await world(); assert.equal((await trip(w.env, w.A)).data.support.whatsapp, null); assert.match((await trip(w.env, w.A)).data.support.note, /not set up/);
  w = await world({ BULA_SUPPORT_WHATSAPP: '+679 000 0000' }); assert.equal((await trip(w.env, w.A)).data.support.whatsapp, null, 'unverified number is never shown');
  w = await world({ BULA_SUPPORT_WHATSAPP: '+679 000 0000', BULA_SUPPORT_VERIFIED: 'on' }); assert.equal((await trip(w.env, w.A)).data.support.whatsapp, '+679 000 0000');
});

test('CLAIM is attributable and atomic: two staff claiming at once -> exactly one wins; the other is told who has it', async () => {
  const { env, A, ana, ben } = await world(); const h = (await one(await reserve(env, A, 'a1'))).data.hold.holdId;
  const [x, y] = await Promise.all([act(env, ana, h, 'claim'), act(env, ben, h, 'claim')]); assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  const loser = x.status === 409 ? await x.json() : await y.json(); assert.equal(loser.code, 'already_claimed'); assert.match(loser.claimedBy, /^(ana|ben)\(ops\)$/);
  const q = (await queue(env, ana)).data.requests[0]; assert.match(q.claimedBy, /^(ana|ben)\(ops\)$/); assert.equal(q.transfer.reference, '1001'); assert.equal(q.transfer.from, 'Nadi Airport');
  assert.equal(await count(env, 'bula_audit', `action = 'hold_claimed' AND subject = '${h}'`), 1);
  assert.doesNotMatch(JSON.stringify(q), /example\.test|\+1555/, 'staff queue carries no guest contact details');
  const g = (await trip(env, A)).data.requests[0]; assert.equal(g.underReview, true); assert.match(g.message, /reviewing/); assert.equal(g.state, 'held'); assert.doesNotMatch(JSON.stringify(g), /ana|ben/, 'guest never sees staff names');
});

test('CLAIM rules: replay by the claimant is fine; others cannot confirm/decline/unclaim; the CEO can override (audited); a claim ends when the request does', async () => {
  const { env, A, ana, ben, ceo } = await world(); const h = (await one(await reserve(env, A, 'a1'))).data.hold.holdId;
  assert.equal((await act(env, ana, h, 'claim')).status, 200); assert.equal((await (await act(env, ana, h, 'claim')).json()).replay, true);
  assert.equal((await act(env, ben, h, 'confirm', { evidence_note: 'x' })).status, 409); assert.equal((await act(env, ben, h, 'decline')).status, 409); assert.equal((await act(env, ben, h, 'unclaim')).status, 409);
  assert.equal((await one(await call(env, 'GET', '/preview/bula/holds', { tok: A, admin: false }))).data.holds[0].state, 'held', 'a refused action changed nothing');
  assert.equal((await act(env, ceo, h, 'unclaim')).status, 200); assert.equal(await count(env, 'bula_audit', `action = 'hold_claim_released' AND subject = '${h}' AND detail LIKE 'override of ana%'`), 1);
  assert.equal((await act(env, ben, h, 'claim')).status, 200); assert.equal((await act(env, ben, h, 'confirm', { evidence_note: 'operator ref OP-1' })).status, 200);
  assert.equal((await act(env, ben, h, 'claim')).status, 409, 'cannot claim a request that is no longer waiting');
  const g = (await trip(env, A)).data.requests[0]; assert.equal(g.state, 'confirmed'); assert.equal(g.chip, 'Confirmed'); assert.equal(g.message, 'Confirmed.');
});

test('journey of a CONFIRMATION by an unclaimed request still works and is attributed to the acting staff member', async () => {
  const { env, A, ana } = await world(); const h = (await one(await reserve(env, A, 'a1'))).data.hold.holdId;
  assert.equal((await act(env, ana, h, 'confirm', { evidence_note: 'ref 9' })).status, 200); const row = await env.DB.prepare('SELECT confirmed_by_ref FROM bula_holds WHERE hold_id = ?').bind(h).first(); assert.match(row.confirmed_by_ref, /^ana:/);
});

test('DECLINE restores credit AND capacity atomically, exactly once; the guest sees "Declined" and "credit returned"; attribution is stored', async () => {
  const { env, A, ana } = await world(); const w0 = await wallet(env, A); assert.equal(w0.availableCents, 50000);
  const h = (await one(await reserve(env, A, 'a1', { expected_net_cents: 12500 }))).data.hold.holdId; assert.equal((await wallet(env, A)).availableCents, 47500); assert.equal((await env.DB.prepare("SELECT remaining r FROM bula_offers WHERE offer_id='ISLAND'").first()).r, 7);
  await act(env, ana, h, 'claim'); assert.equal((await act(env, ana, h, 'decline', { evidence_note: 'operator full' })).status, 200);
  assert.equal((await wallet(env, A)).availableCents, 50000); assert.equal((await env.DB.prepare("SELECT remaining r FROM bula_offers WHERE offer_id='ISLAND'").first()).r, 8);
  assert.equal((await act(env, ana, h, 'decline', { evidence_note: 'again' })).status, 200);   // replay
  assert.equal((await wallet(env, A)).availableCents, 50000, 'second decline restores nothing more'); assert.equal((await env.DB.prepare("SELECT remaining r FROM bula_offers WHERE offer_id='ISLAND'").first()).r, 8);
  assert.equal(await count(env, 'bula_audit', `action = 'hold_declined' AND subject = '${h}'`), 1);
  const g = (await trip(env, A)).data.requests[0]; assert.equal(g.chip, 'Declined'); assert.equal(g.declinedByTeam, true); assert.equal(g.creditReturned, true); assert.equal(g.inventoryReturned, true); assert.equal(g.creditLine, 'FJ$25.00 credit returned.'); assert.doesNotMatch(`${g.chip} ${g.message} ${g.creditLine}`, /released/i);
  const cl = (await queue(env, ana)).data.closed[0]; assert.equal(cl.declinedBy, 'ana(ops)'); assert.equal(cl.declineNote, 'operator full');
});

test('GUEST WITHDRAWAL wording: "Withdrawn" (never "Released"); credit returned shown only because the ledger proves it', async () => {
  const { env, A } = await world(); const h = (await one(await reserve(env, A, 'a1', { expected_net_cents: 12500 }))).data.hold.holdId;
  assert.equal((await call(env, 'POST', `/preview/bula/holds/${h}/release`, { tok: A, admin: false, body: {} })).status, 200);
  const g = (await one(await call(env, 'GET', '/preview/bula/holds', { tok: A, admin: false }))).data.holds[0];
  assert.equal(g.chip, 'Withdrawn'); assert.equal(g.message, 'You withdrew this request. Nothing was charged.'); assert.equal(g.declinedByTeam, false); assert.equal(g.creditReturned, true); assert.equal(g.creditLine, 'FJ$25.00 credit returned.');
  assert.doesNotMatch(`${g.chip} ${g.message} ${g.creditLine}`, /released/i);
});

test('"credit returned" is NOT claimed without proof: a released-but-unsettled request says the return is being processed; a forfeit says it was not returned', async () => {
  const { env, A } = await world(); const h = (await one(await reserve(env, A, 'a1', { expected_net_cents: 12500 }))).data.hold.holdId;
  await env.DB.prepare("UPDATE bula_holds SET state = 'released' WHERE hold_id = ?").bind(h).run();   // simulate an interrupted settle
  let g = (await trip(env, A)).data.requests[0]; assert.equal(g.creditReturned, null); assert.equal(g.creditLine, 'Credit return is being processed.'); assert.doesNotMatch(g.creditLine, /returned\.$/);
  const { sweepExpired } = await import('./inventory_credit.js'); await sweepExpired(env.DB, Date.now());   // the existing recovery sweep completes it
  g = (await trip(env, A)).data.requests[0]; assert.equal(g.creditReturned, true); assert.equal(g.creditLine, 'FJ$25.00 credit returned.');
});

test('CANCELLED confirmed booking inside the no-refund window: shows "not returned", never "returned"', async () => {
  const { env, A, ana } = await world(); await env.DB.prepare('UPDATE bula_offers SET credit_restore_hours_before = 48, inventory_restore_hours_before = 48').run();
  const h = (await one(await reserve(env, A, 'a1', { expected_net_cents: 12500 }))).data.hold.holdId; await act(env, ana, h, 'confirm', { evidence_note: 'ok' });
  assert.equal((await call(env, 'POST', `/preview/bula/holds/${h}/cancel`, { tok: A, admin: false, body: {} })).status, 200);
  const g = (await trip(env, A)).data.requests[0]; assert.equal(g.state, 'cancelled'); assert.equal(g.creditReturned, false); assert.equal(g.creditLine, 'Credit was not returned under the cancellation terms.');
});

test('the guest page and staff page carry the new surfaces and no "Released" label', async () => {
  const { GUEST_UI, STAFF_UI } = await import('./ui.js');
  assert.match(GUEST_UI, /id="t-trip"[^>]*>My trip</); assert.match(GUEST_UI, /Not available from your booking record/); assert.match(STAFF_UI, /Claim this request/); assert.match(STAFF_UI, /Recently closed/);
  assert.doesNotMatch(GUEST_UI, /Released/); assert.doesNotMatch(STAFF_UI, /Released/);
});
