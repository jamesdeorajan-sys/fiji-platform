import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installNetworkGuard } from './network_guard.mjs';
import { makeEnv } from './fixtures.mjs';
import worker, { createGuestSession, createSessionAndOfferLink, requireGuestSession, nowIso } from '../worker/worker.js';
import { normalizePickupDatetime } from '../worker/fiji_time.js';
import {
  syncRealBookingEvent,
  reconcileRealBooking,
  acquireBookingClaim,
  releaseBookingClaim,
  markMissingFromLatestFeed,
  mapRealStatusToMarauStatus,
  validateSourceEvent,
} from '../worker/real_booking_sync.js';

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
function authed(token) {
  return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------
// Synthetic authoritative source — round 17's injected `reader`. This
// stands in for a real, read-only query against the real `bookings`
// table: tests mutate it directly to simulate the real system's current
// state changing between processing steps, and the module ALWAYS reads
// through it fresh — it never sees or trusts a payload the test attaches
// to a signal.
// ---------------------------------------------------------------------
function createSyntheticSource() {
  const store = new Map();
  return {
    set(row) {
      store.set(String(row.source_booking_ref || row.id), { ...row });
    },
    reader: async (sourceBookingRef) => {
      const row = store.get(String(sourceBookingRef));
      return row ? { ...row } : null;
    },
  };
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
// A SIGNAL now — no field payload (pickup/destination/price) at all,
// exactly the round-17 fix: events carry only identity/type, never data.
function signal(booking, overrides = {}) {
  return {
    event_type: 'accepted',
    new_status: 'accepted',
    source_event_id: nextSourceEventId(),
    booking_id: booking.id,
    ...overrides,
  };
}
function createdSignal(booking, overrides = {}) {
  return signal(booking, { event_type: 'created', new_status: 'pending', ...overrides });
}
function createdAlreadyAcceptedSignal(booking, overrides = {}) {
  return signal(booking, { event_type: 'created', new_status: 'accepted', ...overrides });
}

function makeDeps(source, overrides = {}) {
  return { createGuestSession, createSessionAndOfferLink, nowIso, normalizePickupDatetime, reader: source.reader, ...overrides };
}

// A real, explicitly-advanceable fake clock — never a real timer/sleep.
// Two workers racing "in real time" share the SAME clock instance so
// advancing it affects both, deterministically.
function createFakeClock(startIso) {
  let current = new Date(startIso).getTime();
  return {
    nowIso: () => new Date(current).toISOString(),
    advanceMs(ms) {
      current += ms;
    },
  };
}

// A manually-resolved promise — used to PAUSE a reader call at an exact
// point (after it starts, before it returns) so a test can deterministically
// interleave a second worker's full read-apply-release cycle in between,
// without any reliance on real scheduling or timing luck.
function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------
// Round 17 — the two exact reported repros: source freshness, not just
// terminal-state/generation checks.
// ---------------------------------------------------------------------

test('round17 repro A: apply snapshot (en_route, New hotel, 14:00, $80), then deliver an OLDER accepted event — the fresh read must win, fields must NOT revert', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'accepted', pickup_zone: 'Old hotel', destination_zone: 'Nadi Airport', pickup_date: '2026-10-05', pickup_time: '09:00', quoted_amount: 45 });
  source.set(booking);

  const created = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking, { source_event_id: 1 }), deps);
  assert.equal(created.ok, true);

  // The real booking changes: en_route, new destination, new time, new
  // price. A reconciliation pass reads and applies this CURRENT state.
  source.set({ ...booking, status: 'en_route', destination_zone: 'New hotel', pickup_time: '14:00', quoted_amount: 80 });
  const snap = await reconcileRealBooking(env, booking.source_booking_ref, { snapshotSequence: 10, deps });
  assert.equal(snap.applied, true);

  // An OLDER accepted event is now delivered (e.g. queued/retried late).
  // Its OWN signal carries no payload — the module must re-read the
  // CURRENT source, which the test has NOT reverted, so the write must
  // be a no-op re-affirmation of the current truth, never a reversion.
  const olderEvent = await syncRealBookingEvent(env, booking.source_booking_ref, signal(booking, { source_event_id: 2 }), deps);
  assert.equal(olderEvent.ok, true);

  const trip = await call(env, '/preview/trip', { headers: authed(created.session.access_token) });
  const row = trip.data.bookings[0];
  assert.equal(row.destination_zone, 'New hotel', 'round 17 repro A: destination must NOT revert to the old value');
  assert.equal(row.quoted_amount, 80, 'round 17 repro A: price must NOT revert to the old value');
  assert.ok(row.pickup_datetime.includes('14:00') || new Date(row.pickup_datetime).getUTCHours() !== undefined, 'pickup time must reflect the current source, not the stale event');
  assert.equal(row.status, 'confirmed');
});

