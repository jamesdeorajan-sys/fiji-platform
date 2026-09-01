// Fiji Dash — booking handoff reliability suite (GitHub Issue #34 P0 fix).
//
// Integration-style, same discipline as pricing.test.js: real HTTP calls
// against a real deployed API, no mocks. UNLIKE pricing.test.js, this suite
// is NOT side-effect-free - proving duplicate-protection and idempotency
// requires actually calling POST /bookings and letting real rows land in
// whatever database the target API is backed by.
//
// SAFETY: NADI_API_BASE_TEST must be set explicitly and must NOT point at
// the real production API (api.nadiairporttransfers.com) - this file
// refuses to run otherwise. Point it at a preview/staging deployment's own
// isolated D1 database. Every booking this suite creates uses a guest_name
// prefixed "TEST-ISSUE-34-" and an obviously-fake phone number so any that
// ever land somewhere shared are trivially identifiable and safe to purge.
//
// Run: NADI_API_BASE_TEST=https://<preview>.workers.dev node --test nadi-marketplace/worker/booking-handoff.test.js
//
// Admin-visibility tests additionally need ADMIN_TOKEN set to the preview
// deployment's real admin token - skipped with a clear reason if absent,
// never silently passed.

const test = require('node:test');
const assert = require('node:assert/strict');

const API_BASE = process.env.NADI_API_BASE_TEST || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

if (!API_BASE) {
  test('SKIPPED: NADI_API_BASE_TEST not set', { skip: 'Set NADI_API_BASE_TEST to a preview/staging deployment before running this suite - see file header.' }, () => {});
} else if (/api\.nadiairporttransfers\.com/i.test(API_BASE)) {
  throw new Error(
    'booking-handoff.test.js refuses to run against production (api.nadiairporttransfers.com). ' +
    'This suite creates real booking rows - point NADI_API_BASE_TEST at a preview/staging deployment instead.'
  );
} else {
  runSuite();
}

function testBookingPayload(overrides = {}) {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return {
    guest_name: `TEST-ISSUE-34-${stamp}`,
    guest_phone: '+6790000000',
    guest_email: 'test-issue-34@example.invalid',
    pickup_zone: 'Nadi Airport',
    destination_zone: 'Denarau',
    vehicle_type: 'sedan',
    quoted_currency: 'FJD',
    quoted_amount: 49,
    fx_rate_at_booking: 1,
    distance_km: 12,
    payment_method: 'cash',
    pickup_date: '2099-01-01',
    pickup_time: '10:00',
    flight_number: 'FJ401',
    trip_type: 'one-way',
    has_child_seat: false,
    has_surfboard: false,
    has_tour: false,
    is_custom_address: false,
    client_booking_ref: `TEST-REF-${stamp}`,
    ...overrides,
  };
}

