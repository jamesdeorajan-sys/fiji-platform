/* Marau Stage 1 (PREVIEW ONLY) — round 19: the approved staff workflow.
 * A booking-specific "Review and confirm" link, meant to ride inside the
 * existing detailed WhatsApp alert (still fully mocked here). Opening
 * the link (GET) must never confirm anything; only an explicit POST
 * decides, and it must reuse the existing admin confirm/decline
 * handlers rather than duplicate their logic.
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

test('round19: requesting a deal returns a review_link alongside the existing mocked WhatsApp handoff', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  assert.equal(requested.status, 201);
  assert.ok(requested.data.whatsapp_handoff.review_link, 'a review_link must be present on the composed handoff');
  assert.ok(requested.data.whatsapp_handoff.review_link.includes('/preview/staff/review?token='));
});

test('round19: opening the review link (GET) NEVER confirms or declines anything', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const url = new URL(requested.data.whatsapp_handoff.review_link);
  const token = url.searchParams.get('token');

  const page = await call(env, `/preview/staff/review?token=${token}`);
  assert.equal(page.status, 200);
  assert.ok(String(page.data).includes('Confirm'));
  assert.ok(String(page.data).includes('has not confirmed or declined anything'));

  const row = await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(row.status, 'REQUESTED', 'merely opening the page must never change the request status');
});

test('round19: an explicit POST confirm decides the request via the EXISTING admin confirm handler', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const url = new URL(requested.data.whatsapp_handoff.review_link);
  const token = url.searchParams.get('token');

  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm' }));
  assert.equal(decide.status, 200);

  const row = await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(row.status, 'CONFIRMED');

  // The same real vehicle-allocation side effects the ordinary admin
  // confirm endpoint produces must have happened too (proves this is a
  // genuine reuse of the existing handler, not a separate, thinner path).
  const { results: allocations } = await env.DB.prepare('SELECT * FROM vehicle_allocations').all();
  assert.equal(allocations.length, 1);
});

test('round19: an explicit POST decline decides the request via the EXISTING admin decline handler', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const url = new URL(requested.data.whatsapp_handoff.review_link);
  const token = url.searchParams.get('token');

  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'decline' }));
  assert.equal(decide.status, 200);
  const row = await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(row.status, 'DECLINED');
});

test('round19: an invalid token is rejected on both the page and the decide endpoint', async () => {
  const env = makeEnv();
  const page = await call(env, '/preview/staff/review?token=review_does-not-exist');
  assert.equal(page.status, 404);
  const decide = await call(env, '/preview/staff/review/decide', withJson('POST', { token: 'review_does-not-exist', decision: 'confirm' }));
  assert.equal(decide.status, 401);
});

test('round19: a missing token is rejected, never silently treated as valid', async () => {
  const env = makeEnv();
  const page = await call(env, '/preview/staff/review');
  assert.equal(page.status, 404);
});

test('round19: an already-decided request shown via the review page reflects the real status and does not offer to re-decide', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const url = new URL(requested.data.whatsapp_handoff.review_link);
  const token = url.searchParams.get('token');
  await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'confirm' }));

  const page = await call(env, `/preview/staff/review?token=${token}`);
  assert.equal(page.status, 200);
  assert.ok(String(page.data).includes('already been decided'));

  // A second decide attempt via the SAME token must not double-apply —
  // this is enforced by the underlying admin handler's own existing
  // idempotency/terminal-state guard, reused unchanged.
  const secondDecide = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'decline' }));
  assert.notEqual(secondDecide.status, 200);
  const row = await env.DB.prepare('SELECT status FROM deal_requests WHERE request_id = ?').bind(requested.data.request_id).first();
  assert.equal(row.status, 'CONFIRMED', 'the real, first decision must survive an attempted second decide');
});

test('round19: the review token grants NO broader admin access — it cannot be used against the admin-token-gated routes', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const url = new URL(requested.data.whatsapp_handoff.review_link);
  const token = url.searchParams.get('token');
  const attempt = await call(env, '/preview/admin/deal-requests', { headers: authed(token) });
  assert.equal(attempt.status, 401, 'a review token must never work as a bearer token on the real admin routes');
});

test('round19: a decision requires the malformed shape to be rejected cleanly', async () => {
  const env = makeEnv();
  const { requested } = await bookAndRequestDeal(env);
  const url = new URL(requested.data.whatsapp_handoff.review_link);
  const token = url.searchParams.get('token');
  const bad = await call(env, '/preview/staff/review/decide', withJson('POST', { token, decision: 'maybe' }));
  assert.equal(bad.status, 400);
});
