import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv } from './fixtures.mjs';
import worker, { createGuestSession, createSessionAndOfferLink, requireGuestSession, nowIso } from '../worker/worker.js';
import { normalizePickupDatetime } from '../worker/fiji_time.js';
import {
  syncRealBookingEvent,
  applyEventIfNewer,
  applySourceSnapshot,
  markMissingFromLatestFeed,
  mapRealStatusToMarauStatus,
  validateSourceEvent,
} from '../worker/real_booking_sync.js';

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
    status: 'accepted',
    ...overrides,
  };
}
let eventIdCounter = 100;
function nextSourceEventId() {
  eventIdCounter += 1;
  return eventIdCounter;
}
// booking_id is now REQUIRED (round 15, finding 3) — always sourced from
// the booking passed in, matching real association.
function synthEvent(booking, overrides = {}) {
  return {
    event_type: 'accepted',
    previous_status: 'pending',
    new_status: 'accepted',
    actor: 'driver:1',
    created_at: new Date().toISOString(),
    source_event_id: nextSourceEventId(),
    booking_id: booking.id,
    ...overrides,
  };
}
function createdEvent(booking, overrides = {}) {
  return synthEvent(booking, { event_type: 'created', previous_status: null, new_status: 'pending', actor: 'admin', ...overrides });
}
// Round 15, finding 3 — a legitimate real pairing: a WhatsApp-negotiated
// booking created ALREADY accepted, driver pre-assigned.
function createdAlreadyAcceptedEvent(booking, overrides = {}) {
  return synthEvent(booking, { event_type: 'created', previous_status: null, new_status: 'accepted', actor: 'admin', ...overrides });
}

// ---------------------------------------------------------------------
// Finding 1 (P0) — server-controlled provenance; a guest can never
// adopt, steal, or be given a sync-owned row/session.
// ---------------------------------------------------------------------

test('round15/1 P0 repro: a guest who pre-creates a booking under the sync\'s naming scheme never has it adopted, and a later sync for a DIFFERENT guest never leaks into the guest\'s session', async () => {
  const env = makeEnv();

  // Guest A predicts/guesses the OLD (round-13/14) naming scheme and
  // pre-creates a booking under it, with A's own contact details.
  const guestARes = await call(env, '/preview/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      guest_email: 'guest.a@example.test', guest_phone: '+15005550701',
      client_booking_ref: 'REAL-SYNC-9001',
      pickup_zone: 'DENARAU', destination_zone: 'NAD_AIRPORT', vehicle_type: 'Sedan',
      pickup_datetime: new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16), quoted_amount: 45,
    }),
  });
  assert.equal(guestARes.status, 201);
  const guestAToken = guestARes.data.access_token;

  // Guest B's REAL source booking, id=9001, is synced.
  const bookingB = synthRealBooking({ id: 9001, source_booking_ref: '9001', guest_email: 'guest.b@example.test', guest_phone: '+15005550702', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau' });
  const syncedB = await syncRealBookingEvent(env, bookingB, createdEvent(bookingB), deps);
  assert.equal(syncedB.ok, true);
  assert.equal(syncedB.created, true, 'the sync must create its OWN new row/session, never adopt guest A\'s');
  assert.notEqual(syncedB.session.access_token, guestAToken, 'guest A\'s pre-created session must never become the sync\'s session');

  // Guest A's trip must show ONLY guest A's own booking — never B's real
  // pickup/destination.
  const tripA = await call(env, '/preview/trip', { headers: authed(guestAToken) });
  assert.equal(tripA.data.bookings.length, 1);
  assert.equal(tripA.data.bookings[0].pickup_zone, 'DENARAU');
  assert.equal(tripA.data.bookings[0].destination_zone, 'NAD_AIRPORT');
  assert.notEqual(tripA.data.bookings[0].pickup_zone, bookingB.pickup_zone, 'guest A must never see guest B\'s real pickup zone — this is the exact P0 repro');

  // Guest B's own session sees only its real booking.
  const tripB = await call(env, '/preview/trip', { headers: authed(syncedB.session.access_token) });
  assert.equal(tripB.data.bookings.length, 1);
  assert.equal(tripB.data.bookings[0].pickup_zone, 'Nadi Airport');
});