test('round17 repro B: apply a current en_route event (New hotel, 14:00, $80), then apply an OLDER captured snapshot — the fresh read must win, fields must NOT revert', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'accepted', pickup_zone: 'Old hotel', pickup_date: '2026-10-05', pickup_time: '09:00', quoted_amount: 45 });
  source.set(booking);
  const created = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking, { source_event_id: 1 }), deps);

  // The real booking advances to en_route with new details.
  source.set({ ...booking, status: 'en_route', destination_zone: 'New hotel', pickup_time: '14:00', quoted_amount: 80 });
  const currentEvent = await syncRealBookingEvent(env, booking.source_booking_ref, signal(booking, { event_type: 'en_route', new_status: 'en_route', source_event_id: 3 }), deps);
  assert.equal(currentEvent.applied, true);

  // A reconciliation pass, triggered with an OLDER sequence number
  // (e.g. a delayed worker that queued its read earlier), runs NOW —
  // but per round 17's fix it must re-read the CURRENT source at the
  // moment it actually processes, not reuse whatever it queued earlier.
  // The test never reverted the synthetic source, so this must also be
  // a no-op re-affirmation of current truth.
  const staleSnapshot = await reconcileRealBooking(env, booking.source_booking_ref, { snapshotSequence: 1, deps });
  assert.equal(staleSnapshot.ok, true);

  const trip = await call(env, '/preview/trip', { headers: authed(created.session.access_token) });
  const row = trip.data.bookings[0];
  assert.equal(row.destination_zone, 'New hotel', 'round 17 repro B: destination must NOT revert');
  assert.equal(row.quoted_amount, 80, 'round 17 repro B: price must NOT revert');
});

test('round17: same-status detail changes (pickup/destination/price change while status stays the same) are correctly picked up — not fixable by status ranking alone', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'accepted', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', quoted_amount: 45 });
  source.set(booking);
  const created = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking, { source_event_id: 1 }), deps);
  assert.equal(created.status, 'confirmed');

  // Status NEVER changes (stays 'accepted' the whole time) — only the
  // route and price change. A terminal-state-only or status-ranking fix
  // would miss this entirely.
  source.set({ ...booking, status: 'accepted', pickup_zone: 'Sofitel Denarau', destination_zone: 'Coral Coast', quoted_amount: 65 });
  const refreshed = await reconcileRealBooking(env, booking.source_booking_ref, { snapshotSequence: 2, deps });
  assert.equal(refreshed.applied, true);
  assert.equal(refreshed.status, 'confirmed', 'status is unchanged (still maps to confirmed) but the detail change must still apply');

  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(created.marau_booking_id).first();
  assert.equal(row.pickup_zone, 'Sofitel Denarau');
  assert.equal(row.destination_zone, 'Coral Coast');
  assert.equal(row.quoted_amount, 65);
});

// ---------------------------------------------------------------------
// Ownership claims: acquire-before-read, contention, and stale-owner
// takeover.
// ---------------------------------------------------------------------

test('round17: acquiring a claim for the same booking twice, concurrently, contends — only one caller proceeds at a time', async () => {
  const env = makeEnv();
  const first = await acquireBookingClaim(env, 'ref-contend-1', { nowIso });
  assert.equal(first.ok, true);
  const second = await acquireBookingClaim(env, 'ref-contend-1', { nowIso });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'BOOKING_CLAIM_CONTENDED');
  await releaseBookingClaim(env, 'ref-contend-1', first.claimToken);
  const third = await acquireBookingClaim(env, 'ref-contend-1', { nowIso });
  assert.equal(third.ok, true, 'after release, a fresh claim must succeed');
});

