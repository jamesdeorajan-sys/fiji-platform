/* Marau Stage 1 (PREVIEW ONLY) — regressions for Codex's THIRD
 * independent review (of commit b69933e, which reproduced 313/313).
 * Each section reproduces one finding, then is the test proving the fix.
 * See docs/MARAU_STAGE1_CODEX_FIXES_ROUND3.md for the full write-up.
 *
 * All evidence here is against test/d1_sqlite_shim.mjs (a real SQLite
 * engine enforcing real constraints), kept explicitly distinct from any
 * deployed Cloudflare D1 evidence — none exists for this branch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest, seedActiveOffer } from './fixtures.mjs';
import worker from '../worker/worker.js';
import { getOrCreateClientBookingRef, clearClientBookingRef, getOrCreateAttemptSecret, clearAttemptSecret, defaultRandomSource } from '../worker/client_idempotency.js';
import { GUEST_APP_HTML } from '../worker/pages.js';

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
// 1. REMOVE THE UNAUTHENTICATED TIME-WINDOW EXCEPTION
// Codex replayed a FRESH reference/payload (no auth) and still got the
// token back inside the old 60s grace window — timing proved nothing.
// =======================================================================

test('finding 1: a FRESH, unauthenticated replay (immediately after the original, no time delay at all) gets NO token — only a recovery offer', async () => {
  const env = makeEnv();
  const guest = synthGuest({ client_booking_ref: 'FRESH-REPLAY-1' }); // no attempt_secret at all
  const original = await call(env, '/preview/bookings', withJson('POST', guest));
  assert.ok(original.data.access_token);

  // Reproduces Codex's exact case: replay immediately, zero elapsed time,
  // no Authorization header, no attempt_secret.
  const replay = await call(env, '/preview/bookings', withJson('POST', guest));
  assert.equal(replay.status, 200);
  assert.equal(replay.data.access_token, undefined, 'timing alone must never grant access — this is the exact defect Codex found');
  assert.ok(replay.data.recovery_offer, 'a secure recovery path must be offered instead');

  const replayTrip = await call(env, '/preview/trip', { headers: authed(replay.data.recovery_offer.access_token) });
  assert.equal(replayTrip.data.bookings.length, 0, 'the replaying caller must not be able to read the original trip');
});

test('finding 1: presenting the correct attempt_secret (not timing) is what recovers direct access for a genuine retry', async () => {
  const env = makeEnv();
  const guest = synthGuest({ client_booking_ref: 'SECRET-RETRY-1', attempt_secret: 'genuine-client-secret-abc' });
  const original = await call(env, '/preview/bookings', withJson('POST', guest));

  const retryWithSecret = await call(env, '/preview/bookings', withJson('POST', guest));
  assert.equal(retryWithSecret.data.access_token, original.data.access_token);

  const retryWithoutSecret = await call(env, '/preview/bookings', withJson('POST', { ...guest, attempt_secret: undefined }));
  assert.equal(retryWithoutSecret.data.access_token, undefined, 'omitting the secret must not fall back to any other implicit trust');

  const retryWithWrongSecret = await call(env, '/preview/bookings', withJson('POST', { ...guest, attempt_secret: 'guessed-wrong-secret' }));
  assert.equal(retryWithWrongSecret.data.access_token, undefined, 'a wrong secret must be treated the same as no secret at all');
});

test('finding 1 (latent bug found while fixing it): the browser-embedded idempotency/attempt-secret functions run correctly when spliced via toString(), exactly as pages.js embeds them', () => {
  // This is the actual embedding mechanism pages.js uses: each function's
  // own source, NOT imported as an ES module. An earlier version of
  // client_idempotency.js referenced a shared outer `const STORAGE_KEY`
  // from inside each function body — invisible to every test that
  // imports the functions normally (where the constant IS in scope), but
  // a guaranteed ReferenceError the first time a real browser called the
  // spliced version, since the constant never survives extraction. Every
  // function is now fully self-contained; this test proves it by
  // reproducing the EXACT embedding pages.js performs.
  const source = `
    ${getOrCreateClientBookingRef.toString()}
    ${clearClientBookingRef.toString()}
    ${getOrCreateAttemptSecret.toString()}
    ${clearAttemptSecret.toString()}
    ${defaultRandomSource.toString()}
    return { getOrCreateClientBookingRef, clearClientBookingRef, getOrCreateAttemptSecret, clearAttemptSecret, defaultRandomSource };
  `;
  const fns = new Function(source)();

  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };

  const ref1 = fns.getOrCreateClientBookingRef(storage, fns.defaultRandomSource);
  const ref2 = fns.getOrCreateClientBookingRef(storage, fns.defaultRandomSource);
  assert.equal(ref1, ref2, 'the spliced function must persist and reuse the ref exactly like the imported one does');

  const secret1 = fns.getOrCreateAttemptSecret(storage, fns.defaultRandomSource);
  const secret2 = fns.getOrCreateAttemptSecret(storage, fns.defaultRandomSource);
  assert.equal(secret1, secret2);
  assert.notEqual(secret1, ref1, 'the attempt secret and the booking reference must be independent values');

  fns.clearClientBookingRef(storage);
  fns.clearAttemptSecret(storage);
  const ref3 = fns.getOrCreateClientBookingRef(storage, fns.defaultRandomSource);
  const secret3 = fns.getOrCreateAttemptSecret(storage, fns.defaultRandomSource);
  assert.notEqual(ref3, ref1);
  assert.notEqual(secret3, secret1);
});

test('finding 1: the served guest app actually sends attempt_secret with its booking submission (present in the emitted script)', () => {
  assert.ok(GUEST_APP_HTML.includes('getOrCreateAttemptSecret'), 'the browser-side script must call the attempt-secret function');
  assert.ok(GUEST_APP_HTML.includes('attempt_secret'), 'the booking POST body construction must include attempt_secret');
});

// =======================================================================
// 2. MUTUALLY EXCLUSIVE CONFIRM/DECLINE
// Codex found: concurrent confirm and decline both returned 200 with
// contradictory decisions.
// =======================================================================

test('finding 2: a concurrent confirm and decline on the SAME request — exactly one wins, never both', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });

  const [confirmResult, declineResult] = await Promise.all([
    call(env, `/preview/admin/deal-requests/${requested.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) }),
    call(env, `/preview/admin/deal-requests/${requested.data.request_id}/decline`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) }),
  ]);

  const outcomes = [confirmResult, declineResult];
  const winners = outcomes.filter((r) => r.status === 200);
  const losers = outcomes.filter((r) => r.status === 409);
  assert.equal(winners.length, 1, 'exactly one of confirm/decline may succeed — the original defect returned 200/200 here');
  assert.equal(losers.length, 1);
  assert.equal(losers[0].data.error, 'ALREADY_DECIDED');

  // The final stored state must agree with whichever one actually won —
  // never left disagreeing with both responses claiming success.
  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  const winnerWasConfirm = confirmResult.status === 200;
  assert.equal(dealRequest.status, winnerWasConfirm ? 'CONFIRMED' : 'DECLINED');
});

test('finding 2: ten simultaneous confirm attempts on the same request still yield exactly one success', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });

  const attempts = await Promise.all(
    Array.from({ length: 10 }, () => call(env, `/preview/admin/deal-requests/${requested.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) }))
  );
  const winners = attempts.filter((r) => r.status === 200);
  assert.equal(winners.length, 1);
});

// =======================================================================
// 3. ATOMICITY / DURABLE RECOVERY, INCLUDING ROLLBACK-FAILURE HANDLING
// Codex found: failure at the final update PLUS failure during
// compensation left FILLED/REQUESTED with an allocation and a thrown
// error — compensating writes alone don't establish atomicity.
// =======================================================================

test('finding 3: a durable confirmation_attempts record is written and reaches DONE on a normal success', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });

  const confirm = await call(env, `/preview/admin/deal-requests/${requested.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirm.status, 200);

  const attempts = await env.DB.prepare('SELECT * FROM confirmation_attempts WHERE request_id = ?').bind(requested.data.request_id).all();
  assert.equal(attempts.results.length, 1);
  assert.equal(attempts.results[0].phase, 'DONE');
});

test('finding 3: a late failure (after every real side effect already succeeded) is FULLY reverted, durably recorded, and safely retryable', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });

  const failingEnv = { ...env, __TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__: () => { throw new Error('INJECTED_LATE_FAILURE'); } };
  const failed = await call(failingEnv, `/preview/admin/deal-requests/${requested.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(failed.status, 500);
  assert.equal(failed.data.reconciliation_needed, false, 'a fully-rolled-back failure must say it is safe to retry');

  const offerAfter = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offer.offer_id).first();
  assert.equal(offerAfter.status, 'ACTIVE');
  const requestAfter = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(requestAfter.status, 'REQUESTED');
  const allocations = await env.DB.prepare('SELECT * FROM vehicle_allocations').all();
  assert.equal(allocations.results.length, 0);

  const attempts = await env.DB.prepare('SELECT * FROM confirmation_attempts WHERE request_id = ?').bind(requested.data.request_id).all();
  assert.equal(attempts.results[0].phase, 'ROLLED_BACK');

  const retry = await call(env, `/preview/admin/deal-requests/${requested.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(retry.status, 200);
});

// NOTE: this test originally asserted deal_requests.status === 'CONFIRMED'
// after a rollback-compensation failure — that was round 3's own design
// (the request's status flipped to CONFIRMED as the FIRST write, before
// any real side effect). Round 4's independent review found the exact
// hole that design left open (Codex failed the very next write —
// INSERT INTO confirmation_attempts — and found the guest Trip showing
// CONFIRMED with zero real side effects behind it) and required a
// non-final claim state instead: deal_requests.status now NEVER changes
// from 'REQUESTED' until every real side effect has fully succeeded (see
// worker.js#handleAdminConfirmDealRequest and migration 0019). This test
// is updated to assert THAT — status stays 'REQUESTED', never a
// guest-visible lie — while everything else it originally proved
// (partial rollback still recorded as ROLLBACK_FAILED, the other two
// compensating steps still complete independently, reconciliation is
// needed) is unchanged and still exercised.
test('finding 3: when a COMPENSATING write itself fails, the request is NOT silently marked safe — it is flagged for manual reconciliation, durably', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });

  // Force the MAIN operation to fail (as above), AND force the
  // allocation-release step of rollback() to also fail — reproducing
  // "failure during compensation" on top of the original failure.
  const doublyFailingEnv = {
    ...env,
    __TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__: () => { throw new Error('INJECTED_LATE_FAILURE'); },
    __TEST_FAIL_ROLLBACK_STEP__: 'allocation',
  };
  const failed = await call(doublyFailingEnv, `/preview/admin/deal-requests/${requested.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(failed.status, 500);
  assert.equal(failed.data.reconciliation_needed, true, 'a partially-failed rollback must say reconciliation is needed, never that it is safe to retry');

  const attempts = await env.DB.prepare('SELECT * FROM confirmation_attempts WHERE request_id = ?').bind(requested.data.request_id).all();
  assert.equal(attempts.results[0].phase, 'ROLLBACK_FAILED');
  assert.match(attempts.results[0].error_detail, /allocation/);

  // deal_requests.status was NEVER changed from 'REQUESTED' in the first
  // place (round 4's fix) — there is nothing to "revert" here, and
  // critically the guest Trip never showed a false CONFIRMED at any
  // point. The durable confirmation_attempts row (asserted above) and the
  // still-held deal_decision_claims row (asserted next) are what tell a
  // human reconciliation is needed.
  const requestAfter = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(requestAfter.status, 'REQUESTED');

  const claim = await env.DB.prepare('SELECT * FROM deal_decision_claims WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.ok(claim, 'the claim must still be held — this is what blocks a further attempt until admin reconciliation');

  // Offer status and the movement claim — the OTHER two compensating
  // steps — must still have been reverted even though the allocation
  // release specifically failed (each step is independently try/caught).
  const offerAfter = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offer.offer_id).first();
  assert.equal(offerAfter.status, 'ACTIVE', 'a failure in ONE compensating step must not block the OTHERS from completing');
  const claims = await env.DB.prepare('SELECT * FROM vehicle_time_claims').all();
  assert.equal(claims.results.length, 0);

  // The allocation itself IS still present (that's the one step that
  // failed to release) — the durable record is what tells a human this.
  const allocations = await env.DB.prepare('SELECT * FROM vehicle_allocations').all();
  assert.equal(allocations.results.length, 1);
});

test('finding 3: a rollback failure on ONE request never touches a completely unrelated offer/request', async () => {
  const env = makeEnv();
  const { offer: offerA } = await seedActiveOffer(env);
  const { offer: offerB } = await seedActiveOffer(env);
  const guestA = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requestA = await call(env, `/preview/deals/${offerA.offer_id}/request`, { method: 'POST', headers: authed(guestA.data.access_token) });
  const guestB = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requestB = await call(env, `/preview/deals/${offerB.offer_id}/request`, { method: 'POST', headers: authed(guestB.data.access_token) });

  const doublyFailingEnv = {
    ...env,
    __TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__: () => { throw new Error('INJECTED'); },
    __TEST_FAIL_ROLLBACK_STEP__: 'offer_status',
  };
  await call(doublyFailingEnv, `/preview/admin/deal-requests/${requestA.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });

  // offerB and requestB were never touched by this instruction and must
  // still confirm cleanly.
  const confirmB = await call(env, `/preview/admin/deal-requests/${requestB.data.request_id}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirmB.status, 200);
});

// =======================================================================
// 6. confirmed_unallocated REQUIRES AN EXPLICIT OPERATIONAL DECISION
// Until approved, an unallocated booking confirmation is refused and the
// booking stays pending, rather than silently introducing a new status.
// =======================================================================

test('finding 6: confirming an ordinary booking with NO recorded vehicle is refused and the booking stays pending', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const bookingId = (await call(env, '/preview/trip', { headers: authed(created.data.access_token) })).data.bookings[0].id;

  const confirm = await call(env, `/preview/admin/bookings/${bookingId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirm.status, 409);
  assert.equal(confirm.data.error, 'VEHICLE_ALLOCATION_DECISION_PENDING');

  const booking = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(bookingId).first();
  assert.equal(booking.status, 'pending', 'the booking must remain pending, never silently confirmed under any status');
});
