// Vakaviti Fare Authority — Stage B ADAPTER for storefronts 1+2
// (nadiairporttransfers.com / book.fijidash.com), per Issue #38 Step 2.
//
// CEO direction, honored literally here: the existing shared
// nadi-dispatch-api pricing engine IS the candidate Vakaviti Fare
// Authority for these two storefronts. This file does NOT reimplement
// pricing (that's fare-authority.js, kept only as an independent
// cross-check / R2 shadow tool — see its own header). This file is a
// thin, versioned NORMALIZATION LAYER: it calls the real, live,
// already-in-production GET /reference-fare endpoint (read-only, no
// state change, identical to every read-only inventory call already
// made in this engagement) and maps its response into the canonical
// output shape Issue #38 Step 2 requires. Nothing about the existing
// engine, its formula, or its response to a real guest changes.
//
// Not deployed. Not wired into any live request path. Callable locally
// for design verification only.

const CANONICAL_TO_ZONE = require('../mappings/place-route-mapping.json')
  .mappings.nadiairporttransfers_and_fijidash;

// Storefronts 1/2 use the raw zones.name value as both the canonical
// route anchor AND the API's own pickup_zone/destination_zone param
// today (see mappings/place-route-mapping.json: "identity_mapping").
// canonicalPlaceId here is the plc_<slug> form used across this
// project's contracts; toZoneName reverses that back to the exact
// string the live API expects.
function toZoneName(canonicalPlaceId) {
  if (canonicalPlaceId === 'plc_nadi-airport') return 'Nadi Airport';
  const slug = canonicalPlaceId.replace(/^plc_/, '');
  // zones.name values are Title Case with spaces; canonical ids here are
  // kebab-case. This is a deliberately narrow, explicit table rather than
  // a generic slugify() — a generic transform could silently produce a
  // wrong-but-plausible zone name for a place this adapter has never seen.
  const known = {
    'wailoaloa': 'Wailoaloa', 'denarau': 'Denarau', 'sonaisali': 'Sonaisali',
    'vuda-point': 'Vuda Point', 'lautoka': 'Lautoka', 'momi-bay': 'Momi Bay',
    'natadola': 'Natadola', 'sigatoka': 'Sigatoka', 'coral-coast': 'Coral Coast',
    'pacific-harbour': 'Pacific Harbour', 'ba': 'Ba', 'rakiraki': 'Rakiraki',
    'suva': 'Suva', 'nausori': 'Nausori', 'mamanuca-islands': 'Mamanuca Islands',
    'yasawa-islands': 'Yasawa Islands', 'beqa-lagoon': 'Beqa Lagoon', 'nadi': 'Nadi'
  };
  return known[slug] || null;
}

const VEHICLE_CLASS_TO_API = {
  sedan: 'sedan', minivan: 'minivan', minibus: 'minibus', boat: 'boat',
  // suv_people_mover has no live equivalent on these two storefronts today
  // (see mappings/vehicle-class-mapping.json unmapped list) — deliberately
  // absent from this table rather than silently aliased to minivan.
};

/**
 * getCanonicalFare — the Stage B adapter's one public function.
 *
 * @param {object} req canonical QuoteRequest-shaped input:
 *   { originPlaceId, destinationPlaceId, vehicleClassId, tripType, pickupTime, storefrontId, apiBase }
 * @param {object} [opts] { liveCall: boolean } — liveCall defaults true;
 *   set false to get a dry-run shape-check without hitting the network
 *   (used by tests / when no network access is available).
 */
async function getCanonicalFare(req, opts = {}) {
  const liveCall = opts.liveCall !== false;
  const originZone = toZoneName(req.originPlaceId);
  const destZone = toZoneName(req.destinationPlaceId);
  const vehicleParam = VEHICLE_CLASS_TO_API[req.vehicleClassId];

  const base = {
    canonicalOriginPlaceId: req.originPlaceId,
    canonicalDestinationPlaceId: req.destinationPlaceId,
    canonicalRouteId: originZone && destZone ? `rte_${req.originPlaceId.replace('plc_','')}-${req.destinationPlaceId.replace('plc_','')}` : null,
    canonicalVehicleClassId: req.vehicleClassId,
    fareRuleVersion: 'nadi-dispatch-api:pricing_rules@live',
    calculationMethod: null,
    referenceFareFjd: null,
    retailFareFjd: null,
    distanceKm: null,
    journeyMinutes: null, // NOT available from GET /reference-fare today — see note below
    sourceAuthority: 'nadi-dispatch-api (existing shared production engine, adopted as-is per CEO direction)',
    confidence: null,
    verificationStatus: null
  };

  if (!originZone || !destZone || !vehicleParam) {
    return {
      ...base,
      confidence: 'low',
      verificationStatus: 'unmapped_input',
      diagnosticNote: `Cannot resolve one or more inputs to a live zone/vehicle string: originZone=${originZone}, destZone=${destZone}, vehicleParam=${vehicleParam}. This is the adapter correctly refusing to guess, not an engine failure.`
    };
  }

  if (!liveCall) {
    return {
      ...base,
      calculationMethod: 'dry_run_no_network_call',
      confidence: 'medium',
      verificationStatus: 'design_only_not_live_verified'
    };
  }

  const apiBase = req.apiBase || 'https://api.nadiairporttransfers.com';
  const tripTypeParam = req.tripType === 'return' ? 'return' : 'one-way';
  const url = `${apiBase}/reference-fare?pickup_zone=${encodeURIComponent(originZone)}&destination_zone=${encodeURIComponent(destZone)}&vehicle_type=${encodeURIComponent(vehicleParam)}&trip_type=${encodeURIComponent(tripTypeParam)}`;

  let resp, json;
  try {
    resp = await fetch(url);
    json = await resp.json();
  } catch (e) {
    return { ...base, confidence: 'low', verificationStatus: 'live_call_failed', diagnosticNote: String(e) };
  }

  if (!resp.ok || !json.ok) {
    return {
      ...base, confidence: 'low', verificationStatus: 'live_call_returned_error',
      diagnosticNote: json.error || `HTTP ${resp.status}`
    };
  }

  // Step 4 commercial model: finalRetailFareFjd = referenceFareFjd +
  // channelModifier - promotionDiscount, both of which must carry a real,
  // approved ruleId to exist at all. Zero approved rules exist for
  // storefronts 1/2 today, so both are the explicit, loggable {ruleId:
  // null, amountFjd: 0} state -- not omitted, not silently assumed.
  const channelModifier = { ruleId: null, amountFjd: 0, reason: null };
  const promotionDiscount = { ruleId: null, amountFjd: 0, reason: null };
  const referenceFareFjd = json.reference_fare_fjd;
  const finalRetailFareFjd = referenceFareFjd + channelModifier.amountFjd - promotionDiscount.amountFjd;

  return {
    ...base,
    calculationMethod: 'live_authoritative_distance_tiered_formula',
    referenceFareFjd,
    channelModifier,
    promotionDiscount,
    retailFareFjd: finalRetailFareFjd, // kept for Step 2's required field name
    finalRetailFareFjd,
    varianceStatus: 'in_policy',
    distanceKm: json.distance_km,
    confidence: 'high',
    verificationStatus: json.cached ? 'live_verified_cached_distance' : 'live_verified_fresh_distance'
  };
}

module.exports = { getCanonicalFare, toZoneName, VEHICLE_CLASS_TO_API };
