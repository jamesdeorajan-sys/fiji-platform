-- Marau Stage 1 (PREVIEW/TEST ONLY) - closeout round.
--
--  leg_shape: WHY a mirrored booking has the leg_type it has (one_way_arrival, round_trip_single_booking, standalone_departure,
--  direction_not_a_holiday_leg, missing_or_ambiguous_location, itinerary_fields_not_provided). Direction alone (an airport-bound
--  trip) is never treated as proof of a round-trip relationship.
--  relationship_basis: on an adjustment, what evidence let a credit land on that booking ('declared_return_leg' = the guest
--  declared a return in Marau; 'staff_confirmed_departure' = a named staff member confirmed a standalone airport-bound booking
--  is the guest's own departure).
ALTER TABLE marau_test_bookings ADD COLUMN leg_shape TEXT;
ALTER TABLE marau_booking_adjustments ADD COLUMN relationship_basis TEXT;
