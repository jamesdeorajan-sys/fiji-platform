/* Marau Stage 1 (PREVIEW ONLY) — regressions for the seventh independent
 * review ("MARAU — COMPLETE CONFIRMATION AND RECOVERY LIFECYCLE", of
 * commit 973bac2, which verified 356/356 and confirmed no shared-engine
 * changes). Reproduces BOTH new fault injections with REAL SQL (SQLite
 * triggers, not JS hooks), asserting complete database state — not just
 * response codes — then proves the fixes close them while preserving the
 * round-6 reproductions. See docs/MARAU_STAGE1_CODEX_FIXES_ROUND7.md for
 * the full write-up.
 *
 * All evidence here is against test/d1_sqlite_shim.mjs (a real SQLite
 * engine enforcing real constraints, including real triggers), kept
 * explicitly distinct from any deployed Cloudflare D1 evidence — none
 * exists for this branch.
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

async function dbState(env, requestId, offerId) {
  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  const offer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offerId).first();
  const allocations = await env.DB.prepare(`SELECT * FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?`).bind(requestId).all();
  const claims = await env.DB.prepare('SELECT * FROM vehicle_time_claims WHERE claimed_by_request_id = ?').bind(requestId).all();
  const decisionClaim = await env.DB.prepare('SELECT * FROM deal_decision_claims WHERE request_id = ?').bind(requestId).first();
  return {
    requestStatus: dealRequest.status,
    offerStatus: offer.status,
    allocationCount: allocations.results.length,
    claimCount: claims.results.length,
    decisionClaim,
  };
}

// =======================================================================
// NEW FAULT INJECTION 1 — POST-CONFIRMATION AUDIT FAILURE
// A real SQLite trigger rejects UPDATE confirmation_attempts when
// NEW.phase='DONE'. Confirm a valid request.
// Reported result: HTTP 500 "fully rolled back — safe to retry",
// reconciliation_needed; but ACTUALLY request CONFIRMED, offer ACTIVE,
// allocations 0, movement claims 0, decision claims 0 — a real
// confirmation whose supporting resources were wrongly compensated away
// AND whose response lied about what happened.
// =======================================================================

test('post-confirmation audit failure: a real trigger blocking the phase=DONE audit write must NEVER trigger pre-confirmation compensation, and the response must be truthful', async () => {
  const env = makeEnv();
  const { offer, requestId } = await createAndRequestDeal(env);

  // Real SQL fault injection — exactly as specified: a trigger rejecting
  // the UPDATE only when it would set phase='DONE'.
  env.DB.exec(`
    CREATE TRIGGER reject_phase_done
    BEFORE UPDATE ON confirmation_attempts
    WHEN NEW.phase = 'DONE'
    BEGIN SELECT RAISE(ABORT, 'test-injected: phase=DONE update rejected'); END;
  `);

  const confirm = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });

  // THE fix: the response must be TRUTHFUL. The confirmation genuinely
  // committed — this must be reported as success (200 CONFIRMED, with an
  // honest audit_warning), never as a 500 "rolled back" that didn't
  // actually happen.
  assert.equal(confirm.status, 200, 'the confirmation genuinely committed and must be reported as such');
  assert.equal(confirm.data.status, 'CONFIRMED');
  assert.ok(confirm.data.audit_warning, 'must honestly disclose that the audit record could not be finalized');

  // THE exact defect: once confirmation commits, an audit failure must
  // NEVER trigger pre-confirmation compensation. Every real resource
  // must remain exactly as the successful confirmation left it.
  const state = await dbState(env, requestId, offer.offer_id);
  assert.equal(state.requestStatus, 'CONFIRMED', 'must be CONFIRMED, not reverted');
  assert.equal(state.offerStatus, 'FILLED', 'the offer must remain FILLED, never reverted to ACTIVE');
  assert.equal(state.allocationCount, 1, 'the allocation must NOT have been released');
  assert.equal(state.claimCount, 1, 'the movement claim must NOT have been deleted');
  assert.ok(state.decisionClaim, 'the decision claim must NOT have been deleted');

  env.DB.exec('DROP TRIGGER reject_phase_done;');

  // Audit-repair behaviour: reconcile-confirmation, called on this
  // already-CONFIRMED request, must repair the stuck journal phase as a
  // pure, resource-free label fix — never touching the (already correct)
  // resource state again.
  const reconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcile.status, 200);
  assert.equal(reconcile.data.resolved, 'ALREADY_TERMINAL');
  assert.equal(reconcile.data.audit_repaired, true);

  const attempt = await env.DB.prepare('SELECT * FROM confirmation_attempts WHERE request_id = ?').bind(requestId).first();
  assert.equal(attempt.phase, 'DONE', 'the audit repair must fix the phase label');

  const stateAfterRepair = await dbState(env, requestId, offer.offer_id);
  assert.equal(stateAfterRepair.requestStatus, 'CONFIRMED');
  assert.equal(stateAfterRepair.offerStatus, 'FILLED');
  assert.equal(stateAfterRepair.allocationCount, 1);
  assert.equal(stateAfterRepair.claimCount, 1);
});

// =======================================================================
// NEW FAULT INJECTION 2 — RECOVERY RETRY LOSES ORIGINAL ATTEMPT IDENTITY
// Pause confirmation after hold. Block HELD->ACTIVE with a real SQLite
// trigger. Run reconciliation: it fails. Remove the trigger and
// reconcile again.
// Reported result: HTTP 200 ROLLED_BACK_TO_REQUESTED, but the offer
// remains HELD and the decision claim is deleted — a "successful"
// recovery that left a phantom HELD offer with no claim left to ever
// find or fix it again.
// =======================================================================

test('recovery retry: a SECOND reconcile call, after a FIRST one failed mid-compensation due to a real trigger, must still find and finish the SAME journal/resources — never lose them', async () => {
  const env = makeEnv();
  const { offer, requestId } = await createAndRequestDeal(env);

  let releasePause;
  const pausePromise = new Promise((resolve) => { releasePause = resolve; });
  const pausingEnv = { ...env, __TEST_PAUSE_AFTER_HOLD__: () => pausePromise };
  const confirmPromise = call(pausingEnv, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const midFlightOffer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offer.offer_id).first();
  assert.equal(midFlightOffer.status, 'HELD', 'precondition: the offer is genuinely HELD at the pause point');

  // Real SQL fault injection: block the HELD->ACTIVE revert specifically.
  env.DB.exec(`
    CREATE TRIGGER reject_held_to_active
    BEFORE UPDATE ON smart_offers
    WHEN OLD.status = 'HELD' AND NEW.status = 'ACTIVE'
    BEGIN SELECT RAISE(ABORT, 'test-injected: HELD->ACTIVE revert rejected'); END;
  `);

  const firstReconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(firstReconcile.status, 500);
  assert.equal(firstReconcile.data.resolved, 'RECONCILIATION_FAILED');

  // The exact defect's precondition: after the FIRST reconcile's failed
  // attempt, the offer must still genuinely be HELD, and the claim must
  // still exist (not yet deleted) — the first attempt correctly refused
  // to pretend it succeeded.
  const midFlightAfterFirstReconcile = await dbState(env, requestId, offer.offer_id);
  assert.equal(midFlightAfterFirstReconcile.offerStatus, 'HELD');
  assert.ok(midFlightAfterFirstReconcile.decisionClaim, 'the claim must still exist after a FAILED reconcile — nothing was resolved yet');

  env.DB.exec('DROP TRIGGER reject_held_to_active;');

  const secondReconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(secondReconcile.status, 200);
  assert.equal(secondReconcile.data.resolved, 'ROLLED_BACK_TO_REQUESTED');

  // THE exact defect: the second reconcile must have ACTUALLY reverted
  // the offer — not just reported success while leaving it HELD.
  const stateAfterSecondReconcile = await dbState(env, requestId, offer.offer_id);
  assert.equal(stateAfterSecondReconcile.offerStatus, 'ACTIVE', 'the offer must be genuinely reverted to ACTIVE, not left phantom-HELD');
  assert.equal(stateAfterSecondReconcile.allocationCount, 0);
  assert.equal(stateAfterSecondReconcile.claimCount, 0);
  assert.equal(stateAfterSecondReconcile.decisionClaim, null, 'the claim is correctly freed only now that the resources it guarded are genuinely gone');

  // Release the paused original — it must find it lost ownership and
  // abort, writing nothing further (unaffected by this specific fix, but
  // confirms the whole lifecycle stays consistent end-to-end).
  releasePause();
  const originalResult = await confirmPromise;
  assert.equal(originalResult.status, 409);

  // And a fresh confirm now succeeds cleanly.
  const retry = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.status, 'CONFIRMED');
});

// =======================================================================
// BROADER COVERAGE — staggered reconcilers, and compensation proving
// ownership of the SPECIFIC resource being undone (not merely ownership
// of the request).
// =======================================================================

test('staggered reconcilers: a SECOND reconciler racing in AFTER a first one has already taken ownership (but before it finishes) must never also compensate — exactly one recovery happens', async () => {
  const env = makeEnv();
  const { offer, requestId } = await createAndRequestDeal(env);

  let releasePause;
  const pausePromise = new Promise((resolve) => { releasePause = resolve; });
  const pausingEnv = { ...env, __TEST_PAUSE_AFTER_HOLD__: () => pausePromise };
  const confirmPromise = call(pausingEnv, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  await new Promise((resolve) => setTimeout(resolve, 10));

  // First reconciler takes ownership and completes normally.
  const firstReconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(firstReconcile.data.resolved, 'ROLLED_BACK_TO_REQUESTED');

  // A staggered SECOND call arrives after the first already fully
  // resolved and freed the claim — must find nothing left to do.
  const secondReconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(secondReconcile.data.resolved, 'NOTHING_TO_RECONCILE');

  releasePause();
  await confirmPromise;

  const state = await dbState(env, requestId, offer.offer_id);
  assert.equal(state.offerStatus, 'ACTIVE');
  assert.equal(state.allocationCount, 0);
  assert.equal(state.claimCount, 0);
});

test('compensation proves ownership of the SPECIFIC resource being undone: reconciling one request never releases a DIFFERENT request’s allocation even if triggered while both are mid-flight', async () => {
  const env = makeEnv();
  const { requestId: requestA, offer: offerA } = await createAndRequestDeal(env);
  const { requestId: requestB, offer: offerB } = await createAndRequestDeal(env);

  let releasePauseA;
  const pauseA = new Promise((resolve) => { releasePauseA = resolve; });
  const envA = { ...env, __TEST_PAUSE_AFTER_HOLD__: () => pauseA };
  const confirmAPromise = call(envA, `/preview/admin/deal-requests/${requestA}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  await new Promise((resolve) => setTimeout(resolve, 10));

  // B confirms fully and normally while A is still paused.
  const confirmB = await call(env, `/preview/admin/deal-requests/${requestB}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirmB.status, 200);

  // Reconcile A — must only ever touch A's own allocation/claim/offer.
  const reconcileA = await call(env, `/preview/admin/deal-requests/${requestA}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcileA.data.resolved, 'ROLLED_BACK_TO_REQUESTED');
  releasePauseA();
  await confirmAPromise;

  const stateB = await dbState(env, requestB, offerB.offer_id);
  assert.equal(stateB.requestStatus, 'CONFIRMED');
  assert.equal(stateB.offerStatus, 'FILLED');
  assert.equal(stateB.allocationCount, 1, 'B’s own allocation must be completely untouched by reconciling A');
  assert.equal(stateB.claimCount, 1);

  const stateA = await dbState(env, requestA, offerA.offer_id);
  assert.equal(stateA.offerStatus, 'ACTIVE');
  assert.equal(stateA.allocationCount, 0);
});

test('preserves the round-6 reproductions: both original repros still close correctly after this round’s changes', async () => {
  // Repro 1 (round 6): pause before the allocation INSERT.
  const env1 = makeEnv();
  const { offer: offer1, requestId: requestId1 } = await createAndRequestDeal(env1);
  let release1;
  const pause1 = new Promise((resolve) => { release1 = resolve; });
  const env1p = { ...env1, __TEST_PAUSE_BEFORE_ALLOCATION__: () => pause1 };
  const confirm1 = call(env1p, `/preview/admin/deal-requests/${requestId1}/confirm`, { method: 'POST', headers: authed(env1.MARAU_ADMIN_TEST_TOKEN) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const reconcile1 = await call(env1, `/preview/admin/deal-requests/${requestId1}/reconcile-confirmation`, { method: 'POST', headers: authed(env1.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcile1.data.resolved, 'ROLLED_BACK_TO_REQUESTED');
  release1();
  await confirm1;
  const state1 = await dbState(env1, requestId1, offer1.offer_id);
  assert.equal(state1.allocationCount, 0);

  // Repro 2 (round 6): pause before the journal INSERT.
  const env2 = makeEnv();
  const { requestId: requestId2 } = await createAndRequestDeal(env2);
  let release2;
  const pause2 = new Promise((resolve) => { release2 = resolve; });
  const env2p = { ...env2, __TEST_PAUSE_AFTER_CLAIM_BEFORE_JOURNAL__: () => pause2 };
  const confirm2 = call(env2p, `/preview/admin/deal-requests/${requestId2}/confirm`, { method: 'POST', headers: authed(env2.MARAU_ADMIN_TEST_TOKEN) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const reconcile2 = await call(env2, `/preview/admin/deal-requests/${requestId2}/reconcile-confirmation`, { method: 'POST', headers: authed(env2.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcile2.data.resolved, 'ROLLED_BACK_TO_REQUESTED');
  const decline2 = await call(env2, `/preview/admin/deal-requests/${requestId2}/decline`, { method: 'POST', headers: authed(env2.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(decline2.status, 200);
  release2();
  const confirm2Result = await confirm2;
  assert.notEqual(confirm2Result.status, 200);
});
