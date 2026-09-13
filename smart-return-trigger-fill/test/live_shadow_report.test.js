/* Issue #54 Stage 1 (SHADOW MODE) — live shadow report generator tests.
 * CEO safety-correction round (2026-09-14): threads the keyed shadowSecret
 * through, and adds negative-privacy assertions proving the serialized
 * report never contains a raw booking id or a sourceSite:bookingId string.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLiveShadowReport } from '../scripts/live_shadow_report.js';
import { createMemoryStore } from '../src/db.js';
import { buildRoutePriceTruthEntry } from '../src/route_price_truth_source.js';

const TEST_SHADOW_SECRET = crypto.getRandomValues(new Uint8Array(32));

// status stays a realistic OPERATIONAL value ('accepted') — human
// confirmation is orthogonal to bookings.status (CEO P0 correction). The
// trigger fields are human_confirmed_at/human_confirmed_by instead.
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
    human_confirmed_at: '2026-10-01T00:05:00.000Z',
    human_confirmed_by: 'admin',
    pickup_date: '2026-10-05',
    pickup_time: '09:00',
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

// new_status is always NULL on a real human_confirmed event.
function acceptEvent(overrides = {}) {
  return {
    booking_id: 100,
    event_type: 'human_confirmed',
    new_status: null,
    actor: 'admin', // handleAdminHumanConfirm() (worker.js) always writes this literal
    created_at: '2026-10-01T00:05:00Z',
    ...overrides,
  };
}

test('zero input rows -> honestly reports zero evaluated, never substitutes synthetic data, and needs no secret', async () => {
  const report = await runLiveShadowReport([], { sourceSite: 'nadiairporttransfers.com' });
  assert.equal(report.mode, 'READ_SHADOW_ONLY');
  assert.equal(report.input_row_count, 0);
  assert.equal(report.confirmed_movements_evaluated, 0);
  assert.equal(report.hold_count, 0);
  assert.equal(report.ready_for_shadow_match_count, 0);
  assert.deepEqual(report.skipped_bookings, []);
});

test('fails closed (throws) when there are rows to evaluate but no shadowSecret is supplied — never runs unkeyed', async () => {
  const rows = [{ booking: realBooking(), event: acceptEvent(), passengerCount: 2 }];
  await assert.rejects(
    () => runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com' }), // no shadowSecret
    /shadowSecret is required/
  );
});

test('a non-human-confirmed booking is skipped and counted by reason, identified only by its opaque shadowRef, never a raw booking id', async () => {
  const rows = [
    { booking: realBooking({ status: 'pending', human_confirmed_at: null, human_confirmed_by: null }), event: null, passengerCount: 2 },
  ];
  const report = await runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com', shadowSecret: TEST_SHADOW_SECRET });
  assert.equal(report.confirmed_movements_evaluated, 0);
  assert.equal(report.skipped_bookings.length, 1);
  assert.equal(report.skipped_bookings[0].reason, 'NOT_HUMAN_CONFIRMED');
  assert.ok(!('bookingId' in report.skipped_bookings[0]), 'must never carry a raw bookingId field');
  assert.ok(report.skipped_bookings[0].shadowRef, 'must carry the opaque ref instead');
  assert.ok(!String(report.skipped_bookings[0].shadowRef).includes('100'));
  assert.equal(report.skipped_reason_counts.NOT_HUMAN_CONFIRMED, 1);
});

test('a single human-confirmed booking with no matches evaluates but finds nothing to fill', async () => {
  const rows = [{ booking: realBooking(), event: acceptEvent(), passengerCount: 2 }];
  const report = await runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com', shadowSecret: TEST_SHADOW_SECRET });
  assert.equal(report.confirmed_movements_evaluated, 1);
  assert.equal(report.movements_with_predicted_empty_or_reposition_leg, 0);
  assert.equal(report.feasible_candidate_count, 0);
  assert.equal(report.hold_count, 0);
  assert.equal(report.ready_for_shadow_match_count, 0);
});

test('two real bookings forming a plausible reverse pair correctly HOLD on UNKNOWN TIMING, not a guessed FEASIBLE — the real bookings table has no trip-duration field at all', async () => {
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
  const report = await runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com', shadowSecret: TEST_SHADOW_SECRET });
  assert.equal(report.confirmed_movements_evaluated, 2);
  assert.ok(report.movements_with_predicted_empty_or_reposition_leg >= 1, 'the two legs should still match each other as a reverse pair — matching does not require feasibility to already be known');
  assert.equal(report.feasible_candidate_count, 0, 'no duration data exists on a real booking row, so feasibility must never be guessed');
  assert.equal(report.ready_for_shadow_match_count, 0, 'no route_price_truth was seeded either, so nothing may become READY');
  assert.ok(Object.keys(report.hold_reasons).some((r) => r === 'OPERATIONAL_HOLD_UNKNOWN_TIMING'), 'must HOLD on unknown timing, not silently assume feasibility');
});

test('the same reverse pair reaches FEASIBLE and READY once estimatedDurationMinutes and a seeded route_price_truth are supplied — proves row.estimatedDurationMinutes actually threads through runLiveShadowReport, not just the adapter directly (regression: this integration point was missed on the first pass)', async () => {
  const rows = [
    {
      booking: realBooking({ id: 301, pickup_zone: 'NAN', destination_zone: 'DENARAU', pickup_date: '2026-10-05', pickup_time: '09:00' }),
      event: acceptEvent({ booking_id: 301 }),
      passengerCount: 2,
      estimatedDurationMinutes: 20,
    },
    {
      booking: realBooking({ id: 302, pickup_zone: 'DENARAU', destination_zone: 'NAN', pickup_date: '2026-10-05', pickup_time: '15:00' }),
      event: acceptEvent({ booking_id: 302 }),
      passengerCount: 2,
      estimatedDurationMinutes: 20,
    },
  ];
  const store = createMemoryStore();
  const priceTruth = buildRoutePriceTruthEntry({
    originZone: 'DENARAU', destinationZone: 'NAN', vehicleClass: 'SEDAN',
    referenceFareFjd: 49, commissionRate: 0.15,
  });
  assert.equal(priceTruth.ok, true);
  store.upsertRoutePriceTruth(priceTruth.entry);

  const report = await runLiveShadowReport(rows, {
    sourceSite: 'nadiairporttransfers.com',
    shadowSecret: TEST_SHADOW_SECRET,
    store,
    routePriceTruthLookup: (o, d, v) => store.getRoutePriceTruth(o, d, v),
  });
  assert.ok(report.feasible_candidate_count >= 1, 'estimatedDurationMinutes must reach the matcher via runLiveShadowReport, not just when calling the adapter directly');
  assert.ok(report.ready_for_shadow_match_count >= 1, 'a seeded route_price_truth must make at least one candidate READY');
  assert.ok(report.shadow_price_where_permitted.length >= 1);
});

test('no customer PII appears anywhere in the serialized report, even when input rows carry real guest fields', async () => {
  const rows = [{ booking: realBooking(), event: acceptEvent(), passengerCount: 2 }];
  const report = await runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com', shadowSecret: TEST_SHADOW_SECRET });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('REAL NAME'));
  assert.ok(!serialized.includes('111 2222'));
  assert.ok(!serialized.includes('real@example.com'));
  assert.ok(!serialized.includes('FJ900'));
  assert.ok(!serialized.includes('Somewhere Real'));
});

test('no raw booking id or sourceSite:bookingId string appears anywhere in the serialized report', async () => {
  const rows = [
    { booking: realBooking({ id: 314159 }), event: acceptEvent({ booking_id: 314159 }), passengerCount: 2 },
    { booking: realBooking({ id: 271828, status: 'pending', human_confirmed_at: null, human_confirmed_by: null }), event: null, passengerCount: 2 }, // skipped path too
  ];
  const report = await runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com', shadowSecret: TEST_SHADOW_SECRET });
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes('314159'), 'raw id of the evaluated booking must not leak');
  assert.ok(!serialized.includes('271828'), 'raw id of the skipped booking must not leak either');
  assert.ok(!serialized.includes('nadiairporttransfers.com:314159'));
  assert.ok(!serialized.includes('nadiairporttransfers.com:271828'));
});

test('re-running the same confirmed booking through the report a second time does not double-count it (idempotent, so safe to re-run against a real D1 read)', async () => {
  const rows = [{ booking: realBooking(), event: acceptEvent(), passengerCount: 2 }];
  const store = createMemoryStore();
  const first = await runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com', shadowSecret: TEST_SHADOW_SECRET, store });
  const second = await runLiveShadowReport(rows, { sourceSite: 'nadiairporttransfers.com', shadowSecret: TEST_SHADOW_SECRET, store });
  assert.equal(first.confirmed_movements_evaluated, 1);
  assert.equal(second.confirmed_movements_evaluated, 1, 're-running against the same store must not create a duplicate movement for the same booking id');
});
