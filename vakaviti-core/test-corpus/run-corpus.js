// Issue #38 Phase 4 — representative test corpus runner.
// Reads the real, already-captured live quote data (nadi-dispatch-api
// reference-fare + bookfijitransfers.com /api/quotes, both fetched
// read-only during the R1 inventory pass) and runs every comparison
// through the isolated shadow Fare Authority. Writes one structured
// record per comparison to shadow-log/shadow-comparisons.jsonl. Never
// calls any booking-create endpoint; never touches production D1/KV/R2.

const fs = require('fs');
const path = require('path');
const { runShadowComparison } = require('../fare-authority/fare-authority.js');

const LOG_PATH = path.join(__dirname, '..', 'shadow-log', 'shadow-comparisons.jsonl');
fs.writeFileSync(LOG_PATH, ''); // fresh run each time, this is evidence, not an append-forever ledger

// --- Control set: storefronts 1 and 2 against themselves --------------
// They share one backend/D1 today (see inventory 01/02), so this MUST
// come back exact_match every time. If it doesn't, that is itself a real
// finding, not expected noise.
const controlCases = [
  { storefrontId: 'nadiairporttransfers', route: 'Nadi Airport -> Denarau', vehicleClassId: 'sedan', distanceKm: 11.776, existingFare: 47.87, canonicalRouteId: 'rte_nadi-denarau' },
  { storefrontId: 'fijidash', route: 'Nadi Airport -> Denarau', vehicleClassId: 'sedan', distanceKm: 11.776, existingFare: 47.87, canonicalRouteId: 'rte_nadi-denarau' },
];
for (const c of controlCases) {
  runShadowComparison({
    storefrontId: c.storefrontId,
    rawOrigin: 'Nadi Airport', rawDestination: 'Denarau',
    canonicalOriginId: 'plc_nadi-airport', canonicalDestinationId: 'plc_denarau',
    canonicalRouteId: c.canonicalRouteId,
    vehicleClassId: c.vehicleClassId,
    existingStorefrontFareFjd: c.existingFare,
    distanceKm: c.distanceKm,
    tripType: 'one_way', pickupTime: '10:00',
    classificationContext: {}
  }, LOG_PATH);
}

// --- bookfijitransfers.com against the Vakaviti shadow authority ------
// distanceKm comes from nadi-dispatch-api's own real Google-Maps-derived
// distance for the equivalent corridor (captured this pass) — the two
// systems serve the same physical routes, so reusing the more precise,
// already-verified distance is more honest than re-guessing one.
const bftCases = [
  { slug: 'hilton-denarau', route: 'Nadi Airport -> Denarau', distanceKm: 11.776, fares: { sedan: 49, minivan: 69, minibus: 99 }, context: {} },
  { slug: 'port-denarau', route: 'Nadi Airport -> Denarau (Port)', distanceKm: 11.776, fares: { sedan: 39, minivan: 69, minibus: 99 }, context: { sedan: { knownPromotion: "Homepage launch special explicitly advertises 'Nadi Airport to Port Denarau, FJ$39 total, sedan only' — matches this exact fare; not a routing discrepancy." } } },
  { slug: 'wailoaloa-nadi', route: 'Nadi Airport -> Wailoaloa/Nadi', distanceKm: 6.902, fares: { sedan: 39, minivan: 55, minibus: 79 }, context: { sedan: { routeMappingAmbiguous: "bft's 'wailoaloa-nadi' corridor groups Wailoaloa+Namaka+unspecified 'Nadi hotels' into one fixed price; nadi-dispatch's 6.902km distance is for the single Wailoaloa zone specifically. If the corridor's true average distance is longer, a flat corridor price would legitimately exceed a single-point computed fare." } } },
  { slug: 'sonaisali', route: 'Nadi Airport -> Sonaisali', distanceKm: 22.09, fares: { sedan: 69, minivan: 89, minibus: 119 }, context: {} },
  { slug: 'outrigger-coral-coast', route: 'Nadi Airport -> Coral Coast', distanceKm: 69.36, fares: { sedan: 159, minivan: 199, minibus: 249 }, context: {} },
  { slug: 'natadola-intercontinental', route: 'Nadi Airport -> Natadola', distanceKm: 54.718, fares: { sedan: 139, minivan: 175, minibus: 219 }, context: {} },
  { slug: 'marriott-momi', route: 'Nadi Airport -> Momi Bay', distanceKm: 38.623, fares: { sedan: 119, minivan: 149, minibus: 189 }, context: {} },
  { slug: 'pearl-pacific-harbour', route: 'Nadi Airport -> Pacific Harbour', distanceKm: 147.587, fares: { sedan: 269, minivan: 329, minibus: 419 }, context: {} },
  { slug: 'grand-pacific-suva', route: 'Nadi Airport -> Suva', distanceKm: 195.691, fares: { sedan: 329, minivan: 399, minibus: 499 }, context: {} },
];

