/* Marau Stage 1 (PREVIEW ONLY) — regressions for the sixth independent
 * review ("MARAU — RESUME OWNERSHIP FIX", of commit a0bf43b, which
 * verified 349/349). Reproduces BOTH exact Codex repros (the round-5
 * phase-CAS fencing design closed the round-5 repro but left these two
 * real gaps: fencing the observational phase column instead of the
 * actual resource-mutating statements themselves), then proves the
 * statement-level attempt_token ownership design closes both — asserting
 * complete database invariants, not just response codes. See
 * docs/MARAU_STAGE1_CODEX_FIXES_ROUND6.md for the full write-up.
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

async function createAndRequestDeal(env) {
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });
  return { offer, requestId: requested.data.request_id };
}

async function assertCompleteDbInvariants(env, { requestId, offerId, expectedRequestStatus, expectedOfferStatus, expectedAllocations, expectedMovementClaims, expectClaimFreed }) {
  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  assert.equal(dealRequest.status, expectedRequestStatus, 'deal_requests.status');

  const offer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offerId).first();
  assert.equal(offer.status, expectedOfferStatus, 'smart_offers.status');

  const allocations = await env.DB.prepare(`SELECT * FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?`).bind(requestId).all();
  assert.equal(allocations.results.length, expectedAllocations, 'vehicle_allocations count');

  const claims = await env.DB.prepare('SELECT * FROM vehicle_time_claims WHERE claimed_by_request_id = ?').bind(requestId).all();
  assert.equal(claims.results.length, expectedMovementClaims, 'vehicle_time_claims count');

  const decisionClaim = await env.DB.prepare('SELECT * FROM deal_decision_claims WHERE request_id = ?').bind(requestId).first();
  if (expectClaimFreed) {
    assert.equal(decisionClaim, null, 'deal_decision_claims row must be freed');
  } else {
    assert.ok(decisionClaim, 'deal_decision_claims row must still exist (deliberately held)');
  }
}

// =======================================================================
// REPRO 1 — pause BEFORE vehicle_allocations INSERT executes, after
// phase CLAIMING_VEHICLE. Reconcile, then resume.
// Reported result (round-5 design): 409 CONFIRMATION_SUPERSEDED, but one
// orphan allocation remains; request REQUESTED, offer ACTIVE, movement
// claims zero.
// =======================================================================

test('repro 1: pausing BEFORE the vehicle_allocations INSERT (after CLAIMING_VEHICLE), then reconciling, then resuming — must NEVER create an orphaned allocation', async () => {
  const env = makeEnv();
  const { offer, requestId } = await createAndRequestDeal(env);

  let releasePause;
  const pausePromise = new Promise((resolve) => { releasePause = resolve; });
  const pausingEnv = { ...env, __TEST_PAUSE_BEFORE_ALLOCATION__: () => pausePromise };

  const confirmPromise = call(pausingEnv, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Precondition: phase CLAIMING_VEHICLE reached, but genuinely NO
  // allocation exists yet at the pause point.
  const midFlightAllocations = await env.DB.prepare(`SELECT * FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?`).bind(requestId).all();
  assert.equal(midFlightAllocations.results.length, 0, 'precondition: no allocation exists yet at the pause point');
  const attempt = await env.DB.prepare('SELECT * FROM confirmation_attempts WHERE request_id = ?').bind(requestId).first();
  assert.equal(attempt.phase, 'CLAIMING_VEHICLE');

  const reconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcile.status, 200);
  assert.equal(reconcile.data.resolved, 'ROLLED_BACK_TO_REQUESTED');

  releasePause();
  const confirmResult = await confirmPromise;
  assert.equal(confirmResult.status, 409);
  assert.equal(confirmResult.data.error, 'CONFIRMATION_SUPERSEDED');

  // The exact defect: an orphaned allocation must NEVER exist.
  await assertCompleteDbInvariants(env, {
    requestId,
    offerId: offer.offer_id,
    expectedRequestStatus: 'REQUESTED',
    expectedOfferStatus: 'ACTIVE',
    expectedAllocations: 0,
    expectedMovementClaims: 0,
    expectClaimFreed: true,
  });

  // And a fresh confirm now succeeds normally, cleanly.
  const retry = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.status, 'CONFIRMED');
  const finalAllocations = await env.DB.prepare(`SELECT * FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?`).bind(requestId).all();
  assert.equal(finalAllocations.results.length, 1, 'exactly one allocation must exist after the successful retry — no duplicate/orphan from the earlier aborted attempt');
});

// =======================================================================
// REPRO 2 — pause BEFORE confirmation_attempts INSERT executes, after
// decision claim acquisition. Reconcile, then decline, then resume
// original confirm.
// Reported result (round-5 design): decline 200; original confirm 200
// CONFIRMED; actual request DECLINED, offer FILLED, allocation and
// movement claim present.
// =======================================================================

test('repro 2: pausing BEFORE the confirmation_attempts INSERT (right after claim acquisition), then reconciling, then declining, then resuming the original confirm — the original must NEVER complete and must NEVER mutate any resource', async () => {
  const env = makeEnv();
  const { offer, requestId } = await createAndRequestDeal(env);

  let releasePause;
  const pausePromise = new Promise((resolve) => { releasePause = resolve; });
  const pausingEnv = { ...env, __TEST_PAUSE_AFTER_CLAIM_BEFORE_JOURNAL__: () => pausePromise };

  const confirmPromise = call(pausingEnv, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Precondition: the decision claim exists and ownership (attempt_token)
  // IS established, but genuinely NO confirmation_attempts row exists yet
  // — "a claim without a journal."
  const midFlightClaim = await env.DB.prepare('SELECT * FROM deal_decision_claims WHERE request_id = ?').bind(requestId).first();
  assert.ok(midFlightClaim.attempt_token, 'precondition: ownership token IS established at the pause point');
  const midFlightAttempt = await env.DB.prepare('SELECT * FROM confirmation_attempts WHERE request_id = ?').bind(requestId).first();
  assert.equal(midFlightAttempt, null, 'precondition: genuinely no journal row exists yet at the pause point');

  const reconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcile.status, 200);
  assert.equal(reconcile.data.resolved, 'ROLLED_BACK_TO_REQUESTED');

  const decline = await call(env, `/preview/admin/deal-requests/${requestId}/decline`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(decline.status, 200);
  assert.equal(decline.data.status, 'DECLINED');

  releasePause();
  const confirmResult = await confirmPromise;
  // The original must NEVER report success once its ownership was taken
  // away — this is the exact defect: "original confirm 200 CONFIRMED"
  // must never happen again.
  assert.notEqual(confirmResult.status, 200, 'the resumed original confirm must NEVER report success');
  assert.equal(confirmResult.data.error, 'CONFIRMATION_SUPERSEDED');

  // The exact defect: request must be DECLINED (decline's real, honest
  // outcome), offer must NEVER have been filled, and NEITHER an
  // allocation NOR a movement claim may exist — the original's every
  // resource-mutating statement must have been refused outright by its
  // own ownership-fenced WHERE clause, never merely discovered stale
  // after the fact. The claim row itself is correctly LEFT IN PLACE
  // (never deleted) once a terminal decision (DECLINED here) is reached
  // — established behaviour from round 4, unaffected by this fix.
  await assertCompleteDbInvariants(env, {
    requestId,
    offerId: offer.offer_id,
    expectedRequestStatus: 'DECLINED',
    expectedOfferStatus: 'ACTIVE',
    expectedAllocations: 0,
    expectedMovementClaims: 0,
    expectClaimFreed: false,
  });
});

// =======================================================================
// BROADER COVERAGE — interruption around resource writes (both before
// AND after each awaited mutation), concurrent reconcilers, and
// preservation of other requests' resources.
// =======================================================================

test('interruption AFTER the vehicle_allocations INSERT (the round-5 case) still closes correctly under the new design', async () => {
  const env = makeEnv();
  const { offer, requestId } = await createAndRequestDeal(env);

  let releasePause;
  const pausePromise = new Promise((resolve) => { releasePause = resolve; });
  const pausingEnv = { ...env, __TEST_PAUSE_AFTER_ALLOCATION__: () => pausePromise };

  const confirmPromise = call(pausingEnv, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const midFlightAllocations = await env.DB.prepare(`SELECT * FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?`).bind(requestId).all();
  assert.equal(midFlightAllocations.results.length, 1, 'the allocation IS committed at this later pause point');

  const reconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcile.status, 200);
  assert.equal(reconcile.data.resolved, 'ROLLED_BACK_TO_REQUESTED');

  releasePause();
  const confirmResult = await confirmPromise;
  assert.equal(confirmResult.status, 409);
  assert.equal(confirmResult.data.error, 'CONFIRMATION_SUPERSEDED');

  await assertCompleteDbInvariants(env, {
    requestId,
    offerId: offer.offer_id,
    expectedRequestStatus: 'REQUESTED',
    expectedOfferStatus: 'ACTIVE',
    expectedAllocations: 0,
    expectedMovementClaims: 0,
    expectClaimFreed: true,
  });
});

test('interruption AFTER the offer is HELD but before it is FILLED — reconcile mid-flight, resumed original must never fill an offer it no longer owns', async () => {
  const env = makeEnv();
  const { offer, requestId } = await createAndRequestDeal(env);

  let releasePause;
  const pausePromise = new Promise((resolve) => { releasePause = resolve; });
  const pausingEnv = { ...env, __TEST_PAUSE_AFTER_HOLD__: () => pausePromise };

  const confirmPromise = call(pausingEnv, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const midFlightOffer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offer.offer_id).first();
  assert.equal(midFlightOffer.status, 'HELD', 'precondition: the offer IS held at this pause point');

  const reconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcile.status, 200);
  assert.equal(reconcile.data.resolved, 'ROLLED_BACK_TO_REQUESTED');

  releasePause();
  const confirmResult = await confirmPromise;
  assert.equal(confirmResult.status, 409);
  assert.equal(confirmResult.data.error, 'CONFIRMATION_SUPERSEDED');

  await assertCompleteDbInvariants(env, {
    requestId,
    offerId: offer.offer_id,
    expectedRequestStatus: 'REQUESTED',
    expectedOfferStatus: 'ACTIVE',
    expectedAllocations: 0,
    expectedMovementClaims: 0,
    expectClaimFreed: true,
  });
});

test('concurrent reconcilers: two simultaneous reconcile-confirmation calls on the same stalled attempt — exactly one performs the takeover and the unwind, never both', async () => {
  const env = makeEnv();
  const { offer, requestId } = await createAndRequestDeal(env);

  let releasePause;
  const pausePromise = new Promise((resolve) => { releasePause = resolve; });
  const pausingEnv = { ...env, __TEST_PAUSE_BEFORE_ALLOCATION__: () => pausePromise };
  const confirmPromise = call(pausingEnv, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const [reconcileA, reconcileB] = await Promise.all([
    call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) }),
    call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) }),
  ]);
  releasePause();
  await confirmPromise;

  const resolved = [reconcileA.data.resolved, reconcileB.data.resolved];
  const rolledBackCount = resolved.filter((r) => r === 'ROLLED_BACK_TO_REQUESTED').length;
  assert.equal(rolledBackCount, 1, 'exactly one reconciler must perform the actual takeover/unwind — never both, never zero');

  await assertCompleteDbInvariants(env, {
    requestId,
    offerId: offer.offer_id,
    expectedRequestStatus: 'REQUESTED',
    expectedOfferStatus: 'ACTIVE',
    expectedAllocations: 0,
    expectedMovementClaims: 0,
    expectClaimFreed: true,
  });
});

test('preservation of other requests’ resources: reconciling one stalled attempt never touches a completely unrelated request’s allocation, movement claim, or offer', async () => {
  const env = makeEnv();
  const { requestId: requestA } = await createAndRequestDeal(env);
  const { offer: offerB, requestId: requestB } = await createAndRequestDeal(env);

  // Confirm B fully and normally FIRST — a real, unrelated, terminal
  // resource footprint that must never be touched by anything done to A.
  const confirmB = await call(env, `/preview/admin/deal-requests/${requestB}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirmB.status, 200);

  let releasePause;
  const pausePromise = new Promise((resolve) => { releasePause = resolve; });
  const pausingEnv = { ...env, __TEST_PAUSE_BEFORE_ALLOCATION__: () => pausePromise };
  const confirmAPromise = call(pausingEnv, `/preview/admin/deal-requests/${requestA}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const reconcileA = await call(env, `/preview/admin/deal-requests/${requestA}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcileA.data.resolved, 'ROLLED_BACK_TO_REQUESTED');
  releasePause();
  await confirmAPromise;

  // B's resources must be completely untouched.
  const dealRequestB = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestB).first();
  assert.equal(dealRequestB.status, 'CONFIRMED');
  const freshOfferB = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offerB.offer_id).first();
  assert.equal(freshOfferB.status, 'FILLED');
  const allocationsB = await env.DB.prepare(`SELECT * FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?`).bind(requestB).all();
  assert.equal(allocationsB.results.length, 1);
  const claimsB = await env.DB.prepare('SELECT * FROM vehicle_time_claims WHERE claimed_by_request_id = ?').bind(requestB).all();
  assert.equal(claimsB.results.length, 1);
});

test('final-write affected-row count is actually checked: a request that reaches DECLINED between the offer being filled and the final write never reports CONFIRMED', async () => {
  // A direct, deterministic reproduction of the specific bug (not just
  // the full end-to-end repro above): force deal_requests.status to
  // 'DECLINED' via the test-only pause-after-hold hook, immediately
  // before the confirm handler's own final decisive UPDATE runs.
  const env = makeEnv();
  const { requestId } = await createAndRequestDeal(env);

  const flippingEnv = {
    ...env,
    __TEST_PAUSE_AFTER_HOLD__: async () => {
      await env.DB.prepare(`UPDATE deal_requests SET status = 'DECLINED' WHERE request_id = ?`).bind(requestId).run();
    },
  };
  const confirm = await call(flippingEnv, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.notEqual(confirm.status, 200, 'must never report CONFIRMED when the final write’s own affected-row count is zero');

  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  assert.equal(dealRequest.status, 'DECLINED', 'the actually-decided status must be preserved, never silently overwritten to CONFIRMED');
});