test('round15/1: concurrent first-creation race for the SAME source booking is resolved by the database itself (partial unique index), never by application-level guesswork', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();

  const [first, second] = await Promise.all([
    syncRealBookingEvent(env, booking, createdEvent(booking, { source_event_id: 1 }), deps),
    syncRealBookingEvent(env, booking, createdEvent(booking, { source_event_id: 1 }), deps),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.session.session_id, second.session.session_id, 'both callers must converge on the SAME winning session');

  const { results: owned } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? AND source_sync_owned = 1').bind(booking.source_booking_ref).all();
  assert.equal(owned.length, 1, 'the database\'s own partial unique index guarantees exactly one owned row, never two');

  const { results: liveSessions } = await env.DB.prepare('SELECT * FROM guest_sessions WHERE guest_email = ? AND access_token_revoked = 0').bind(booking.guest_email).all();
  assert.equal(liveSessions.length, 1, 'the losing session must have been cleaned up, not merely abandoned');
});

test('round15/1: interrupted recovery (fault-injected link insert) still works correctly under the corrected, provenance-based ownership check', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();

  env.DB.exec(`CREATE TRIGGER round15_block_link BEFORE INSERT ON marau_real_booking_links BEGIN SELECT RAISE(ABORT, 'fault'); END;`);
  await assert.rejects(() => syncRealBookingEvent(env, booking, createdEvent(booking, { source_event_id: 1 }), deps));
  env.DB.exec('DROP TRIGGER round15_block_link;');

  const retry = await syncRealBookingEvent(env, booking, createdEvent(booking, { source_event_id: 1 }), deps);
  assert.equal(retry.ok, true);
  assert.equal(retry.recovered, true);

  const { results: owned } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? AND source_sync_owned = 1').bind(booking.source_booking_ref).all();
  assert.equal(owned.length, 1);
  const { results: sessions } = await env.DB.prepare('SELECT * FROM guest_sessions WHERE guest_email = ?').bind(booking.guest_email).all();
  assert.equal(sessions.length, 1, 'still exactly one session after fault-injected recovery');
});

test('round15/1: revocation of a real-synced session is unaffected by the ownership fix', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const synced = await syncRealBookingEvent(env, booking, createdEvent(booking), deps);
  await call(env, '/preview/trip/revoke', { method: 'POST', headers: authed(synced.session.access_token) });
  const after = await call(env, '/preview/trip', { headers: authed(synced.session.access_token) });
  assert.equal(after.status, 401);
  assert.equal(await requireGuestSession(new Request('http://x', { headers: authed(synced.session.access_token) }), env), null);
});

test('round15/1: cross-guest isolation — two DIFFERENT real bookings, synced back to back, never share a session or see each other\'s details', async () => {
  const env = makeEnv();
  const bookingA = synthRealBooking({ pickup_zone: 'Nadi Airport', destination_zone: 'Denarau' });
  const bookingC = synthRealBooking({ pickup_zone: 'Coral Coast', destination_zone: 'Nadi Airport' });
  const syncedA = await syncRealBookingEvent(env, bookingA, createdEvent(bookingA), deps);
  const syncedC = await syncRealBookingEvent(env, bookingC, createdEvent(bookingC), deps);
  assert.notEqual(syncedA.session.access_token, syncedC.session.access_token);

  const tripA = await call(env, '/preview/trip', { headers: authed(syncedA.session.access_token) });
  assert.equal(tripA.data.bookings.length, 1);
  assert.equal(tripA.data.bookings[0].pickup_zone, 'Nadi Airport');
  const tripC = await call(env, '/preview/trip', { headers: authed(syncedC.session.access_token) });
  assert.equal(tripC.data.bookings.length, 1);
  assert.equal(tripC.data.bookings[0].pickup_zone, 'Coral Coast');
});

// ---------------------------------------------------------------------
// Finding 2 — reject invalid prices BEFORE numeric coercion.
// ---------------------------------------------------------------------