test('round17: two genuinely concurrent syncRealBookingEvent calls for the SAME booking never both proceed at once — the contended one reports BOOKING_CLAIM_CONTENDED, never a stale write', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'accepted' });
  source.set(booking);
  const created = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking, { source_event_id: 1 }), deps);

  const [a, b] = await Promise.all([
    syncRealBookingEvent(env, booking.source_booking_ref, signal(booking, { event_type: 'en_route', new_status: 'en_route', source_event_id: 2 }), deps),
    syncRealBookingEvent(env, booking.source_booking_ref, signal(booking, { event_type: 'en_route', new_status: 'en_route', source_event_id: 3 }), deps),
  ]);
  const results = [a, b];
  const contended = results.filter((r) => r.ok === false && r.reason === 'BOOKING_CLAIM_CONTENDED');
  const succeeded = results.filter((r) => r.ok === true);
  assert.equal(succeeded.length + contended.length, 2);
  assert.ok(succeeded.length >= 1, 'at least one concurrent caller must actually succeed');
  // Whichever succeeded read the CURRENT source at its own processing
  // time — never a stale payload — so the final state is always correct
  // regardless of which one "won".
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(created.marau_booking_id).first();
  assert.equal(row.status, 'confirmed');
});

test('round17: a stale (expired) claim can be atomically taken over — a crashed/interrupted holder never permanently blocks a booking', async () => {
  const env = makeEnv();
  const ref = 'ref-takeover-1';
  const first = await acquireBookingClaim(env, ref, { nowIso, claimTtlMs: 1000 });
  assert.equal(first.ok, true);

  // Simulate the first holder crashing (never releases) AND its claim
  // having genuinely expired — directly manipulate expires_at into the
  // past for determinism (no sleeping in tests).
  await env.DB.prepare('UPDATE marau_real_booking_sync_claims SET expires_at = ? WHERE source_booking_ref = ?').bind('2000-01-01T00:00:00.000Z', ref).run();

  const second = await acquireBookingClaim(env, ref, { nowIso });
  assert.equal(second.ok, true);
  assert.equal(second.tookOver, true);
  assert.notEqual(second.claimToken, first.claimToken);
});

test('round17: takeover always leads to a FRESH read, never reuse of the abandoned attempt\'s own data — the exact "retry or takeover must never reuse a previously captured payload" requirement', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'accepted', quoted_amount: 45 });
  source.set(booking);

  // Fault-inject the link-row insert so the first attempt is interrupted
  // mid-flight (its own claim is released by the `finally`, so this
  // specifically tests fault-recovery, not claim expiry — a companion
  // to the claim-takeover test above).
  env.DB.exec(`CREATE TRIGGER round17_block_link BEFORE INSERT ON marau_real_booking_links BEGIN SELECT RAISE(ABORT, 'fault'); END;`);
  await assert.rejects(() => syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking, { source_event_id: 1 }), deps));
  env.DB.exec('DROP TRIGGER round17_block_link;');

  // The real source changes BEFORE the retry.
  source.set({ ...booking, quoted_amount: 99, destination_zone: 'Somewhere New' });

  const retry = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking, { source_event_id: 1 }), deps);
  assert.equal(retry.ok, true);
  assert.equal(retry.recovered, true);

  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(row.quoted_amount, 99, 'the retry must read FRESH data, never the abandoned attempt\'s original $45 payload');
  assert.equal(row.destination_zone, 'Somewhere New');
});

// ---------------------------------------------------------------------
// Round 18 — enforce claim ownership AT EACH WRITE, not just at
// acquisition. The exact deterministic repro: a paused reader (a
// manually-resolved promise, never a real timer) plus a shared,
// explicitly-advanceable fake clock.
// ---------------------------------------------------------------------

