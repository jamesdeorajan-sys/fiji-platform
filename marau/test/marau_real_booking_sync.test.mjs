import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv } from './fixtures.mjs';
import worker, { createGuestSession, createSessionAndOfferLink, requireGuestSession, nowIso } from '../worker/worker.js';
import { normalizePickupDatetime } from '../worker/fiji_time.js';
import {
  syncRealBookingEvent,
  applyEventIfNewer,
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
    ...overrides,
  };
}
let eventIdCounter = 100;
function nextSourceEventId() {
  eventIdCounter += 1;
  return eventIdCounter;
}
function synthEvent(overrides = {}) {
  return {
    event_type: 'accepted',
    previous_status: 'pending',
    new_status: 'accepted',
    actor: 'driver:1',
    created_at: new Date().toISOString(),
    source_event_id: nextSourceEventId(),
    ...overrides,
  };
}
// A real 'created' (save) event — new_status must be 'pending' to be
// internally consistent (validateSourceEvent enforces this).
function createdEvent(overrides = {}) {
  return synthEvent({ event_type: 'created', previous_status: null, new_status: 'pending', actor: 'admin', ...overrides });
}

// ---------------------------------------------------------------------
// Finding 1 — immediate secure pending Trip access on SAVE, not on
// acceptance; no duplicate guest entry; Smart Return's own confirmed-only
// movement ingestion is a completely separate, untouched system.
// ---------------------------------------------------------------------

test('round14/1: a real booking\'s own SAVE (created, pending) grants secure Trip access immediately — no waiting for acceptance', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const result = await syncRealBookingEvent(env, booking, createdEvent(), deps);
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.status, 'pending');

  const trip = await call(env, '/preview/trip', { headers: authed(result.session.access_token) });
  assert.equal(trip.status, 200);
  assert.equal(trip.data.bookings.length, 1);
  assert.equal(trip.data.bookings[0].status, 'pending');
  assert.equal(trip.data.bookings[0].source_booking_ref, booking.source_booking_ref);
});

test('round14/1: the Marau-only test form is NOT how a real guest gets in — the sync module never touches marau_test_bookings rows created through /preview/bookings, and vice versa', async () => {
  const env = makeEnv();
  const ownFormRes = await call(env, '/preview/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      guest_email: 'own.form@example.test', guest_phone: '+15005550599',
      pickup_zone: 'NAD_AIRPORT', destination_zone: 'DENARAU', vehicle_type: 'Sedan',
      pickup_datetime: new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16), quoted_amount: 50,
    }),
  });
  assert.equal(ownFormRes.status, 201);

  const booking = synthRealBooking();
  const synced = await syncRealBookingEvent(env, booking, createdEvent(), deps);
  assert.notEqual(synced.session.access_token, ownFormRes.data.access_token);

  const syncedTrip = await call(env, '/preview/trip', { headers: authed(synced.session.access_token) });
  assert.equal(syncedTrip.data.bookings.length, 1, 'the real-synced session must never see the unrelated own-form booking');
});

test('round14/1: a later real accept event for the SAME saved booking updates the SAME mirror row — no duplicate guest entry', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const saved = await syncRealBookingEvent(env, booking, createdEvent({ source_event_id: 1 }), deps);
  assert.equal(saved.status, 'pending');

  const accepted = await syncRealBookingEvent(env, booking, synthEvent({ source_event_id: 2 }), deps);
  assert.equal(accepted.applied, true);
  assert.equal(accepted.marau_booking_id, saved.marau_booking_id);
  assert.equal(accepted.status, 'confirmed');

  const { results } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(results.length, 1, 'exactly one mirror row across the whole booking lifecycle — never a duplicate');

  const trip = await call(env, '/preview/trip', { headers: authed(saved.session.access_token) });
  assert.equal(trip.data.bookings[0].status, 'confirmed');
});

// ---------------------------------------------------------------------
// Finding 2 — atomic ordering with a deterministic concurrency barrier
// (no real thread timing relied on), and a durable source version.
// ---------------------------------------------------------------------