for (const c of bftCases) {
  for (const vehicleClassId of ['sedan', 'minivan', 'minibus']) {
    const ctx = c.context[vehicleClassId] || {};
    runShadowComparison({
      storefrontId: 'bookfijitransfers',
      rawOrigin: 'Nadi Airport', rawDestination: c.slug,
      canonicalOriginId: 'plc_nadi-airport', canonicalDestinationId: `plc_${c.slug}`,
      canonicalRouteId: `rte_nadi-${c.slug}`,
      vehicleClassId,
      existingStorefrontFareFjd: c.fares[vehicleClassId],
      distanceKm: c.distanceKm,
      tripType: 'one_way', pickupTime: '10:00',
      classificationContext: ctx
    }, LOG_PATH);
  }
}

// --- Return-trip case ---------------------------------------------------
// nadi-dispatch-api applies a 1.85x return multiplier; bookfijitransfers.com
// advertises a flat 5% second-leg discount. These are architecturally
// different discount curves (see contracts/ ReturnTrip.returnDiscountModel)
// — this comparison is expected to show a real, structural mismatch, not
// a data error, and is logged as such rather than mis-classified.
runShadowComparison({
  storefrontId: 'nadiairporttransfers',
  rawOrigin: 'Nadi Airport', rawDestination: 'Denarau',
  canonicalOriginId: 'plc_nadi-airport', canonicalDestinationId: 'plc_denarau',
  canonicalRouteId: 'rte_nadi-denarau',
  vehicleClassId: 'sedan',
  existingStorefrontFareFjd: null, // not captured live this pass to avoid an extra production call; formula-derived only
  distanceKm: 11.776,
  tripType: 'return', pickupTime: '10:00',
  classificationContext: { routeMappingAmbiguous: 'Return-trip fare not captured live for this comparison row; shadow value shown is formula-only pending a live return-trip reference-fare call.' }
}, LOG_PATH);

// --- Custom/unmapped address -------------------------------------------
// nadi-dispatch-api supports POST /quote (geocoded custom address) as its
// dynamic_authoritative_custom_route path. bookfijitransfers.com's shipped
// bundle shows no equivalent free-text/autocomplete field at all -- its
// destination list is closed. Logged as a capability gap, not a fare
// mismatch, since there is no bft fare to compare against.
runShadowComparison({
  storefrontId: 'bookfijitransfers',
  rawOrigin: 'Nadi Airport', rawDestination: '(custom/unmapped address — not supported)',
  canonicalOriginId: 'plc_nadi-airport', canonicalDestinationId: null,
  canonicalRouteId: null,
  vehicleClassId: 'sedan',
  existingStorefrontFareFjd: null,
  distanceKm: null,
  tripType: 'one_way', pickupTime: '10:00',
  classificationContext: {}
}, LOG_PATH);

console.log('Wrote', fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n').length, 'shadow comparison records to', LOG_PATH);
