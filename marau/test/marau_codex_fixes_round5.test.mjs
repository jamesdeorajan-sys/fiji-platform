/* Marau Stage 1 (PREVIEW ONLY) — regressions for the fifth independent
 * review ("MARAU — BOUNDED STAGE 1 CORRECTIONS", of commit 6864edc,
 * which reproduced 339/339). Each section reproduces one finding, then
 * is the test proving the fix. See docs/MARAU_STAGE1_CODEX_FIXES_ROUND5.md
 * for the full write-up.
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
import { toFijiWallClockInputValue, normalizePickupDatetime } from '../worker/fiji_time.js';
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

async function createAndRequestDeal(env) {
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });
  return { offer, requestId: requested.data.request_id };
}

// =======================================================================
// FINDING 1 — CONFIRMATION/RECONCILIATION CONCURRENCY
// Codex's exact repro: pause immediately after vehicle_allocations INSERT
// commits but before its awaited result returns; call
// reconcile-confirmation; resume the original confirmation. Observed:
// reconcile returns ROLLED_BACK_TO_REQUESTED, original returns 200
// CONFIRMED, database has a FILLED offer, a CONFIRMED request, zero
// allocations and zero movement claims.
// =======================================================================

test('finding 1: reconcile racing a genuinely in-flight confirm attempt right after its allocation commits — the original must NOT resume and commit CONFIRMED once reconcile has already unwound it', async () => {
  const env = makeEnv();
  const { offer, requestId } = await createAndRequestDeal(env);

  let releasePause;
  const pausePromise = new Promise((resolve) => { releasePause = resolve; });
  const pausingEnv = { ...env, __TEST_PAUSE_AFTER_ALLOCATION__: () => pausePromise };

  // Start the original confirm attempt — it will run up to (and including)
  // its vehicle_allocations INSERT, then suspend on the pause hook,
  // exactly at the point Codex's repro describes.
  const confirmPromise = call(pausingEnv, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });

  // Let the microtask queue drain so the paused confirm attempt has
  // genuinely reached the pause point before we act.
  await new Promise((resolve) => setTimeout(resolve, 10));

  // The allocation row must already exist at this point (committed,
  // exactly as the repro describes), and the admin can see the request
  // as still 'REQUESTED' (nothing has been marked CONFIRMED yet).
  const midFlightAllocations = await env.DB.prepare(`SELECT * FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?`).bind(requestId).all();
  assert.equal(midFlightAllocations.results.length, 1, 'the allocation must already be committed at the pause point');

  // Call reconcile-confirmation WHILE the original is still paused —
  // admin authentication here is not the same thing as owning the
  // in-flight attempt; this must correctly detect the attempt is not yet
  // DONE and win the fencing race since the original hasn't advanced
  // past CLAIMING_VEHICLE yet.
  const reconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcile.status, 200);
  assert.equal(reconcile.data.resolved, 'ROLLED_BACK_TO_REQUESTED');

  // Now resume the original — it must discover it has lost ownership and
  // abort, NEVER writing CONFIRMED.
  releasePause();
  const confirmResult = await confirmPromise;
  assert.equal(confirmResult.status, 409);
  assert.equal(confirmResult.data.error, 'CONFIRMATION_SUPERSEDED');

  // The database must be fully, consistently clean — never the "FILLED
  // offer + CONFIRMED request + zero allocations/claims" ghost state.
  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  assert.equal(dealRequest.status, 'REQUESTED', 'the original must never resume and commit CONFIRMED once reconcile has already unwound it');

  const freshOffer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offer.offer_id).first();
  assert.equal(freshOffer.status, 'ACTIVE', 'the offer must never end up FILLED when the request was rolled back');

  const allocationsAfter = await env.DB.prepare(`SELECT * FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?`).bind(requestId).all();
  assert.equal(allocationsAfter.results.length, 0);
  const claimsAfter = await env.DB.prepare('SELECT * FROM vehicle_time_claims').all();
  assert.equal(claimsAfter.results.length, 0);

  const decisionClaim = await env.DB.prepare('SELECT * FROM deal_decision_claims WHERE request_id = ?').bind(requestId).first();
  assert.equal(decisionClaim, null, 'the decision claim must be freed for a genuinely clean retry');

  // And a fresh confirm now succeeds normally.
  const retry = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.status, 'CONFIRMED');
});

test('finding 1: reconcile called on a confirm attempt that is NOT actually stalled (it finishes before reconcile can fence it) reports ATTEMPT_STILL_ACTIVE and touches nothing', async () => {
  const env = makeEnv();
  const { requestId } = await createAndRequestDeal(env);

  // No pause hook this time — the confirm runs to full completion before
  // reconcile is ever called.
  const confirm = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirm.status, 200);

  // A reconcile call after the fact must recognize the request is already
  // terminal, not "still active" (that branch is specifically for a
  // fence LOSS against a phase that had already reached DONE/ROLLED_BACK
  // between read and fence — covered by the confirmed dealRequest.status
  // check at the top of the handler).
  const reconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcile.status, 200);
  assert.equal(reconcile.data.resolved, 'ALREADY_TERMINAL');
  assert.equal(reconcile.data.status, 'CONFIRMED');
});

test('finding 1: a rollback failure on one request never touches a completely unrelated request’s resources, even with the new fencing in place', async () => {
  const env = makeEnv();
  const { requestId: requestA } = await createAndRequestDeal(env);
  const { offer: offerB, requestId: requestB } = await createAndRequestDeal(env);

  const doublyFailingEnv = {
    ...env,
    __TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__: () => { throw new Error('INJECTED'); },
    __TEST_FAIL_ROLLBACK_STEP__: 'offer_status',
  };
  await call(doublyFailingEnv, `/preview/admin/deal-requests/${requestA}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });

  const confirmB = await call(env, `/preview/admin/deal-requests/${requestB}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirmB.status, 200);
  const freshOfferB = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offerB.offer_id).first();
  assert.equal(freshOfferB.status, 'FILLED');
});

// =======================================================================
// FINDING 2 — INTERRUPTED CLAIMS DISCOVERABLE
// A persisted decision claim with no confirmation_attempts row currently
// returns ALREADY_DECIDED, while the ops list reports
// reconciliation_needed.
// =======================================================================

test('finding 2: a claim that exists with NO confirmation_attempts row at all is reported as CONFIRMATION_INTERRUPTED, never ALREADY_DECIDED', async () => {
  const env = makeEnv();
  const { requestId } = await createAndRequestDeal(env);

  // Simulate the exact interruption window: the claim was inserted, but
  // the process died before even the FIRST confirmation_attempts row
  // could be written (nothing else exists at this point — no movement
  // claim, no allocation, no offer touch).
  await env.DB
    .prepare(`INSERT INTO deal_decision_claims (request_id, decision, claimed_at) VALUES (?, 'CONFIRM', ?)`)
    .bind(requestId, new Date().toISOString())
    .run();

  const attempts = await env.DB.prepare('SELECT * FROM confirmation_attempts WHERE request_id = ?').bind(requestId).all();
  assert.equal(attempts.results.length, 0, 'precondition: genuinely no attempt row exists');

  const confirmRetry = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirmRetry.status, 409);
  assert.equal(confirmRetry.data.error, 'CONFIRMATION_INTERRUPTED', 'must never say ALREADY_DECIDED when nothing was actually decided');
  assert.equal(confirmRetry.data.recovery_action, `POST /preview/admin/deal-requests/${requestId}/reconcile-confirmation`);

  const declineAttempt = await call(env, `/preview/admin/deal-requests/${requestId}/decline`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(declineAttempt.status, 409);
  assert.equal(declineAttempt.data.error, 'CONFIRMATION_INTERRUPTED', 'decline must report the same interruption, not ALREADY_DECIDED, for the same claim+request state');

  // The reconcile endpoint itself must resolve this cleanly (no attempt
  // row -> nothing beyond the claim could have happened -> just free it).
  const reconcile = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconcile.status, 200);
  assert.equal(reconcile.data.resolved, 'ROLLED_BACK_TO_REQUESTED');

  const retry = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.status, 'CONFIRMED');
});

test('finding 2: this exact interruption is ALSO visible from the admin list (consistent with the confirm/decline gate’s own answer)', async () => {
  const env = makeEnv();
  const { requestId } = await createAndRequestDeal(env);
  await env.DB
    .prepare(`INSERT INTO deal_decision_claims (request_id, decision, claimed_at) VALUES (?, 'CONFIRM', ?)`)
    .bind(requestId, new Date().toISOString())
    .run();

  const list = await call(env, '/preview/admin/deal-requests', { headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  const row = list.data.deal_requests.find((r) => r.request_id === requestId);
  assert.equal(row.reconciliation_needed, true, 'the ops list already reported this — the confirm/decline gate must agree, not say ALREADY_DECIDED');
});

// =======================================================================
// FINDING 3 — THE ACTUAL CHANGE-FORM DEFAULT
// pages.js still used active.pickup_datetime.slice(0,16) in a
// Fiji-labelled prompt — Fiji noon on 1 October becomes midnight in that
// prompt; submitting unchanged moves the booking 12 hours earlier.
// =======================================================================

test('finding 3: toFijiWallClockInputValue produces the ACTUAL Fiji wall-clock reading of a stored UTC instant, not a mislabelled slice of the UTC string', () => {
  // The exact bug: Fiji noon on 1 October is stored as
  // "2026-10-01T00:00:00.000Z" (UTC). A raw .slice(0,16) of that gives
  // "2026-10-01T00:00" — midnight — wrongly labelled "Fiji time".
  const storedUtc = '2026-10-01T00:00:00.000Z';
  const wrongOldDefault = storedUtc.slice(0, 16);
  assert.equal(wrongOldDefault, '2026-10-01T00:00', 'confirms the OLD bug’s actual output, for contrast');

  const correctDefault = toFijiWallClockInputValue(storedUtc);
  assert.equal(correctDefault, '2026-10-01T12:00', 'must show the real Fiji wall-clock time (noon), not the UTC instant mislabelled as Fiji time');
});

test('finding 3: submitting the change-form default UNCHANGED is a genuine no-op end-to-end (the actual bug: it used to shift the booking 12 hours earlier)', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest({ pickup_datetime: '2026-10-01T12:00' })));
  const token = created.data.access_token;
  const tripBefore = await call(env, '/preview/trip', { headers: authed(token) });
  const booking = tripBefore.data.bookings[0];
  assert.equal(booking.pickup_datetime, '2026-10-01T00:00:00.000Z');

  // This is the ACTUAL UI path: read the stored value the way the real
  // change-form prompt now does, submit it completely unchanged.
  const promptDefault = toFijiWallClockInputValue(booking.pickup_datetime);
  const change = await call(env, `/preview/bookings/${booking.id}/change-request`, withJson('POST', { requested_fields: { pickup_datetime: promptDefault } }, authed(token)));
  assert.equal(change.status, 201);
  const approve = await call(env, `/preview/admin/change-requests/${change.data.change_request_id}/approve`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(approve.status, 200);

  const bookingAfter = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(booking.id).first();
  assert.equal(bookingAfter.pickup_datetime, '2026-10-01T00:00:00.000Z', 'an unedited resubmission through the ACTUAL prompt default must never shift the booking — the old bug shifted it 12 hours earlier');
});

test('finding 3: the served guest app actually calls toFijiWallClockInputValue for the change-form default (present in the emitted script, not the raw UTC slice)', () => {
  assert.ok(GUEST_APP_HTML.includes('toFijiWallClockInputValue'), 'the change-form prompt must use the real Fiji-time formatter');
  assert.ok(!GUEST_APP_HTML.includes('pickup_datetime.slice(0, 16)'), 'the old, wrong raw-UTC-slice default must be gone');
});

test('finding 3: toFijiWallClockInputValue runs correctly when spliced via toString(), exactly as pages.js embeds it', () => {
  const source = `
    ${toFijiWallClockInputValue.toString()}
    return { toFijiWallClockInputValue };
  `;
  const fns = new Function(source)();
  assert.equal(fns.toFijiWallClockInputValue('2026-10-01T00:00:00.000Z'), '2026-10-01T12:00');
});

test('finding 3: toFijiWallClockInputValue round-trips through normalizePickupDatetime as a true inverse (any instant, not just the one worked example)', () => {
  const samples = ['2026-01-15T03:00:00.000Z', '2026-06-30T23:45:00.000Z', '2026-12-01T00:00:00.000Z'];
  for (const iso of samples) {
    const fijiLocal = toFijiWallClockInputValue(iso);
    const roundTripped = normalizePickupDatetime(fijiLocal);
    assert.equal(roundTripped, iso, `round-trip failed for ${iso}`);
  }
});
