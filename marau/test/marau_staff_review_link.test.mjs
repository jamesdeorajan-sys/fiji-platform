/* Marau Stage 1 (PREVIEW ONLY) — round 19: the approved staff workflow.
 * A booking-specific "Review and confirm" link, meant to ride inside the
 * existing detailed WhatsApp alert (still fully mocked here). Opening
 * the link (GET) must never confirm anything; only an explicit POST
 * decides, and it must reuse the existing admin confirm/decline
 * handlers rather than duplicate their logic.
 *
 * P0 FIX (round 20): round 19 returned the review token DIRECTLY to the
 * guest who created the request — a complete staff-authorization bypass
 * (the guest could decide their own request). Fixed: the token is never
 * in the guest-facing response; it is surfaced ONLY via the
 * admin-token-gated /preview/admin/deal-requests listing, and deciding
 * now ALSO requires real staff authentication (the admin bearer token),
 * not mere possession of the review token. Every test below reflects
 * the corrected flow; the P0 itself is asserted directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, seedActiveOffer, synthGuest } from './fixtures.mjs';
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

async function bookAndRequestDeal(env) {
  const { movement, offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const token = created.data.access_token;
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(token) });
  return { movement, offer, token, requested };
}

// Staff (admin) fetches the review link the ONLY correct way — via the
// admin-token-gated list, never from the guest's own response.
async function fetchReviewLinkAsStaff(env, requestId) {
  const list = await call(env, '/preview/admin/deal-requests', { headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  const row = list.data.deal_requests.find((r) => r.request_id === requestId);
  return row && row.review_link;
}
function tokenFromLink(link) {
  return new URL(link).searchParams.get('token');
}

// ---------------------------------------------------------------------
// P0 (round 20): the review token must never reach the guest.
// ---------------------------------------------------------------------

test('P0: the guest-facing response to requesting a deal NEVER contains a review token or review_link, anywhere in the payload', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  assert.equal(requested.status, 201);
  const serialized = JSON.stringify(requested.data);
  assert.ok(!serialized.includes('review_link'), 'the guest response must not contain a review_link field at all');
  assert.ok(!/review_[0-9a-f-]{8,}/i.test(serialized), 'the guest response must not contain a review token value in any form');
  assert.equal(requested.data.whatsapp_handoff.review_link, undefined);
});

test('P0: the review link IS available to staff, via the admin-token-gated listing only', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const reviewLink = await fetchReviewLinkAsStaff(env, requested.data.request_id);
  assert.ok(reviewLink, 'staff must be able to see the review link via the admin listing');
  assert.ok(reviewLink.includes('/preview/staff/review?token='));

  const unauth = await call(env, '/preview/admin/deal-requests');
  assert.equal(unauth.status, 401, 'the listing that carries the review link must itself require the admin token');
});

test('P0: a guest who somehow obtained a review token still cannot decide — deciding requires real staff authentication, not mere token possession', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const reviewLink = await fetchReviewLinkAsStaff(env, requested.data.request_id);
  const token = tokenFromLink(reviewLink);

  // Simulate a guest who somehow got the token (e.g. from a compromised
  // link) attempting to decide WITHOUT any staff credential.
  const attempt = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm' }));
  assert.equal(attempt.status, 401);
  const row = await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(row.status, 'REQUESTED', 'the request must remain undecided without real staff authentication');
});

// ---------------------------------------------------------------------
// The corrected flow, end to end.
// ---------------------------------------------------------------------

test('opening the review link (GET, no auth required) NEVER confirms or declines anything', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const reviewLink = await fetchReviewLinkAsStaff(env, requested.data.request_id);
  const token = tokenFromLink(reviewLink);

  const page = await call(env, `/preview/staff/review?token=${token}`);
  assert.equal(page.status, 200);
  assert.ok(String(page.data).includes('Confirm'));
  assert.ok(String(page.data).includes('staff token'));

  const row = await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(row.status, 'REQUESTED', 'merely opening the page must never change the request status');
});

test('a POST confirm WITH valid staff authentication (Authorization header) decides via the EXISTING admin confirm handler', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const reviewLink = await fetchReviewLinkAsStaff(env, requested.data.request_id);
  const token = tokenFromLink(reviewLink);

  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(decide.status, 200);
  const row = await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(row.status, 'CONFIRMED');

  // The same real vehicle-allocation side effects the ordinary admin
  // confirm endpoint produces must have happened too (proves this is a
  // genuine reuse of the existing handler, not a separate, thinner path).
  const { results: allocations } = await env.DB.prepare('SELECT * FROM vehicle_allocations').all();
  assert.equal(allocations.length, 1);
});

test('a POST confirm WITH valid staff authentication via the form\'s own admin_token field also works (the plain HTML page cannot set an Authorization header)', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const reviewLink = await fetchReviewLinkAsStaff(env, requested.data.request_id);
  const token = tokenFromLink(reviewLink);

  const form = new URLSearchParams({ token, decision: 'confirm', admin_token: env.MARAU_ADMIN_TEST_TOKEN, operator: 'ops-1' });
  const decide = await call(env, '/preview/staff/review/decide', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  assert.equal(decide.status, 200);
  const row = await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(row.status, 'CONFIRMED');
});

test('a POST confirm with a WRONG admin_token is rejected, never decided', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const reviewLink = await fetchReviewLinkAsStaff(env, requested.data.request_id);
  const token = tokenFromLink(reviewLink);

  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', admin_token: 'not-the-real-token', operator: 'ops-1' }));
  assert.equal(decide.status, 401);
  const row = await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(row.status, 'REQUESTED');
});

test('a POST decline WITH valid staff authentication decides via the EXISTING admin decline handler', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const reviewLink = await fetchReviewLinkAsStaff(env, requested.data.request_id);
  const token = tokenFromLink(reviewLink);

  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'decline', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(decide.status, 200);
  const row = await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(row.status, 'DECLINED');
});

test('an invalid review token is rejected on both the page and the decide endpoint, even with valid staff auth', async () => {
  const env = makeEnv();
  const page = await call(env, '/preview/staff/review?token=review_does-not-exist');
  assert.equal(page.status, 404);
  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token: 'review_does-not-exist', decision: 'confirm', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(decide.status, 401);
});

test('a missing token is rejected, never silently treated as valid', async () => {
  const env = makeEnv();
  const page = await call(env, '/preview/staff/review');
  assert.equal(page.status, 404);
});

test('an already-decided request shown via the review page reflects the real status and does not offer to re-decide', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const reviewLink = await fetchReviewLinkAsStaff(env, requested.data.request_id);
  const token = tokenFromLink(reviewLink);
  await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));

  const page = await call(env, `/preview/staff/review?token=${token}`);
  assert.equal(page.status, 200);
  assert.ok(String(page.data).includes('already been decided'));

  // A second decide attempt via the SAME token (even with valid staff
  // auth) must not double-apply — enforced by the underlying admin
  // handler's own existing idempotency/terminal-state guard, reused
  // unchanged.
  const secondDecide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'decline', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.notEqual(secondDecide.status, 200);
  const row = await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(row.status, 'CONFIRMED', 'the real, first decision must survive an attempted second decide');
});

test('the review token grants NO broader admin access — it cannot be used against the admin-token-gated routes', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const reviewLink = await fetchReviewLinkAsStaff(env, requested.data.request_id);
  const token = tokenFromLink(reviewLink);
  const attempt = await call(env, '/preview/admin/deal-requests', { headers: authed(token) });
  assert.equal(attempt.status, 401, 'a review token must never work as a bearer token on the real admin routes');
});

test('a malformed decision shape is rejected cleanly even with valid staff auth', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const reviewLink = await fetchReviewLinkAsStaff(env, requested.data.request_id);
  const token = tokenFromLink(reviewLink);
  const bad = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'maybe', operator: 'ops-1' }, authed(env.MARAU_ADMIN_TEST_TOKEN)));
  assert.equal(bad.status, 400);
});