test('round15/2: quoted_amount null/blank/boolean/negative/non-finite are all rejected, never silently coerced to 0', async () => {
  const env = makeEnv();
  const cases = [
    { value: null, expected: 'MISSING_QUOTED_AMOUNT' },
    { value: undefined, expected: 'MISSING_QUOTED_AMOUNT' },
    { value: '', expected: 'MISSING_QUOTED_AMOUNT' },
    { value: '   ', expected: 'MISSING_QUOTED_AMOUNT' },
    { value: true, expected: 'INVALID_QUOTED_AMOUNT' },
    { value: false, expected: 'INVALID_QUOTED_AMOUNT' },
    { value: -5, expected: 'INVALID_QUOTED_AMOUNT' },
    { value: NaN, expected: 'INVALID_QUOTED_AMOUNT' },
    { value: Infinity, expected: 'INVALID_QUOTED_AMOUNT' },
    { value: 'not-a-number', expected: 'INVALID_QUOTED_AMOUNT' },
  ];
  for (const { value, expected } of cases) {
    const booking = synthRealBooking({ quoted_amount: value });
    const result = await syncRealBookingEvent(env, booking, createdEvent(booking), deps);
    assert.equal(result.ok, false, `quoted_amount ${JSON.stringify(value)} must be rejected`);
    assert.equal(result.reason, expected, `quoted_amount ${JSON.stringify(value)} must be rejected with ${expected}`);
    const { results } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
    assert.equal(results.length, 0, 'no row must exist for a rejected quoted_amount');
  }
});

test('round15/2: an explicit, deliberate quoted_amount of 0 is preserved (a legitimate free/comped fare), matching the existing contract', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ quoted_amount: 0 });
  const result = await syncRealBookingEvent(env, booking, createdEvent(booking), deps);
  assert.equal(result.ok, true);
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(result.marau_booking_id).first();
  assert.equal(row.quoted_amount, 0);
});

test('round15/2: a numeric-string quoted_amount ("45") is accepted, still rejecting a rejected update leaves prior state unchanged', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ quoted_amount: '45' });
  const good = await syncRealBookingEvent(env, booking, createdEvent(booking, { source_event_id: 1 }), deps);
  assert.equal(good.ok, true);
  const before = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(good.marau_booking_id).first();

  const invalidUpdate = await syncRealBookingEvent(env, { ...booking, quoted_amount: null }, synthEvent(booking, { source_event_id: 2 }), deps);
  assert.equal(invalidUpdate.ok, false);
  assert.equal(invalidUpdate.reason, 'MISSING_QUOTED_AMOUNT');

  const after = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(good.marau_booking_id).first();
  assert.deepEqual(after, before, 'a rejected update must leave the FULL previous state unchanged');
});

// ---------------------------------------------------------------------
// Finding 3 — the corrected source-event contract.
// ---------------------------------------------------------------------

test('round15/3: a booking created ALREADY accepted (created + new_status: accepted — the WhatsApp-negotiated path) is a legitimate pairing, not rejected', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ status: 'accepted' });
  const result = await syncRealBookingEvent(env, booking, createdAlreadyAcceptedEvent(booking), deps);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'confirmed', 'created+accepted must map to confirmed immediately, no separate accept event required');
});

test('round15/3: unevidenced event_type/new_status combinations are still rejected — the fix is not a looser blanket rule', async () => {
  const env = makeEnv();
  const cases = [
    { event_type: 'created', new_status: 'cancelled' },
    { event_type: 'created', new_status: 'en_route' },
    { event_type: 'accepted', new_status: 'pending' },
    { event_type: 'accepted', new_status: 'en_route' },
    { event_type: 'en_route', new_status: 'completed' },
    { event_type: 'cancelled', new_status: 'accepted' },
  ];
  for (const overrides of cases) {
    const booking = synthRealBooking();
    const result = await syncRealBookingEvent(env, booking, synthEvent(booking, overrides), deps);
    assert.equal(result.ok, false, `${overrides.event_type}+${overrides.new_status} must still be rejected`);
    assert.equal(result.reason, 'EVENT_STATUS_MISMATCH');
  }
});

