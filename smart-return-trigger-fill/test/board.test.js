import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/db.js';
import { ingestMovement } from '../src/ledger.js';
import { buildSevenDayMovementBoard } from '../src/board.js';

const NOW = '2026-09-20T00:00:00Z';
// Booked well before NOW so this fixture proves eligibility is decided at
// booking time, not at board-viewing time (see pricing.js docstring).
const BOOKED_AT = '2026-09-05T00:00:00Z';

function seedStore() {
  const store = createMemoryStore();
  // Return-lock eligible pair: booked 2026-09-05 for travel 2026-09-22 —
  // 17 days ahead of booking, past the 7-day threshold, even though the
  // board is being viewed on NOW (2026-09-20), only 2 days before travel.
  ingestMovement(store, {
    movement_id: 'mv_out',
    booking_reference: 'BOARD-OUT',
    source_site: 'nadiairporttransfers.com',
    itinerary_id: 'itn_board',
    origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
    destination: 'Denarau', dropoff_zone: 'DENARAU',
    pickup_datetime: '2026-09-22T09:00:00Z', // inside the 7-day board window
    arrival_or_departure: 'arrival',
    passenger_count: 2, vehicle_class: 'SEDAN',
    customer_price: 45, operator_payout: 30, absolute_floor: 25,
    created_at: BOOKED_AT,
    test_data: true,
  });
  ingestMovement(store, {
    movement_id: 'mv_ret',
    booking_reference: 'BOARD-RET',
    source_site: 'nadiairporttransfers.com',
    itinerary_id: 'itn_board',
    linked_return_movement_id: 'mv_out',
    origin: 'Denarau', pickup_zone: 'DENARAU',
    destination: 'Nadi Airport', dropoff_zone: 'NAD_AIRPORT',
    pickup_datetime: '2026-09-23T09:00:00Z',
    arrival_or_departure: 'departure',
    passenger_count: 2, vehicle_class: 'SEDAN',
    customer_price: 45, operator_payout: 30, absolute_floor: 25,
    created_at: BOOKED_AT,
    test_data: true,
  });
  // mv_out actually needs linked_return_movement_id set for symmetry.
  store.updateMovement('mv_out', { linked_return_movement_id: 'mv_ret' });

  // Unmatched single, inside window.
  ingestMovement(store, {
    movement_id: 'mv_lonely',
    booking_reference: 'BOARD-LONELY',
    source_site: 'book.fijidash.com',
    origin: 'Suva CBD', pickup_zone: 'SUVA',
    destination: 'Suva Hotel', dropoff_zone: 'SUVA',
    pickup_datetime: '2026-09-24T09:00:00Z',
    arrival_or_departure: 'arrival',
    passenger_count: 1, vehicle_class: 'SEDAN',
    customer_price: 15, operator_payout: 10, absolute_floor: 8,
    created_at: NOW,
    test_data: true,
  });

  // Outside the 7-day window entirely — must not appear on the board.
  ingestMovement(store, {
    movement_id: 'mv_far_future',
    booking_reference: 'BOARD-FAR',
    source_site: 'book.fijidash.com',
    origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
    destination: 'Denarau', dropoff_zone: 'DENARAU',
    pickup_datetime: '2026-11-01T09:00:00Z',
    arrival_or_departure: 'arrival',
    passenger_count: 1, vehicle_class: 'SEDAN',
    customer_price: 45, operator_payout: 30, absolute_floor: 25,
    created_at: NOW,
    test_data: true,
  });

  return store;
}

test('board only includes movements inside the 7-day window', () => {
  const store = seedStore();
  const board = buildSevenDayMovementBoard(store, { nowIso: NOW });
  const ids = board.confirmedMovements.map((m) => m.movement_id);
  assert.ok(ids.includes('mv_out'));
  assert.ok(ids.includes('mv_ret'));
  assert.ok(!ids.includes('mv_far_future'));
});

test('board flags the unmatched movement and excludes the matched pair from it', () => {
  const store = seedStore();
  const board = buildSevenDayMovementBoard(store, { nowIso: NOW });
  const unmatchedIds = board.unmatchedMovements.map((m) => m.movement_id);
  assert.ok(unmatchedIds.includes('mv_lonely'));
  assert.ok(!unmatchedIds.includes('mv_out'));
});

test('return-lock eligibility on the board is evaluated against booking time, not viewing time', () => {
  const store = seedStore();
  const board = buildSevenDayMovementBoard(store, { nowIso: NOW });
  assert.ok(board.returnLockEligible.some((r) => r.itinerary_id === 'itn_board'));
});

test('experience credit EARN has no transfer-spend threshold — a return-lock-eligible itinerary earns it on the board', () => {
  const store = seedStore();
  const board = buildSevenDayMovementBoard(store, { nowIso: NOW });
  const earned = board.experienceCreditEarned.find((e) => e.itinerary_id === 'itn_board');
  assert.ok(earned, 'expected itn_board to have earned the AU$50 credit eligibility');
  assert.equal(earned.creditsEarned, 2);
});

test('estimated recoverable revenue never includes a fabricated figure', () => {
  const store = seedStore();
  const board = buildSevenDayMovementBoard(store, { nowIso: NOW });
  // No route_price_truth rows were seeded, so every candidate's
  // estimated_incremental_revenue is null and the total must be 0.
  assert.equal(board.estimatedRecoverableRevenue.total, 0);
});