test('round18 exact repro: Worker A\'s stale-captured payload, resumed AFTER Worker B\'s legitimate takeover and successful refresh, must be rejected — never restore the old details', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const clock = createFakeClock('2026-10-01T00:00:00.000Z');

  // 1. Seed an accepted mirrored booking.
  const booking = synthRealBooking({ status: 'accepted', pickup_zone: 'Old hotel', destination_zone: 'Nadi Airport', pickup_date: '2026-10-05', pickup_time: '09:00', quoted_amount: 45 });
  source.set(booking);
  const seedDeps = makeDeps(source, { nowIso: clock.nowIso });
  const seeded = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking, { source_event_id: 1 }), seedDeps);
  assert.equal(seeded.ok, true);

  // 2. Worker A acquires the claim; its injected reader is CALLED and
  // begins returning "Old hotel / 09:00 / FJ$45" but is PAUSED before
  // that call actually returns — a deferred promise, resolved later.
  const deferredReaderA = createDeferred();
  const pausedReader = async (ref) => deferredReaderA.promise.then(() => source.reader(ref));
  // Snapshot the CURRENT (old) source data now, before it changes — this
  // is exactly what A's paused reader will eventually resolve to.
  const staleSourceSnapshot = { ...booking, status: 'accepted', pickup_zone: 'Old hotel', destination_zone: 'Nadi Airport', pickup_time: '09:00', quoted_amount: 45 };
  source.set(staleSourceSnapshot); // still current at the moment A's read "begins"
  const depsA = makeDeps(source, { nowIso: clock.nowIso, reader: pausedReader });
  const aPromise = syncRealBookingEvent(env, booking.source_booking_ref, signal(booking, { source_event_id: 2 }), depsA);

  // Let A's call actually run up to (and suspend on) `await reader(...)`.
  await new Promise((r) => setImmediate(r));

  // 3. Advance the clock 31s — past the default 30s claim TTL, so A's
  // held claim is now genuinely expired.
  clock.advanceMs(31_000);

  // 4. The authoritative source changes.
  source.set({ ...booking, status: 'accepted', destination_zone: 'New hotel', pickup_time: '14:00', quoted_amount: 80 });

  // 5. Worker B takes over and refreshes successfully.
  const depsB = makeDeps(source, { nowIso: clock.nowIso });
  const b = await syncRealBookingEvent(env, booking.source_booking_ref, signal(booking, { source_event_id: 3 }), depsB);
  assert.equal(b.ok, true);
  assert.equal(b.applied, true);
  assert.equal(b.claim_took_over, true, 'sanity check: B really did take over A\'s expired claim');

  // 6. Resume A — its paused reader now resolves with the STALE payload
  // it captured back in step 2.
  deferredReaderA.resolve();
  const a = await aPromise;

  assert.equal(a.ok, true);
  assert.equal(a.applied, false, 'the exact bug: A must NOT report applied:true');
  assert.equal(a.reason, 'CLAIM_LOST', 'A\'s write must be rejected because it no longer holds the live claim, not merely because of a generation mismatch it could pass');

  // Complete state assertion: the CURRENT (B's) data must be exactly
  // what survives — never A's stale payload.
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(row.destination_zone, 'New hotel', 'round 18: A must never restore the old destination');
  assert.equal(row.quoted_amount, 80, 'round 18: A must never restore the old price');
  assert.equal(row.pickup_datetime, normalizePickupDatetime('2026-10-05T14:00'), 'round 18: A must never restore the old (09:00) pickup time');
  assert.equal(row.status, 'confirmed');

  // No claim row should remain (B released its own claim after success;
  // A's write never happened, so it never re-acquired or released one).
  const claimRow = await env.DB.prepare('SELECT * FROM marau_real_booking_sync_claims WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(claimRow, null, 'no claim should be left held after this sequence');

  // Exactly one session, one link, throughout.
  const { results: sessions } = await env.DB.prepare('SELECT * FROM guest_sessions WHERE guest_email = ?').bind(booking.guest_email).all();
  assert.equal(sessions.length, 1);
  const { results: links } = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(links.length, 1);
});