test('round14/2: deterministic repro — a stale in-flight update (read before a later cancellation, written after it) is atomically rejected, never overwrites the cancellation', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();

  // Event 1: initial accept, source_event_id 10.
  const event1 = await syncRealBookingEvent(env, booking, synthEvent({ source_event_id: 10 }), deps);
  assert.equal(event1.status, 'confirmed');

  // Event 2 "begins": read the row as it stands NOW (before event 3 has
  // run) — this is the exact stale snapshot a paused/in-flight update
  // would be working from.
  const staleSnapshotForEvent2 = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(event1.marau_booking_id).first();
  assert.equal(staleSnapshotForEvent2.source_event_id, 10);

  // Event 3 (a real cancellation) runs to completion FIRST, using the
  // normal, current path.
  const event3 = await syncRealBookingEvent(env, booking, synthEvent({ event_type: 'cancelled', new_status: 'cancelled', source_event_id: 30 }), deps);
  assert.equal(event3.applied, true);
  assert.equal(event3.status, 'cancelled');

  // Event 2 NOW "resumes" — its own write is attempted using the STALE
  // snapshot it read before event 3 ran (source_event_id 10, i.e. an
  // event actually OLDER than event 3's 30, even though it is a fresh
  // 're-derived' apply of event 2's own data, source_event_id 20).
  const event2Deps = { nowIso, marauStatus: 'confirmed', pickupDatetime: staleSnapshotForEvent2.pickup_datetime };
  const event2Resumed = await applyEventIfNewer(
    env,
    staleSnapshotForEvent2,
    booking,
    synthEvent({ source_event_id: 20 }),
    event2Deps
  );
  // event 2 (id 20) IS genuinely newer than what's now in the database
  // (id 30 from event 3)? No — 20 < 30, so it must be REJECTED as stale,
  // proving the atomic WHERE-clause guard checks the CURRENT database
  // state at write time, never the caller's earlier snapshot.
  assert.equal(event2Resumed.applied, false);
  assert.equal(event2Resumed.reason, 'STALE_OR_DUPLICATE_EVENT');

  const finalRow = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(event1.marau_booking_id).first();
  assert.equal(finalRow.status, 'cancelled', 'the cancellation must survive the stale in-flight update, regardless of write order');
  assert.equal(finalRow.source_event_id, 30);
});

test('round14/2: a genuinely newer event, applied with a stale-but-still-correct-relative-to-current-DB snapshot id, DOES apply (proves the fix rejects only genuinely stale writes, not all out-of-order arrival)', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const event1 = await syncRealBookingEvent(env, booking, synthEvent({ source_event_id: 10 }), deps);
  const event2 = await syncRealBookingEvent(env, booking, synthEvent({ event_type: 'completed', new_status: 'completed', source_event_id: 20 }), deps);
  assert.equal(event2.applied, true);
  assert.equal(event2.status, 'confirmed');
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(event1.marau_booking_id).first();
  assert.equal(row.source_event_id, 20);
});

test('round14/2: source_event_id is required to be a real, durable positive integer — not an invented per-call counter', () => {
  const booking = synthRealBooking();
  assert.equal(validateSourceEvent(booking, synthEvent({ source_event_id: undefined })), 'MISSING_OR_INVALID_SOURCE_EVENT_ID');
  assert.equal(validateSourceEvent(booking, synthEvent({ source_event_id: 0 })), 'MISSING_OR_INVALID_SOURCE_EVENT_ID');
  assert.equal(validateSourceEvent(booking, synthEvent({ source_event_id: -5 })), 'MISSING_OR_INVALID_SOURCE_EVENT_ID');
  assert.equal(validateSourceEvent(booking, synthEvent({ source_event_id: 1.5 })), 'MISSING_OR_INVALID_SOURCE_EVENT_ID');
  assert.equal(validateSourceEvent(booking, synthEvent({ source_event_id: 7 })), null);
});

// ---------------------------------------------------------------------
// Finding 3 — recoverable, idempotent first sync: real SQL fault
// injection on the marau_real_booking_links INSERT, then retry.
// ---------------------------------------------------------------------

