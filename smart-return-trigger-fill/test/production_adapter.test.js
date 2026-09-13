/* Issue #54 Stage 1 (SHADOW MODE) — production adapter tests, written FIRST
 * per the mission's implementation discipline, before src/production_adapter.js
 * exists in its final form.
 *
 * These tests exercise the adapter against the REAL nadi-dispatch-api
 * `bookings` / `booking_events` schema as read directly from
 * nadi-marketplace/worker/worker.js (createBookingRecord, logBookingEvent,
 * handleDriverAcceptBooking, handleAdminManualAssign) — not a guessed shape.
 * No live database was reachable to generate these fixtures (Cloudflare API
 * access is unavailable in this environment); every fixture below is a
 * hand-built row shaped exactly like what those real functions write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMAN_CONFIRMED_BOOKING_STATUS,
  isHumanConfirmedBooking,
  generateOpaqueContactRef,
  mapConfirmedBookingToMovementInput,
} from '../src/production_adapter.js';
import { normalizeMovementInput } from '../src/model.js';

// Shaped exactly like a real `bookings` row (see createBookingRecord in
// nadi-marketplace/worker/worker.js) — guest_name/guest_phone/guest_email
// ARE present here (as they are in the real table), specifically so the
// tests below can prove the adapter strips them rather than assuming a
// PII-free input.
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
    pickup_time: '09:30',
    client_booking_ref: 'FD-ABC123',
    trip_type: 'one-way',
    created_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

// Shaped exactly like a real `booking_events` row (see logBookingEvent).
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

test('HUMAN_CONFIRMED_BOOKING_STATUS matches the real backend\'s own accepted-state literal', () => {
  assert.equal(HUMAN_CONFIRMED_BOOKING_STATUS, 'accepted');
});

test('isHumanConfirmedBooking: true for a driver-accepted booking', () => {
  assert.equal(isHumanConfirmedBooking(realBookingRow(), realAcceptEvent({ actor: 'driver:12' })), true);
});

test('isHumanConfirmedBooking: true for an admin-manual-assigned booking', () => {
  assert.equal(isHumanConfirmedBooking(realBookingRow(), realAcceptEvent({ actor: 'admin' })), true);
});

test('isHumanConfirmedBooking: false when booking.status is still pending, even with a stray accept-shaped event', () => {
  assert.equal(
    isHumanConfirmedBooking(realBookingRow({ status: 'pending' }), realAcceptEvent()),
    false
  );
});

test('isHumanConfirmedBooking: false with no confirming event at all — never triggers on booking creation alone', () => {
  assert.equal(isHumanConfirmedBooking(realBookingRow(), null), false);
});

test('isHumanConfirmedBooking: false for an actor that is neither a driver:<id> nor admin (defends against a future automated actor)', () => {
  assert.equal(
    isHumanConfirmedBooking(realBookingRow(), realAcceptEvent({ actor: 'system' })),
    false
  );
  assert.equal(
    isHumanConfirmedBooking(realBookingRow(), realAcceptEvent({ actor: 'cron' })),
    false
  );
  assert.equal(
    isHumanConfirmedBooking(realBookingRow(), realAcceptEvent({ actor: '' })),
    false
  );
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

test('isHumanConfirmedBooking: false once a booking has moved on to en_route/completed/cancelled without a status snapshot at "accepted" left to trust', () => {
  // The adapter only ever trusts the CURRENT booking.status + the specific
  // accept event; a later status only matters if the caller re-checks
  // booking.status itself, which this guards.
  assert.equal(
    isHumanConfirmedBooking(realBookingRow({ status: 'cancelled' }), realAcceptEvent()),
    false
  );
});

test('generateOpaqueContactRef: deterministic for the same booking, different across bookings', () => {
  const a1 = generateOpaqueContactRef(realBookingRow({ id: 1 }), 'nadiairporttransfers.com');
  const a2 = generateOpaqueContactRef(realBookingRow({ id: 1 }), 'nadiairporttransfers.com');
  const b = generateOpaqueContactRef(realBookingRow({ id: 2 }), 'nadiairporttransfers.com');
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
});

test('generateOpaqueContactRef: never derived from or resembling guest_phone/guest_email — passes model.js\'s own PII-shape check', () => {
  const ref = generateOpaqueContactRef(realBookingRow(), 'nadiairporttransfers.com');
  assert.ok(!ref.includes('999'), 'must not leak digits from the real phone number');
  assert.ok(!/@/.test(ref), 'must not look like an email');
  assert.ok(!/(?:\+?\d[\d\s().-]{6,}\d)/.test(ref), 'must not match a phone-number shape');
});

test('mapConfirmedBookingToMovementInput: refuses a booking that is not human-confirmed, never silently maps it', () => {
  const result = mapConfirmedBookingToMovementInput(
    realBookingRow({ status: 'pending' }),
    null,
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2 }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_HUMAN_CONFIRMED');
});

test('mapConfirmedBookingToMovementInput: happy path produces a valid, fully PII-free movement input', () => {
  const result = mapConfirmedBookingToMovementInput(
    realBookingRow(),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2 }
  );
  assert.equal(result.ok, true);
  const m = result.movementInput;

  // Core mapping correctness.
  assert.equal(m.source_site, 'nadiairporttransfers.com');
  assert.equal(m.pickup_zone, 'NAN');
  assert.equal(m.dropoff_zone, 'HILTON_DENARAU');
  assert.equal(m.vehicle_class, 'SEDAN', 'real vehicle_type is lowercase; Smart Return convention is uppercase');
  assert.equal(m.customer_price, 49);
  assert.equal(m.arrival_or_departure, 'arrival', 'pickup_zone NAN means the guest is arriving');
  assert.equal(m.booking_status, 'CONFIRMED');
  assert.equal(m.human_confirmation_status, 'CONFIRMED');
  assert.equal(m.test_data, false, 'real production data must always be marked test_data:false');

  // PII must never appear anywhere in the mapped output.
  const serialized = JSON.stringify(m);
  assert.ok(!serialized.includes('REAL GUEST NAME'), 'guest name leaked into movement input');
  assert.ok(!serialized.includes('999 0000'), 'guest phone leaked into movement input');
  assert.ok(!serialized.includes('realguest@example.com'), 'guest email leaked into movement input');
  assert.ok(!serialized.includes('FJ810'), 'flight number leaked into movement input');
  assert.ok(!serialized.includes('Hilton Fiji Beach Resort'), 'free-text notes field leaked into movement input');
  assert.equal(m.booking_contact_ref, generateOpaqueContactRef(realBookingRow(), 'nadiairporttransfers.com'));

  // The mapped input must itself still pass model.js's own ingestion
  // validation end to end (not just look plausible).
  assert.doesNotThrow(() => normalizeMovementInput(m));
});

test('mapConfirmedBookingToMovementInput: departure direction derived correctly when destination_zone is the airport', () => {
  const result = mapConfirmedBookingToMovementInput(
    realBookingRow({ pickup_zone: 'HILTON_DENARAU', destination_zone: 'NAN' }),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2 }
  );
  assert.equal(result.ok, true);
  assert.equal(result.movementInput.arrival_or_departure, 'departure');
});

test('mapConfirmedBookingToMovementInput: refuses to guess arrival/departure when neither zone is a recognized airport zone', () => {
  const result = mapConfirmedBookingToMovementInput(
    realBookingRow({ pickup_zone: 'HILTON_DENARAU', destination_zone: 'SHANGRI_LA_YANUCA' }),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 2 }
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CANNOT_DETERMINE_ARRIVAL_OR_DEPARTURE');
});

test('mapConfirmedBookingToMovementInput: refuses to fabricate passenger_count when the real booking row has none and no override is supplied', () => {
  // The real `bookings` table (see createBookingRecord) does not store
  // passenger_count at all today — this is a genuine upstream data gap,
  // not a Smart Return safety gate, and must be reported as such rather
  // than silently defaulted to 1.
  const result = mapConfirmedBookingToMovementInput(
    realBookingRow(),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com' } // no passengerCount override
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MISSING_PASSENGER_COUNT');
});

test('mapConfirmedBookingToMovementInput: idempotency_key is stable across repeated mapping of the same booking (safe to re-run)', () => {
  const r1 = mapConfirmedBookingToMovementInput(realBookingRow(), realAcceptEvent(), { sourceSite: 'nadiairporttransfers.com', passengerCount: 2 });
  const r2 = mapConfirmedBookingToMovementInput(realBookingRow(), realAcceptEvent(), { sourceSite: 'nadiairporttransfers.com', passengerCount: 2 });
  assert.equal(r1.movementInput.idempotency_key, r2.movementInput.idempotency_key);
});

test('mapConfirmedBookingToMovementInput: unknown vehicle_type is passed through unmapped rather than silently coerced (matcher will just find no vehicle-compatible pairs)', () => {
  const result = mapConfirmedBookingToMovementInput(
    realBookingRow({ vehicle_type: 'boat' }),
    realAcceptEvent(),
    { sourceSite: 'nadiairporttransfers.com', passengerCount: 4 }
  );
  assert.equal(result.ok, true);
  assert.equal(result.movementInput.vehicle_class, 'BOAT');
});
