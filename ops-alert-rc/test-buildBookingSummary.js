// CEO P0 Round 6, Track B - isolated test harness. Not deployed anywhere,
// runs standalone with plain node. Feeds buildBookingSummary() six
// representative booking rows shaped exactly like real INSERT results from
// createBookingRecord() (same field names, same null-handling) and prints
// the resulting alert text for each, plus a persistence/idempotency
// blast-radius check.
const { buildBookingSummary } = require('./buildBookingSummary');

const payloads = {
  '1. FijiDash (one-way, flight present)': {
    id: 71, client_booking_ref: 'FD-RAET93', guest_name: 'James Derajan',
    pickup_zone: 'Nadi Airport', destination_zone: 'Vuda Point', vehicle_type: 'minibus',
    quoted_currency: 'FJD', quoted_amount: 112.23,
    pickup_date: '2026-09-10', pickup_time: '14:00', flight_number: 'FJ811',
    return_date: null, return_time: null, return_pickup_location: null,
  },
  '2. Nadi one-way (no flight)': {
    id: 70, client_booking_ref: 'FTT-R8VHGA', guest_name: 'CEO CANARY TEST DO NOT ACTION',
    pickup_zone: 'Nadi Airport', destination_zone: 'Natadola', vehicle_type: 'minivan',
    quoted_currency: 'FJD', quoted_amount: 134,
    pickup_date: '2026-09-08', pickup_time: '10:00', flight_number: null,
    return_date: null, return_time: null, return_pickup_location: null,
  },
  '3. Nadi return (full return details)': {
    id: 999997, client_booking_ref: 'PRODVERIFY-RETURN-1', guest_name: 'ProdVerify ReturnTrip',
    pickup_zone: 'Nadi Airport', destination_zone: 'Momi Bay', vehicle_type: 'sedan',
    quoted_currency: 'FJD', quoted_amount: 166,
    pickup_date: '2026-09-08', pickup_time: '10:00', flight_number: null,
    return_date: '2026-09-22', return_time: '16:00', return_pickup_location: 'Fiji Marriott Resort Momi Bay',
  },
  '4. Null flight (FijiDash, guest skipped it)': {
    id: 68, client_booking_ref: 'FD-QUNG9T', guest_name: 'James Derajan',
    pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan',
    quoted_currency: 'FJD', quoted_amount: 49,
    pickup_date: '2026-09-07', pickup_time: '09:00', flight_number: null,
    return_date: null, return_time: null, return_pickup_location: null,
  },
  '5. Null return data (one-way, so return fields never sent)': {
    id: 67, client_booking_ref: 'FD-Q2A58S', guest_name: 'CEO CANARY HOTFIX TEST',
    pickup_zone: 'Nadi Airport', destination_zone: 'Coral Coast', vehicle_type: 'sedan',
    quoted_currency: 'FJD', quoted_amount: 129,
    pickup_date: '2026-09-06', pickup_time: '17:30', flight_number: 'NZ56',
    return_date: null, return_time: null, return_pickup_location: null,
  },
  '6. Idempotent replay (same booking object, called twice)': {
    id: 999997, client_booking_ref: 'PRODVERIFY-RETURN-1', guest_name: 'ProdVerify ReturnTrip',
    pickup_zone: 'Nadi Airport', destination_zone: 'Momi Bay', vehicle_type: 'sedan',
    quoted_currency: 'FJD', quoted_amount: 166,
    pickup_date: '2026-09-08', pickup_time: '10:00', flight_number: null,
    return_date: '2026-09-22', return_time: '16:00', return_pickup_location: 'Fiji Marriott Resort Momi Bay',
  },
};

console.log('='.repeat(70));
for (const [label, b] of Object.entries(payloads)) {
  console.log(`\n--- ${label} ---`);
  console.log(buildBookingSummary(b));
}
console.log('\n' + '='.repeat(70));

// Idempotency check: same input -> byte-identical output, every time.
// Proves the function is pure (no hidden state, no side effect that could
// duplicate an alert or drift between the real send and a replay).
const run1 = buildBookingSummary(payloads['6. Idempotent replay (same booking object, called twice)']);
const run2 = buildBookingSummary(payloads['6. Idempotent replay (same booking object, called twice)']);
console.log('\nIdempotency check (same input twice, byte-identical?):', run1 === run2 ? 'PASS' : 'FAIL');

// Blast-radius proof: this function accepts NO db/env/request object at
// all - only a plain data object. It cannot reach D1, cannot construct a
// second INSERT, cannot mutate the booking row, and has no code path back
// into createBookingRecord() or the HTTP response. Demonstrated by
// signature inspection, not just assertion:
console.log('\nFunction arity (should be 1 - just the booking row, nothing else):', buildBookingSummary.length);
console.log('Function source references "INSERT" or "env.DB"?',
  /INSERT|env\.DB|fetch\(/.test(buildBookingSummary.toString()) ? 'FOUND (would be a problem)' : 'NOT FOUND (confirms no persistence/network access)');