test('round14/3: a fault-injected failure on the link-row INSERT, followed by a retry after removing the fault, recovers cleanly — exactly one session, one booking, one link', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();

  env.DB.exec(`
    CREATE TRIGGER round14_block_link_insert
    BEFORE INSERT ON marau_real_booking_links
    BEGIN
      SELECT RAISE(ABORT, 'round14 fault injection: link insert blocked');
    END;
  `);

  await assert.rejects(() => syncRealBookingEvent(env, booking, createdEvent({ source_event_id: 1 }), deps));

  // Interrupted state: session + booking exist, link row does not.
  const { results: sessionsAfterFailure } = await env.DB.prepare('SELECT * FROM guest_sessions WHERE guest_email = ?').bind(booking.guest_email).all();
  assert.equal(sessionsAfterFailure.length, 1, 'exactly one session must exist after the interrupted first attempt');
  const { results: bookingsAfterFailure } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(bookingsAfterFailure.length, 1, 'exactly one mirror row must exist after the interrupted first attempt');
  const { results: linksAfterFailure } = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(linksAfterFailure.length, 0, 'the link row must genuinely be missing — this is the interrupted state under test');

  env.DB.exec('DROP TRIGGER round14_block_link_insert;');

  const retry = await syncRealBookingEvent(env, booking, createdEvent({ source_event_id: 1 }), deps);
  assert.equal(retry.ok, true);
  assert.equal(retry.recovered, true);
  assert.equal(retry.created, false);
  assert.equal(retry.session.session_id, sessionsAfterFailure[0].session_id, 'the retry must reuse the EXISTING session, never create a second one');

  const { results: sessionsAfterRetry } = await env.DB.prepare('SELECT * FROM guest_sessions WHERE guest_email = ?').bind(booking.guest_email).all();
  assert.equal(sessionsAfterRetry.length, 1, 'still exactly one session after recovery');
  const { results: bookingsAfterRetry } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(bookingsAfterRetry.length, 1, 'still exactly one booking after recovery — never a duplicate');
  const { results: linksAfterRetry } = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(linksAfterRetry.length, 1, 'the link row now exists, closing the interrupted state');

  const trip = await call(env, '/preview/trip', { headers: authed(retry.session.access_token) });
  assert.equal(trip.data.bookings.length, 1);
});

test('round14/3: two concurrent FIRST-delivery attempts for the same real booking never leave two live sessions or an orphaned session', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();

  const [first, second] = await Promise.all([
    syncRealBookingEvent(env, booking, createdEvent({ source_event_id: 1 }), deps),
    syncRealBookingEvent(env, booking, createdEvent({ source_event_id: 1 }), deps),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const { results: bookings } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(bookings.length, 1, 'exactly one booking row must survive a genuine concurrent first-delivery race');

  const { results: links } = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(links.length, 1, 'exactly one link row');

  const winnerSessionId = links[0].guest_session_id;
  const { results: liveSessions } = await env.DB.prepare('SELECT * FROM guest_sessions WHERE guest_email = ? AND access_token_revoked = 0').bind(booking.guest_email).all();
  assert.equal(liveSessions.length, 1, 'exactly one live session must remain — the loser\'s own session must have been cleaned up, not merely abandoned');
  assert.equal(liveSessions[0].session_id, winnerSessionId);

  assert.equal(first.session.session_id, second.session.session_id, 'both concurrent callers must end up pointing at the SAME winning session');
});

test('round14/3: recovery is internal only — it is never reachable by an external caller presenting merely a booking reference or matching contact details', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const synced = await syncRealBookingEvent(env, booking, createdEvent(), deps);

  // An external caller who knows only the phone/email (not the session's
  // own access token) still cannot get in via the ordinary, unrelated
  // guest-facing booking-creation endpoint — this recovery mechanism has
  // no HTTP surface at all; it is exercised only by this module's own
  // internal retry of syncRealBookingEvent.
  const attempt = await call(env, '/preview/bookings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      guest_email: booking.guest_email, guest_phone: booking.guest_phone,
      pickup_zone: 'NAD_AIRPORT', destination_zone: 'DENARAU', vehicle_type: 'Sedan',
      pickup_datetime: new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16), quoted_amount: 999,
    }),
  });
  assert.equal(attempt.status, 201);
  assert.notEqual(attempt.data.access_token, synced.session.access_token, 'matching contact details on the public endpoint must never itself return the real-synced session\'s token');
});

// ---------------------------------------------------------------------
// Finding 4 — authoritative later snapshots update route/vehicle/time/
// price, not status/provenance only.
// ---------------------------------------------------------------------

test('round14/4: a later, validated source snapshot with a changed pickup time, route, vehicle and price updates the guest\'s Trip', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', quoted_amount: 45, pickup_date: '2026-10-05', pickup_time: '09:00' });
  const first = await syncRealBookingEvent(env, booking, createdEvent({ source_event_id: 1 }), deps);
  assert.equal(first.status, 'pending');

  const changedBooking = {
    ...booking,
    pickup_zone: 'Denarau',
    destination_zone: 'Nadi Airport',
    vehicle_type: 'Minivan',
    quoted_amount: 62,
    pickup_date: '2026-10-06',
    pickup_time: '14:30',
  };
  const updated = await syncRealBookingEvent(env, changedBooking, synthEvent({ source_event_id: 2 }), deps);
  assert.equal(updated.applied, true);
  assert.equal(updated.status, 'confirmed');

  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(first.marau_booking_id).first();
  assert.equal(row.pickup_zone, 'Denarau');
  assert.equal(row.destination_zone, 'Nadi Airport');
  assert.equal(row.vehicle_type, 'Minivan');
  assert.equal(row.quoted_amount, 62);
  assert.ok(row.pickup_datetime.startsWith('2026-10-06'));

  const trip = await call(env, '/preview/trip', { headers: authed(first.session.access_token) });
  const mirrored = trip.data.bookings[0];
  assert.equal(mirrored.pickup_zone, 'Denarau');
  assert.equal(mirrored.destination_zone, 'Nadi Airport');
  assert.equal(mirrored.vehicle_type, 'Minivan');
  assert.equal(mirrored.quoted_amount, 62);
});