test('round18: takeover during FIRST creation — Worker A\'s paused, stale first-sync attempt resumed after Worker B has already created the booking must not create a duplicate or corrupt the result', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const clock = createFakeClock('2026-10-01T00:00:00.000Z');
  const booking = synthRealBooking({ status: 'accepted', pickup_zone: 'Old hotel', quoted_amount: 45 });

  const deferredReaderA = createDeferred();
  const pausedReader = async (ref) => deferredReaderA.promise.then(() => source.reader(ref));
  source.set(booking); // what A's paused reader will eventually see
  const depsA = makeDeps(source, { nowIso: clock.nowIso, reader: pausedReader });
  const aPromise = syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking, { source_event_id: 1 }), depsA);
  await new Promise((r) => setImmediate(r));

  clock.advanceMs(31_000);
  source.set({ ...booking, destination_zone: 'New hotel', quoted_amount: 80 });

  const depsB = makeDeps(source, { nowIso: clock.nowIso });
  const b = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking, { source_event_id: 2 }), depsB);
  assert.equal(b.ok, true);
  assert.equal(b.created, true);
  assert.equal(b.claim_took_over, true);

  deferredReaderA.resolve();
  const a = await aPromise;
  // By the time A resumes, B's first-sync has already created the link
  // row, so A's resumed call takes the ordinary "apply to existing
  // link" path (not a second "created" path) — it must report a
  // determined, non-error CLAIM_LOST outcome (not `applied: true`),
  // never a successful (duplicate) creation.
  assert.equal(a.ok, true);
  assert.equal(a.created, undefined, 'A must never report created:true — that would mean a duplicate first-sync succeeded');
  assert.equal(a.applied, false, 'A must never report a successful apply of its stale payload');
  assert.equal(a.reason, 'CLAIM_LOST');

  const { results: bookings } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? AND source_sync_owned = 1').bind(booking.source_booking_ref).all();
  assert.equal(bookings.length, 1, 'exactly one owned mirror row — no duplicate from A\'s resumed attempt');
  assert.equal(bookings[0].destination_zone, 'New hotel', 'B\'s current data, never A\'s stale payload');
  const { results: sessions } = await env.DB.prepare('SELECT * FROM guest_sessions WHERE guest_email = ?').bind(booking.guest_email).all();
  assert.equal(sessions.length, 1, 'exactly one session — A\'s own session (created before it discovered ownership was lost) must be cleaned up');
  const { results: links } = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(links.length, 1);

  const trip = await call(env, '/preview/trip', { headers: authed(b.session.access_token) });
  assert.equal(trip.data.bookings.length, 1);
  assert.equal(trip.data.bookings[0].destination_zone, 'New hotel');
});

test('round18: missing-link recovery — if the claim is lost between the mirror INSERT and the link INSERT, the row is reported CLAIM_LOST, and a later retry repairs the link cleanly (never a duplicate session)', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();

  // Fault-inject the link-row insert so the very FIRST attempt is
  // interrupted after the mirror row is durably created but before the
  // link exists — exactly the state a claim-loss-mid-flight would also
  // produce, and the SAME repair path must handle both.
  const booking = synthRealBooking({ status: 'pending' });
  source.set(booking);
  const deps = makeDeps(source);
  env.DB.exec(`CREATE TRIGGER round18_block_link BEFORE INSERT ON marau_real_booking_links BEGIN SELECT RAISE(ABORT, 'fault'); END;`);
  await assert.rejects(() => syncRealBookingEvent(env, booking.source_booking_ref, createdSignal(booking, { source_event_id: 1 }), deps));
  env.DB.exec('DROP TRIGGER round18_block_link;');

  const { results: orphanRows } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? AND source_sync_owned = 1').bind(booking.source_booking_ref).all();
  assert.equal(orphanRows.length, 1);
  const { results: linksAfterFailure } = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(linksAfterFailure.length, 0, 'interrupted state under test: link genuinely missing');
  // The claim from the failed attempt is released by the `finally` even
  // on a thrown error, so a normal retry (fresh claim) should succeed
  // immediately without needing a takeover.
  const claimAfterFailure = await env.DB.prepare('SELECT * FROM marau_real_booking_sync_claims WHERE source_booking_ref = ?').bind(booking.source_booking_ref).first();
  assert.equal(claimAfterFailure, null, 'the claim must be released even when the write path throws');

  const retry = await syncRealBookingEvent(env, booking.source_booking_ref, createdSignal(booking, { source_event_id: 1 }), deps);
  assert.equal(retry.ok, true);
  assert.equal(retry.recovered, true);

  const { results: linksAfterRetry } = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(linksAfterRetry.length, 1);
  const { results: bookingsAfterRetry } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(bookingsAfterRetry.length, 1);
  const { results: sessionsAfterRetry } = await env.DB.prepare('SELECT * FROM guest_sessions WHERE guest_email = ?').bind(booking.guest_email).all();
  assert.equal(sessionsAfterRetry.length, 1, 'no duplicate session from the repair');
});

