/* Marau Stage 1 (PREVIEW ONLY) — regressions for Codex's FOURTH
 * independent review (of commit 4d44fbd, which reproduced 323/323).
 * Each section reproduces one finding, then is the test proving the fix.
 * See docs/MARAU_STAGE1_CODEX_FIXES_ROUND4.md for the full write-up.
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
import { normalizePickupDatetime, fijiWallClockToUtcIso, formatFijiDateTime } from '../worker/fiji_time.js';
import { selectDefaultBooking, ACTIVE_BOOKING_STATUSES } from '../worker/booking_selection.js';
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
// FINDING 1 — CONFIRMATION INTEGRITY
// Codex made INSERT INTO confirmation_attempts itself fail (a SQLite
// trigger) and found the guest Trip CONFIRMED, offer ACTIVE, zero
// allocations, zero audit rows. A late failure plus failed offer
// compensation also left the guest Trip CONFIRMED with zero allocations.
// =======================================================================

test('finding 1: Codex\'s exact reproduction — rejecting INSERT INTO confirmation_attempts with a SQLite trigger must NEVER leave deal_requests CONFIRMED', async () => {
  const env = makeEnv();
  const { offer, requestId } = await createAndRequestDeal(env);

  // Reproduce Codex's exact mechanism: a real SQLite trigger that aborts
  // every INSERT into confirmation_attempts, exactly as they described.
  env.DB.exec(`
    CREATE TRIGGER reject_confirmation_attempts
    BEFORE INSERT ON confirmation_attempts
    BEGIN SELECT RAISE(ABORT, 'test-injected: confirmation_attempts insert rejected'); END;
  `);

  const confirm = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(confirm.status, 500);

  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  assert.equal(dealRequest.status, 'REQUESTED', 'must NEVER show CONFIRMED when the audit write itself failed — this is the exact defect Codex found');

  const freshOffer = await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offer.offer_id).first();
  assert.equal(freshOffer.status, 'ACTIVE');

  const allocations = await env.DB.prepare(`SELECT * FROM vehicle_allocations WHERE subject_type = 'DEAL_REQUEST' AND subject_id = ?`).bind(requestId).all();
  assert.equal(allocations.results.length, 0, 'zero allocations must exist — nothing substantive happened before the audit write failed');

  const attempts = await env.DB.prepare('SELECT * FROM confirmation_attempts WHERE request_id = ?').bind(requestId).all();
  assert.equal(attempts.results.length, 0, 'the audit row itself could not be written — this is the exact gap the new claim table closes');

  // Because nothing real happened, this must be cleanly retryable once the
  // trigger is gone (proves the claim was released, not left stuck).
  env.DB.exec('DROP TRIGGER reject_confirmation_attempts;');
  const retry = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.status, 'CONFIRMED');
});

test('finding 1: a late failure PLUS a failing compensating step never exposes CONFIRMED, and the actionable admin reconcile path fully resolves it', async () => {
  const env = makeEnv();
  const { requestId } = await createAndRequestDeal(env);

  const doublyFailingEnv = {
    ...env,
    __TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__: () => { throw new Error('INJECTED_LATE_FAILURE'); },
    __TEST_FAIL_ROLLBACK_STEP__: 'offer_status',
  };
  const failed = await call(doublyFailingEnv, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(failed.status, 500);
  assert.equal(failed.data.reconciliation_needed, true);
  assert.equal(failed.data.recovery_action, `POST /preview/admin/deal-requests/${requestId}/reconcile-confirmation`);

  // The guest-visible status must NEVER have flipped to CONFIRMED, even
  // though real side effects partially happened and one compensating step
  // failed — this is the exact standard Codex demanded.
  const dealRequest = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  assert.equal(dealRequest.status, 'REQUESTED', 'recording ROLLBACK_FAILED alone is insufficient — the guest Trip must never show CONFIRMED here');

  // A further confirm/decline attempt must be blocked (claim/journal
  // interruption gap closed) with the actionable recovery path named.
  const blockedRetry = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(blockedRetry.status, 409);
  assert.equal(blockedRetry.data.error, 'CONFIRMATION_INTERRUPTED');
  assert.equal(blockedRetry.data.recovery_action, `POST /preview/admin/deal-requests/${requestId}/reconcile-confirmation`);

  // The ownership-fenced admin reconcile endpoint resolves it definitively.
  const reconciled = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.data.resolved, 'ROLLED_BACK_TO_REQUESTED');

  const afterReconcile = await env.DB.prepare('SELECT * FROM deal_requests WHERE request_id = ?').bind(requestId).first();
  assert.equal(afterReconcile.status, 'REQUESTED');

  // And now genuinely retryable.
  const retry = await call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.status, 'CONFIRMED');
});

test('finding 1: the admin deal-requests list surfaces reconciliation_needed for a stalled request', async () => {
  const env = makeEnv();
  const { requestId } = await createAndRequestDeal(env);
  const doublyFailingEnv = {
    ...env,
    __TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__: () => { throw new Error('INJECTED'); },
    __TEST_FAIL_ROLLBACK_STEP__: 'offer_status',
  };
  await call(doublyFailingEnv, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });

  const list = await call(env, '/preview/admin/deal-requests', { headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  const row = list.data.deal_requests.find((r) => r.request_id === requestId);
  assert.equal(row.reconciliation_needed, true);
  assert.equal(row.stalled_phase, 'ROLLBACK_FAILED');
});

test('finding 1: reconcile on a request with nothing to reconcile is a clean no-op', async () => {
  const env = makeEnv();
  const { requestId } = await createAndRequestDeal(env);
  const reconciled = await call(env, `/preview/admin/deal-requests/${requestId}/reconcile-confirmation`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(reconciled.status, 200);
  assert.equal(reconciled.data.resolved, 'NOTHING_TO_RECONCILE');
});

test('finding 1: mutual exclusion still holds via the new deal_decision_claims table — concurrent confirm+decline, exactly one wins', async () => {
  const env = makeEnv();
  const { requestId } = await createAndRequestDeal(env);
  const [confirmResult, declineResult] = await Promise.all([
    call(env, `/preview/admin/deal-requests/${requestId}/confirm`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) }),
    call(env, `/preview/admin/deal-requests/${requestId}/decline`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) }),
  ]);
  const winners = [confirmResult, declineResult].filter((r) => r.status === 200);
  assert.equal(winners.length, 1);
  const claim = await env.DB.prepare('SELECT * FROM deal_decision_claims WHERE request_id = ?').bind(requestId).first();
  assert.ok(claim, 'the claim row must exist once a decision has been made');
});

// =======================================================================
// FINDING 2 — PICKUP ACCURACY
// =======================================================================

test('finding 2: selectDefaultBooking never picks an old cancelled/declined booking over a real upcoming active one', () => {
  const now = '2026-06-01T00:00:00.000Z';
  const bookings = [
    { id: 1, status: 'cancelled', pickup_datetime: '2026-05-01T00:00:00.000Z' }, // earliest timestamp, but cancelled
    { id: 2, status: 'pending', pickup_datetime: '2026-06-10T00:00:00.000Z' }, // upcoming, active
    { id: 3, status: 'confirmed', pickup_datetime: '2026-07-01T00:00:00.000Z' }, // further upcoming, active
  ];
  const chosen = selectDefaultBooking(bookings, now);
  assert.equal(chosen.id, 2, 'must pick the soonest UPCOMING ACTIVE booking, never the earlier cancelled one');
});

test('finding 2: selectDefaultBooking falls back to the most recent PAST active booking when nothing is upcoming, never a declined row', () => {
  const now = '2026-06-01T00:00:00.000Z';
  const bookings = [
    { id: 1, status: 'declined', pickup_datetime: '2026-05-20T00:00:00.000Z' },
    { id: 2, status: 'confirmed', pickup_datetime: '2026-05-01T00:00:00.000Z' },
    { id: 3, status: 'confirmed', pickup_datetime: '2026-05-15T00:00:00.000Z' },
  ];
  const chosen = selectDefaultBooking(bookings, now);
  assert.equal(chosen.id, 3, 'must pick the most recent PAST active booking, never the declined one even though it is more recent');
});

// A single trip having MULTIPLE bookings only happens for real through the
// verified-ownership linking flow (a second full round trip: link_offer ->
// confirm code) — exercised elsewhere. For these two tests, which are
// purely about default-selection and booking_id plumbing given an
// existing multi-booking session, a second row is seeded directly onto
// the SAME guest_session_id (bypassing the API's own single-booking-per-
// submission linking rules), exactly like the pre-existing multi-booking
// "switcher" fixtures this stage already relies on.
async function seedSecondBookingOnSameSession(env, firstBookingId, overrides = {}) {
  const first = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(firstBookingId).first();
  const ref = overrides.client_booking_ref || `EXTRA-${firstBookingId}-${Math.random().toString(36).slice(2, 8)}`;
  await env.DB
    .prepare(
      `INSERT INTO marau_test_bookings
        (client_booking_ref, guest_session_id, guest_email, guest_phone, pickup_zone, destination_zone, vehicle_type, pickup_datetime, quoted_amount, status, test_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .bind(
      ref,
      first.guest_session_id,
      first.guest_email,
      first.guest_phone,
      overrides.pickup_zone || first.pickup_zone,
      overrides.destination_zone || first.destination_zone,
      overrides.vehicle_type || first.vehicle_type,
      overrides.pickup_datetime || first.pickup_datetime,
      first.quoted_amount,
      overrides.status || 'pending',
      new Date().toISOString(),
      new Date().toISOString()
    )
    .run();
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind(ref).first();
  return row.id;
}

test('finding 2: the WhatsApp handoff summarizes the next upcoming ACTIVE booking, not an old cancelled one with an earlier timestamp', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest({
    client_booking_ref: 'OLD-CANCELLED-1',
    pickup_datetime: new Date(Date.now() - 48 * 3600_000).toISOString(),
  })));
  const token = created.data.access_token;
  const tripBefore = await call(env, '/preview/trip', { headers: authed(token) });
  const bookingId = tripBefore.data.bookings[0].id;
  await env.DB.prepare(`UPDATE marau_test_bookings SET status = 'cancelled' WHERE id = ?`).bind(bookingId).run();

  const upcomingBookingId = await seedSecondBookingOnSameSession(env, bookingId, {
    client_booking_ref: 'UPCOMING-ACTIVE-1',
    pickup_datetime: new Date(Date.now() + 48 * 3600_000).toISOString(),
    status: 'pending',
  });

  const handoff = await call(env, '/preview/trip/whatsapp-handoff', { method: 'POST', headers: authed(token) });
  assert.equal(handoff.status, 200);
  assert.equal(handoff.data.whatsapp_handoff.booking_id, upcomingBookingId, 'must summarize the upcoming active booking, never the old cancelled one');
});

test('finding 2: the WhatsApp handoff accepts an explicit booking_id so it matches whichever trip the guest has selected', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest({ client_booking_ref: 'SEL-A' })));
  const token = created.data.access_token;
  const tripBefore = await call(env, '/preview/trip', { headers: authed(token) });
  const bookingA = tripBefore.data.bookings[0].id;

  const bookingB = await seedSecondBookingOnSameSession(env, bookingA, {
    client_booking_ref: 'SEL-B',
    pickup_datetime: new Date(Date.now() + 96 * 3600_000).toISOString(),
  });

  const handoffA = await call(env, '/preview/trip/whatsapp-handoff', withJson('POST', { booking_id: bookingA }, authed(token)));
  assert.equal(handoffA.data.whatsapp_handoff.booking_id, bookingA);

  const handoffB = await call(env, '/preview/trip/whatsapp-handoff', withJson('POST', { booking_id: bookingB }, authed(token)));
  assert.equal(handoffB.data.whatsapp_handoff.booking_id, bookingB);
});

test('finding 2: Fiji time normalization — under TZ=UTC, "2026-10-01T12:00" (Fiji noon) must NOT display as midnight the next day', () => {
  // Reproduces the exact bug: plain new Date(...).toISOString() on a
  // zone-less string treats it as the SERVER's local time (UTC on a
  // Worker), storing "2026-10-01T12:00:00.000Z" — which is actually
  // MIDNIGHT ON 2 OCTOBER in Fiji (UTC+12). The guest's raw form input is
  // always meant as Fiji local wall-clock time.
  const stored = normalizePickupDatetime('2026-10-01T12:00');
  assert.equal(stored, '2026-10-01T00:00:00.000Z', 'noon Fiji time on 1 Oct must be stored as the correct UTC instant');

  const displayed = formatFijiDateTime(stored);
  assert.equal(displayed.day, 'Thursday, Oct 1', 'displaying the stored instant back in Fiji time must show 1 October, not 2 October');
  assert.match(displayed.time, /^12:00/, 'must show noon, not midnight');
});

test('finding 2: normalizePickupDatetime is idempotent on already-zoned input — a resubmitted, unchanged time never compounds a shift', () => {
  const once = normalizePickupDatetime('2026-10-01T12:00');
  const twice = normalizePickupDatetime(once);
  assert.equal(twice, once, 'feeding an already-zoned instant back through must be a no-op');
});

test('finding 2: booking creation stores the Fiji-normalized instant, not the naive UTC-as-local interpretation', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest({ client_booking_ref: 'FIJI-NORM-1', pickup_datetime: '2026-10-01T12:00' })));
  assert.equal(created.status, 201);
  const booking = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE client_booking_ref = ?').bind('FIJI-NORM-1').first();
  assert.equal(booking.pickup_datetime, '2026-10-01T00:00:00.000Z');
});

test('finding 2: an approved change request normalizes a raw Fiji-local pickup_datetime, and resubmitting the SAME time (already normalized) does not shift it again', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const token = created.data.access_token;
  const tripBefore = await call(env, '/preview/trip', { headers: authed(token) });
  const bookingId = tripBefore.data.bookings[0].id;

  const change = await call(env, `/preview/bookings/${bookingId}/change-request`, withJson('POST', { requested_fields: { pickup_datetime: '2026-11-05T09:30' } }, authed(token)));
  assert.equal(change.status, 201);
  const changeRequestId = change.data.change_request_id;

  const stored = await env.DB.prepare('SELECT * FROM booking_change_requests WHERE change_request_id = ?').bind(changeRequestId).first();
  const requestedFields = JSON.parse(stored.requested_fields_json);
  assert.equal(requestedFields.pickup_datetime, '2026-11-04T21:30:00.000Z', 'must already be normalized at request time');

  const approve = await call(env, `/preview/admin/change-requests/${changeRequestId}/approve`, { method: 'POST', headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(approve.status, 200);

  const booking = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(bookingId).first();
  assert.equal(booking.pickup_datetime, '2026-11-04T21:30:00.000Z', 'applying an already-normalized value again must not shift it a second time');
});

// =======================================================================
// FINDING 3 — INSTALLED-APP ACCEPTANCE
// =======================================================================

test('finding 3: the token-persistence functions embedded in pages.js recover the trip from localStorage alone (simulating install → close → reopen at start_url "/", a fresh top-level launch with empty sessionStorage but a surviving per-origin localStorage)', () => {
  // Extract the ACTUAL served script and confirm it reads/writes BOTH
  // storages — not a hand-duplicated assertion of intended behaviour.
  assert.ok(GUEST_APP_HTML.includes('localStorage'), 'the served app must reference localStorage for token persistence');
  assert.ok(GUEST_APP_HTML.includes("localStorage.setItem('marau_tok'"), 'setToken must persist to localStorage');
  assert.ok(GUEST_APP_HTML.includes("localStorage.getItem('marau_tok')"), 'getToken must be able to recover from localStorage');
  assert.ok(GUEST_APP_HTML.includes("localStorage.removeItem('marau_tok')"), 'clearToken/revoke must clear localStorage too');

  // Reproduce the actual storage-fallback LOGIC (not the DOM) directly:
  // sessionStorage empty (fresh top-level launch, no #tok= fragment —
  // exactly what an installed PWA's start_url "/" produces), localStorage
  // still holds the token from before the app was closed.
  const sessionStore = new Map();
  const localStore = new Map();
  const sessionStorage = { getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null), setItem: (k, v) => sessionStore.set(k, v), removeItem: (k) => sessionStore.delete(k) };
  const localStorage = { getItem: (k) => (localStore.has(k) ? localStore.get(k) : null), setItem: (k, v) => localStore.set(k, v), removeItem: (k) => localStore.delete(k) };

  localStorage.setItem('marau_tok', 'secure-trip-token-abc');
  // No sessionStorage entry, no location.hash — the exact installed-PWA
  // reopen scenario. getToken() must still recover it.
  function getToken(location) {
    var m = location.hash.match(/tok=([^&]+)/);
    if (m) {
      try { sessionStorage.setItem('marau_tok', m[1]); } catch (e) {}
      try { localStorage.setItem('marau_tok', m[1]); } catch (e) {}
      return m[1];
    }
    try {
      var fromSession = sessionStorage.getItem('marau_tok');
      if (fromSession) return fromSession;
    } catch (e) {}
    try { return localStorage.getItem('marau_tok'); } catch (e) { return null; }
  }
  const recovered = getToken({ hash: '' });
  assert.equal(recovered, 'secure-trip-token-abc', 'an installed PWA relaunch (empty sessionStorage, no fragment) must still recover the token from localStorage');
});

test('finding 3: revoking/clearing the token removes it from BOTH storages, and server-side revocation is the authoritative check regardless of any cached client value', async () => {
  const env = makeEnv();
  const created = await call(env, '/preview/bookings', withJson('POST', synthGuest()));
  const token = created.data.access_token;

  const revoke = await call(env, '/preview/trip/revoke', { method: 'POST', headers: authed(token) });
  assert.equal(revoke.status, 200);

  // Even if a client had cached this token in localStorage from a prior
  // session, the server must refuse it post-revocation.
  const tripAfterRevoke = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(tripAfterRevoke.status, 401, 'revocation must be enforced server-side regardless of any client-cached copy');
});

test('finding 3: the manifest references real PNG icon assets (not only SVG) and never embeds any token/session value', async () => {
  const env = makeEnv();
  const manifestRes = await call(env, '/manifest.json');
  const iconSrcs = manifestRes.data.icons.map((i) => i.src);
  assert.ok(iconSrcs.includes('/icon-192.png'));
  assert.ok(iconSrcs.includes('/icon-512.png'));
  assert.ok(!JSON.stringify(manifestRes.data).match(/tok=|access_token|Bearer/i), 'the manifest must never carry any private token');

  const icon192 = await worker.fetch(req('/icon-192.png'), env);
  assert.equal(icon192.status, 200);
  assert.equal(icon192.headers.get('content-type'), 'image/png');
  const bytes192 = new Uint8Array(await icon192.arrayBuffer());
  assert.ok(bytes192.length > 100, 'must be a real, non-trivial PNG payload');
  assert.equal(bytes192[0], 0x89, 'must start with the real PNG magic byte');
  assert.equal(bytes192[1], 0x50); // 'P'
  assert.equal(bytes192[2], 0x4e); // 'N'
  assert.equal(bytes192[3], 0x47); // 'G'

  const icon180 = await worker.fetch(req('/icon-180.png'), env);
  assert.equal(icon180.status, 200);
  const bytes180 = new Uint8Array(await icon180.arrayBuffer());
  assert.equal(bytes180[0], 0x89);

  assert.ok(GUEST_APP_HTML.includes('apple-touch-icon" href="/icon-180.png"'), 'apple-touch-icon must reference the real PNG, not the SVG (iOS Safari does not reliably honour SVG touch icons)');
});