async function postBooking(payload) {
  const res = await fetch(`${API_BASE}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function runSuite() {
  // ─── Scenario: double click ──────────────────────────────────────────────
  // Two POST /bookings calls fired back-to-back with the SAME
  // client_booking_ref (exactly what a fast double-click/double-tap does
  // client-side, since confirmBooking() mints the ref once and both
  // in-flight clicks would carry it) must resolve to ONE booking, not two.
  test('double click: two rapid requests with the same client_booking_ref create exactly one booking', async () => {
    const payload = testBookingPayload();
    const [first, second] = await Promise.all([postBooking(payload), postBooking(payload)]);

    assert.equal(first.data.ok, true, `first request should succeed: ${JSON.stringify(first.data)}`);
    assert.equal(second.data.ok, true, `second request should succeed (not a hard failure): ${JSON.stringify(second.data)}`);
    assert.equal(first.data.booking_id, second.data.booking_id, 'both requests must resolve to the SAME booking_id, not two different bookings');
    // Exactly one of the two should be the "real" creation (201, idempotent:false)
    // and the other the idempotent replay (200, idempotent:true) - which one
    // wins the race is not deterministic, but exactly one of each must occur.
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 201], `expected one 201 (created) and one 200 (idempotent replay), got ${JSON.stringify(statuses)}`);
    const idempotentFlags = [first.data.idempotent, second.data.idempotent].sort();
    assert.deepEqual(idempotentFlags, [false, true], 'expected exactly one idempotent:true and one idempotent:false');
  });

  // ─── Scenario: refresh/retry ─────────────────────────────────────────────
  // A guest who refreshes or explicitly hits "Try again" (retryMarketplaceBooking
  // in app.js) resubmits sequentially, not concurrently - same ref, later in
  // time. Must still return the original booking, not create a second one.
  test('refresh/retry: a later sequential request with the same client_booking_ref returns the original booking', async () => {
    const payload = testBookingPayload();
    const first = await postBooking(payload);
    assert.equal(first.data.ok, true);
    assert.equal(first.status, 201);
    assert.equal(first.data.idempotent, false);

    const retry = await postBooking(payload);
    assert.equal(retry.data.ok, true);
    assert.equal(retry.status, 200, 'a retry of an already-created booking should be 200, not 201');
    assert.equal(retry.data.idempotent, true);
    assert.equal(retry.data.booking_id, first.data.booking_id, 'retry must return the SAME booking_id');
  });

  // ─── Scenario: same idempotency key twice (explicit, 3+ attempts) ───────
  // Broader than the double-click/retry cases above: proves the guarantee
  // holds regardless of HOW MANY times the same ref is resubmitted, not
  // just twice.
  test('same idempotency key sent 3 times in a row always returns the same booking_id', async () => {
    const payload = testBookingPayload();
    const attempts = [];
    for (let i = 0; i < 3; i++) attempts.push(await postBooking(payload));

    for (const a of attempts) assert.equal(a.data.ok, true);
    const bookingIds = new Set(attempts.map(a => a.data.booking_id));
    assert.equal(bookingIds.size, 1, `expected all 3 attempts to share one booking_id, got ${JSON.stringify([...bookingIds])}`);
    assert.equal(attempts.filter(a => a.status === 201).length, 1, 'exactly one attempt should be the real creation (201)');
    assert.equal(attempts.filter(a => a.status === 200).length, 2, 'the other two should be idempotent replays (200)');
  });

  // ─── Scenario: network timeout after server commit ──────────────────────
  // Can't literally sever the connection mid-response in an integration
  // test, but the functionally equivalent, actually-testable claim is: a
  // completely independent later request carrying the SAME ref (as if the
  // guest's browser never saw the first response and retried from scratch)
  // still resolves to the original booking - proving a client that lost
  // the response after the server had already committed cannot create a
  // second real booking by retrying.
  test('a request that looks like a fresh retry after a lost response still dedupes correctly', async () => {
    const payload = testBookingPayload();
    const original = await postBooking(payload);
    assert.equal(original.data.ok, true);

    // Simulate "client never saw the response, retries from scratch" - same
    // ref, but otherwise resubmitted as if it were the first attempt again.
    const blindRetry = await postBooking({ ...payload });
    assert.equal(blindRetry.data.ok, true);
    assert.equal(blindRetry.data.booking_id, original.data.booking_id);
    assert.equal(blindRetry.data.idempotent, true);
  });

  // ─── Scenario: no online drivers ─────────────────────────────────────────
  // Booking creation must succeed and be visible regardless of whether
  // broadcastBookingToDrivers() actually found anyone online - the whole
  // point of Issue #34 requirement 10 (driver broadcast is additive, not
  // the only operational notification). Can't force zero online drivers
  // from outside, but this asserts the contract that matters: a booking
  // is real and admin-visible independent of the broadcast outcome.
  test('booking creation succeeds and reports ok even when the driver broadcast finds nobody online', async () => {
    const result = await postBooking(testBookingPayload());
    assert.equal(result.data.ok, true);
    assert.ok(result.data.booking_id, 'booking_id must be present regardless of broadcast outcome');
    assert.ok(result.data.booking, 'the created booking row must be returned');
    // broadcast is present on a real (non-idempotent) creation; its own
    // notified-driver count is not asserted here - zero is a valid,
    // successful outcome, exactly the case this test protects.
  });

  // ─── Scenario: WhatsApp never opened ─────────────────────────────────────
  // The entire point of Issue #34: booking existence must never depend on
  // a WhatsApp tap. This test creates a booking purely via the API - the
  // same server transaction confirmBooking() now awaits - with zero
  // WhatsApp interaction anywhere in the test, and asserts the booking is
  // real and correctly persisted regardless.
  test('a booking created via the API alone (no WhatsApp step involved at all) is real and correctly stored', async () => {
    const payload = testBookingPayload({ guest_email: 'whatsapp-never-opened@example.invalid', flight_number: 'NZ56' });
    const result = await postBooking(payload);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.booking.guest_email, payload.guest_email, 'guest_email must be persisted (Issue #34 requirement 9)');
    assert.equal(result.data.booking.flight_number, payload.flight_number, 'flight_number must be persisted (Issue #34 requirement 9)');
    assert.equal(result.data.booking.status, 'pending');
  });

  // ─── Scenario: booking still visible to admin ────────────────────────────
  if (!ADMIN_TOKEN) {
    test('SKIPPED: booking still visible to admin', { skip: 'Set ADMIN_TOKEN to the target deployment\'s real admin token to run this test.' }, () => {});
  } else {
    test('booking still visible to admin: a created booking appears in GET /admin/bookings with its ops-required fields', async () => {
      const payload = testBookingPayload();
      const created = await postBooking(payload);
      assert.equal(created.data.ok, true);

      const res = await fetch(`${API_BASE}/admin/bookings?search=${encodeURIComponent(payload.guest_name)}`, {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      const found = (data.bookings || []).find(b => b.id === created.data.booking_id);
      assert.ok(found, `booking #${created.data.booking_id} should appear in the admin list`);
      assert.equal(found.guest_email, payload.guest_email);
      assert.equal(found.flight_number, payload.flight_number);
      assert.equal(found.client_booking_ref, payload.client_booking_ref);
    });
  }
}