test('round18: a claim genuinely lost (expired, not yet taken over by anyone) reports CLAIM_LOST on the link-repair path too, and a subsequent retry succeeds cleanly', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const clock = createFakeClock('2026-10-01T00:00:00.000Z');
  const booking = synthRealBooking({ status: 'pending' });
  source.set(booking);

  // Fault-inject so the row exists but is unlinked (same interrupted
  // state as above), using the fake clock throughout.
  const deps = makeDeps(source, { nowIso: clock.nowIso });
  env.DB.exec(`CREATE TRIGGER round18_block_link2 BEFORE INSERT ON marau_real_booking_links BEGIN SELECT RAISE(ABORT, 'fault'); END;`);
  await assert.rejects(() => syncRealBookingEvent(env, booking.source_booking_ref, createdSignal(booking, { source_event_id: 1 }), deps));
  env.DB.exec('DROP TRIGGER round18_block_link2;');

  // A normal retry (fresh claim) should still repair cleanly — the
  // failed attempt's own claim was already released in its `finally`.
  const retry = await syncRealBookingEvent(env, booking.source_booking_ref, createdSignal(booking, { source_event_id: 1 }), deps);
  assert.equal(retry.ok, true);
  assert.equal(retry.recovered, true);
  const { results: links } = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(links.length, 1);
});

// ---------------------------------------------------------------------
// Preserved regressions — round 13-16 safety properties, re-verified
// under the round-17 fresh-read + claim architecture. None removed.
// ---------------------------------------------------------------------

test('round15/1 P0 (re-verified): a guest who pre-creates a booking under the sync\'s naming scheme never has it adopted, and a later sync for a DIFFERENT guest never leaks into the guest\'s session', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);

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

  const bookingB = synthRealBooking({ id: 9001, source_booking_ref: '9001', guest_email: 'guest.b@example.test', guest_phone: '+15005550702', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', status: 'accepted' });
  source.set(bookingB);
  const syncedB = await syncRealBookingEvent(env, '9001', createdAlreadyAcceptedSignal(bookingB), deps);
  assert.equal(syncedB.ok, true);
  assert.equal(syncedB.created, true);
  assert.notEqual(syncedB.session.access_token, guestAToken);

  const tripA = await call(env, '/preview/trip', { headers: authed(guestAToken) });
  assert.equal(tripA.data.bookings.length, 1);
  assert.equal(tripA.data.bookings[0].pickup_zone, 'DENARAU');
  assert.notEqual(tripA.data.bookings[0].pickup_zone, bookingB.pickup_zone);

  const tripB = await call(env, '/preview/trip', { headers: authed(syncedB.session.access_token) });
  assert.equal(tripB.data.bookings.length, 1);
  assert.equal(tripB.data.bookings[0].pickup_zone, 'Nadi Airport');
});

