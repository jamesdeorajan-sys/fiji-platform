# First real read-only shadow run — exact plan

Everything below is READ-ONLY against the real `nadi-dispatch-api` D1
database. No row is inserted, updated, or deleted by any query here. This
plan does not require and does not request write access.

This has not been executed — Cloudflare API access has been unavailable in
this environment for the whole engagement (`wrangler whoami` →
`Invalid access token [code: 9109]`). It's written so whoever has real D1
read access (`wrangler d1 execute nadi-marketplace-db --remote --command
"..."`, or the dashboard's D1 console) can run it directly and hand the
results back.

## Step 1 — confirmed bookings + their confirming event

```sql
SELECT
  b.id, b.pickup_zone, b.destination_zone, b.vehicle_type,
  b.quoted_amount, b.assigned_driver_id, b.status,
  b.pickup_date, b.pickup_time, b.created_at,
  be.actor, be.booking_id AS event_booking_id, be.event_type, be.new_status,
  be.created_at AS confirmed_at
FROM bookings b
JOIN booking_events be ON be.booking_id = b.id
WHERE b.status = 'accepted'
  AND be.event_type = 'accepted'
  AND be.new_status = 'accepted'
ORDER BY be.created_at DESC;
```

No `guest_name`, `guest_phone`, `guest_email`, `flight_number`, or `notes`
column is selected — not because the adapter would strip them (it does, as
a second layer), but so the exported data never contains them in the first
place. `event_booking_id` is included specifically so
`isHumanConfirmedBooking()`'s same-booking-event proof has something real to
check, not assumed to match.

## Step 2 — passenger count, where it exists (negotiated bookings only)

```sql
SELECT nr.booking_id, nr.passengers
FROM negotiation_requests nr
WHERE nr.booking_id IN (/* the b.id values from step 1 */)
  AND nr.passengers IS NOT NULL;
```

Join this in application code (not SQL) via
`derivePassengerCountFromNegotiationRequest()` — it re-validates the range
(1-20) independently rather than trusting the join. Any `b.id` NOT covered
by this query has no real passenger-count source at all; do not default it.

## Step 3 — duration, where it exists (custom-address bookings only)

```sql
SELECT query_normalized, duration_text, distance_km
FROM geocoded_addresses
WHERE duration_text IS NOT NULL;
```

This is keyed by normalized address text, not by zone name — it only
usefully joins to a booking whose `pickup_zone`/`destination_zone` was
itself resolved from a custom address (not the fixed zone-pair dropdown
flow). Matching a specific booking to a specific `geocoded_addresses` row
requires the same address-normalization logic `handleQuoteCreate` uses
server-side; that normalization function was read but not reproduced here —
reproducing it independently risks drift from the real implementation,
which is exactly the class of mistake this whole system exists to prevent.
**Recommendation: whoever runs this query should export
`(query_normalized, duration_text)` pairs verbatim and let
`deriveDurationMinutesFromGoogleRoutesDuration()` parse each `duration_text`
value — do not hand-normalize addresses to force a match.**

For the FIXED zone-pair path (the majority of bookings), there is currently
no equivalent stored duration at all — see `production_adapter.js`'s header
for the full explanation. Every such booking should be expected to HOLD on
`operational_feasibility = HOLD_UNKNOWN_TIMING` in this first run, correctly,
not as a defect.

## Step 4 — route price truth, per distinct (origin_zone, destination_zone, vehicle_class) pair seen in step 1

For each distinct pair, someone with the real backend's own pricing logic
available needs to supply exactly two real numbers — this adapter cannot
compute either itself (see `route_price_truth_source.js`'s header):

1. **`referenceFareFjd`** — call the real `computeRealReferenceFare(env,
   pickupZone, destinationZone, vehicleType, tripType)` (worker.js) for that
   pair, or equivalently read the same value the live `/quote`-adjacent
   negotiation flow already computes for it.
2. **`commissionRate`** — read `platform_settings.default_commission_rate`
   fresh (currently `0.15` as of this mission, but a live, mutable setting —
   do not hardcode):
   ```sql
   SELECT value FROM platform_settings WHERE key = 'default_commission_rate';
   ```

Then, in application code:

```js
import { buildRoutePriceTruthEntry } from './src/route_price_truth_source.js';

const result = buildRoutePriceTruthEntry({
  originZone, destinationZone, vehicleClass,
  referenceFareFjd,   // from computeRealReferenceFare, step 4.1
  commissionRate,     // from platform_settings, step 4.2
  asOfIso: new Date().toISOString(),
});
if (result.ok) store.upsertRoutePriceTruth(result.entry);
```

Any pair this isn't done for will correctly show
`commercial_pricing_status = HOLD_UNKNOWN_ECONOMICS` in the report — expected
for a first run where this hasn't been populated yet, not a bug.

## Step 5 — the shadow secret

A real `SMART_RETURN_SHADOW_SECRET` must be generated and held by whoever
runs this (see `docs/SHADOW_SECRET_SETUP.md`) — never by this codebase,
never committed, never printed.

## Step 6 — sanitized input file format

Assemble step 1-3's results into the exact shape
`scripts/live_shadow_report.js --input` expects:

```json
[
  {
    "booking": { "id": 4821, "pickup_zone": "NAN", "destination_zone": "HILTON_DENARAU", "vehicle_type": "sedan", "quoted_amount": 49, "assigned_driver_id": 77, "status": "accepted", "pickup_date": "2026-10-05", "pickup_time": "09:30", "created_at": "2026-10-01T10:00:00Z" },
    "event": { "booking_id": 4821, "event_type": "accepted", "new_status": "accepted", "actor": "driver:77" },
    "passengerCount": 2,
    "estimatedDurationMinutes": 20
  }
]
```

`passengerCount` and `estimatedDurationMinutes` are omitted entirely for any
booking step 2/3 found nothing for — never filled with a placeholder.

## Step 7 — run it

```bash
export SMART_RETURN_SHADOW_SECRET="<the real secret from step 5>"
node scripts/live_shadow_report.js --input confirmed_bookings.json --source-site nadiairporttransfers.com
```

Output is the full 12-point report, no PII, no raw booking ids anywhere in
it (see `test/live_shadow_report.test.js`'s privacy tests). Route-price
truth from step 4 needs to be seeded into the `store` passed to
`runLiveShadowReport()` beforehand (or via a small wrapper script) for the
`ready_for_shadow_match_count`/`shadow_price_where_permitted` fields to ever
be non-zero — without it, every candidate will correctly HOLD on economics.

## Expected shape of this first real run

Given what steps 2-4 can realistically cover on a first pass (likely partial
or zero coverage for all three, since none of this has been populated
before), the honest expectation is: `confirmed_movements_evaluated > 0`
(step 1 alone gets this), but `feasible_candidate_count` and
`ready_for_shadow_match_count` likely at or near 0 until duration and route
price truth are populated for at least some real routes. **That is a correct
result, not a failed run** — it's exactly what "unknown timing = HOLD,
unknown economics = HOLD" is supposed to produce on a system nothing has
been fed into yet.
