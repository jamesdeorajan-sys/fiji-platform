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

/**
 * Ingests a real movement (through the real ledger, not a hand-inserted
 * row) and runs it through discover -> validate -> activate, exactly the
 * real approval pipeline an ops reviewer would use — so an "approved test
 * offer" fixture is faithful to how a real offer would reach ACTIVE.
 */
export async function seedActiveOffer(env, overrides = {}) {
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
  return { movement, offer: await env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offer.offer_id).first() };
}

/**
 * Two DIFFERENT smart_offers rows that both trace back to the SAME
 * source_movement_id — the double-listing scenario the vehicle_time_claims
 * guard exists for. Faithful to a plausible real bug (the same shadow leg
 * discovered/listed twice) rather than an artificial test-only shape.
 */
export async function seedCompetingOffersForSameVehicle(env) {
  const store = createD1Store({ SMART_RETURN_DB: env.DB });
  const movementInput = {
    booking_reference: nextRef('SEED-MV-SHARED'),
    source_site: 'nadiairporttransfers.com',
    origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
    destination: 'Sofitel Denarau', dropoff_zone: 'DENARAU',
    pickup_datetime: new Date(Date.now() + 3 * 3600_000).toISOString(),
    arrival_or_departure: 'arrival',
    passenger_count: 2, vehicle_class: 'SEDAN',
    customer_price: 45, operator_payout: 30, absolute_floor: 25,
    test_data: true,
  };
  const { movement } = await ingestMovement(store, movementInput);

  async function makeOffer(priceOverride) {
    const offer = await discoverOffer(store, {
      source_movement_id: movement.movement_id,
      origin_zone: movement.dropoff_zone,
      destination_zone: movement.pickup_zone,
      earliest_pickup: new Date(Date.now() + 4 * 3600_000).toISOString(),
      latest_pickup: new Date(Date.now() + 6 * 3600_000).toISOString(),
      vehicle_class: movementInput.vehicle_class,
      capacity: 1,
      standard_price: 60,
      smart_match_price: priceOverride,
      absolute_floor: 20,
      expires_at: new Date(Date.now() + 5 * 3600_000).toISOString(),
      test_data: true,
    });
    await validateOffer(store, offer.offer_id);
    await activateOffer(store, offer.offer_id);
    return env.DB.prepare('SELECT * FROM smart_offers WHERE offer_id = ?').bind(offer.offer_id).first();
  }

  const offerA = await makeOffer(24);
  const offerB = await makeOffer(22);
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
