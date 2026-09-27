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

test('health check responds ok', async () => {
  const env = makeEnv();
  const res = await call(env, '/health');
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'ok');
});

// ---------------------------------------------------------------------
// Bookings: correct details, required contact validation, immediate
// access, duplicate/retry recovery.
// ---------------------------------------------------------------------

test('saving a booking requires both email and phone — server enforces even if a client skipped its own validation', async () => {
  const env = makeEnv();
  const missingEmail = synthGuest({ guest_email: '' });
  const res = await call(env, '/preview/bookings', withJson('POST', missingEmail));
  assert.equal(res.status, 400);
  assert.ok(res.data.details.some((d) => d.includes('guest_email')));

  const missingPhone = synthGuest({ guest_phone: '' });
  const res2 = await call(env, '/preview/bookings', withJson('POST', missingPhone));
  assert.equal(res2.status, 400);
  assert.ok(res2.data.details.some((d) => d.includes('guest_phone')));
});

test('whatsapp_available is recorded but never required — a guest without WhatsApp can still book', async () => {
  const env = makeEnv();
  const guest = synthGuest({ whatsapp_available: false });
  const res = await call(env, '/preview/bookings', withJson('POST', guest));
  assert.equal(res.status, 201);
  const trip = await call(env, '/preview/trip', { headers: authed(res.data.access_token) });
  assert.equal(trip.data.whatsapp_available, false);
});

test('a successfully saved booking immediately grants access — no waiting for human confirmation', async () => {
  const env = makeEnv();
  const guest = synthGuest();
  const res = await call(env, '/preview/bookings', withJson('POST', guest));
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'pending');
  assert.equal(res.data.message, 'Awaiting human confirmation');
  assert.ok(res.data.access_token, 'access_token must be present in the SAME response, not deferred');

  const trip = await call(env, '/preview/trip', { headers: authed(res.data.access_token) });
  assert.equal(trip.status, 200);
  assert.equal(trip.data.bookings[0].status, 'pending');
});

test('retrying the same client_booking_ref is idempotent — no duplicate row, same access token', async () => {
  const env = makeEnv();
  const guest = synthGuest({ client_booking_ref: 'DUP-REF-001' });
  const first = await call(env, '/preview/bookings', withJson('POST', guest));
  const second = await call(env, '/preview/bookings', withJson('POST', guest));
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.data.was_new_booking, false);
  assert.equal(second.data.access_token, first.data.access_token);
  assert.equal(second.data.booking_reference, first.data.booking_reference);

  const trip = await call(env, '/preview/trip', { headers: authed(first.data.access_token) });
  assert.equal(trip.data.bookings.length, 1, 'a retried submit must not create a second booking row');
});

// NOTE: "same phone automatically reuses an existing session" and
// "multi-booking ordering" are now covered in marau_codex_fixes.test.mjs,
// rewritten against the corrected verified-linking behaviour — see that
// file's P0 GUEST ACCESS section for why the old versions of these two
// tests here directly encoded the vulnerability Codex found and have
// been removed rather than patched in place.

// ---------------------------------------------------------------------
// Secure / revocable access
// ---------------------------------------------------------------------

test('an invalid access token is rejected', async () => {
  const env = makeEnv();
  const res = await call(env, '/preview/trip', { headers: authed('not-a-real-token') });
  assert.equal(res.status, 401);
});

test('revoking access makes the same token stop working immediately', async () => {
  const env = makeEnv();
  const guest = synthGuest();
  const created = await call(env, '/preview/bookings', withJson('POST', guest));
  const token = created.data.access_token;

  const beforeRevoke = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(beforeRevoke.status, 200);

  const revoke = await call(env, '/preview/trip/revoke', { method: 'POST', headers: authed(token) });
  assert.equal(revoke.status, 200);
  assert.equal(revoke.data.revoked, true);

  const afterRevoke = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(afterRevoke.status, 401, 'a revoked token must be rejected, not silently still work');
});

// ---------------------------------------------------------------------
// Deals: open browsing, demonstration labelling, auth required to request,
// idempotent request, stale/expired rejection.
// ---------------------------------------------------------------------

test('anyone can browse deals without an access token, clearly labelled as demonstration data', async () => {
  const env = makeEnv();
  await seedActiveOffer(env);
  const res = await call(env, '/preview/deals');
  assert.equal(res.status, 200);
  assert.equal(res.data.demonstration_data, true);
  assert.equal(res.data.deals.length, 1);
  const deal = res.data.deals[0];
  assert.ok(deal.label.includes('DEMONSTRATION DATA'));
  assert.ok(typeof deal.total_price === 'number');
  assert.ok(typeof deal.capacity === 'number');
  assert.ok(deal.conditions);
  assert.ok(deal.expires_at);
});

