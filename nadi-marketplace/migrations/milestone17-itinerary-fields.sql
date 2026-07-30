-- Nadi Airport Transfers — Driver Marketplace
-- Milestone 17: itinerary fields (pickup_date, pickup_time, notes,
-- return_date, return_time, return_pickup_location).
--
-- The bookings table previously stored zero itinerary detail for either
-- leg of a trip - only pricing/zone/vehicle/settlement data. Added after a
-- real return-trip booking reached dispatch with no return date, time, or
-- pickup location captured anywhere. All nullable/optional so existing
-- rows and the other two createBookingRecord() callers (admin test
-- booking, negotiation accept-offer) are unaffected.

ALTER TABLE bookings ADD COLUMN pickup_date TEXT;
ALTER TABLE bookings ADD COLUMN pickup_time TEXT;
ALTER TABLE bookings ADD COLUMN notes TEXT;
ALTER TABLE bookings ADD COLUMN return_date TEXT;
ALTER TABLE bookings ADD COLUMN return_time TEXT;
ALTER TABLE bookings ADD COLUMN return_pickup_location TEXT;
