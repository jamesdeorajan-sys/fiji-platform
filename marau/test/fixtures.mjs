// Marau Stage 1 (PREVIEW ONLY) — synthetic test fixtures. Every record
// carries test_data: true/1 and uses opaque references — no real names,
// emails or phone numbers anywhere in this file (the ones used as
// "synthetic contacts" below are throwaway example.test addresses/numbers
// that resolve nowhere real).
import { createTestD1 } from './d1_sqlite_shim.mjs';
import { ingestMovement } from '../../smart-return-trigger-fill/src/ledger.js';
import { discoverOffer, validateOffer, activateOffer } from '../../smart-return-trigger-fill/src/offers.js';
import { createD1Store } from '../../smart-return-trigger-fill/src/db.js';

export function makeEnv(overrides = {}) {
  const DB = createTestD1();
  return {
    DB,
    MARAU_ADMIN_TEST_TOKEN: 'test-admin-token-do-not-use-in-production',
    MARAU_OPS_WHATSAPP_TEST_NUMBER: '+15556414099',
    ...overrides,
  };
}

let counter = 0;
function nextRef(prefix) {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function seedMovement(env, overrides = {}) {
  const store = createD1Store({ SMART_RETURN_DB: env.DB });
  const movementInput = {
    booking_reference: overrides.booking_reference || nextRef('SEED-MV'),
    source_site: 'nadiairporttransfers.com',
    origin: 'Nadi Airport', pickup_zone: overrides.origin_zone || 'NAD_AIRPORT',
    destination: 'Sofitel Denarau', dropoff_zone: overrides.destination_zone || 'DENARAU',
    pickup_datetime: overrides.pickup_datetime || new Date(Date.now() + 3 * 3600_000).toISOString(),
    arrival_or_departure: 'arrival',
    passenger_count: 2,
    vehicle_class: overrides.vehicle_class || 'SEDAN',
    customer_price: 45,
    operator_payout: 30,
    absolute_floor: 25,
    test_data: true,
  };
  const { movement } = await ingestMovement(store, movementInput);
  return { movement, movementInput };
}

async function seedOfferForMovement(env, movement, movementInput, overrides = {}) {
  const store = createD1Store({ SMART_RETURN_DB: env.DB });
  const offer = await discoverOffer(store, {
    source_movement_id: movement.movement_id,
    origin_zone: movement.dropoff_zone,
    destination_zone: movement.pickup_zone,
    earliest_pickup: overrides.earliest_pickup || new Date(Date.now() + 4 * 3600_000).toISOString(),
    latest_pickup: overrides.latest_pickup || new Date(Date.now() + 6 * 3600_000).toISOString(),
    vehicle_class: movementInput.vehicle_class,
    capacity: overrides.capacity ?? 1,
    standard_price: overrides.standard_price ?? 60,
    smart_match_price: overrides.smart_match_price ?? 24,
    absolute_floor: 20,
    expires_at: overrides.expires_at || new Date(Date.now() + 5 * 3600_000).toISOString(),
    test_data: true,
  });
  await validateOffer(store, offer.offer_id);
  await activateOffer(store, offer.offer_id);
  return env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offer.offer_id).first();
}

/**
 * Records that `movement` is assigned to `vehicleId` for a window — the
 * ops-verified-movements input Issue #54 itself is still waiting on,
 * supplied directly here for fixtures. Without this row, worker.js
 * treats the vehicle as UNKNOWN and blocks confirmation outright.
 */
export async function seedVehicleWindowForMovement(env, movement, { vehicleId, windowStart, windowEnd } = {}) {
  await env.DB
    .prepare(
      `INSERT INTO vehicle_windows (subject_type, subject_id, vehicle_id, window_start, window_end, test_data, created_at)
       VALUES ('MOVEMENT', ?, ?, ?, ?, 1, ?)`
    )
    .bind(movement.movement_id, vehicleId, windowStart, windowEnd, new Date().toISOString())
    .run();
}

export async function seedVehicleWindowForBooking(env, bookingId, { vehicleId, windowStart, windowEnd } = {}) {
  await env.DB
    .prepare(
      `INSERT INTO vehicle_windows (subject_type, subject_id, vehicle_id, window_start, window_end, test_data, created_at)
       VALUES ('BOOKING', ?, ?, ?, ?, 1, ?)`
    )
    .bind(String(bookingId), vehicleId, windowStart, windowEnd, new Date().toISOString())
    .run();
}

/**
 * A single ACTIVE offer with its movement assigned to a known vehicle —
 * the common case most tests need. `vehicleId` defaults to a fresh,
 * never-reused id per call so unrelated tests never accidentally share a
 * vehicle unless a test explicitly asks them to (see
 * seedTwoOffersSameVehicleOverlappingWindows below).
 */