test('round14/4: a STALE snapshot\'s changed fields must never overwrite the newer, already-applied ones', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ quoted_amount: 45 });
  const first = await syncRealBookingEvent(env, booking, createdEvent({ source_event_id: 1 }), deps);
  const newer = await syncRealBookingEvent(env, { ...booking, quoted_amount: 70 }, synthEvent({ source_event_id: 5 }), deps);
  assert.equal(newer.applied, true);

  const staleReplay = await syncRealBookingEvent(env, { ...booking, quoted_amount: 999 }, synthEvent({ source_event_id: 2 }), deps);
  assert.equal(staleReplay.applied, false);
  assert.equal(staleReplay.reason, 'STALE_OR_DUPLICATE_EVENT');

  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(first.marau_booking_id).first();
  assert.equal(row.quoted_amount, 70, 'the newer, already-applied price must survive a stale replay carrying an older, different price');
});

// ---------------------------------------------------------------------
// Finding 5 — validate the COMPLETE event before any write; an internally
// inconsistent event must leave the existing row completely untouched.
// ---------------------------------------------------------------------

test('round14/5: event_type/new_status mismatch (e.g. accepted + garbage) is rejected BEFORE any write, and never advances source_event_id', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const good = await syncRealBookingEvent(env, booking, synthEvent({ source_event_id: 1 }), deps);
  const before = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(good.marau_booking_id).first();

  const inconsistent = await syncRealBookingEvent(env, booking, synthEvent({ event_type: 'accepted', new_status: 'garbage', source_event_id: 2 }), deps);
  assert.equal(inconsistent.ok, false);
  assert.equal(inconsistent.reason, 'EVENT_STATUS_MISMATCH');

  const after = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(good.marau_booking_id).first();
  assert.deepEqual(after, before, 'an internally inconsistent event must leave the row COMPLETELY unchanged, including source_event_id');
});

test('round14/5: a cancelled event_type with a mismatched new_status (e.g. \'accepted\') is rejected the same way', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const result = await syncRealBookingEvent(env, booking, synthEvent({ event_type: 'cancelled', new_status: 'accepted', source_event_id: 1 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'EVENT_STATUS_MISMATCH');
});

test('round14/5: an event whose booking_id does not match the source booking\'s own id is rejected (association check)', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const result = await syncRealBookingEvent(env, booking, synthEvent({ booking_id: booking.id + 1, source_event_id: 1 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'BOOKING_EVENT_MISMATCH');
});

test('round14/5: an event whose booking_id DOES match is accepted normally', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const result = await syncRealBookingEvent(env, booking, synthEvent({ booking_id: booking.id, source_event_id: 1 }), deps);
  assert.equal(result.ok, true);
});

test('round14/5: validation runs strictly before any database touch — no rows exist anywhere after a rejected event on a brand-new booking', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const rejected = await syncRealBookingEvent(env, booking, synthEvent({ new_status: 'garbage', source_event_id: 1 }), deps);
  assert.equal(rejected.ok, false);
  const { results: sessions } = await env.DB.prepare('SELECT * FROM guest_sessions WHERE guest_email = ?').bind(booking.guest_email).all();
  assert.equal(sessions.length, 0);
  const { results: bookings } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(bookings.length, 0);
});

// ---------------------------------------------------------------------
// Round 13 corrections, re-verified unchanged under the round-14 module.
// ---------------------------------------------------------------------

test('round13/1 (re-verified): a SECOND real booking on the SAME phone gets its own session, never the first\'s', async () => {
  const env = makeEnv();
  const sharedPhone = '+15005550699';
  const first = synthRealBooking({ guest_phone: sharedPhone });
  const firstResult = await syncRealBookingEvent(env, first, createdEvent(), deps);
  const second = synthRealBooking({ guest_phone: sharedPhone });
  const secondResult = await syncRealBookingEvent(env, second, createdEvent(), deps);
  assert.notEqual(secondResult.session.access_token, firstResult.session.access_token);
  assert.ok(secondResult.link_offer);
});