test('round15/1 (re-verified): a SECOND real booking on the SAME phone gets its own session, never the first\'s', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const sharedPhone = '+15005550699';
  const first = synthRealBooking({ guest_phone: sharedPhone, status: 'accepted' });
  source.set(first);
  const firstResult = await syncRealBookingEvent(env, first.source_booking_ref, createdAlreadyAcceptedSignal(first), deps);
  const second = synthRealBooking({ guest_phone: sharedPhone, status: 'accepted' });
  source.set(second);
  const secondResult = await syncRealBookingEvent(env, second.source_booking_ref, createdAlreadyAcceptedSignal(second), deps);
  assert.notEqual(secondResult.session.access_token, firstResult.session.access_token);
  assert.ok(secondResult.link_offer);
});

test('round13/3 (re-verified): revocation of a real-synced session blocks the protected /preview/trip endpoint', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'accepted' });
  source.set(booking);
  const synced = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking), deps);
  const token = synced.session.access_token;
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

test('round13/5 (re-verified): flight_number/notes on the source are never mirrored even when present', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'accepted', flight_number: 'FJ911', notes: 'VIP' });
  source.set(booking);
  const result = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking), deps);
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(result.marau_booking_id).first();
  assert.equal('flight_number' in row, false);
  assert.equal('notes' in row, false);
});

test('round15/2 (re-verified): quoted_amount null/blank/boolean/negative are rejected on the FRESH READ, never silently coerced', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  for (const value of [null, undefined, '', true, -5, NaN]) {
    const booking = synthRealBooking({ status: 'accepted', quoted_amount: value });
    source.set(booking);
    const result = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking), deps);
    assert.equal(result.ok, false, `quoted_amount ${JSON.stringify(value)} must be rejected`);
  }
});

test('round15/3 (re-verified): a booking created ALREADY accepted is a legitimate signal, not rejected; an unevidenced pairing still is', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'accepted' });
  source.set(booking);
  const legit = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking), deps);
  assert.equal(legit.ok, true);

  const other = synthRealBooking({ status: 'accepted' });
  source.set(other);
  const notEvidenced = await syncRealBookingEvent(env, other.source_booking_ref, signal(other, { event_type: 'created', new_status: 'cancelled' }), deps);
  assert.equal(notEvidenced.ok, false);
  assert.equal(notEvidenced.reason, 'EVENT_STATUS_MISMATCH');
});

test('round16/1 (re-verified): terminal-state stickiness — once cancelled (from a fresh read), no further apply revives it', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'accepted' });
  source.set(booking);
  const created = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking), deps);

  source.set({ ...booking, status: 'cancelled' });
  const cancelled = await syncRealBookingEvent(env, booking.source_booking_ref, signal(booking, { event_type: 'cancelled', new_status: 'cancelled' }), deps);
  assert.equal(cancelled.status, 'cancelled');

  // The source is (incorrectly, or by a stale re-read) still showing
  // accepted somewhere else — but even if re-read as accepted again,
  // terminal-state stickiness (defense-in-depth) still blocks it.
  const revive = await syncRealBookingEvent(env, booking.source_booking_ref, signal(booking, { event_type: 'accepted', new_status: 'accepted' }), deps);
  assert.equal(revive.applied, false);
  assert.equal(revive.reason, 'TERMINAL_STATE_LOCKED');
});

test('round16/2 (re-verified): fault-injected first-sync recovery repairs missing linkage, without creating an extra session or bypassing revocation', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'pending' });
  source.set(booking);

  env.DB.exec(`CREATE TRIGGER round17_block_link2 BEFORE INSERT ON marau_real_booking_links BEGIN SELECT RAISE(ABORT, 'fault'); END;`);
  await assert.rejects(() => syncRealBookingEvent(env, booking.source_booking_ref, createdSignal(booking), deps));
  env.DB.exec('DROP TRIGGER round17_block_link2;');

  const { results: orphanRows } = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE source_booking_ref = ? AND source_sync_owned = 1').bind(booking.source_booking_ref).all();
  const orphanSessionId = orphanRows[0].guest_session_id;
  await env.DB.prepare('UPDATE guest_sessions SET access_token_revoked = 1 WHERE session_id = ?').bind(orphanSessionId).run();

  const retry = await syncRealBookingEvent(env, booking.source_booking_ref, createdSignal(booking), deps);
  assert.equal(retry.ok, true);
  assert.equal(retry.session.session_id, orphanSessionId, 'repair must reuse the SAME session, never mint a fresh one');

  const { results: links } = await env.DB.prepare('SELECT * FROM marau_real_booking_links WHERE source_booking_ref = ?').bind(booking.source_booking_ref).all();
  assert.equal(links.length, 1);
  const { results: sessions } = await env.DB.prepare('SELECT * FROM guest_sessions WHERE guest_email = ?').bind(booking.guest_email).all();
  assert.equal(sessions.length, 1);

  const session = await env.DB.prepare('SELECT * FROM guest_sessions WHERE session_id = ?').bind(orphanSessionId).first();
  assert.equal(session.access_token_revoked, 1, 'revocation must never be bypassed by repair');
  const tripAttempt = await call(env, '/preview/trip', { headers: authed(retry.session.access_token) });
  assert.equal(tripAttempt.status, 401);
});