test('round15/3: booking_id is now REQUIRED, not optional — an event with no booking_id at all is rejected', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const result = await syncRealBookingEvent(env, booking, synthEvent(booking, { booking_id: undefined }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MISSING_EVENT_BOOKING_ID');
});

test('round15/3: a mismatched booking_id is rejected (association check, unchanged from round 14)', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const result = await syncRealBookingEvent(env, booking, synthEvent(booking, { booking_id: booking.id + 1 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'BOOKING_EVENT_MISMATCH');
});

test('round15/3: validateSourceEvent directly — every evidenced pairing passes, every unevidenced one fails', () => {
  const booking = synthRealBooking();
  const evidenced = [
    { event_type: 'created', new_status: 'pending' },
    { event_type: 'created', new_status: 'accepted' },
    { event_type: 'accepted', new_status: 'accepted' },
    { event_type: 'en_route', new_status: 'en_route' },
    { event_type: 'completed', new_status: 'completed' },
    { event_type: 'cancelled', new_status: 'cancelled' },
  ];
  for (const pair of evidenced) {
    assert.equal(validateSourceEvent(booking, synthEvent(booking, pair)), null, `${pair.event_type}+${pair.new_status} should be valid`);
  }
});

// ---------------------------------------------------------------------
// Finding 4 — the missing-event reliability gap: a snapshot-based
// reconciliation fallback, demonstrated synthetically.
// ---------------------------------------------------------------------

test('round15/4: a real booking whose \'created\' event never logged (simulating logBookingEvent\'s own silent catch) is still discoverable via a snapshot reconciliation pass', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ status: 'pending' });
  // No syncRealBookingEvent call at all here — simulating the event
  // never having been written to booking_events in the first place.
  const result = await applySourceSnapshot(env, booking, { snapshotSequence: 1, deps });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.status, 'pending');
  assert.equal(result.via, 'snapshot');

  const trip = await call(env, '/preview/trip', { headers: authed(result.session.access_token) });
  assert.equal(trip.data.bookings.length, 1);
  assert.equal(trip.data.bookings[0].status, 'pending');
});

test('round15/4: a later detail change with NO corresponding event is caught by the next snapshot pass', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ status: 'accepted', quoted_amount: 45 });
  const first = await applySourceSnapshot(env, booking, { snapshotSequence: 1, deps });
  assert.equal(first.status, 'confirmed');

  // The real price changed, but (simulating a missed booking_events row)
  // no event carries it — only the next snapshot pass sees it.
  const changed = { ...booking, quoted_amount: 80, vehicle_type: 'Minivan' };
  const second = await applySourceSnapshot(env, changed, { snapshotSequence: 2, deps });
  assert.equal(second.applied, true);

  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(first.marau_booking_id).first();
  assert.equal(row.quoted_amount, 80);
  assert.equal(row.vehicle_type, 'Minivan');
});

test('round15/4: a stale (older-sequence) snapshot never rolls back a newer, already-applied one', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ status: 'accepted', quoted_amount: 45 });
  const first = await applySourceSnapshot(env, booking, { snapshotSequence: 1, deps });
  await applySourceSnapshot(env, { ...booking, quoted_amount: 90 }, { snapshotSequence: 5, deps });

  const staleReplay = await applySourceSnapshot(env, { ...booking, quoted_amount: 1 }, { snapshotSequence: 2, deps });
  assert.equal(staleReplay.applied, false);
  assert.equal(staleReplay.reason, 'STALE_OR_DUPLICATE_SNAPSHOT');

  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(first.marau_booking_id).first();
  assert.equal(row.quoted_amount, 90, 'the newer snapshot\'s price must survive a stale replay');
});

test('round15/4: snapshotSequence must be a real, durable positive integer — never invented internally, and never conflated with source_event_id', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const missing = await applySourceSnapshot(env, booking, { snapshotSequence: undefined, deps });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'MISSING_OR_INVALID_SNAPSHOT_SEQUENCE');
  const zero = await applySourceSnapshot(env, booking, { snapshotSequence: 0, deps });
  assert.equal(zero.ok, false);

  // Event-driven and snapshot-driven ordering are tracked in SEPARATE
  // columns — applying a snapshot must never touch source_event_id, and
  // vice versa.
  const eventApplied = await syncRealBookingEvent(env, booking, createdEvent(booking, { source_event_id: 7 }), deps);
  const row1 = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(eventApplied.marau_booking_id).first();
  assert.equal(row1.source_event_id, 7);
  assert.equal(row1.source_snapshot_sequence, null);

  const snapApplied = await applySourceSnapshot(env, { ...booking, quoted_amount: 99 }, { snapshotSequence: 3, deps });
  assert.equal(snapApplied.applied, true);
  const row2 = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(eventApplied.marau_booking_id).first();
  assert.equal(row2.source_event_id, 7, 'a snapshot apply must never overwrite the event-ordering column');
  assert.equal(row2.source_snapshot_sequence, 3);
});

// ---------------------------------------------------------------------
// Rounds 13/14 corrections, re-verified unchanged under the round-15
// module.
// ---------------------------------------------------------------------