export async function seedActiveOffer(env, overrides = {}) {
  const { movement, movementInput } = await seedMovement(env, overrides);
  const offer = await seedOfferForMovement(env, movement, movementInput, overrides);
  await seedVehicleWindowForMovement(env, movement, {
    vehicleId: overrides.vehicle_id || nextRef('VEH'),
    windowStart: overrides.window_start || new Date(Date.now() + 3 * 3600_000).toISOString(),
    windowEnd: overrides.window_end || new Date(Date.now() + 7 * 3600_000).toISOString(),
  });
  return { movement, offer };
}

/** Same as seedActiveOffer but deliberately WITHOUT a vehicle_windows row — for testing the "unknown vehicle blocks confirmation" rule. */
export async function seedActiveOfferWithUnknownVehicle(env, overrides = {}) {
  const { movement, movementInput } = await seedMovement(env, overrides);
  const offer = await seedOfferForMovement(env, movement, movementInput, overrides);
  return { movement, offer };
}

/**
 * Two DIFFERENT smart_offers rows backed by TWO DIFFERENT movements, both
 * assigned to the SAME real vehicle with OVERLAPPING windows — this is
 * exactly the case the P0 fix targets (as opposed to
 * seedCompetingOffersForSameMovement below, which is the narrower,
 * already-guarded "same movement claimed twice" case).
 */
export async function seedTwoOffersSameVehicleOverlappingWindows(env, { vehicleId = nextRef('VEH-SHARED'), overlapMinutesShift = 60 } = {}) {
  const windowAStart = new Date(Date.now() + 4 * 3600_000).toISOString();
  const windowAEnd = new Date(Date.now() + 6 * 3600_000).toISOString();
  const windowBStart = new Date(Date.now() + 4 * 3600_000 + overlapMinutesShift * 60_000).toISOString();
  const windowBEnd = new Date(Date.now() + 6 * 3600_000 + overlapMinutesShift * 60_000).toISOString();

  const seedA = await seedMovement(env, { booking_reference: nextRef('SEED-MV-VEHA') });
  const offerA = await seedOfferForMovement(env, seedA.movement, seedA.movementInput, { earliest_pickup: windowAStart, latest_pickup: windowAEnd, smart_match_price: 24 });
  await seedVehicleWindowForMovement(env, seedA.movement, { vehicleId, windowStart: windowAStart, windowEnd: windowAEnd });

  const seedB = await seedMovement(env, { booking_reference: nextRef('SEED-MV-VEHB') });
  const offerB = await seedOfferForMovement(env, seedB.movement, seedB.movementInput, { earliest_pickup: windowBStart, latest_pickup: windowBEnd, smart_match_price: 22 });
  await seedVehicleWindowForMovement(env, seedB.movement, { vehicleId, windowStart: windowBStart, windowEnd: windowBEnd });

  return { movementA: seedA.movement, offerA, movementB: seedB.movement, offerB, vehicleId };
}

/**
 * The narrower, original case: two DIFFERENT offer rows both tracing back
 * to the literal SAME movement (a double-listing bug). Kept because
 * vehicle_time_claims (0010) still guards this specifically, in addition
 * to the newer vehicle_allocations (0014) overlap guard.
 */
export async function seedCompetingOffersForSameMovement(env) {
  const { movement, movementInput } = await seedMovement(env, { booking_reference: nextRef('SEED-MV-SHARED') });
  const vehicleId = nextRef('VEH-SAME-MOVEMENT');
  const windowStart = new Date(Date.now() + 4 * 3600_000).toISOString();
  const windowEnd = new Date(Date.now() + 6 * 3600_000).toISOString();
  await seedVehicleWindowForMovement(env, movement, { vehicleId, windowStart, windowEnd });

  const offerA = await seedOfferForMovement(env, movement, movementInput, { earliest_pickup: windowStart, latest_pickup: windowEnd, smart_match_price: 24 });
  const offerB = await seedOfferForMovement(env, movement, movementInput, { earliest_pickup: windowStart, latest_pickup: windowEnd, smart_match_price: 22 });
  return { movement, offerA, offerB };
}

export function synthGuest(overrides = {}) {
  const n = ++counter;
  return {
    guest_email: `preview.guest${n}@example.test`,
    guest_phone: `+150055501${String(n).padStart(2, '0')}`,
    whatsapp_available: true,
    pickup_zone: 'NAD_AIRPORT',
    destination_zone: 'DENARAU',
    vehicle_type: 'Sedan',
    quoted_amount: 45,
    pickup_datetime: new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16),
    ...overrides,
  };
}
