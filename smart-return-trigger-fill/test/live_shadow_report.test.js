/* Issue #54 Stage 1 (SHADOW MODE) — live shadow report generator tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLiveShadowReport } from '../scripts/live_shadow_report.js';
import { createMemoryStore } from '../src/db.js';

function realBooking(overrides = {}) {
  return {
    id: 100,
    guest_name: 'REAL NAME',
    guest_phone: '+679 111 2222',
    guest_email: 'real@example.com',
    flight_number: 'FJ900',
    notes: 'Staying at: Somewhere Real',
    pickup_zone: 'NAN',
    destination_zone: 'HILTON_DENARAU',
    vehicle_type: 'sedan',
    quoted_currency: 'FJD',
    quoted_amount: 49,
    assigned_driver_id: 5,
    status: 'accepted',
    pickup_date: '2026-10-05',
    pickup_time: '09:00',
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function acceptEvent(overrides = {}) {
  return {
    booking_id: 100,
    event_type: 'accepted',
    new_status: 'accepted',
    actor: 'driver:5',
    created_at: '2026-10-01T00:05:00Z',
    ...overrides,
  };
}

test('zero input rows -> honestly reports zero evaluated, never substitutes synthetic data', () => {
  const report = runLiveShadowReport([], { sourceSite: 'nadiairporttransfers.com' });
  assert.equal(report.mode, 'READ_SHADOW_ONLY');
  assert.equal(report.input_row_count, 0);
  assert.equal(report.confirmed_movements_evaluated, 0);
  assert.equal(report.hold_count, 0);
  assert.equal(report.ready_for_shadow_match_count, 0);
  assert.deepEqual(report.skipped_bookings, []);
});

test('a non-human-confirmed booking is skipped and counted, never silently evaluated', () => {
  const rows = [
    { booking: realBooking({ status: 'pending' }), event: null, passengerCount: 2 },
  ];
  const report = runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com' });
  assert.equal(report.confirmed_movements_evaluated, 0);
  assert.equal(report.skipped_bookings.length, 1);
  assert.equal(report.skipped_bookings[0].reason, 'NOT_HUMAN_CONFIRMED');
  assert.equal(report.skipped_reason_counts.NOT_HUMAN_CONFIRMED, 1);
});

test('a single human-confirmed booking with no matches evaluates but finds nothing to fill', () => {
  const rows = [
    { booking: realBooking(), event: acceptEvent(), passengerCount: 2 },
  ];
  const report = runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com' });
  assert.equal(report.confirmed_movements_evaluated, 1);
  assert.equal(report.movements_with_predicted_empty_or_reposition_leg, 0);
  assert.equal(report.feasible_candidate_count, 0);
  assert.equal(report.hold_count, 0);
  assert.equal(report.ready_for_shadow_match_count, 0);
});

test('two real bookings forming a plausible reverse pair correctly HOLD on UNKNOWN TIMING, not a guessed FEASIBLE — the real bookings table has no trip-duration field at all', () => {
  // Genuine finding, not a test bug: createBookingRecord() (the real
  // backend) never captures an estimated trip duration or planned dropoff
  // time. estimateSourceCompletionMs() in model.js correctly refuses to
  // fill that gap from placeholder geography, so chronological feasibility
  // — and therefore operational_feasibility — is honestly UNKNOWN for
  // every real movement evaluated at the HUMAN_CONFIRMED trigger point,
  // not a guessed FEASIBLE. This is the safety gate working correctly, not
  // a shortfall in this pair of fixtures specifically.
  const rows = [
    {
      booking: realBooking({ id: 201, pickup_zone: 'NAN', destination_zone: 'DENARAU', pickup_date: '2026-10-05', pickup_time: '09:00' }),
      event: acceptEvent({ booking_id: 201 }),
      passengerCount: 2,
    },
    {
      booking: realBooking({ id: 202, pickup_zone: 'DENARAU', destination_zone: 'NAN', pickup_date: '2026-10-05', pickup_time: '15:00' }),
      event: acceptEvent({ booking_id: 202 }),
      passengerCount: 2,
    },
  ];
  const report = runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com' });
  assert.equal(report.confirmed_movements_evaluated, 2);
  assert.ok(report.movements_with_predicted_empty_or_reposition_leg >= 1, 'the two legs should still match each other as a reverse pair — matching does not require feasibility to already be known');
  assert.equal(report.feasible_candidate_count, 0, 'no duration data exists on a real booking row, so feasibility must never be guessed');
  assert.equal(report.ready_for_shadow_match_count, 0, 'no route_price_truth was seeded either, so nothing may become READY');
  assert.ok(Object.keys(report.hold_reasons).some((r) => r === 'OPERATIONAL_HOLD_UNKNOWN_TIMING'), 'must HOLD on unknown timing, not silently assume feasibility');
});

test('no customer PII appears anywhere in the serialized report, even when input rows carry real guest fields', () => {
  const rows = [
    { booking: realBooking(), event: acceptEvent(), passengerCount: 2 },
  ];
  const report = runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com' });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('REAL NAME'));
  assert.ok(!serialized.includes('111 2222'));
  assert.ok(!serialized.includes('real@example.com'));
  assert.ok(!serialized.includes('FJ900'));
  assert.ok(!serialized.includes('Somewhere Real'));
});

test('re-running the same confirmed booking through the report a second time does not double-count it (idempotent, so safe to re-run against a real D1 read)', () => {
  const rows = [
    { booking: realBooking(), event: acceptEvent(), passengerCount: 2 },
  ];
  const store = createMemoryStore();
  const first = runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com', store });
  const second = runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com', store });
  assert.equal(first.confirmed_movements_evaluated, 1);
  assert.equal(second.confirmed_movements_evaluated, 1, 're-running against the same store must not create a duplicate movement for the same booking id');
});
