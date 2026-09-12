/* Issue #54 Stage 1 (SHADOW MODE) — synthetic canary data only.
 * Every record is tagged test_data: true. No real customer PII: no names,
 * emails, phone numbers, or addresses anywhere in this file — only opaque
 * synthetic booking references and zone codes.
 */

const BASE = new Date('2026-10-01T00:00:00Z').getTime();
const hoursFromBase = (h) => new Date(BASE + h * 60 * 60 * 1000).toISOString();

export function buildSyntheticMovements() {
  return [
    // Exact reverse pair, >=7 days out relative to nowIso used in tests (2026-09-20).
    {
      movement_id: 'mv_syn_out_01',
      booking_reference: 'SYN-0001',
      source_site: 'nadiairporttransfers.com',
      itinerary_id: 'itn_syn_01',
      origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
      destination: 'Sofitel Denarau', dropoff_zone: 'DENARAU',
      pickup_datetime: hoursFromBase(0),
      arrival_or_departure: 'arrival',
      passenger_count: 2, vehicle_class: 'SEDAN',
      customer_price: 45, operator_payout: 30, absolute_floor: 25,
      test_data: true,
    },
    {
      movement_id: 'mv_syn_ret_01',
      booking_reference: 'SYN-0002',
      source_site: 'nadiairporttransfers.com',
      itinerary_id: 'itn_syn_01',
      linked_return_movement_id: 'mv_syn_out_01',
      origin: 'Sofitel Denarau', pickup_zone: 'DENARAU',
      destination: 'Nadi Airport', dropoff_zone: 'NAD_AIRPORT',
      pickup_datetime: hoursFromBase(72),
      arrival_or_departure: 'departure',
      passenger_count: 2, vehicle_class: 'SEDAN',
      customer_price: 45, operator_payout: 30, absolute_floor: 25,
      test_data: true,
    },

    // Nearby-reverse candidate (Nadi Town instead of exact Denarau reverse).
    {
      movement_id: 'mv_syn_nearby_01',
      booking_reference: 'SYN-0003',
      source_site: 'bookfijitransfers.com',
      origin: 'Nadi Town Hotel', pickup_zone: 'NAD_TOWN',
      destination: 'Nadi Airport', dropoff_zone: 'NAD_AIRPORT',
      pickup_datetime: hoursFromBase(3),
      arrival_or_departure: 'departure',
      passenger_count: 1, vehicle_class: 'SEDAN',
      customer_price: 20, operator_payout: null, absolute_floor: null,
      test_data: true,
    },

    // Corridor match pair (Nadi Airport <-> Coral Coast corridor).
    {
      movement_id: 'mv_syn_corridor_a',
      booking_reference: 'SYN-0004',
      source_site: 'book.fijidash.com',
      origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
      destination: 'Shangri-La Yanuca', dropoff_zone: 'CORAL_COAST',
      pickup_datetime: hoursFromBase(5),
      arrival_or_departure: 'arrival',
      passenger_count: 3, vehicle_class: 'VAN',
      customer_price: 90, operator_payout: 60, absolute_floor: 50,
      test_data: true,
    },
    {
      // Same corridor, same direction as corridor_a (Nadi -> Coral Coast) —
      // a genuine corridor match, distinct from an exact reverse leg.
      movement_id: 'mv_syn_corridor_b',
      booking_reference: 'SYN-0005',
      source_site: 'book.fijidash.com',
      origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
      destination: 'Sheraton Coral Coast', dropoff_zone: 'CORAL_COAST',
      pickup_datetime: hoursFromBase(6),
      arrival_or_departure: 'arrival',
      passenger_count: 2, vehicle_class: 'VAN',
      customer_price: 85, operator_payout: 55, absolute_floor: 48,
      test_data: true,
    },

    // Unmatched single movement — no reverse/corridor/chain candidate exists.
    {
      movement_id: 'mv_syn_unmatched_01',
      booking_reference: 'SYN-0006',
      source_site: 'nadiairporttransfers.com',
      origin: 'Suva CBD', pickup_zone: 'SUVA',
      destination: 'Grand Pacific Hotel', dropoff_zone: 'SUVA',
      pickup_datetime: hoursFromBase(10),
      arrival_or_departure: 'arrival',
      passenger_count: 1, vehicle_class: 'SEDAN',
      customer_price: 15, operator_payout: 10, absolute_floor: 8,
      test_data: true,
    },

    // Return-lock pair that is LESS than 7 days out (ineligible, for contrast).
    {
      movement_id: 'mv_syn_out_soon',
      booking_reference: 'SYN-0007',
      source_site: 'nadiairporttransfers.com',
      itinerary_id: 'itn_syn_soon',
      origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
      destination: 'Denarau Hotel', dropoff_zone: 'DENARAU',
      pickup_datetime: hoursFromBase(-96), // relative to base; test nowIso is set accordingly
      arrival_or_departure: 'arrival',
      passenger_count: 2, vehicle_class: 'SEDAN',
      customer_price: 45, operator_payout: 30, absolute_floor: 25,
      test_data: true,
    },
    {
      movement_id: 'mv_syn_ret_soon',
      booking_reference: 'SYN-0008',
      source_site: 'nadiairporttransfers.com',
      itinerary_id: 'itn_syn_soon',
      linked_return_movement_id: 'mv_syn_out_soon',
      origin: 'Denarau Hotel', pickup_zone: 'DENARAU',
      destination: 'Nadi Airport', dropoff_zone: 'NAD_AIRPORT',
      pickup_datetime: hoursFromBase(-72),
      arrival_or_departure: 'departure',
      passenger_count: 2, vehicle_class: 'SEDAN',
      customer_price: 45, operator_payout: 30, absolute_floor: 25,
      test_data: true,
    },

    // Multi-leg chain candidates: A -> B -> C, same vehicle class, turnaround-feasible.
    {
      movement_id: 'mv_syn_chain_a',
      booking_reference: 'SYN-0009',
      source_site: 'book.fijidash.com',
      origin: 'Nadi Airport', pickup_zone: 'NAD_AIRPORT',
      destination: 'Nadi Town', dropoff_zone: 'NAD_TOWN',
      pickup_datetime: hoursFromBase(20),
      arrival_or_departure: 'arrival',
      passenger_count: 1, vehicle_class: 'SEDAN',
      customer_price: 20, operator_payout: 12, absolute_floor: 10,
      test_data: true,
    },
    {
      movement_id: 'mv_syn_chain_b',
      booking_reference: 'SYN-0010',
      source_site: 'book.fijidash.com',
      origin: 'Nadi Town', pickup_zone: 'NAD_TOWN',
      destination: 'Denarau', dropoff_zone: 'DENARAU',
      pickup_datetime: hoursFromBase(21.5),
      arrival_or_departure: 'departure',
      passenger_count: 1, vehicle_class: 'SEDAN',
      customer_price: 18, operator_payout: 11, absolute_floor: 9,
      test_data: true,
    },
    {
      movement_id: 'mv_syn_chain_c',
      booking_reference: 'SYN-0011',
      source_site: 'book.fijidash.com',
      origin: 'Denarau', pickup_zone: 'DENARAU',
      destination: 'Nadi Airport', dropoff_zone: 'NAD_AIRPORT',
      pickup_datetime: hoursFromBase(23),
      arrival_or_departure: 'departure',
      passenger_count: 1, vehicle_class: 'SEDAN',
      customer_price: 20, operator_payout: 12, absolute_floor: 10,
      test_data: true,
    },
  ];
}
