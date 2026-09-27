/* Regression test for the Codex-reported defect: the offer/ledger/board/
 * pipeline services were written assuming a SYNCHRONOUS store (only ever
 * exercised against createMemoryStore, whose methods return plain values).
 * createD1Store (src/db.js) returns Promises from every method, per the
 * real Cloudflare D1 API. Nothing in this package has ever called the
 * service layer against a Promise-returning store before this test.
 *
 * `asyncStore()` below wraps createMemoryStore() so every method returns
 * a Promise — same external contract shape as createD1Store, without
 * needing a real D1 binding. This is the exact class of bug the mission
 * describes ("consumes asynchronous store results synchronously") and
 * this file is the reproduction the mission asked for, kept in the suite
 * as a permanent regression guard (mutation-check: reverting any of the
 * `await`s added in src/offers.js, src/ledger.js, src/board.js or
 * src/pipeline.js makes these tests fail again).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/db.js';
import { discoverOffer, validateOffer, activateOffer, holdOffer, fillOffer } from '../src/offers.js';
import { ingestMovement, linkReturnMovement } from '../src/ledger.js';
import { buildSevenDayMovementBoard } from '../src/board.js';
import { processIncomingMovement } from '../src/pipeline.js';

function asyncStore() {
  const inner = createMemoryStore();
  const wrapped = { kind: 'async-memory' };
  for (const [key, fn] of Object.entries(inner)) {
    if (typeof fn !== 'function') { wrapped[key] = fn; continue; }
    // Every call resolves on a later microtask, exactly like a real D1
    // round-trip would — a caller that reads the return value without
    // `await` gets a pending Promise object, not the real result.
    wrapped[key] = async (...args) => {
      await Promise.resolve();
      return fn(...args);
    };
  }
  return wrapped;
}

function offerParams(overrides = {}) {
  return {
    source_movement_id: 'mv_async_x',
    origin_zone: 'NAD_AIRPORT',
    destination_zone: 'DENARAU',
    earliest_pickup: '2026-10-10T08:00:00Z',
    latest_pickup: '2026-10-10T10:00:00Z',
    vehicle_class: 'SEDAN',
    capacity: 1,
    standard_price: 40,
    absolute_floor: 25,
    expires_at: '2026-10-10T10:00:00Z',
    test_data: true,
    ...overrides,
  };
}

test('offers.js: discoverOffer/validateOffer/activateOffer/holdOffer all resolve real values against an async store', async () => {
  const store = asyncStore();
  const offer = await discoverOffer(store, offerParams());
  assert.equal(typeof offer.offer_id, 'string', 'discoverOffer must resolve the created offer, not a Promise');

  const validated = await validateOffer(store, offer.offer_id);
  assert.equal(validated.success, true, 'validateOffer must await the store read before checking required fields');

  const activated = await activateOffer(store, offer.offer_id);
  assert.equal(activated.success, true);

  const held = await holdOffer(store, offer.offer_id);
  assert.equal(held.success, true, 'holdOffer must await casOfferStatus; a bare Promise has no .success and this would silently read as failure');
});

test('offers.js: holdOffer double-claim is still exactly-one-winner against an async store (real concurrency guarantee, not just the memory-store shortcut)', async () => {
  const store = asyncStore();
  const offer = await discoverOffer(store, offerParams({ source_movement_id: 'mv_async_race' }));
  await validateOffer(store, offer.offer_id);
  await activateOffer(store, offer.offer_id);

  const [first, second] = await Promise.all([
    holdOffer(store, offer.offer_id),
    holdOffer(store, offer.offer_id),
  ]);
  const successes = [first, second].filter((r) => r.success).length;
  assert.equal(successes, 1, 'exactly one concurrent hold must win, even when every store call is a Promise');
});

test('offers.js: fillOffer resolves the real offer object, not an unresolved Promise, against an async store', async () => {
  const store = asyncStore();
  const offer = await discoverOffer(store, offerParams({ source_movement_id: 'mv_async_fill' }));
  await validateOffer(store, offer.offer_id);
  await activateOffer(store, offer.offer_id);
  await holdOffer(store, offer.offer_id);
  const filled = await fillOffer(store, offer.offer_id, { movement_id: 'mv_async_fill_source' });
  assert.equal(filled.success, true);
  assert.equal(filled.offer.status, 'FILLED');
});

function movementInput(overrides = {}) {
  return {
    booking_reference: 'ASYNC-0001',
    source_site: 'nadiairporttransfers.com',
    origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
    destination: 'Sofitel Denarau', dropoff_zone: 'DENARAU',
    pickup_datetime: '2026-10-10T08:00:00Z',
    arrival_or_departure: 'arrival',
    passenger_count: 2,
    vehicle_class: 'SEDAN',
    customer_price: 45,
    itinerary_id: 'itin-async-1',
    test_data: true,
    ...overrides,
  };
}

test('ledger.js: ingestMovement resolves the real inserted movement against an async store, and idempotency still holds', async () => {
  const store = asyncStore();
  const raw = movementInput({ booking_reference: 'ASYNC-IDEM-1' });
  const first = await ingestMovement(store, raw);
  assert.equal(first.wasNew, true);
  assert.equal(typeof first.movement.movement_id, 'string', 'ingestMovement must resolve the real stored movement');

  const second = await ingestMovement(store, raw);
  assert.equal(second.wasNew, false, 'idempotency must still be honoured once the store call is awaited');
  assert.equal(second.movement.movement_id, first.movement.movement_id);
});

test('ledger.js: linkReturnMovement resolves both updated movements against an async store', async () => {
  const store = asyncStore();
  const out = await ingestMovement(store, movementInput({
    booking_reference: 'ASYNC-LINK-OUT',
    itinerary_id: 'itin-async-link',
  }));
  const ret = await ingestMovement(store, movementInput({
    booking_reference: 'ASYNC-LINK-RET',
    origin: 'Sofitel Denarau', pickup_zone: 'DENARAU',
    destination: 'Nadi Airport', dropoff_zone: 'NAD_AIRPORT',
    pickup_datetime: '2026-10-12T08:00:00Z',
    arrival_or_departure: 'departure',
    itinerary_id: 'itin-async-link',
  }));
  const linked = await linkReturnMovement(store, out.movement.movement_id, ret.movement.movement_id);
  assert.equal(linked.outbound.linked_return_movement_id, ret.movement.movement_id);
  assert.equal(linked.return.linked_return_movement_id, out.movement.movement_id);
});

test('pipeline.js: processIncomingMovement resolves a real result object against an async store', async () => {
  const store = asyncStore();
  const result = await processIncomingMovement(store, movementInput({
    booking_reference: 'ASYNC-PIPE-1',
    itinerary_id: 'itin-async-pipe',
  }));
  assert.equal(result.wasNew, true);
  assert.equal(typeof result.movement.movement_id, 'string');
  assert.equal(result.matcherError, null);
});

test('board.js: buildSevenDayMovementBoard resolves real arrays (not Promises) against an async store', async () => {
  const store = asyncStore();
  const nowIso = '2026-10-09T00:00:00Z';
  await ingestMovement(store, movementInput({
    booking_reference: 'ASYNC-BOARD-1',
    itinerary_id: 'itin-async-board',
  }));
  const board = await buildSevenDayMovementBoard(store, { nowIso });
  assert.ok(Array.isArray(board.confirmedMovements), 'confirmedMovements must be a resolved array, not a pending Promise');
  assert.equal(board.confirmedMovements.length, 1);
  assert.ok(Array.isArray(board.possibleSmartFillSpecials));
});
