/* Issue #54 Stage 1 (SHADOW MODE) — SAMPLE shadow output.
 *
 * NOT a live report. Every row below is hand-built, clearly-fake demo data
 * shaped exactly like the real `bookings`/`booking_events` schema (see
 * src/production_adapter.js's header comment), run through the exact same
 * runLiveShadowReport() the real CLI uses. This exists purely so a reviewer
 * can see what a populated report looks like without needing real D1
 * access — see docs/CEO_RELEASE_REPORT.md and the mission's own final
 * report for why no real rows were available this round.
 *
 * Run with: node scripts/sample_shadow_output.js
 */
import { runLiveShadowReport } from './live_shadow_report.js';

const SOURCE_SITE = 'nadiairporttransfers.com';

function booking(overrides) {
  return {
    id: overrides.id,
    guest_name: 'SAMPLE DATA - not real',
    guest_phone: '+679 000 0000',
    pickup_zone: overrides.pickup_zone,
    destination_zone: overrides.destination_zone,
    vehicle_type: overrides.vehicle_type ?? 'sedan',
    quoted_currency: 'FJD',
    quoted_amount: overrides.quoted_amount,
    assigned_driver_id: overrides.assigned_driver_id ?? 9,
    status: 'accepted',
    pickup_date: overrides.pickup_date,
    pickup_time: overrides.pickup_time,
    created_at: overrides.created_at ?? '2026-10-01T00:00:00Z',
  };
}

function acceptedEvent(bookingId, actor) {
  return { booking_id: bookingId, event_type: 'accepted', new_status: 'accepted', actor, created_at: '2026-10-01T00:05:00Z' };
}

const rows = [
  // A confirmed arrival leg — driver-accepted.
  {
    booking: booking({ id: 9001, pickup_zone: 'NAN', destination_zone: 'DENARAU', quoted_amount: 49, pickup_date: '2026-10-05', pickup_time: '09:00' }),
    event: acceptedEvent(9001, 'driver:9'),
    passengerCount: 2,
  },
  // Its plausible reverse (empty-leg-avoiding) candidate — admin-assigned.
  {
    booking: booking({ id: 9002, pickup_zone: 'DENARAU', destination_zone: 'NAN', quoted_amount: 49, pickup_date: '2026-10-05', pickup_time: '15:00' }),
    event: acceptedEvent(9002, 'admin'),
    passengerCount: 2,
  },
  // A booking that is NOT yet human-confirmed — must be skipped, not evaluated.
  {
    booking: booking({ id: 9003, pickup_zone: 'NAN', destination_zone: 'PACIFIC_HARBOUR', quoted_amount: 199, pickup_date: '2026-10-06', pickup_time: '10:00', status: 'pending' }),
    event: null,
    passengerCount: 3,
  },
];
// booking() always sets status:'accepted' from the overrides spread order
// above except where explicitly overridden - fix the one deliberate
// pending case:
rows[2].booking.status = 'pending';

// Demo-only key: freshly random on every run via the Web Crypto RNG, never
// a fixed/committed literal, and discarded the moment this process exits.
// This is NOT "inventing a production secret" (prohibited) - it's simply
// what any keyed-HMAC demo needs to run at all, and it never needs to be
// stable across runs since this script's output is illustrative only, not
// a real, re-joinable shadow ledger.
const demoShadowSecret = crypto.getRandomValues(new Uint8Array(32));

const report = await runLiveShadowReport(rows, { sourceSite: SOURCE_SITE, shadowSecret: demoShadowSecret });
console.log('# SAMPLE OUTPUT ONLY — hand-built demo rows, not real bookings.');
console.log(JSON.stringify(report, null, 2));
