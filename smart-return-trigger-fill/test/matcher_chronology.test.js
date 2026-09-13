import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMovementInput } from '../src/model.js';
import { computeMatchCandidates } from '../src/matcher.js';

/* CEO fix 2026-09-13: chronological feasibility must be based on when the
 * source movement's own trip finishes (pickup + known duration), never a
 * raw |pickup - pickup| gap. These tests are self-contained (not sharing
 * the wider synthetic pool) so each scenario is unambiguous. */

const BASE = '2026-10-10T00:00:00Z';
const plus = (minutes) => new Date(new Date(BASE).getTime() + minutes * 60000).toISOString();

function mk(overrides) {
  return normalizeMovementInput({
    source_site: 'nadiairporttransfers.com',
    origin: 'x',
    destination: 'y',
    arrival_or_departure: 'arrival',
    passenger_count: 1,
    vehicle_class: 'SEDAN',
    customer_price: 50,
    operator_payout: 30,
    absolute_floor: 25,
    test_data: true,
    ...overrides,
  });
}

test('an earlier reverse leg is INFEASIBLE, never matched as feasible', () => {
  const source = mk({
    booking_reference: 'CHR-1', pickup_zone: 'NAD_AIRPORT', dropoff_zone: 'DENARAU',
    pickup_datetime: plus(120), estimated_duration_minutes: 30,
  });
  const earlierCandidate = mk({
    booking_reference: 'CHR-2', pickup_zone: 'DENARAU', dropoff_zone: 'NAD_AIRPORT',
    pickup_datetime: plus(0),
  });
  const [candidate] = computeMatchCandidates(source, [earlierCandidate]);
  assert.equal(candidate.time_compatible, false);
  assert.equal(candidate.operational_feasibility, 'INFEASIBLE');
});

test('a later reverse leg with sufficient gap after source completion is FEASIBLE', () => {
  const source = mk({
    booking_reference: 'CHR-3', pickup_zone: 'NAD_AIRPORT', dropoff_zone: 'DENARAU',
    pickup_datetime: plus(0), estimated_duration_minutes: 30,
  });
  const laterCandidate = mk({
    booking_reference: 'CHR-4', pickup_zone: 'DENARAU', dropoff_zone: 'NAD_AIRPORT',
    pickup_datetime: plus(200),
  });
  const [candidate] = computeMatchCandidates(source, [laterCandidate]);
  assert.equal(candidate.time_compatible, true);
  assert.equal(candidate.operational_feasibility, 'FEASIBLE');
});

test('identical pickup time is INFEASIBLE, not a borderline pass', () => {
  const source = mk({
    booking_reference: 'CHR-5', pickup_zone: 'NAD_AIRPORT', dropoff_zone: 'DENARAU',
    pickup_datetime: plus(0), estimated_duration_minutes: 30,
  });
  const sameTimeCandidate = mk({
    booking_reference: 'CHR-6', pickup_zone: 'DENARAU', dropoff_zone: 'NAD_AIRPORT',
    pickup_datetime: plus(0),
  });
  const [candidate] = computeMatchCandidates(source, [sameTimeCandidate]);
  assert.equal(candidate.time_compatible, false);
  assert.equal(candidate.operational_feasibility, 'INFEASIBLE');
});

test('a candidate starting mid-trip (overlapping the source\'s own duration) is INFEASIBLE', () => {
  const source = mk({
    booking_reference: 'CHR-7', pickup_zone: 'NAD_AIRPORT', dropoff_zone: 'DENARAU',
    pickup_datetime: plus(0), estimated_duration_minutes: 60,
  });
  const overlappingCandidate = mk({
    booking_reference: 'CHR-8', pickup_zone: 'DENARAU', dropoff_zone: 'NAD_AIRPORT',
    pickup_datetime: plus(30),
  });
  const [candidate] = computeMatchCandidates(source, [overlappingCandidate]);
  assert.equal(candidate.operational_feasibility, 'INFEASIBLE');
});

test('unknown source trip duration holds as HOLD_UNKNOWN_TIMING, never guessed feasible', () => {
  const source = mk({
    booking_reference: 'CHR-9', pickup_zone: 'NAD_AIRPORT', dropoff_zone: 'DENARAU',
    pickup_datetime: plus(0), // no estimated_duration_minutes, no planned_dropoff_datetime
  });
  const laterCandidate = mk({
    booking_reference: 'CHR-10', pickup_zone: 'DENARAU', dropoff_zone: 'NAD_AIRPORT',
    pickup_datetime: plus(500),
  });
  const [candidate] = computeMatchCandidates(source, [laterCandidate]);
  assert.equal(candidate.time_compatible, null);
  assert.equal(candidate.operational_feasibility, 'HOLD_UNKNOWN_TIMING');
});

// CEO's literal scenario: NAN (Nadi International Airport, IATA code) ->
// Suva, followed by Suva -> NAN too early.
test('NAN -> Suva then Suva -> NAN too early is INFEASIBLE', () => {
  const outbound = mk({
    booking_reference: 'NAN-1', pickup_zone: 'NAD_AIRPORT', dropoff_zone: 'SUVA',
    pickup_datetime: plus(0), estimated_duration_minutes: 150,
  });
  const tooEarlyReturn = mk({
    booking_reference: 'NAN-2', pickup_zone: 'SUVA', dropoff_zone: 'NAD_AIRPORT',
    pickup_datetime: plus(150 + 10), // only 10 minutes after arrival; buffer requires 45
  });
  const [candidate] = computeMatchCandidates(outbound, [tooEarlyReturn]);
  assert.equal(candidate.operational_feasibility, 'INFEASIBLE');
});

test('NAN -> Suva then Suva -> NAN with a realistic later pickup is FEASIBLE when other rules pass', () => {
  const outbound = mk({
    booking_reference: 'NAN-3', pickup_zone: 'NAD_AIRPORT', dropoff_zone: 'SUVA',
    pickup_datetime: plus(0), estimated_duration_minutes: 150,
  });
  const realisticReturn = mk({
    booking_reference: 'NAN-4', pickup_zone: 'SUVA', dropoff_zone: 'NAD_AIRPORT',
    pickup_datetime: plus(150 + 24 * 60), // next day
  });
  const [candidate] = computeMatchCandidates(outbound, [realisticReturn]);
  assert.equal(candidate.time_compatible, true);
  assert.equal(candidate.operational_feasibility, 'FEASIBLE');
});

test('a planned_dropoff_datetime, when given, takes precedence over estimated_duration_minutes', () => {
  const source = mk({
    booking_reference: 'CHR-11', pickup_zone: 'NAD_AIRPORT', dropoff_zone: 'DENARAU',
    pickup_datetime: plus(0), estimated_duration_minutes: 10, planned_dropoff_datetime: plus(300),
  });
  // Only 50 minutes after the (ignored) estimated_duration_minutes completion,
  // but well within the buffer if planned_dropoff_datetime is honored instead.
  const tooEarlyIfDurationUsed = mk({
    booking_reference: 'CHR-12', pickup_zone: 'DENARAU', dropoff_zone: 'NAD_AIRPORT',
    pickup_datetime: plus(60),
  });
  const [candidate] = computeMatchCandidates(source, [tooEarlyIfDurationUsed]);
  assert.equal(candidate.operational_feasibility, 'INFEASIBLE'); // plus(60) is before planned_dropoff_datetime plus(300)
});
