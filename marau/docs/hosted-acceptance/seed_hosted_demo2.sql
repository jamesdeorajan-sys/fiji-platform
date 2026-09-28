-- Second synthetic movement + offer for the hosted-acceptance concurrency
-- exercises (duplicate requests, competing confirmations, interrupted
-- recovery) — kept separate from the first so the happy-path flow's own
-- state is undisturbed.
INSERT INTO movements (
  movement_id, idempotency_key, booking_reference, source_site, origin, pickup_zone,
  destination, dropoff_zone, pickup_datetime, earliest_safe_pickup, latest_safe_pickup,
  arrival_or_departure, passenger_count, luggage_count, vehicle_class,
  customer_price, operator_payout, absolute_floor, test_data, created_at, updated_at
) VALUES (
  'mv_hosted_demo_002', 'idem_hosted_demo_002', 'HOSTED-DEMO-002', 'nadiairporttransfers.com',
  'Nadi Airport', 'NAD_AIRPORT', 'Sofitel Denarau', 'DENARAU',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+3 hours'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+3 hours'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+3 hours'),
  'arrival', 2, 2, 'SEDAN', 45, 30, 25, 1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

INSERT INTO smart_offers (
  offer_id, source_movement_id, origin_zone, destination_zone, earliest_pickup, latest_pickup,
  vehicle_class, capacity, standard_price, smart_match_price, absolute_floor, expires_at,
  inventory_count, status, test_data, created_at, updated_at
) VALUES (
  'of_hosted_demo_002', 'mv_hosted_demo_002', 'DENARAU', 'NAD_AIRPORT',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+4 hours'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+6 hours'),
  'SEDAN', 1, 60, 24, 20,
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 hours'),
  1, 'ACTIVE', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

INSERT INTO vehicle_windows (subject_type, subject_id, vehicle_id, window_start, window_end, test_data, created_at)
VALUES (
  'MOVEMENT', 'mv_hosted_demo_002', 'veh_hosted_demo_002',
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+3 hours'),
  strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 hours'),
  1, strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
