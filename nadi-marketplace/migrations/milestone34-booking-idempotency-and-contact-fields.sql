-- Fiji Dash — Milestone 34: booking idempotency + missing ops contact fields.
--
-- P0 revenue-protection fix (GitHub Issue #34): booking #42 (Brendan Gunton)
-- and #43 (duplicate Brendan booking, same route/date/time/vehicle) proved
-- POST /bookings has no idempotency protection at all - a retried or
-- double-submitted guest request creates a second real booking row, not a
-- no-op. client_booking_ref is a stable value the guest widget generates
-- once per booking attempt (the same "FD-XXXXXX" reference it already
-- shows the guest) and sends on every attempt/retry for that same booking,
-- so createBookingRecord() can detect "this exact request already
-- succeeded" and return the existing row instead of inserting a new one.
--
-- Partial unique index (WHERE client_booking_ref IS NOT NULL), not a plain
-- UNIQUE column constraint, because the other two createBookingRecord()
-- callers (admin test booking, negotiation accept-offer) don't have a
-- client-generated ref to send and will keep passing NULL - SQLite/D1
-- allow any number of NULLs through a partial unique index, so those two
-- callers are completely unaffected.
--
-- guest_email and flight_number: Issue #34 requirement 9 - operations
-- needs at minimum email + phone/WhatsApp + flight + pickup date/time to
-- actually run a booking, and only phone + pickup date/time reach this
-- table today (see milestone17-itinerary-fields.sql). Both nullable - the
-- guest widget form doesn't collect email on every path, and not every
-- booking has a flight to track (e.g. a departing-guest custom-address
-- pickup with no NAN leg).

ALTER TABLE bookings ADD COLUMN client_booking_ref TEXT;
ALTER TABLE bookings ADD COLUMN guest_email TEXT;
ALTER TABLE bookings ADD COLUMN flight_number TEXT;

CREATE UNIQUE INDEX idx_bookings_client_booking_ref
  ON bookings(client_booking_ref)
  WHERE client_booking_ref IS NOT NULL;