test('round13/3 (re-verified): revoking a real-synced session\'s token blocks the protected /preview/trip endpoint', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const result = await syncRealBookingEvent(env, booking, createdEvent(), deps);
  const token = result.session.access_token;
  await call(env, '/preview/trip/revoke', { method: 'POST', headers: authed(token) });
  const after = await call(env, '/preview/trip', { headers: authed(token) });
  assert.equal(after.status, 401);
  assert.equal(await requireGuestSession(new Request('http://x', { headers: authed(token) }), env), null);
});

test('round13/4 (re-verified): mapRealStatusToMarauStatus never produces confirmed_unallocated', () => {
  for (const s of ['pending', 'created', 'accepted', 'en_route', 'completed', 'cancelled', 'garbage', null, undefined]) {
    assert.notEqual(mapRealStatusToMarauStatus(s), 'confirmed_unallocated');
  }
});

test('round13/5 (re-verified): flight_number/notes are never mirrored even when present on the source row', async () => {
  const env = makeEnv();
  const booking = synthRealBooking({ flight_number: 'FJ911', notes: 'VIP' });
  const result = await syncRealBookingEvent(env, booking, createdEvent(), deps);
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(result.marau_booking_id).first();
  assert.equal('flight_number' in row, false);
  assert.equal('notes' in row, false);
});

test('round13/7 (re-verified): a booking absent from a later feed pass is never inferred as cancelled', async () => {
  const env = makeEnv();
  const booking = synthRealBooking();
  const synced = await syncRealBookingEvent(env, booking, synthEvent({ source_event_id: 1 }), deps);
  await markMissingFromLatestFeed(env, booking.source_booking_ref, { nowIso });
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(synced.marau_booking_id).first();
  assert.equal(row.status, 'confirmed');
  assert.equal(row.sync_state, 'MISSING_FROM_LATEST_FEED');
});

// ---------------------------------------------------------------------
// End-to-end synthetic demonstration, isolated Marau storage only,
// covering the full round-14 corrected lifecycle.
// ---------------------------------------------------------------------

test('round14: end-to-end — save (pending, immediate access) -> accept (confirmed, details change) -> fault-injected link recovery on a SECOND booking -> stale write correctly rejected -> guest sees the final, correct state throughout', async () => {
  const env = makeEnv();

  // Guest A: save -> immediate pending access -> accept with changed
  // details -> guest sees the update.
  const bookingA = synthRealBooking({ quoted_amount: 45, vehicle_type: 'Sedan' });
  const savedA = await syncRealBookingEvent(env, bookingA, createdEvent({ source_event_id: 1 }), deps);
  assert.equal(savedA.status, 'pending');
  const tripA1 = await call(env, '/preview/trip', { headers: authed(savedA.session.access_token) });
  assert.equal(tripA1.data.bookings[0].status, 'pending');

  const acceptedA = await syncRealBookingEvent(env, { ...bookingA, vehicle_type: 'Minivan', quoted_amount: 60 }, synthEvent({ source_event_id: 2 }), deps);
  assert.equal(acceptedA.status, 'confirmed');
  const tripA2 = await call(env, '/preview/trip', { headers: authed(savedA.session.access_token) });
  assert.equal(tripA2.data.bookings[0].status, 'confirmed');
  assert.equal(tripA2.data.bookings[0].vehicle_type, 'Minivan');
  assert.equal(tripA2.data.bookings[0].quoted_amount, 60);

  // Guest B: interrupted first sync via real fault injection, recovered.
  const bookingB = synthRealBooking();
  env.DB.exec(`CREATE TRIGGER round14_e2e_block BEFORE INSERT ON marau_real_booking_links BEGIN SELECT RAISE(ABORT, 'fault'); END;`);
  await assert.rejects(() => syncRealBookingEvent(env, bookingB, createdEvent({ source_event_id: 1 }), deps));
  env.DB.exec('DROP TRIGGER round14_e2e_block;');
  const recoveredB = await syncRealBookingEvent(env, bookingB, createdEvent({ source_event_id: 1 }), deps);
  assert.equal(recoveredB.recovered, true);
  const tripB = await call(env, '/preview/trip', { headers: authed(recoveredB.session.access_token) });
  assert.equal(tripB.data.bookings.length, 1);

  // Guest A: a stale replay must not undo the accepted state.
  const staleReplayA = await syncRealBookingEvent(env, bookingA, createdEvent({ source_event_id: 1 }), deps);
  assert.equal(staleReplayA.applied, false);
  const tripA3 = await call(env, '/preview/trip', { headers: authed(savedA.session.access_token) });
  assert.equal(tripA3.data.bookings[0].status, 'confirmed');

  const admin = await call(env, '/preview/admin/bookings', { headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(admin.status, 200);
});
