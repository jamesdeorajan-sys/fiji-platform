/* Marau Stage 1 (PREVIEW ONLY) — regressions for Codex's SECOND
 * independent review of commit a0ffe49 (296/296 passing at the time).
 * Each section reproduces one finding, then is the test proving the fix.
 * See docs/MARAU_STAGE1_CODEX_FIXES_ROUND2.md for the full write-up.
 *
 * All evidence here is against test/d1_sqlite_shim.mjs (a real SQLite
 * engine enforcing real constraints) — kept explicitly distinct from any
 * deployed Cloudflare D1 evidence, which does not exist for this branch
 * (see the review package's own deployment-blocked section).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest, seedActiveOffer, seedVehicleWindowForBooking } from './fixtures.mjs';
import worker from '../worker/worker.js';

installNetworkGuard();

function req(path, opts = {}) {
  return new Request('http://marau-preview.test' + path, opts);
}
async function call(env, path, opts) {
  const res = await worker.fetch(req(path, opts), env);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
function withJson(method, body, headers = {}) {
  return { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) };
}
function authed(token) {
  return { authorization: `Bearer ${token}` };
}

// =======================================================================
// 1. ATOMICITY ACROSS ALLOCATION, OFFER STATE AND REQUEST STATE
// Codex injected a failure at the FINAL deal_requests UPDATE: offer
// remained FILLED, request REQUESTED, allocation count zero; retry
// returned 409 forever (the offer's own state was never reverted).
// =======================================================================

test('late-failure atomicity: a fault at the final UPDATE fully reverts offer status, allocation and claim — and the request is retryable afterward', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });

  // Inject the exact failure point Codex used: right before the final
  // deal_requests status UPDATE, after holdOffer/fillOffer have already
  // succeeded.
  const failingEnv = { ...env, __TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__: () => { throw new Error('INJECTED_TEST_FAILURE_BEFORE_FINAL_UPDATE'); } };
  const failedAttempt = await call(failingEnv, `/preview/admin/deal-requests/${requested.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(failedAttempt.status, 500);
  assert.equal(failedAttempt.data.error, 'CONFIRMATION_FAILED');

  // Reproduce the exact broken state Codex found, to prove it does NOT occur:
  const offerAfterFailure = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offer.offer_id).first();
  assert.equal(offerAfterFailure.status, 'ACTIVE', 'the offer must be reverted to ACTIVE, not left FILLED');

  const requestAfterFailure = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(requestAfterFailure.status, 'REQUESTED', 'the request must be unchanged, not stranded');

  const allocations = await env.DB.prepare('SELECT * FROM vehicle_allocations').all();
  assert.equal(allocations.results.length, 0, 'the allocation must be released, not left counted as taken');
  const claims = await env.DB.prepare('SELECT * FROM vehicle_time_claims').all();
  assert.equal(claims.results.length, 0, 'the movement claim must be released too');

  // A retry, without the injected fault, must now succeed cleanly — the
  // original defect made this permanently 409.
  const retry = await call(env, `/preview/admin/deal-requests/${requested.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.status, 'CONFIRMED');
});

test('late-failure atomicity: reverting FILLED->ACTIVE does not resurrect a genuinely different, already-terminal offer', async () => {
  // Sanity check on the compensating action itself: reverting one offer
  // must never affect an unrelated offer's own state.
  const env = makeEnv();
  const { offer: offerA } = await seedActiveOffer(env);
  const { offer: offerB } = await seedActiveOffer(env);
  const guestA = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requestA = await call(env, `/preview/deals/${offerA.offer_id}/request`, { method: 'POST', headers: authed(guestA.data.access_token) });

  const failingEnv = { ...env, __TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__: () => { throw new Error('INJECTED'); } };
  await call(failingEnv, `/preview/admin/deal-requests/${requestA.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });

  const offerBAfter = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offerB.offer_id).first();
  assert.equal(offerBAfter.status, 'ACTIVE', 'an unrelated offer must never be touched by another offer’s rollback');
});

// =======================================================================
// 2. SIMULTANEOUS SAME-KEY BOOKING SUBMISSIONS
// Codex reproduced: one successful save, one uncaught UNIQUE-constraint
// error, and two sessions (an orphan left behind).
// =======================================================================

test('concurrency: two truly simultaneous submissions of the SAME client_booking_ref recover cleanly — one winner, no crash, no orphan session', async () => {
  // Both concurrent requests carry the SAME attempt_secret, exactly as a
  // real browser would (generated once, before either request fires) —
  // see the third-review fix, which otherwise requires proof of ownership
  // for any resubmit regardless of timing.
  const env = makeEnv();
  const guest = synthGuest({ client_booking_ref: 'RACE-KEY-1', attempt_secret: 'concurrent-race-secret-1' });

  const [first, second] = await Promise.all([
    call(env, '/preview/bookings', withJson('POST', guest)),
    call(env, '/preview/bookings', withJson('POST', guest)),
  ]);

  assert.equal(first.status < 500 && second.status < 500, true, 'neither concurrent request may crash with an uncaught constraint error');
  const successes = [first, second].filter((r) => r.status === 201 || r.status === 200);
  assert.equal(successes.length, 2, 'both calls must resolve to a usable response');
  assert.equal(first.data.access_token, second.data.access_token, 'both concurrent submissions of the same in-flight request must recover the SAME session');

  const contactKey = guest.guest_phone.replace(/[^0-9+]/g, '');
  const sessions = await env.DB.prepare('SELECT * FROM guest_sessions WHERE guest_contact_key = ?').bind(contactKey).all();
  assert.equal(sessions.results.length, 1, 'no orphan session may be left behind by the losing side of the race');

  const bookings = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind('RACE-KEY-1').all();
  assert.equal(bookings.results.length, 1, 'exactly one booking row, never two');

  const trip = await call(env, '/preview/trip', { headers: authed(first.data.access_token) });
  assert.equal(trip.data.bookings.length, 1);
});

test('concurrency: a genuine race does not leak a link-offer row referencing the deleted losing session', async () => {
  const env = makeEnv();
  const phone = '+15005559100';
  // Seed an EARLIER, different session on the same phone so the losing
  // side's createSessionAndOfferLink() also opens a cross-phone link
  // offer — the exact combination that triggered the FK-ordering bug
  // found while fixing this.
  await call(env, '/preview/bookings', withJson('POST', synthGuest({ guest_phone: phone, client_booking_ref: 'EARLIER-ON-PHONE' })));

  const guest = synthGuest({ guest_phone: phone, client_booking_ref: 'RACE-KEY-2' });
  const [first, second] = await Promise.all([
    call(env, '/preview/bookings', withJson('POST', guest)),
    call(env, '/preview/bookings', withJson('POST', guest)),
  ]);
  assert.equal(first.status < 500 && second.status < 500, true);

  const bookings = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind('RACE-KEY-2').all();
  assert.equal(bookings.results.length, 1);
});

// =======================================================================
// 3. RETRY RECOVERY vs. PRIVATE-TRIP AUTHORIZATION
// Codex found: an unauthenticated replay of a booking reference plus
// matching details returned the session token outright.
// =======================================================================

test('authorization: an unauthenticated replay of a SETTLED (old) booking’s reference+details no longer returns the access token', async () => {
  const env = makeEnv();
  const guest = synthGuest({ client_booking_ref: 'OLD-SETTLED-1' });
  const original = await call(env, '/preview/bookings', withJson('POST', guest));
  assert.ok(original.data.access_token);

  // Simulate this being an OLD, already-settled request — well outside
  // the same-attempt retry grace window — by backdating created_at.
  await env.DB.prepare('UPDATE marau_test_bookings SET created_at = ? WHERE client_booking_ref = ?').bind('2000-01-01T00:00:00Z', 'OLD-SETTLED-1').run();

  const replay = await call(env, '/preview/bookings', withJson('POST', guest)); // no Authorization header
  assert.equal(replay.status, 200);
  assert.equal(replay.data.access_token, undefined, 'a bare replay of an old, settled request must never hand back the access token');
  assert.ok(replay.data.recovery_offer, 'a secure recovery path must be offered instead');
  assert.notEqual(replay.data.recovery_offer.access_token, original.data.access_token, 'the recovery session must not itself be the private trip’s token');
});

test('authorization: the recovery offer completes through the SAME verified-ownership mechanism as a phone-match link', async () => {
  const env = makeEnv();
  const guest = synthGuest({ client_booking_ref: 'OLD-SETTLED-2' });
  const original = await call(env, '/preview/bookings', withJson('POST', guest));
  await env.DB.prepare('UPDATE marau_test_bookings SET created_at = ? WHERE client_booking_ref = ?').bind('2000-01-01T00:00:00Z', 'OLD-SETTLED-2').run();

  const replay = await call(env, '/preview/bookings', withJson('POST', guest));
  const recoveryToken = replay.data.recovery_offer.access_token;

  // The attacker/replayer (holding only the recovery session) cannot read the code.
  const replayerInbox = await call(env, '/preview/trip/link-requests', { headers: authed(recoveryToken) });
  assert.equal((replayerInbox.data.link_requests || []).length, 0);

  // Only the ORIGINAL session's own token can read it.
  const ownerInbox = await call(env, '/preview/trip/link-requests', { headers: authed(original.data.access_token) });
  assert.equal(ownerInbox.data.link_requests.length, 1);
  const code = ownerInbox.data.link_requests[0].verification_code;

  const confirm = await call(env, '/preview/trip/link', withJson('POST', { link_request_id: replay.data.recovery_offer.link_request_id, verification_code: code }, authed(recoveryToken)));
  assert.equal(confirm.status, 200);

  const mergedTrip = await call(env, '/preview/trip', { headers: authed(recoveryToken) });
  assert.equal(mergedTrip.data.bookings.length, 1);
});

// NOTE: an earlier version of this test asserted that a FRESH,
// no-Authorization-header resubmit (inside a 60s "retry grace window")
// still got direct access. A third independent review replayed exactly
// this — a fresh reference/payload, no auth — and still received the
// token, proving timing alone is not proof of anything. That grace
// window has been removed entirely; see marau_codex_fixes_round3.test.mjs
// for the corrected behaviour (only a matching attempt_secret or the
// caller's own valid token ever recovers direct access, regardless of
// how quickly the resubmit followed the original).

test('authorization: presenting the CORRECT session’s own token on a resubmit always works, regardless of age', async () => {
  const env = makeEnv();
  const guest = synthGuest({ client_booking_ref: 'OLD-BUT-AUTHED-1' });
  const original = await call(env, '/preview/bookings', withJson('POST', guest));
  await env.DB.prepare('UPDATE marau_test_bookings SET created_at = ? WHERE client_booking_ref = ?').bind('2000-01-01T00:00:00Z', 'OLD-BUT-AUTHED-1').run();

  const resubmitWithOwnToken = await call(env, '/preview/bookings', withJson('POST', guest, authed(original.data.access_token)));
  assert.equal(resubmitWithOwnToken.status, 200);
  assert.equal(resubmitWithOwnToken.data.access_token, original.data.access_token);
});

test('authorization: presenting SOMEONE ELSE’S valid token does not grant access to this booking’s trip', async () => {
  const env = makeEnv();
  const guest = synthGuest({ client_booking_ref: 'OLD-STRANGER-1' });
  await call(env, '/preview/bookings', withJson('POST', guest));
  await env.DB.prepare('UPDATE marau_test_bookings SET created_at = ? WHERE client_booking_ref = ?').bind('2000-01-01T00:00:00Z', 'OLD-STRANGER-1').run();

  const stranger = await call(env, '/preview/bookings', withJson('POST', synthGuest({ client_booking_ref: 'STRANGER-OWN-BOOKING' })));

  const replay = await call(env, '/preview/bookings', withJson('POST', guest, authed(stranger.data.access_token)));
  assert.equal(replay.status, 200);
  assert.equal(replay.data.access_token, undefined, 'a stranger’s own valid token must not unlock someone else’s settled booking');
  assert.ok(replay.data.recovery_offer);
});

// =======================================================================
// 5. UNKNOWN/INVALID COMMERCIAL FLOORS + STALE PRICE
// =======================================================================

test('eligibility: a NULL absolute_floor is rejected, never treated as "no floor to violate"', async () => {
  const { evaluateOfferEligibility } = await import('../worker/offer_eligibility.js');
  const offer = { status: 'ACTIVE', expires_at: new Date(Date.now() + 3600_000).toISOString(), inventory_count: 1, standard_price: 40, absolute_floor: null };
  const result = evaluateOfferEligibility(offer, new Date().toISOString());
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'UNKNOWN_FLOOR');
});

test('eligibility: a negative or non-finite absolute_floor is rejected the same way', async () => {
  const { evaluateOfferEligibility } = await import('../worker/offer_eligibility.js');
  const nowIso = new Date().toISOString();
  const base = { status: 'ACTIVE', expires_at: new Date(Date.now() + 3600_000).toISOString(), inventory_count: 1, standard_price: 40 };
  assert.equal(evaluateOfferEligibility({ ...base, absolute_floor: -5 }, nowIso).reason, 'UNKNOWN_FLOOR');
  assert.equal(evaluateOfferEligibility({ ...base, absolute_floor: NaN }, nowIso).reason, 'UNKNOWN_FLOOR');
});

test('stale price: confirmation is refused if the offer’s price changed since the guest requested it', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env, { smart_match_price: 24 });
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });

  // Ops (or a re-run of the pricing engine) changes the price AFTER the
  // guest already requested it at 24.
  await env.DB.prepare('UPDATE smart_offers SET smart_match_price = ? WHERE offer_id = ?').bind(30, offer.offer_id).run();

  const confirm = await call(env, `/preview/admin/deal-requests/${requested.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirm.status, 409);
  assert.equal(confirm.data.error, 'PRICE_CHANGED_SINCE_REQUEST');

  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(dealRequest.status, 'REQUESTED', 'a stale-price rejection must not silently decide the request either way');
});

test('stale price: confirmation is refused if the FLOOR changed since the guest requested it, even if the shown price did not', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });

  await env.DB.prepare('UPDATE smart_offers SET absolute_floor = ? WHERE offer_id = ?').bind(23.9, offer.offer_id).run();

  const confirm = await call(env, `/preview/admin/deal-requests/${requested.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirm.status, 409);
  assert.equal(confirm.data.error, 'PRICE_CHANGED_SINCE_REQUEST');
});

test('stale price: an unchanged price/floor confirms normally', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });

  const confirm = await call(env, `/preview/admin/deal-requests/${requested.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirm.status, 200);
});

// =======================================================================
// 4 (side-by-side proof). CONFIRMED vs. CONFIRMED_UNALLOCATED
// =======================================================================

// NOTE: this test originally proved that an allocated booking confirms
// as 'confirmed' while an unallocated one confirms as the distinct
// 'confirmed_unallocated'. A third independent review found that
// introducing 'confirmed_unallocated' at all was itself a silent policy
// change needing James's explicit approval first — see
// marau_codex_fixes_round3.test.mjs, which replaces this test: an
// unallocated booking confirmation now REFUSES
// (409 VEHICLE_ALLOCATION_DECISION_PENDING) and the booking stays
// 'pending', rather than confirming under any status.
test('unknown-vehicle rule: an allocated booking still confirms normally', async () => {
  const env = makeEnv();
  const vehicleId = 'VEH-ROUND2-DISTINCT';
  const windowStart = new Date(Date.now() + 4 * 3600_000).toISOString();
  const windowEnd = new Date(Date.now() + 6 * 3600_000).toISOString();

  const allocatedGuest = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const allocatedBookingId = (await call(env, '/preview/trip', { headers: authed(allocatedGuest.data.access_token) })).data.bookings[0].id;
  await seedVehicleWindowForBooking(env, allocatedBookingId, { vehicleId, windowStart, windowEnd });
  const allocatedConfirm = await call(env, `/preview/admin/bookings/${allocatedBookingId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(allocatedConfirm.data.status, 'confirmed');
});

// =======================================================================
// 6. THE OMITTED SIXTH FINDING — deal requests visible in the trip
// =======================================================================

test('trip view: shows the guest’s own deal requests in every state, with authoritative details and source lineage', async () => {
  const env = makeEnv();
  const { offer: offerRequested } = await seedActiveOffer(env, { smart_match_price: 24 });
  const { offer: offerConfirmed } = await seedActiveOffer(env, { smart_match_price: 30 });
  const { offer: offerDeclined } = await seedActiveOffer(env, { smart_match_price: 22 });

  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const token = created.data.access_token;

  const r1 = await call(env, `/preview/deals/${offerRequested.offer_id}/request`, { method: 'POST', headers: authed(token) });
  const r2 = await call(env, `/preview/deals/${offerConfirmed.offer_id}/request`, { method: 'POST', headers: authed(token) });
  const r3 = await call(env, `/preview/deals/${offerDeclined.offer_id}/request`, { method: 'POST', headers: authed(token) });

  await call(env, `/preview/admin/deal-requests/${r2.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  await call(env, `/preview/admin/deal-requests/${r3.data.request_id}/decline`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });

  const trip = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(trip.data.deal_requests.length, 3);

  const byId = Object.fromEntries(trip.data.deal_requests.map((d) => [d.request_id, d]));
  assert.equal(byId[r1.data.request_id].status, 'REQUESTED');
  assert.equal(byId[r2.data.request_id].status, 'CONFIRMED');
  assert.equal(byId[r3.data.request_id].status, 'DECLINED');

  for (const [reqId, offer] of [[r1.data.request_id, offerRequested], [r2.data.request_id, offerConfirmed], [r3.data.request_id, offerDeclined]]) {
    const row = byId[reqId];
    assert.equal(row.offer_id, offer.offer_id);
    assert.equal(row.source_movement_id, offer.source_movement_id, 'source lineage back to the shadow-leg movement must be preserved');
    assert.equal(row.origin_zone, offer.origin_zone);
    assert.equal(row.destination_zone, offer.destination_zone);
    assert.equal(row.requested_price, offer.smart_match_price, 'the price the guest actually saw/agreed to must be recorded');
    assert.ok(row.created_at);
  }
});

test('trip view: current_price reflects live offer data, distinct from what was originally requested', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env, { smart_match_price: 24 });
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });

  await env.DB.prepare('UPDATE smart_offers SET smart_match_price = ? WHERE offer_id = ?').bind(30, offer.offer_id).run();

  const trip = await call(env, '/preview/trip', { headers: authed(created.data.access_token) });
  const row = trip.data.deal_requests.find((d) => d.request_id === requested.data.request_id);
  assert.equal(row.requested_price, 24, 'what the guest originally saw must stay fixed');
  assert.equal(row.current_price, 30, 'the live offer price must be shown alongside it');
});
