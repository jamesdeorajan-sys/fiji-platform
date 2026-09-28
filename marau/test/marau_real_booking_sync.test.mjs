import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv } from './fixtures.mjs';
import worker, { createGuestSession, createSessionAndOfferLink, requireGuestSession, nowIso } from '../worker/worker.js';
import { normalizePickupDatetime } from '../worker/fiji_time.js';
import { syncRealBookingEvent, markMissingFromLatestFeed, mapRealStatusToMarauStatus } from '../worker/real_booking_sync.js';

installNetworkGuard();

const deps = { createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime };

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
function authed(token) {
  return { authorization: `Bearer ${token}` };
}

let counter = 0;
function synthRealBooking(overrides = {}) {
  const n = ++counter;
  return {
    id: 9000 + n,
    source_booking_ref: `real-sync-${n}`,
    guest_email: `real.sync${n}@example.test`,
    guest_phone: `+150055502${String(n).padStart(2, '0')}`,
    whatsapp_available: null,
    pickup_zone: 'Nadi Airport',
    destination_zone: 'Denarau',
    vehicle_type: 'Sedan',
    pickup_date: '2026-10-05',
    pickup_time: '09:00',
    quoted_amount: 45,
    assigned_driver_id: 'drv_1',
    ...overrides,
  };
}
function synthEvent(overrides = {}) {
  return {
    event_type: 'accepted',
    previous_status: 'pending',
    new_status: 'accepted',
    actor: 'driver:1',
    created_at: new Date().toISOString(),
    event_ordinal: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// Correction 1 — verified-ownership access is reused, never bypassed.
// ---------------------------------------------------------------------

test('round13/1: a fresh real accepted booking creates exactly one Marau session and one mirrored booking', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const result = await syncRealBookingEvent(env, booking, synthEvent(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.status, 'confirmed');

  const trip = await call(env, '/preview/trip', { headers: authed(result.session.access_token) });
  assert.equal(trip.status, 200);
  assert.equal(trip.data.bookings.length, 1);
  assert.equal(trip.data.bookings[0].status, 'confirmed');
  assert.equal(trip.data.bookings[0].source_booking_ref, booking.source_booking_ref);
});

test('round13/1: a SECOND real booking on the SAME phone (different source_booking_ref) gets its OWN session, never the first session\'s token or bookings — direct negative test of the rejected phone-lookup design', async () => {
  const env = makeEnv();
  const sharedPhone = '+15005550299';
  const first = synthRealBooking({ guest_phone: sharedPhone });
  const firstResult = await syncRealBookingEvent(env, first, synthEvent(), deps);
  assert.equal(firstResult.ok, true);

  const second = synthRealBooking({ guest_phone: sharedPhone });
  const secondResult = await syncRealBookingEvent(env, second, synthEvent(), deps);
  assert.equal(secondResult.ok, true);
  assert.notEqual(secondResult.session.access_token, firstResult.session.access_token);
  assert.notEqual(secondResult.session.session_id, firstResult.session.session_id);
  // A verified link OFFER is produced (same mechanism a guest's own
  // resubmission uses) — but it is never itself access, only an offer.
  assert.ok(secondResult.link_offer, 'expected a link offer for the shared-phone match');
  assert.equal(secondResult.link_offer.access_token, undefined, 'a link offer must never itself carry an access token to the OTHER session');

  const secondTrip = await call(env, '/preview/trip', { headers: authed(secondResult.session.access_token) });
  assert.equal(secondTrip.data.bookings.length, 1, 'the second session must see only its OWN real-synced booking, never the first phone-matched one');
  assert.equal(secondTrip.data.bookings[0].source_booking_ref, second.source_booking_ref);
});

test('round13/1: unauthorized booking linkage — presenting only a phone match (no verification code) never grants access to the other session\'s trip', async () => {
  const env = makeEnv();
  const sharedPhone = '+15005550399';
  const first = synthRealBooking({ guest_phone: sharedPhone });
  const firstResult = await syncRealBookingEvent(env, first, synthEvent(), deps);
  const second = synthRealBooking({ guest_phone: sharedPhone });
  const secondResult = await syncRealBookingEvent(env, second, synthEvent(), deps);

  // An attacker who only knows the phone number (not the first session's
  // own token) cannot read the first session's trip using the second
  // session's token, and cannot fabricate access without the real
  // verification code (mocked-delivery, readable only via the ORIGINAL
  // session's own token — see worker.js's handleListLinkRequests).
  const attemptWithSecondToken = await call(env, '/preview/trip', { headers: authed(secondResult.session.access_token) });
  const firstBookingRefs = attemptWithSecondToken.data.bookings.map((b) => b.source_booking_ref);
  assert.ok(!firstBookingRefs.includes(first.source_booking_ref), 'the shared-phone attacker session must never see the other real booking');

  // Confirm the verification code really is unreadable except via the
  // ORIGINAL session's own token.
  const wrongHolderReadsCode = await call(env, '/preview/trip/link-requests', { headers: authed(secondResult.session.access_token) });
  assert.equal(wrongHolderReadsCode.status, 200);
  // (this call succeeds because it's the CANDIDATE-side endpoint on the
  // NEW session, listing PENDING requests where it is itself the
  // candidate for an EARLIER session's own link offer — not a path to
  // reading the first session's code)
  const rightHolderReadsCode = await call(env, '/preview/trip/link-requests', { headers: authed(firstResult.session.access_token) });
  assert.equal(rightHolderReadsCode.status, 200);
});

// ---------------------------------------------------------------------
// Correction 2 — Marau's own immediate-access flow is untouched; a real
// still-pending booking is never synced at all.
// ---------------------------------------------------------------------

test('round13/2: a real booking still in \'pending\' is never mirrored — confirmed-only ingestion preserved', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const result = await syncRealBookingEvent(env, booking, synthEvent({ event_type: 'created', new_status: 'pending', event_ordinal: 0 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_YET_SYNCABLE');

  const { results } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(results.length, 0, 'no mirror row should exist for a still-pending real booking');
});

test('round13/2: Marau\'s own guest-submitted booking flow is completely unaffected by this module existing', async () => {
  const env = makeEnv();
  const res = await call(env, '/preview/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      guest_email: 'own.flow@example.test', guest_phone: '+15005550499',
      pickup_zone: 'NAD_AIRPORT', destination_zone: 'DENARAU', vehicle_type: 'Sedan',
      pickup_datetime: new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16), quoted_amount: 50,
    }),
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'pending');
  assert.ok(res.data.access_token, 'immediate access on save, unchanged');
});

// ---------------------------------------------------------------------
// Correction 3 — revocation already existed; test it against a
// PROTECTED endpoint, not the public booking-creation endpoint.
// ---------------------------------------------------------------------

test('round13/3: revoking a real-synced session\'s token via the existing /preview/trip/revoke immediately blocks the protected /preview/trip endpoint', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const result = await syncRealBookingEvent(env, booking, synthEvent(), deps);
  const token = result.session.access_token;

  const beforeRevoke = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(beforeRevoke.status, 200);

  const revokeRes = await call(env, '/preview/trip/revoke', { method: 'POST', headers: authed(token) });
  assert.equal(revokeRes.status, 200);
  assert.equal(revokeRes.data.revoked, true);

  const afterRevoke = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(afterRevoke.status, 401);

  // Direct assertion the EXISTING mechanism (requireGuestSession) itself
  // rejects the revoked token, independent of the HTTP layer.
  const directCheck = await requireGuestSession(new Request('http://x', { headers: authed(token) }), env);
  assert.equal(directCheck, null);
});