test('round14/2 (re-verified): the atomic TOCTOU fix still holds — a stale in-flight update never overwrites a newer cancellation', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const event1 = await syncRealBookingEvent(env, booking, synthEvent(booking, { source_event_id: 10 }), deps);
  const staleSnapshotForEvent2 = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(event1.marau_booking_id).first();
  const event3 = await syncRealBookingEvent(env, booking, synthEvent(booking, { event_type: 'cancelled', new_status: 'cancelled', source_event_id: 30 }), deps);
  assert.equal(event3.status, 'cancelled');
  const event2Resumed = await applyEventIfNewer(env, staleSnapshotForEvent2, booking, synthEvent(booking, { source_event_id: 20 }), { nowIso, marauStatus: 'confirmed', pickupDatetime: staleSnapshotForEvent2.pickup_datetime, quotedAmount: staleSnapshotForEvent2.quoted_amount });
  assert.equal(event2Resumed.applied, false);
  const finalRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(event1.marau_booking_id).first();
  assert.equal(finalRow.status, 'cancelled');
});

test('round13/7 (re-verified): a booking absent from a later feed pass is never inferred as cancelled', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const synced = await syncRealBookingEvent(env, booking, synthEvent(booking, { source_event_id: 1 }), deps);
  await markMissingFromLatestFeed(env, booking.source_booking_ref, { nowIso });
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(synced.marau_booking_id).first();
  assert.equal(row.status, 'confirmed');
  assert.equal(row.sync_state, 'MISSING_FROM_LATEST_FEED');
});

test('round13/4 (re-verified): mapRealStatusToMarauStatus never produces confirmed_unallocated', () => {
  for (const s of ['pending', 'created', 'accepted', 'en_route', 'completed', 'cancelled', 'garbage', null, undefined]) {
    assert.notEqual(mapRealStatusToMarauStatus(s), 'confirmed_unallocated');
  }
});

test('round13/5 (re-verified): flight_number/notes are never mirrored even when present on the source row', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ flight_number: 'FJ911', notes: 'VIP' });
  const result = await syncRealBookingEvent(env, booking, createdEvent(booking), deps);
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(result.marau_booking_id).first();
  assert.equal('flight_number' in row, false);
  assert.equal('notes' in row, false);
});

// ---------------------------------------------------------------------
// End-to-end synthetic demonstration, isolated Marau storage only,
// covering the full round-15 corrected lifecycle.
// ---------------------------------------------------------------------

test('round15: end-to-end — a guest-guessed reference collision never leaks data, an already-accepted creation grants confirmed access immediately, a missed event is caught by snapshot reconciliation, and invalid prices never corrupt state', async () => {
  const env = makeEnv();

  // Attacker/guest pre-creates a colliding ref for a DIFFERENT future
  // source booking id.
  const preCreated = await call(env, '/preview/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      guest_email: 'pre.created@example.test', guest_phone: '+15005550801',
      client_booking_ref: 'REAL-SYNC-8500',
      pickup_zone: 'SUVA', destination_zone: 'NADI', vehicle_type: 'Sedan',
      pickup_datetime: new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16), quoted_amount: 10,
    }),
  });
  assert.equal(preCreated.status, 201);

  const realBooking = synthRealBooking({ id: 8500, source_booking_ref: '8500', status: 'accepted' });
  const synced = await syncRealBookingEvent(env, realBooking, createdAlreadyAcceptedEvent(realBooking), deps);
  assert.equal(synced.created, true);
  assert.equal(synced.status, 'confirmed');
  assert.notEqual(synced.session.access_token, preCreated.data.access_token);

  const preCreatedTrip = await call(env, '/preview/trip', { headers: authed(preCreated.data.access_token) });
  assert.equal(preCreatedTrip.data.bookings[0].pickup_zone, 'SUVA', 'the pre-created guest booking must be completely untouched');

  // A second real booking's creation event never logged (simulated) —
  // discovered only via snapshot.
  const missedBooking = synthRealBooking({ status: 'pending' });
  const rejectedInvalid = await applySourceSnapshot(env, { ...missedBooking, quoted_amount: null }, { snapshotSequence: 1, deps });
  assert.equal(rejectedInvalid.ok, false);
  assert.equal(rejectedInvalid.reason, 'MISSING_QUOTED_AMOUNT');
  const discovered = await applySourceSnapshot(env, missedBooking, { snapshotSequence: 1, deps });
  assert.equal(discovered.created, true);
  assert.equal(discovered.status, 'pending');

  const admin = await call(env, '/preview/admin/bookings', { headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(admin.status, 200);
});
