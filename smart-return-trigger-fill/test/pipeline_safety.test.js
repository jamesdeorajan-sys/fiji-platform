import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/db.js';
import { processIncomingMovement } from '../src/pipeline.js';

const payload = () => ({
  booking_reference: 'PIPE-0001',
  source_site: 'nadiairporttransfers.com',
  origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
  destination: 'Denarau', dropoff_zone: 'DENARAU',
  pickup_datetime: '2026-10-05T09:00:00Z',
  arrival_or_departure: 'arrival',
  passenger_count: 2, vehicle_class: 'SEDAN',
  customer_price: 45,
  test_data: true,
});

test('matcher outage does not stop the STANDARD booking flow — movement is still saved', () => {
  const store = createMemoryStore();
  const throwingMatcher = () => {
    throw new Error('simulated matcher outage');
  };

  const result = processIncomingMovement(store, payload(), { matchFn: throwingMatcher });

  assert.ok(result.movement.movement_id);
  assert.equal(store.listMovements().length, 1);
  assert.ok(result.matcherError instanceof Error);
  assert.deepEqual(result.matches, []);
});

test('WhatsApp card failure cannot invalidate or roll back a saved booking', () => {
  const store = createMemoryStore();
  const throwingCardBuilder = () => {
    throw new Error('simulated WhatsApp/card builder failure');
  };

  const result = processIncomingMovement(store, payload(), { cardFn: throwingCardBuilder });

  assert.ok(result.movement.movement_id);
  assert.equal(store.listMovements().length, 1);
  assert.equal(result.opsCard, null);
  assert.ok(result.whatsappError instanceof Error);
});

test('a matcher AND card outage together still leave the booking saved', () => {
  const store = createMemoryStore();
  const result = processIncomingMovement(store, payload(), {
    matchFn: () => {
      throw new Error('matcher down');
    },
    cardFn: () => {
      throw new Error('card builder down');
    },
  });

  assert.equal(store.listMovements().length, 1);
  assert.ok(result.matcherError instanceof Error);
  assert.ok(result.whatsappError instanceof Error);
});

test('a genuinely malformed booking still fails loudly (this is not "swallow everything")', () => {
  const store = createMemoryStore();
  const bad = payload();
  delete bad.customer_price;
  assert.throws(() => processIncomingMovement(store, bad));
  assert.equal(store.listMovements().length, 0);
});
