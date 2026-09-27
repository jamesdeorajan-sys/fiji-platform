import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/db.js';
import { ingestMovement } from '../src/ledger.js';
import { ValidationError } from '../src/model.js';

const validPayload = () => ({
  booking_reference: 'IDEMP-0001',
  source_site: 'nadiairporttransfers.com',
  origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
  destination: 'Denarau', dropoff_zone: 'DENARAU',
  pickup_datetime: '2026-10-05T09:00:00Z',
  arrival_or_departure: 'arrival',
  passenger_count: 2, vehicle_class: 'SEDAN',
  customer_price: 45,
  test_data: true,
});

test('ingesting the same booking twice is idempotent (same movement_id, not duplicated)', async () => {
  const store = createMemoryStore();
  const first = await ingestMovement(store, validPayload());
  const second = await ingestMovement(store, validPayload());

  assert.equal(first.wasNew, true);
  assert.equal(second.wasNew, false);
  assert.equal(first.movement.movement_id, second.movement.movement_id);
  assert.equal(store.listMovements().length, 1);
});

test('a different booking_reference from the same source is a distinct movement', async () => {
  const store = createMemoryStore();
  await ingestMovement(store, validPayload());
  await ingestMovement(store, { ...validPayload(), booking_reference: 'IDEMP-0002' });
  assert.equal(store.listMovements().length, 2);
});

test('missing required field throws ValidationError and writes nothing', async () => {
  const store = createMemoryStore();
  const bad = validPayload();
  delete bad.vehicle_class;
  await assert.rejects(() => ingestMovement(store, bad), ValidationError);
  assert.equal(store.listMovements().length, 0);
});

test('test_data must be explicit — omitting it is rejected rather than defaulted', async () => {
  const store = createMemoryStore();
  const bad = validPayload();
  delete bad.test_data;
  await assert.rejects(() => ingestMovement(store, bad), ValidationError);
});
