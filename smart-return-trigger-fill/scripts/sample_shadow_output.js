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
import { createMemoryStore } from '../src/db.js';
import { buildRoutePriceTruthEntry } from '../src/route_price_truth_source.js';

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
    status: 'human_confirmed',
    pickup_date: overrides.pickup_date,
    pickup_time: overrides.pickup_time,
    created_at: overrides.created_at ?? '2026-10-01T00:00:00Z',
  };
}

// handleAdminHumanConfirm() (worker.js) always writes actor: 'admin' as a
// literal — never a driver, never anything else — so there is no actor
// parameter here to vary; every human_confirmed event has the same real
// shape.
function humanConfirmedEvent(bookingId) {
  return { booking_id: bookingId, event_type: 'human_confirmed', new_status: 'human_confirmed', actor: 'admin', created_at: '2026-10-01T00:05:00Z' };
}

const rows = [
  // A confirmed arrival leg.
  {
    booking: booking({ id: 9001, pickup_zone: 'NAN', destination_zone: 'DENARAU', quoted_amount: 49, pickup_date: '2026-10-05', pickup_time: '09:00' }),
    event: humanConfirmedEvent(9001),
    passengerCount: 2,
  },
  // Its plausible reverse (empty-leg-avoiding) candidate.
  {
    booking: booking({ id: 9002, pickup_zone: 'DENARAU', destination_zone: 'NAN', quoted_amount: 49, pickup_date: '2026-10-05', pickup_time: '15:00' }),
    event: humanConfirmedEvent(9002),
    passengerCount: 2,
  },
  // A booking that is NOT yet human-confirmed — must be skipped, not evaluated.
  {
    booking: booking({ id: 9003, pickup_zone: 'NAN', destination_zone: 'PACIFIC_HARBOUR', quoted_amount: 199, pickup_date: '2026-10-06', pickup_time: '10:00', status: 'pending' }),
    event: null,
    passengerCount: 3,
  },
  // A second reverse pair, this time WITH an estimatedDurationMinutes
  // override (as if step 3 of the read-only run plan found a real Google
  // Routes duration for these) AND a seeded route_price_truth entry below
  // — demonstrates the full HOLD -> FEASIBLE -> READY chain, not just the
  // HOLD state the first pair (9001/9002) shows.
  {
    booking: booking({ id: 9004, pickup_zone: 'NAN', destination_zone: 'HILTON_DENARAU', quoted_amount: 49, pickup_date: '2026-10-05', pickup_time: '09:00' }),
    event: humanConfirmedEvent(9004),
    passengerCount: 2,
    estimatedDurationMinutes: 20, // e.g. from deriveDurationMinutesFromGoogleRoutesDuration('1200s')
  },
  {
    booking: booking({ id: 9005, pickup_zone: 'HILTON_DENARAU', destination_zone: 'NAN', quoted_amount: 49, pickup_date: '2026-10-05', pickup_time: '15:00' }),
    event: humanConfirmedEvent(9005),
    passengerCount: 2,
    // chronologicalFeasibility() checks the movement being evaluated AS
    // SOURCE's own completion time — since matching runs in ingestion
    // order, 9005 (ingested after 9004) is the one whose own duration
    // matters when it looks back at 9004 as a candidate. Set on both pair
    // members so this demo is correct regardless of which one ends up
    // evaluated as source for a given candidate pairing.
    estimatedDurationMinutes: 20,
  },
];
// booking() always sets status:'human_confirmed' from the overrides spread
// order above except where explicitly overridden - fix the one deliberate
// pending case:
rows[2].booking.status = 'pending';

// Demo-only key: freshly random on every run via the Web Crypto RNG, never
// a fixed/committed literal, and discarded the moment this process exits.
// This is NOT "inventing a production secret" (prohibited) - it's simply
// what any keyed-HMAC demo needs to run at all, and it never needs to be
// stable across runs since this script's output is illustrative only, not
// a real, re-joinable shadow ledger.
const demoShadowSecret = crypto.getRandomValues(new Uint8Array(32));

// Seed one route_price_truth entry using the SAME real formulas
// route_price_truth_source.js documents (never invented here either) —
// illustrative figures only (a real run sources referenceFareFjd from
// computeRealReferenceFare() and commissionRate from
// platform_settings.default_commission_rate, per
// docs/FIRST_READ_ONLY_RUN_PLAN.md step 4).
const store = createMemoryStore();
const priceTruth = buildRoutePriceTruthEntry({
  originZone: 'HILTON_DENARAU', destinationZone: 'NAN', vehicleClass: 'SEDAN',
  referenceFareFjd: 49, commissionRate: 0.15, asOfIso: new Date().toISOString(),
});
if (priceTruth.ok) store.upsertRoutePriceTruth(priceTruth.entry);

const report = await runLiveShadowReport(rows, {
  sourceSite: SOURCE_SITE,
  shadowSecret: demoShadowSecret,
  store,
  routePriceTruthLookup: (origin, destination, vehicleClass) => store.getRoutePriceTruth(origin, destination, vehicleClass),
});
console.log('# SAMPLE OUTPUT ONLY — hand-built demo rows, not real bookings.');
console.log(JSON.stringify(report, null, 2));