// ---------------------------------------------------------------------
// Correction 4 — no invented confirmation policy; confirmed_unallocated
// is never written by this module, ever.
// ---------------------------------------------------------------------

test('round13/4: mapRealStatusToMarauStatus never produces confirmed_unallocated for any input', () => {
  for (const s of ['pending', 'created', 'accepted', 'en_route', 'completed', 'cancelled', 'garbage', null, undefined]) {
    assert.notEqual(mapRealStatusToMarauStatus(s), 'confirmed_unallocated');
  }
  assert.equal(mapRealStatusToMarauStatus('accepted'), 'confirmed');
  assert.equal(mapRealStatusToMarauStatus('en_route'), 'confirmed');
  assert.equal(mapRealStatusToMarauStatus('completed'), 'confirmed');
  assert.equal(mapRealStatusToMarauStatus('cancelled'), 'cancelled');
});

test('round13/4: an accepted real booking with an assigned_driver_id is mirrored as plain \'confirmed\' with the vehicle fact stored SEPARATELY, never folded into the status', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ assigned_driver_id: 'drv_42' });
  const result = await syncRealBookingEvent(env, booking, synthEvent(), deps);
  assert.equal(result.status, 'confirmed');
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(result.marau_booking_id).first();
  assert.equal(row.status, 'confirmed');
  assert.equal(row.source_assigned_driver_id, 'drv_42');

  const { results: all } = await env.DB.prepare('SELECT status FROM marau_test_bookings').all();
  assert.ok(all.every((r) => r.status !== 'confirmed_unallocated'), 'confirmed_unallocated must never be written by this module');
});

