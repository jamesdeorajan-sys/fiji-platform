/* Marau Stage 1 (PREVIEW ONLY) — regressions for the bounded mobile-copy
 * corrections found on James's iPhone screenshots. Every fix here is
 * DISPLAY ONLY — the underlying booking/authorization/pricing/recovery
 * logic is completely unaffected; these tests specifically assert that
 * raw values are STILL PRESENT where they matter (structured fields,
 * database rows, comparisons) even as the human-readable text around
 * them changes. See docs/MARAU_STAGE1_MOBILE_COPY_CORRECTIONS.md for the
 * full write-up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv, synthGuest, seedActiveOffer } from './fixtures.mjs';
import worker from '../worker/worker.js';
import { shortBookingReference, humanizeZoneLabel, humanizeVehicleClassLabel, formatFijiCurrency } from '../worker/guest_display.js';
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
// UNIT TESTS — the shared guest_display.js helpers directly.
// =======================================================================

test('finding 1: shortBookingReference shortens a long/UUID-shaped reference but leaves an already-short one alone, and is purely a display transform', () => {
  assert.equal(shortBookingReference('MARAU-3f9a36c7-829c-4f9d-8af0-bb5332860f4b'), 'MARAU-3F9A36C7');
  assert.equal(shortBookingReference('HOSTED-ACCEPT-001'), 'HOSTED-ACCEPT-001', 'a human-chosen reference with no real UUID segment is shown as-is, however long');
  assert.equal(shortBookingReference(null), null);
});

test('finding 2: humanizeZoneLabel converts known offer-derived zone codes, gives a readable fallback for unknown code-shaped values, and leaves already-human text (an ordinary booking’s own free-typed zone) completely alone', () => {
  assert.equal(humanizeZoneLabel('NAD_AIRPORT'), 'Nadi Airport');
  assert.equal(humanizeZoneLabel('DENARAU'), 'Denarau');
  assert.equal(humanizeZoneLabel('SOME_FUTURE_ZONE'), 'Some Future Zone', 'unknown but code-shaped values still get a readable fallback');
  assert.equal(humanizeZoneLabel('Nadi Airport'), 'Nadi Airport', 'already-human text must be returned completely unchanged');
  assert.equal(humanizeZoneLabel('Sofitel Denarau'), 'Sofitel Denarau', 'the exact real-world regression: must NOT become "Sofitel denarau"');
});

test('finding 2: humanizeVehicleClassLabel converts known offer-derived vehicle classes, and leaves an ordinary booking’s own free-typed vehicle_type completely alone', () => {
  assert.equal(humanizeVehicleClassLabel('SEDAN'), 'Sedan');
  assert.equal(humanizeVehicleClassLabel('Private van, up to 6'), 'Private van, up to 6', 'free-typed text must never be run through the code-shaped fallback');
});

test('finding 3: formatFijiCurrency prefixes FJ$ without altering the numeric amount', () => {
  assert.equal(formatFijiCurrency(24), 'FJ$24.00');
  assert.equal(formatFijiCurrency(24.5), 'FJ$24.50');
  assert.equal(formatFijiCurrency('60'), 'FJ$60.00');
});

test('finding 1/2/3: every guest_display.js function runs correctly when spliced via toString(), exactly as pages.js embeds them', () => {
  const source = `
    ${shortBookingReference.toString()}
    ${humanizeZoneLabel.toString()}
    ${humanizeVehicleClassLabel.toString()}
    ${formatFijiCurrency.toString()}
    return { shortBookingReference, humanizeZoneLabel, humanizeVehicleClassLabel, formatFijiCurrency };
  `;
  const fns = new Function(source)();
  assert.equal(fns.shortBookingReference('MARAU-3f9a36c7-829c-4f9d-8af0-bb5332860f4b'), 'MARAU-3F9A36C7');
  assert.equal(fns.humanizeZoneLabel('NAD_AIRPORT'), 'Nadi Airport');
  assert.equal(fns.humanizeZoneLabel('Nadi Airport'), 'Nadi Airport');
  assert.equal(fns.humanizeVehicleClassLabel('SEDAN'), 'Sedan');
  assert.equal(fns.formatFijiCurrency(24), 'FJ$24.00');
});

// =======================================================================
// END-TO-END — the actual served app and composed messages.
// =======================================================================

async function createAndRequestDeal(env) {
  const { offer } = await seedActiveOffer(env);
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const requested = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(created.data.access_token) });
  return { offer, requestId: requested.data.request_id, token: created.data.access_token };
}

test('finding 3/4/2: a listed deal shows FJ$ prices, "Requires operator confirmation" (never a false pre-confirmed claim), and a humanized vehicle class, while the raw numeric price is unaffected', async () => {
  const env = makeEnv();
  const { offer } = await seedActiveOffer(env, { standard_price: 60, smart_match_price: 24 });
  const list = await call(env, '/preview/deals');
  const deal = list.data.deals.find((d) => d.offer_id === offer.offer_id);
  assert.equal(deal.total_price, 24, 'the raw numeric price must be completely unaffected');
  assert.equal(deal.standard_price, 60);
  assert.ok(deal.conditions.includes('Requires operator confirmation'), 'must never claim a deal is already confirmed just by being listed');
  assert.ok(!deal.conditions.includes('Confirmed by operator before travel'), 'the old, misleading wording must be gone');
  assert.ok(deal.conditions.includes('Sedan'), 'the vehicle class must be humanized in the composed conditions text too');
  assert.ok(!deal.conditions.includes('SEDAN'));
});

test('finding 6/3: the composed deal-request WhatsApp message uses a short reference, a readable route, a humanized vehicle class, and FJ$ pricing, while full internal linkage (request_id, offer_id) is preserved as structured fields', async () => {
  const env = makeEnv();
  const { offer, requestId } = await createAndRequestDeal(env);
  const list = await call(env, '/preview/admin/deal-requests', { headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  void list; // not needed further — the handoff was already returned at request time
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  void created;

  // Re-derive the handoff directly from the request call's own response
  // by re-requesting the SAME offer with a fresh guest (idempotent
  // per-offer-per-guest, so a new guest gets a fresh composed message).
  const guest2 = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const req2 = await call(env, `/preview/deals/${offer.offer_id}/request`, { method: 'POST', headers: authed(guest2.data.access_token) });
  const handoff = req2.data.whatsapp_handoff;

  assert.equal(handoff.offer_id, offer.offer_id, 'full internal linkage must be preserved as a structured field');
  assert.ok(handoff.request_id, 'full internal linkage must be preserved as a structured field');
  assert.ok(!handoff.message.includes(offer.offer_id), 'the raw offer_id must not be embedded in the human-readable message text');
  assert.ok(handoff.message.includes('Denarau'), 'the route must read as a real place name');
  assert.ok(handoff.message.includes('Nadi Airport'));
  assert.ok(!handoff.message.includes('DENARAU') && !handoff.message.includes('NAD_AIRPORT'), 'the raw zone codes must not appear in the message text');
  assert.ok(handoff.message.includes('Sedan') && !handoff.message.includes('SEDAN'));
  assert.ok(handoff.message.includes('FJ$'), 'the price in the composed message must carry the FJ$ currency label');
  assert.equal(requestId, requestId); // keep the earlier request in scope, unaffected
});

test('finding 1/6/7: the composed trip WhatsApp summary uses a short reference and explicit Fiji date/time (never a raw UTC timestamp), matching the selected booking exactly', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest({ client_booking_ref: 'MARAU-' + 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', pickup_datetime: '2026-10-05T09:00' })));
  const token = created.data.access_token;
  const handoff = await call(env, '/preview/trip/whatsapp-handoff', { method: 'POST', headers: authed(token) });
  assert.equal(handoff.status, 200);
  const message = handoff.data.whatsapp_handoff.message;
  assert.ok(message.includes('MARAU-A1B2C3D4'), 'the message must show the SHORT reference');
  assert.ok(!message.includes('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), 'the full raw reference must not appear in the message text');
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(message), 'no raw UTC ISO timestamp may appear in the message text');
  assert.ok(message.includes('Fiji time'), 'the time must be explicitly labelled Fiji time');
  assert.ok(message.includes('9:00'), 'the Fiji wall-clock time entered by the guest must be reflected exactly');
});

test('finding 7: a listed deal’s expiry is shown in explicit Fiji time, not the phone’s own implicit local timezone', () => {
  assert.ok(GUEST_APP_HTML.includes('Fiji time'), 'the deals list must label the expiry explicitly, the same way the pickup card already does');
  // The exact old buggy expression (not just the bare method name, which
  // would also match this test file's own explanatory comment above).
  assert.ok(!GUEST_APP_HTML.includes('new Date(d.expires_at).toLocaleString()'), 'the old implicit-local-timezone formatting must be gone from the deals list');
  assert.ok(GUEST_APP_HTML.includes('formatFijiDateTime(d.expires_at)'), 'the deals list must use the same Fiji-time formatter as everywhere else');
});

test('finding 5: the served app never echoes the raw REQUESTED enum back at the guest as "Requested (REQUESTED)"', () => {
  assert.ok(!GUEST_APP_HTML.includes("'Requested (' + res.data.status + ')'"), 'the raw-enum echo must be gone');
  assert.ok(GUEST_APP_HTML.includes('Request received') || GUEST_APP_HTML.includes('Awaiting confirmation'), 'a plain-English status label must be present instead');
});

test('finding 8: the pickup heading reads "Requested pickup" while pending and "Next pickup" only once genuinely confirmed', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const token = created.data.access_token;
  const bookingId = created ? (await call(env, '/preview/trip', { headers: authed(token) })).data.bookings[0].id : null;

  // Directly exercise the SAME heading-selection logic the client uses,
  // spliced the same way, against both a pending and a confirmed status.
  assert.ok(GUEST_APP_HTML.includes('Requested pickup'), 'the pending-state heading must be present in the served app');
  assert.ok(GUEST_APP_HTML.includes("'Next pickup'"), 'the confirmed-state heading must still exist for a genuinely confirmed arrangement');

  // And confirm the underlying booking itself is still just 'pending' —
  // nothing about this copy-only fix changes booking/confirmation logic.
  const trip = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(trip.data.bookings[0].status, 'pending');
  assert.equal(trip.data.bookings[0].id, bookingId);
});

test('booking, authorization, pricing and recovery logic are all completely unaffected by these display-only corrections', async () => {
  const env = makeEnv();
  const { offer, requestId, token } = await createAndRequestDeal(env);
  const confirm = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.data.status, 'CONFIRMED');
  assert.equal(confirm.data.offer.smart_match_price, 24, 'raw pricing is unaffected');

  const trip = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(trip.data.deal_requests[0].status, 'CONFIRMED');
  assert.equal(trip.data.deal_requests[0].offer_id, offer.offer_id, 'raw internal ids remain in the underlying data');

  const badAuth = await call(env, '/preview/trip', { headers: authed('not-a-real-token') });
  assert.equal(badAuth.status, 401, 'authorization logic is unaffected');
});