test('requesting a deal requires a saved booking (access token)', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const res = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST' });
  assert.equal(res.status, 401);
});

test('requesting a deal is idempotent and prepares (never sends) a WhatsApp handoff', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env);
  const guest = synthGuest();
  const created = await call(env, '/preview/bookings', withJson('POST', guest));
  const token = created.data.access_token;

  const first = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(token) });
  assert.equal(first.status, 201);
  assert.equal(first.data.status, 'REQUESTED');
  assert.ok(first.data.whatsapp_handoff.message.includes(offer.offer_id));
  assert.ok(first.data.whatsapp_handoff.note.toLowerCase().includes('never'));

  const retry = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(token) });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.request_id, first.data.request_id, 'a retried request must return the SAME request, not a duplicate');
});

test('a stale/expired offer is rejected on request', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env, { expires_at: new Date(Date.now() - 60_000).toISOString() });
  const guest = synthGuest();
  const created = await call(env, '/preview/bookings', withJson('POST', guest));
  const res = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });
  assert.equal(res.status, 409);
  assert.equal(res.data.error, 'STALE_OR_UNAPPROVED_OFFER');
  assert.equal(res.data.reason, 'EXPIRED');
});

// ---------------------------------------------------------------------
// Protected change requests
// ---------------------------------------------------------------------

test('a requested change does not alter the booking until an operator approves it', async () => {
  const env = makeEnv();
  const guest = synthGuest();
  const created = await call(env, '/preview/bookings', withJson('POST', guest));
  const token = created.data.access_token;
  const tripBefore = await call(env, '/preview/trip', { headers: authed(token) });
  const bookingId = tripBefore.data.bookings[0].id;

  const change = await call(env, `/preview/bookings/${bookingId}/change-request`, withJson('POST', { requested_fields: { pickup_datetime: new Date(Date.now() + 96 * 3600_000).toISOString() } }, authed(token)));
  assert.equal(change.status, 201);
  assert.equal(change.data.status, 'PENDING');

  const tripAfter = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(tripAfter.data.bookings[0].pickup_datetime, tripBefore.data.bookings[0].pickup_datetime, 'the original booking must be unchanged until approved');

  const approve = await call(env, `/preview/admin/change-requests/${change.data.change_request_id}/approve`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(approve.status, 200);
  assert.equal(approve.data.status, 'APPROVED');

  const tripFinal = await call(env, '/preview/trip', { headers: authed(token) });
  assert.notEqual(tripFinal.data.bookings[0].pickup_datetime, tripBefore.data.bookings[0].pickup_datetime, 'an APPROVED change request must apply');
});

test('a change request cannot smuggle a write to guest_email/quoted_amount/status', async () => {
  const env = makeEnv();
  const guest = synthGuest();
  const created = await call(env, '/preview/bookings', withJson('POST', guest));
  const token = created.data.access_token;
  const trip = await call(env, '/preview/trip', { headers: authed(token) });
  const bookingId = trip.data.bookings[0].id;

  const change = await call(env, `/preview/bookings/${bookingId}/change-request`, withJson('POST', { requested_fields: { guest_email: 'attacker@example.test', quoted_amount: 1, status: 'confirmed' } }, authed(token)));
  const approve = await call(env, `/preview/admin/change-requests/${change.data.change_request_id}/approve`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(approve.status, 400, 'no changeable field means the approve endpoint must refuse, not silently apply nothing');

  const tripAfter = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(tripAfter.data.bookings[0].guest_email, guest.guest_email);
  assert.equal(tripAfter.data.bookings[0].status, 'pending');
});

// ---------------------------------------------------------------------
// Admin auth and human confirmation
// ---------------------------------------------------------------------

test('admin endpoints require the test admin token', async () => {
  const env = makeEnv();
  const res = await call(env, '/preview/admin/bookings');
  assert.equal(res.status, 401);
  const wrongToken = await call(env, '/preview/admin/bookings', { headers: authed('wrong-token') });
  assert.equal(wrongToken.status, 401);
});

test('opening a WhatsApp handoff never confirms a booking — only the authenticated admin confirm does', async () => {
  const env = makeEnv();
  const guest = synthGuest();
  const created = await call(env, '/preview/bookings', withJson('POST', guest));
  const token = created.data.access_token;

  // Simulate "opening WhatsApp" — there is no code path that does this
  // (the handoff is inert data), so we just assert the booking stays
  // pending with no admin action taken.
  const tripBefore = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(tripBefore.data.bookings[0].status, 'pending');

  const listPending = await call(env, '/preview/admin/bookings', { headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  const bookingId = listPending.data.bookings[0].id;
  const confirm = await call(env, `/preview/admin/bookings/${bookingId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.data.status, 'confirmed');

  const tripAfter = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(tripAfter.data.bookings[0].status, 'confirmed');
});