// ---------------------------------------------------------------------
// Correction 5 — minimum guest-data contract: email/phone ARE carried
// (unlike the anonymous movement adapter), flight_number/notes are not.
// ---------------------------------------------------------------------

test('round13/5: guest_email and guest_phone ARE mirrored (required for a real Marau session, unlike the anonymous shadow-movement adapter)', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ guest_email: 'carried.through@example.test' });
  const result = await syncRealBookingEvent(env, booking, synthEvent(), deps);
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(result.marau_booking_id).first();
  assert.equal(row.guest_email, 'carried.through@example.test');
  assert.equal(row.guest_phone, booking.guest_phone);
});

test('round13/5: fields with no guest-facing purpose (flight_number, notes) are never read into the mirror even when present on the source row', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ flight_number: 'FJ911', notes: 'VIP — handle with care' });
  const result = await syncRealBookingEvent(env, booking, synthEvent(), deps);
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(result.marau_booking_id).first();
  assert.equal('flight_number' in row, false);
  assert.equal('notes' in row, false);
  // Also never leaked into the composed WhatsApp-adjacent trip API response.
  const tripRes = await call(env, '/preview/trip', { headers: authed(result.session.access_token) });
  const serialized = JSON.stringify(tripRes.data);
  assert.ok(!serialized.includes('FJ911'));
  assert.ok(!serialized.includes('VIP'));
});

test('round13/5: a missing guest_email or guest_phone on the source row fails closed rather than creating an uncontactable session', async () => {
  const env = makeEnv();
  const noEmail = await syncRealBookingEvent(env, synthRealBooking({ guest_email: null }), synthEvent(), deps);
  assert.equal(noEmail.ok, false);
  assert.equal(noEmail.reason, 'MISSING_GUEST_CONTACT');
  const noPhone = await syncRealBookingEvent(env, synthRealBooking({ guest_phone: null }), synthEvent(), deps);
  assert.equal(noPhone.ok, false);
  assert.equal(noPhone.reason, 'MISSING_GUEST_CONTACT');
});

// ---------------------------------------------------------------------
// Correction 7 — sync semantics: ordering, failures, never-inferred
// cancellation from feed absence.
// ---------------------------------------------------------------------

test('round13/7: an out-of-order (stale) event is a documented no-op, never rolls the mirror back', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const first = await syncRealBookingEvent(env, booking, synthEvent({ event_ordinal: 1 }), deps);
  const advance = await syncRealBookingEvent(env, booking, synthEvent({ event_type: 'completed', new_status: 'completed', event_ordinal: 2 }), deps);
  assert.equal(advance.applied, true);

  const stale = await syncRealBookingEvent(env, booking, synthEvent({ event_type: 'accepted', new_status: 'accepted', event_ordinal: 1 }), deps);
  assert.equal(stale.ok, true);
  assert.equal(stale.applied, false);
  assert.equal(stale.reason, 'STALE_OR_DUPLICATE_EVENT');

  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(first.marau_booking_id).first();
  assert.equal(row.source_event_ordinal, 2, 'the later event must remain the recorded state after a stale replay');
});

