// CEO P0 Round 6, Track B - isolated ops-alert RC.
// This is the ENTIRE patch: one pure function, extracted verbatim as it
// would appear in nadi-marketplace/worker/worker.js, replacing the current
// single-line bookingSummary template at line ~3164 in handleGuestBookingCreate().
//
// Pure function: takes the already-inserted booking row (b), returns a
// string. Reads nothing else, writes nothing, awaits nothing, throws
// nothing a caller needs to catch (see the defensive .filter(Boolean)
// below - a missing field just omits its line, never throws).
//
// Called from handleGuestBookingCreate() AFTER createBookingRecord()'s
// INSERT has already committed and `b.id`/`b.client_booking_ref` already
// exist as real values from that completed write - this function cannot
// affect the INSERT (it runs after it) and cannot affect the HTTP response
// returned to the guest (result.bookingId/result.booking/result.idempotent
// are already assembled before this is ever called - see call site below).
function buildBookingSummary(b) {
  const route = `${b.pickup_zone} -> ${b.destination_zone}`;
  const pickupLine = b.pickup_date && b.pickup_time
    ? `Pickup: ${b.pickup_date} ${b.pickup_time}`
    : (b.pickup_date ? `Pickup: ${b.pickup_date}` : 'Pickup: (not provided)');
  const flightLine = b.flight_number ? `Flight: ${b.flight_number}` : null;
  const vehicleLine = `Vehicle: ${b.vehicle_type}`;
  const isReturn = !!b.return_date;
  const tripLine = `Trip: ${isReturn ? 'return' : 'one-way'}`;
  const returnLine = isReturn
    ? `Return: ${b.return_date}${b.return_time ? ' ' + b.return_time : ''}${b.return_pickup_location ? ' from ' + b.return_pickup_location : ''}`
    : null;
  const totalLine = `Total: ${b.quoted_currency} ${b.quoted_amount}`;
  const refPart = b.client_booking_ref ? `Ref ${b.client_booking_ref}` : 'Ref (none)';

  const lines = [
    `NEW BOOKING | #${b.id} | ${refPart}`,
    route,
    pickupLine,
    flightLine,
    vehicleLine,
    tripLine,
    returnLine,
    totalLine,
    'Open admin dashboard for full details.',
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = { buildBookingSummary };

// ─────────────────────────────────────────────────────────────────────────
// EXACT CALL-SITE DIFF (nadi-marketplace/worker/worker.js, line ~3163-3167,
// inside handleGuestBookingCreate(), unchanged surrounding code shown for
// context - NOT applied to the live file, this RC is standalone):
//
// --- current ---
//   const b = result.booking;
//   const bookingSummary = `New booking #${b.id}: ${b.guest_name}, ${b.pickup_zone} -> ${b.destination_zone}, ${b.vehicle_type}, ${b.quoted_currency} ${b.quoted_amount}.`;
//   for (const alertPhone of await getAdminAlertPhones(env)) {
//     await sendHealthAlertWhatsApp(env, alertPhone, bookingSummary, sqliteNow());
//   }
//
// --- proposed ---
//   const b = result.booking;
//   const bookingSummary = buildBookingSummary(b);
//   for (const alertPhone of await getAdminAlertPhones(env)) {
//     await sendHealthAlertWhatsApp(env, alertPhone, bookingSummary, sqliteNow());
//   }
//
// Only ONE call site touched. buildBookingSummary() itself would live as a
// new, separate top-level function - it does not replace or modify
// createBookingRecord(), handleGuestBookingCreate()'s INSERT logic,
// getAdminAlertPhones(), sendHealthAlertWhatsApp(), CORS handling, or any
// routing. Nothing about WHEN the alert fires, WHO it goes to, or WHETHER
// it fires changes - only what the message text says.
// ─────────────────────────────────────────────────────────────────────────
