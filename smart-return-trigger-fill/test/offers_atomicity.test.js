import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/db.js';
import { discoverOffer, validateOffer, activateOffer, holdOffer, releaseHold, fillOffer, expireOffer } from '../src/offers.js';

function activeOffer(store, overrides = {}) {
  const offer = discoverOffer(store, {
    source_movement_id: 'mv_x',
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
  });
  validateOffer(store, offer.offer_id);
  activateOffer(store, offer.offer_id);
  return store.getOffer(offer.offer_id);
}

test('one offer cannot be sold (held) twice — second concurrent hold attempt fails', () => {
  const store = createMemoryStore();
  const offer = activeOffer(store);

  const first = holdOffer(store, offer.offer_id);
  const second = holdOffer(store, offer.offer_id);

  assert.equal(first.success, true);
  assert.equal(second.success, false);
  assert.equal(store.getOffer(offer.offer_id).status, 'HELD');
});

test('offer hold -> fill is atomic and the vehicle/time slot cannot be double-allocated', () => {
  const store = createMemoryStore();
  const offer = activeOffer(store);

  holdOffer(store, offer.offer_id);
  const fillA = fillOffer(store, offer.offer_id, { movement_id: 'mv_fill_a' });
  const fillB = fillOffer(store, offer.offer_id, { movement_id: 'mv_fill_b' });

  assert.equal(fillA.success, true);
  assert.equal(fillB.success, false);
  assert.equal(store.getOffer(offer.offer_id).status, 'FILLED');
});

test('an expired offer cannot be booked', () => {
  const store = createMemoryStore();
  const offer = activeOffer(store, { expires_at: '2020-01-01T00:00:00Z' });

  const result = holdOffer(store, offer.offer_id);

  assert.equal(result.success, false);
  assert.equal(result.reason, 'EXPIRED');
  assert.equal(store.getOffer(offer.offer_id).status, 'EXPIRED');
});

test('a released hold returns the offer to ACTIVE and it can be held again by a different taker', () => {
  const store = createMemoryStore();
  const offer = activeOffer(store);

  holdOffer(store, offer.offer_id);
  const released = releaseHold(store, offer.offer_id);
  const reheld = holdOffer(store, offer.offer_id);

  assert.equal(released.success, true);
  assert.equal(reheld.success, true);
});

test('validateOffer rejects an offer missing required fields', () => {
  const store = createMemoryStore();
  const offer = discoverOffer(store, {
    source_movement_id: 'mv_x',
    origin_zone: 'NAD_AIRPORT',
    destination_zone: 'DENARAU',
    // vehicle_class intentionally omitted
    standard_price: 40,
    expires_at: '2026-10-10T10:00:00Z',
    test_data: true,
  });
  const result = validateOffer(store, offer.offer_id);
  assert.equal(result.success, false);
  assert.match(result.reason, /MISSING_FIELDS/);
});

test('expireOffer refuses to move a terminal (FILLED) offer', () => {
  const store = createMemoryStore();
  const offer = activeOffer(store);
  holdOffer(store, offer.offer_id);
  fillOffer(store, offer.offer_id, { movement_id: 'mv_fill' });

  const result = expireOffer(store, offer.offer_id);
  assert.equal(result.success, false);
  assert.equal(result.reason, 'ALREADY_TERMINAL');
});