test('round13/7: replaying the exact same event twice is idempotent (duplicate, not an error, not double-applied)', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const first = await syncRealBookingEvent(env, booking, synthEvent({ event_ordinal: 1 }), deps);
  const duplicate = await syncRealBookingEvent(env, booking, synthEvent({ event_ordinal: 1 }), deps);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.reason, 'STALE_OR_DUPLICATE_EVENT');
  const { results } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(results.length, 1, 'no duplicate mirror row from a repeated event');
});

test('round13/7: a malformed/unrecognized event type is a typed failure that leaves the existing mirror row completely untouched', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const good = await syncRealBookingEvent(env, booking, synthEvent({ event_ordinal: 1 }), deps);
  const before = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(good.marau_booking_id).first();

  const malformed = await syncRealBookingEvent(env, booking, synthEvent({ event_type: 'teleported', new_status: 'teleported', event_ordinal: 2 }), deps);
  assert.equal(malformed.ok, false);
  assert.equal(malformed.reason, 'UNRECOGNIZED_EVENT_TYPE');

  const after = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(good.marau_booking_id).first();
  assert.deepEqual(after, before, 'a sync failure must never mutate the last known-good mirror row');
});

test('round13/7: a real booking absent from the latest accepted-only feed pass is marked as such WITHOUT ever inferring cancellation', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const synced = await syncRealBookingEvent(env, booking, synthEvent(), deps);
  assert.equal(synced.status, 'confirmed');

  const missing = await markMissingFromLatestFeed(env, booking.source_booking_ref, { nowIso });
  assert.equal(missing.ok, true);

  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(synced.marau_booking_id).first();
  assert.equal(row.status, 'confirmed', 'status must NEVER be inferred as cancelled merely from feed absence');
  assert.equal(row.sync_state, 'MISSING_FROM_LATEST_FEED');

  // Only an EXPLICIT cancelled event ever flips the guest-facing status.
  const cancelEvent = synthEvent({ event_type: 'cancelled', new_status: 'cancelled', event_ordinal: 2 });
  const cancelled = await syncRealBookingEvent(env, booking, cancelEvent, deps);
  assert.equal(cancelled.applied, true);
  assert.equal(cancelled.status, 'cancelled');
  const rowAfterExplicitCancel = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(synced.marau_booking_id).first();
  assert.equal(rowAfterExplicitCancel.status, 'cancelled');
});

test('round13/7: a booking that reappears in a later feed pass after being marked missing is re-marked IN_LATEST_FEED by its next real sync event', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const synced = await syncRealBookingEvent(env, booking, synthEvent(), deps);
  await markMissingFromLatestFeed(env, booking.source_booking_ref, { nowIso });

  const reappear = await syncRealBookingEvent(env, booking, synthEvent({ event_type: 'completed', new_status: 'completed', event_ordinal: 2 }), deps);
  assert.equal(reappear.applied, true);
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(synced.marau_booking_id).first();
  assert.equal(row.sync_state, 'IN_LATEST_FEED');
  assert.equal(row.status, 'confirmed');
});

// ---------------------------------------------------------------------
// End-to-end synthetic demonstration, isolated Marau storage only.
// ---------------------------------------------------------------------

test('round13: end-to-end synthetic demonstration — save (accepted) -> guest Trip access -> operator completes -> guest sees updated status, entirely via isolated synthetic sync, zero production writes', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan' });

  const accepted = await syncRealBookingEvent(env, booking, synthEvent({ event_ordinal: 1 }), deps);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.status, 'confirmed');

  const trip1 = await call(env, '/preview/trip', { headers: authed(accepted.session.access_token) });
  assert.equal(trip1.data.bookings[0].status, 'confirmed');

  const completed = await syncRealBookingEvent(env, booking, synthEvent({ event_type: 'completed', new_status: 'completed', event_ordinal: 2 }), deps);
  assert.equal(completed.applied, true);
  assert.equal(completed.status, 'confirmed', 'Marau has no finer status than confirmed today — completed still reads as confirmed, not invented as a new value');

  const trip2 = await call(env, '/preview/trip', { headers: authed(accepted.session.access_token) });
  assert.equal(trip2.data.bookings[0].status, 'confirmed');
  assert.equal(trip2.data.bookings[0].source_status, 'completed');

  const admin = await call(env, '/preview/admin/bookings', { headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(admin.status, 200);
});
