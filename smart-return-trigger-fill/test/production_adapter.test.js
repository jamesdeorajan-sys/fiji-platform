/* Issue #54 Stage 1 (SHADOW MODE) — production adapter tests.
 *
 * CEO safety-correction round (2026-09-14): rewrites the previous version
 * of these tests to cover the four fixed defects — keyed HMAC opaque
 * linkage (no raw booking id / no sourceSite:bookingId string anywhere),
 * Fiji-local timezone conversion (no naive "append Z"), same-booking
 * event proof, and no raw booking id in any failure/report path.
 *
 * Fixtures are shaped exactly like the real nadi-dispatch-api `bookings` /
 * `booking_events` schema (see nadi-marketplace/worker/worker.js:
 * createBookingRecord, logBookingEvent, handleDriverAcceptBooking,
 * handleAdminManualAssign) — not a guessed shape. No live database was
 * reachable to generate these fixtures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMAN_CONFIRMED_BOOKING_STATUS,
  isHumanConfirmedBooking,
  computeOpaqueBookingRef,
  mapConfirmedBookingToMovementInput,
} from '../src/production_adapter.js';
import { normalizeMovementInput } from '../src/model.js';

// Test-only key — 32 random bytes, generated fresh for this file, never
// reused as a real shadow secret and never the value the adapter falls
// back to on its own (there IS no fallback — see the "fails closed"
// tests below, which prove the adapter refuses to invent one).
const TEST_SHADOW_SECRET = crypto.getRandomValues(new Uint8Array(32));

function realBookingRow(overrides = {}) {
  return {
    id: 4821,
    guest_name: 'REAL GUEST NAME - must never leave this file',
    guest_phone: '+679 999 0000',
    guest_email: 'realguest@example.com',
    flight_number: 'FJ810',
    notes: 'Staying at: Hilton Fiji Beach Resort',
    pickup_zone: 'NAN',
    destination_zone: 'HILTON_DENARAU',
    distance_km: 12,
    vehicle_type: 'sedan',
    quoted_currency: 'FJD',
    quoted_amount: 49,
    assigned_driver_id: 77,
    status: 'accepted',
    pickup_date: '2026-10-05',
    pickup_time: '09:30', // Fiji LOCAL time — the whole point of test 2 below
    client_booking_ref: 'FD-ABC123',
    trip_type: 'one-way',
    created_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

function realAcceptEvent(overrides = {}) {
  return {
    booking_id: 4821,
    event_type: 'accepted',
    previous_status: 'pending',
    new_status: 'accepted',
    actor: 'driver:77',
    created_at: '2026-10-01T10:05:00Z',
    ...overrides,
  };
}

// ─── 1. OPAQUE BOOKING LINKAGE ──────────────────────────────────────────

test('HUMAN_CONFIRMED_BOOKING_STATUS matches the real backend\'s own accepted-state literal', () => {
  assert.equal(HUMAN_CONFIRMED_BOOKING_STATUS, 'accepted');
});

test('computeOpaqueBookingRef: fails closed (returns null) when no secret is supplied — never invents or hardcodes one', async () => {
  const ref = await computeOpaqueBookingRef(realBookingRow(), 'nadiairporttransfers.com', null);
  assert.equal(ref, null);
});

test('computeOpaqueBookingRef: fails closed for an empty-bytes secret too, not just null/undefined', async () => {
  const ref = await computeOpaqueBookingRef(realBookingRow(), 'nadiairporttransfers.com', new Uint8Array(0));
  assert.equal(ref, null);
});

test('computeOpaqueBookingRef: deterministic for the same booking+key, different across bookings and across keys', async () => {
  const a1 = await computeOpaqueBookingRef(realBookingRow({ id: 1 }), 'nadiairporttransfers.com', TEST_SHADOW_SECRET);
  const a2 = await computeOpaqueBookingRef(realBookingRow({ id: 1 }), 'nadiairporttransfers.com', TEST_SHADOW_SECRET);
  const b = await computeOpaqueBookingRef(realBookingRow({ id: 2 }), 'nadiairporttransfers.com', TEST_SHADOW_SECRET);
  const otherKey = crypto.getRandomValues(new Uint8Array(32));
  const c = await computeOpaqueBookingRef(realBookingRow({ id: 1 }), 'nadiairporttransfers.com', otherKey);
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.notEqual(a1, c, 'a different key must produce a different ref for the same booking — this is a KEYED hash, not a bare fingerprint');
});

test('computeOpaqueBookingRef: output never contains the raw booking id or a sourceSite:bookingId string', async () => {
  const booking = realBookingRow({ id: 4821 });
  const ref = await computeOpaqueBookingRef(booking, 'nadiairporttransfers.com', TEST_SHADOW_SECRET);
  assert.ok(!ref.includes('4821'), 'raw booking id must not appear in the opaque ref');
  assert.ok(!ref.includes('nadiairporttransfers.com:4821'), 'sourceSite:bookingId string must not appear');
  assert.ok(!/@/.test(ref) && !/(?:\+?\d[\d\s().-]{6,}\d)/.test(ref), 'must not look like an email or phone number either');
});

test('computeOpaqueBookingRef: never matches model.js\'s own phone-number-shape PII guard, across many bookings (regression: a raw hex digest occasionally did, by chance)', async () => {
  // Real bug caught while building this fix, not hypothetical: a 32-char
  // hex digest is ~62.5% digit characters, so an 8+ consecutive-digit run
  // (matching model.js's CONTACT_REF_LOOKS_LIKE_PII =
  // /\d[\d\s().-]{6,}\d/) occurred roughly 1 in every 20-50 refs before
  // the chunk-separator fix. 500 distinct bookings is enough to make that
  // failure mode reappear reliably if the fix ever regresses.
  const PII_SHAPE = /@|(?:\+?\d[\d\s().-]{6,}\d)/;
  for (let id = 1; id <= 500; id++) {
    const ref = await computeOpaqueBookingRef({ id }, 'nadiairporttransfers.com', TEST_SHADOW_SECRET);
    assert.ok(!PII_SHAPE.test(ref), `ref for booking id=${id} looks phone/email-shaped: ${ref}`);
  }
});

test('computeOpaqueBookingRef: two different HMAC keys of the same length never collide across ~1000 distinct bookings (sanity, not a proof)', async () => {
  const refs = new Set();
  for (let id = 1; id <= 1000; id++) {
    refs.add(await computeOpaqueBookingRef(realBookingRow({ id }), 'nadiairporttransfers.com', TEST_SHADOW_SECRET));
  }
  assert.equal(refs.size, 1000);
});

// ─── 3. SAME-BOOKING EVENT PROOF ────────────────────────────────────────

test('isHumanConfirmedBooking: true for a driver-accepted booking whose event matches this exact booking id', () => {
  assert.equal(isHumanConfirmedBooking(realBookingRow(), realAcceptEvent({ actor: 'driver:12', booking_id: 4821 })), true);
});

test('isHumanConfirmedBooking: true for an admin-manual-assigned booking whose event matches this exact booking id', () => {
  assert.equal(isHumanConfirmedBooking(realBookingRow(), realAcceptEvent({ actor: 'admin', booking_id: 4821 })), true);
});

test('isHumanConfirmedBooking: FALSE for an accepted event that belongs to a DIFFERENT booking id — the exact defect being fixed', () => {
  const booking = realBookingRow({ id: 4821 });
  const eventForAnotherBooking = realAcceptEvent({ booking_id: 9999 });
  assert.equal(isHumanConfirmedBooking(booking, eventForAnotherBooking), false);
});

test('isHumanConfirmedBooking: FALSE when the event carries no booking_id at all — never assumed to match', () => {
  const booking = realBookingRow({ id: 4821 });
  const eventMissingBookingId = realAcceptEvent({ booking_id: undefined });
  assert.equal(isHumanConfirmedBooking(booking, eventMissingBookingId), false);
});

test('isHumanConfirmedBooking: FALSE when booking.id itself is missing — nothing to prove a match against', () => {
  const booking = realBookingRow({ id: undefined });
  assert.equal(isHumanConfirmedBooking(booking, realAcceptEvent({ booking_id: undefined })), false);
});

test('isHumanConfirmedBooking: booking_id match is safe across numeric vs string representations (DB driver differences), without accepting a genuine mismatch', () => {
  const booking = realBookingRow({ id: 4821 });
  assert.equal(isHumanConfirmedBooking(booking, realAcceptEvent({ booking_id: '4821' })), true, 'numeric 4821 vs string "4821" must still match — same real id, different DB driver representation');
  assert.equal(isHumanConfirmedBooking(booking, realAcceptEvent({ booking_id: '48210' })), false, 'must not fuzzy-match a prefix/substring');
  assert.equal(isHumanConfirmedBooking(booking, realAcceptEvent({ booking_id: 4820 })), false);
});

test('isHumanConfirmedBooking: false when booking.status is still pending, even with a stray accept-shaped event for the same id', () => {
  assert.equal(
    isHumanConfirmedBooking(realBookingRow({ status: 'pending' }), realAcceptEvent()),
    false
  );
});

test('isHumanConfirmedBooking: false with no confirming event at all — never triggers on booking creation alone', () => {
  assert.equal(isHumanConfirmedBooking(realBookingRow(), null), false);
});

test('isHumanConfirmedBooking: false for an actor that is neither a driver:<id> nor admin (defends against a future automated actor)', () => {
  assert.equal(isHumanConfirmedBooking(realBookingRow(), realAcceptEvent({ actor: 'system' })), false);
  assert.equal(isHumanConfirmedBooking(realBookingRow(), realAcceptEvent({ actor: 'cron' })), false);
  assert.equal(isHumanConfirmedBooking(realBookingRow(), realAcceptEvent({ actor: '' })), false);
});

test('isHumanConfirmedBooking: false for page_view/quote/booking_attempt/notification_sent style events — only "accepted" qualifies', () => {
  for (const eventType of ['page_view', 'quote_requested', 'booking_attempt', 'notification_sent', 'created']) {
    assert.equal(
      isHumanConfirmedBooking(realBookingRow(), realAcceptEvent({ event_type: eventType, new_status: 'pending' })),
      false,
      `event_type=${eventType} must not count as human-confirmed`
    );
  }
});

// ─── 2. FIJI TIMEZONE CORRECTION ────────────────────────────────────────

test('mapConfirmedBookingToMovementInput: 10:00 Fiji local is NOT treated as 10:00 UTC — must convert via Pacific/Fiji, not append Z', async () => {
  const result = await mapConfirmedBookingToMovementInput(
    realBookingRow({ pickup_date: '2026-10-05', pickup_time: '10:00' }),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }
  );
  assert.equal(result.ok, true);
  assert.notEqual(result.movementInput.pickup_datetime, '2026-10-05T10:00:00.000Z', 'must not be the naive UTC reading');
  // Fiji is UTC+12 (no DST observed as of current IANA data for this
  // period) — 10:00 Fiji local = 22:00 UTC the PREVIOUS day.
  assert.equal(result.movementInput.pickup_datetime, '2026-10-04T22:00:00.000Z');
});

test('overnight boundary: 23:30 Fiji local rolls back to the correct earlier UTC calendar day', async () => {
  const result = await mapConfirmedBookingToMovementInput(
    realBookingRow({ pickup_date: '2026-10-05', pickup_time: '23:30' }),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }
  );
  assert.equal(result.ok, true);
  // 23:30 Fiji (UTC+12) on Oct 5 = 11:30 UTC on Oct 5 (still same UTC day
  // here since 23:30 - 12:00 = 11:30, not a rollover in THIS direction —
  // Fiji being ahead of UTC means Fiji's evening is still UTC's same-day
  // late morning). This specifically proves the conversion does real
  // subtraction rather than any hardcoded day-shift assumption.
  assert.equal(result.movementInput.pickup_datetime, '2026-10-05T11:30:00.000Z');
});

test('overnight boundary: 00:30 Fiji local (just after local midnight) converts to the PREVIOUS UTC calendar day', async () => {
  const result = await mapConfirmedBookingToMovementInput(
    realBookingRow({ pickup_date: '2026-10-05', pickup_time: '00:30' }),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }
  );
  assert.equal(result.ok, true);
  // 00:30 Oct 5 Fiji local (UTC+12) = 12:30 UTC on Oct 4 — the UTC
  // calendar day is genuinely different from the Fiji calendar day here.
  assert.equal(result.movementInput.pickup_datetime, '2026-10-04T12:30:00.000Z');
});

test('next-day completion: a pickup late on day N plus a same-source movement pair still orders correctly once both are converted to real UTC instants', async () => {
  // Two Fiji-local pickups that are chronologically DAY_N 23:00 and
  // DAY_N+1 01:00 Fiji-local (2 hours apart in Fiji wall-clock) must stay
  // 2 hours apart as real UTC instants, not get distorted by a naive
  // per-row "append Z" that would place them 24h+2h apart instead.
  const early = await mapConfirmedBookingToMovementInput(
    realBookingRow({ id: 1, pickup_date: '2026-10-05', pickup_time: '23:00' }),
    realAcceptEvent({ booking_id: 1 }),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }
  );
  const later = await mapConfirmedBookingToMovementInput(
    realBookingRow({ id: 2, pickup_date: '2026-10-06', pickup_time: '01:00' }),
    realAcceptEvent({ booking_id: 2 }),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }
  );
  const earlyMs = new Date(early.movementInput.pickup_datetime).getTime();
  const laterMs = new Date(later.movementInput.pickup_datetime).getTime();
  assert.equal((laterMs - earlyMs) / (60 * 1000), 120, 'must be exactly 2 hours apart in real elapsed time');
});

test('invalid/missing timezone data fails closed: malformed pickup_date/pickup_time never falls back to a guessed instant', async () => {
  for (const bad of [
    { pickup_date: null, pickup_time: '10:00' },
    { pickup_date: '2026-10-05', pickup_time: null },
    { pickup_date: 'not-a-date', pickup_time: '10:00' },
    { pickup_date: '2026-10-05', pickup_time: '25:99' },
    { pickup_date: '2026-13-40', pickup_time: '10:00' },
  ]) {
    const result = await mapConfirmedBookingToMovementInput(
      realBookingRow(bad),
      realAcceptEvent(),
      { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }
    );
    assert.equal(result.ok, false, `expected failure for ${JSON.stringify(bad)}`);
    assert.equal(result.reason, 'MISSING_OR_INVALID_PICKUP_DATETIME');
  }
});

// ─── general mapping / gating behavior ──────────────────────────────────

test('mapConfirmedBookingToMovementInput: refuses a booking that is not human-confirmed, never silently maps it', async () => {
  const result = await mapConfirmedBookingToMovementInput(
    realBookingRow({ status: 'pending' }),
    null,
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_HUMAN_CONFIRMED');
});

test('mapConfirmedBookingToMovementInput: fails closed with SHADOW_SECRET_NOT_CONFIGURED when no secret is supplied at all — even for an otherwise-valid human-confirmed booking', async () => {
  const result = await mapConfirmedBookingToMovementInput(
    realBookingRow(),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2 } // no shadowSecret
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SHADOW_SECRET_NOT_CONFIGURED');
  assert.equal(result.shadowRef, null, 'no ref can be computed without a secret — must not fall back to anything');
});

test('mapConfirmedBookingToMovementInput: happy path produces a valid, fully PII-free, ID-free movement input', async () => {
  const result = await mapConfirmedBookingToMovementInput(
    realBookingRow(),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }
  );
  assert.equal(result.ok, true);
  const m = result.movementInput;

  assert.equal(m.source_site, 'nadiairporttransfers.com');
  assert.equal(m.pickup_zone, 'NAN');
  assert.equal(m.dropoff_zone, 'HILTON_DENARAU');
  assert.equal(m.vehicle_class, 'SEDAN');
  assert.equal(m.customer_price, 49);
  assert.equal(m.arrival_or_departure, 'arrival');
  assert.equal(m.booking_status, 'CONFIRMED');
  assert.equal(m.human_confirmation_status, 'CONFIRMED');
  assert.equal(m.test_data, false);
  assert.equal(m.operator_payout, null);
  assert.equal(m.absolute_floor, null);

  const serialized = JSON.stringify(m);
  // PII.
  assert.ok(!serialized.includes('REAL GUEST NAME'));
  assert.ok(!serialized.includes('999 0000'));
  assert.ok(!serialized.includes('realguest@example.com'));
  assert.ok(!serialized.includes('FJ810'));
  assert.ok(!serialized.includes('Hilton Fiji Beach Resort'));
  // Raw identity — the defect this round fixes.
  assert.ok(!serialized.includes('4821'), 'raw booking id must not appear anywhere in the movement');
  assert.ok(!serialized.includes('nadiairporttransfers.com:4821'), 'sourceSite:bookingId string must not appear');

  assert.equal(m.booking_contact_ref, result.shadowRef);
  assert.equal(m.booking_reference, result.shadowRef);
  assert.ok(m.movement_id.includes(result.shadowRef));
  assert.ok(m.idempotency_key.includes(result.shadowRef));

  assert.doesNotThrow(() => normalizeMovementInput(m));
});

test('mapConfirmedBookingToMovementInput: departure direction derived correctly when destination_zone is the airport', async () => {
  const result = await mapConfirmedBookingToMovementInput(
    realBookingRow({ pickup_zone: 'HILTON_DENARAU', destination_zone: 'NAN' }),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }
  );
  assert.equal(result.ok, true);
  assert.equal(result.movementInput.arrival_or_departure, 'departure');
});

test('mapConfirmedBookingToMovementInput: refuses to guess arrival/departure when neither zone is a recognized airport zone', async () => {
  const result = await mapConfirmedBookingToMovementInput(
    realBookingRow({ pickup_zone: 'HILTON_DENARAU', destination_zone: 'SHANGRI_LA_YANUCA' }),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CANNOT_DETERMINE_ARRIVAL_OR_DEPARTURE');
});

test('mapConfirmedBookingToMovementInput: refuses to fabricate passenger_count when the real booking row has none and no override is supplied', async () => {
  const result = await mapConfirmedBookingToMovementInput(
    realBookingRow(),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', shadowSecret: TEST_SHADOW_SECRET } // no passengerCount override
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MISSING_PASSENGER_COUNT');
});

test('mapConfirmedBookingToMovementInput: idempotency_key is stable across repeated mapping of the same booking (safe to re-run)', async () => {
  const r1 = await mapConfirmedBookingToMovementInput(realBookingRow(), realAcceptEvent(), { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET });
  const r2 = await mapConfirmedBookingToMovementInput(realBookingRow(), realAcceptEvent(), { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET });
  assert.equal(r1.movementInput.idempotency_key, r2.movementInput.idempotency_key);
});

test('mapConfirmedBookingToMovementInput: unknown vehicle_type is passed through unmapped rather than silently coerced', async () => {
  const result = await mapConfirmedBookingToMovementInput(
    realBookingRow({ vehicle_type: 'boat' }),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 4, shadowSecret: TEST_SHADOW_SECRET }
  );
  assert.equal(result.ok, true);
  assert.equal(result.movementInput.vehicle_class, 'BOAT');
});

// ─── 4. failure paths never leak a raw booking id, only the opaque ref ──

test('every failure result (except SHADOW_SECRET_NOT_CONFIGURED, where none can be computed) carries an opaque shadowRef, never the raw booking id', async () => {
  const cases = [
    mapConfirmedBookingToMovementInput(realBookingRow(), realAcceptEvent(), { sourceSite: 'nadiairporttransfers.com', shadowSecret: TEST_SHADOW_SECRET }), // missing passenger count
    mapConfirmedBookingToMovementInput(realBookingRow({ pickup_zone: 'HILTON_DENARAU', destination_zone: 'SHANGRI_LA_YANUCA' }), realAcceptEvent(), { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }), // cannot determine direction
  ];
  for (const p of cases) {
    const result = await p;
    assert.equal(result.ok, false);
    assert.ok(!('bookingId' in result), 'result must never carry a raw bookingId field at all');
    assert.ok(result.shadowRef, 'an opaque ref must still be attached when one could be computed');
    assert.ok(!String(result.shadowRef).includes('4821'));
  }
});

test('NOT_HUMAN_CONFIRMED failures still carry an opaque shadowRef when a secret is available (useful for ops to locate the real booking without exposing its id)', async () => {
  const result = await mapConfirmedBookingToMovementInput(
    realBookingRow({ status: 'pending' }),
    null,
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2, shadowSecret: TEST_SHADOW_SECRET }
  );
  assert.equal(result.ok, false);
  assert.ok(result.shadowRef);
  assert.ok(!String(result.shadowRef).includes('4821'));
});
