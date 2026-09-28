-- Two DISTINCT movements/offers, each with its OWN vehicle_windows row,
-- but sharing the SAME real vehicle_id with OVERLAPPING time windows —
-- for the round-10 "two distinct requests competing for overlapping
-- vehicle availability" exercise. This re-verifies the original P0
-- vehicle/time exclusivity finding (round 2) end-to-end against real
-- hosted D1, through the full round 6-8 ownership stack.
INSERT INTO movements (
  movement_id, idempotency_key, booking_reference, source_site, origin, pickup_zone,
  destination, dropoff_zone, pickup_datetime, earliest_safe_pickup, latest_safe_pickup,
  arrival_or_departure, passenger_count, luggage_count, vehicle_class,
  customer_price, operator_payout, absolute_floor, test_data, created_at, updated_at
) VALUES
('mv_hosted_overlap_a', 'idem_hosted_overlap_a', 'HOSTED-OVERLAP-A', 'nadiairporttransfers.com',
  'Nadi Airport', 'NAD_AIRPORT', 'Sofitel Denarau', 'DENARAU',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+3 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','+3 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','+3 hours'),
  'arrival', 2, 2, 'SEDAN', 45, 30, 25, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('mv_hosted_overlap_b', 'idem_hosted_overlap_b', 'HOSTED-OVERLAP-B', 'nadiairporttransfers.com',
  'Nadi Airport', 'NAD_AIRPORT', 'Sofitel Denarau', 'DENARAU',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+4 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','+4 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','+4 hours'),
  'arrival', 2, 2, 'SEDAN', 45, 30, 25, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT INTO smart_offers (
  offer_id, source_movement_id, origin_zone, destination_zone, earliest_pickup, latest_pickup,
  vehicle_class, capacity, standard_price, smart_match_price, absolute_floor, expires_at,
  inventory_count, status, test_data, created_at, updated_at
) VALUES
('of_hosted_overlap_a', 'mv_hosted_overlap_a', 'DENARAU', 'NAD_AIRPORT',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+4 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','+6 hours'),
  'SEDAN', 1, 60, 24, 20, strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 hours'),
  1, 'ACTIVE', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('of_hosted_overlap_b', 'mv_hosted_overlap_b', 'DENARAU', 'NAD_AIRPORT',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+4 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','+6 hours'),
  'SEDAN', 1, 60, 24, 20, strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 hours'),
  1, 'ACTIVE', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- SAME vehicle_id, OVERLAPPING windows: A = [+3h, +7h], B = [+5h, +9h] — a
-- genuine two-hour overlap ([+5h, +7h]), not merely the same vehicle on
-- unrelated days.
INSERT INTO vehicle_windows (subject_type, subject_id, vehicle_id, window_start, window_end, test_data, created_at)
VALUES
('MOVEMENT', 'mv_hosted_overlap_a', 'veh_hosted_overlap_shared',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+3 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 hours'), 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('MOVEMENT', 'mv_hosted_overlap_b', 'veh_hosted_overlap_shared',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 hours'), strftime('%Y-%m-%dT%H:%M:%fZ','now','+9 hours'), 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