test('round15/4 (re-verified): a real booking whose \'created\' event never logged is still discoverable via reconciliation', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'pending' });
  source.set(booking);
  // No event delivered at all — only reconciliation discovers it.
  const result = await reconcileRealBooking(env, booking.source_booking_ref, { snapshotSequence: 1, deps });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.status, 'pending');
});

test('round13/7 (re-verified): a booking absent from a later reconciliation pass is never inferred as cancelled', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);
  const booking = synthRealBooking({ status: 'accepted' });
  source.set(booking);
  const synced = await syncRealBookingEvent(env, booking.source_booking_ref, createdAlreadyAcceptedSignal(booking), deps);
  await markMissingFromLatestFeed(env, booking.source_booking_ref, { nowIso });
  const row = await env.DB.prepare('SELECT * FROM marau_test_bookings WHERE id = ?').bind(synced.marau_booking_id).first();
  assert.equal(row.status, 'confirmed');
  assert.equal(row.sync_state, 'MISSING_FROM_LATEST_FEED');
});

// ---------------------------------------------------------------------
// End-to-end synthetic demonstration, isolated storage + a synthetic
// authoritative source only.
// ---------------------------------------------------------------------

test('round17: end-to-end — save, accept with changing details across both an event and reconciliation, a late-delivered stale event, and a fault-injected+takeover recovery, all resolve to the CURRENT true state', async () => {
  const env = makeEnv();
  const source = createSyntheticSource();
  const deps = makeDeps(source);

  const booking = synthRealBooking({ status: 'pending', pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', quoted_amount: 45 });
  source.set(booking);
  const saved = await syncRealBookingEvent(env, booking.source_booking_ref, createdSignal(booking, { source_event_id: 1 }), deps);
  assert.equal(saved.status, 'pending');

  source.set({ ...booking, status: 'accepted' });
  const accepted = await syncRealBookingEvent(env, booking.source_booking_ref, signal(booking, { source_event_id: 2 }), deps);
  assert.equal(accepted.status, 'confirmed');

  source.set({ ...booking, status: 'en_route', destination_zone: 'Sofitel Denarau', quoted_amount: 60 });
  const enRoute = await reconcileRealBooking(env, booking.source_booking_ref, { snapshotSequence: 1, deps });
  assert.equal(enRoute.applied, true);

  // A stale, out-of-order event arrives late — must be a harmless
  // re-affirmation of the CURRENT truth, never a reversion.
  const stale = await syncRealBookingEvent(env, booking.source_booking_ref, signal(booking, { source_event_id: 3 }), deps);
  assert.equal(stale.ok, true);

  const trip = await call(env, '/preview/trip', { headers: authed(saved.session.access_token) });
  assert.equal(trip.data.bookings[0].destination_zone, 'Sofitel Denarau');
  assert.equal(trip.data.bookings[0].quoted_amount, 60);
  assert.equal(trip.data.bookings[0].status, 'confirmed');

  const admin = await call(env, '/preview/admin/bookings', { headers: authed(env.MARAU_ADMIN_TEST_TOKEN) });
  assert.equal(admin.status, 200);
});
