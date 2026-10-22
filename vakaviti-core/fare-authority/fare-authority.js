// Vakaviti Fare Authority — shadow mode only (Issue #38, R2).
//
// This module is NOT deployed anywhere. It runs locally (via test-corpus
// scripts) or, in a future authorized phase, inside its own isolated Worker
// with its own isolated bindings — never inside nadi-dispatch-api and never
// against production D1. It never calls a storefront's booking-create
// endpoint and never returns a value a storefront could accidentally wire
// into a customer-facing response. Its only output is a comparison record.
//
// Pricing hierarchy (Issue #37/#38, implemented in priority order):
//   1. fixed_retail_known_route   — mapped route + vehicle -> tiered formula below
//   2. dynamic_authoritative_custom_route — same formula, distance from caller
//      (the caller is responsible for resolving distance for unmapped routes;
//      this module does not call Google Maps itself, to stay fully isolated)
//   3. marketplace_payout_offer — out of scope for R2; OperatorPayout is a
//      separate contract (see contracts/) and this module never computes it
//   4. flexible_negotiated_fare — never computed here; a negotiated fare is
//      read as-is from the storefront's own record for comparison purposes,
//      never treated as if it were the reference fare

const fs = require('fs');
const path = require('path');

const SNAPSHOT = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'pricing-rules.snapshot.json'), 'utf8')
);

function computeBaseFare(vehicleClassId, distanceKm) {
  const tiers = SNAPSHOT.tiers[vehicleClassId];
  if (!tiers) return null;
  const tier = tiers.find(t => distanceKm >= t.minKm && distanceKm < t.maxKm)
    || tiers[tiers.length - 1];
  return tier.flagfall + tier.ratePerKm * distanceKm;
}

function isNightPickup(pickupTime) {
  if (!pickupTime) return false;
  const [h] = pickupTime.split(':').map(Number);
  return h >= 22 || h < 6;
}

/**
 * Computes the Vakaviti canonical retail fare for a route/vehicle.
 * This is pricing hierarchy tiers 1+2 — the same formula serves both a
 * known mapped route and a custom/unmapped one; the only difference is
 * where distanceKm came from (a canonical Route row vs. a fresh geocode),
 * which is the caller's concern, not this function's.
 */
function computeVakavitiRetailFare({ vehicleClassId, distanceKm, tripType, pickupTime, applyOver50Discount = false }) {
  if (distanceKm == null || distanceKm < 0) {
    return { ok: false, error: 'distanceKm required' };
  }
  const base = computeBaseFare(vehicleClassId, distanceKm);
  if (base == null) {
    return { ok: false, error: `no pricing tier for vehicleClassId=${vehicleClassId}` };
  }
  let fare = base * SNAPSHOT.fuelIndex.multiplier;
  if (isNightPickup(pickupTime)) fare *= (1 + SNAPSHOT.constants.nightSurchargeRate);
  if (tripType === 'return') fare *= SNAPSHOT.constants.returnMultiplier;
  // IMPORTANT (found empirically, not assumed): nadi-dispatch-api's own
  // GET /reference-fare does NOT apply the >$50/10% discount — verified by
  // reproducing this exact formula against a live captured value (Nadi
  // Airport -> Sigatoka, sedan, 69.36km: this formula gives 138.49 with the
  // discount left off, matching the real API's 138.49 exactly; applying the
  // discount here would have given 124.64, which does not match). The
  // discount is applied somewhere later in the storefront's own
  // booking/display flow, not in the reference-fare preview itself. Default
  // is OFF so this function's output is directly comparable to
  // /reference-fare, which is what the R2 shadow corpus actually calls.
  // Set applyOver50Discount:true only when comparing against a fare that is
  // known to already include that step (e.g. a completed booking's
  // quoted_amount), not a raw reference-fare preview.
  if (applyOver50Discount && fare > SNAPSHOT.constants.discountThresholdFjd) {
    fare *= (1 - SNAPSHOT.constants.discountRate);
  }
  return {
    ok: true,
    retailFareFjd: Math.round(fare * 100) / 100,
    pricingRuleUsed: 'fixed_retail_known_route',
    distanceKm,
    pricingVersionId: 'vakaviti-fare-authority-v1-baseline'
  };
}

/**
 * Classifies the variance between a storefront's existing fare and the
 * Vakaviti shadow fare into one of Issue #38's required categories.
 * Never guesses a root cause it cannot support from the inputs given —
 * falls back to unknown_manual_review rather than inventing a reason.
 */
function classifyMismatch({ existingFare, shadowFare, absVariance, pctVariance, context = {} }) {
  if (existingFare == null || shadowFare == null) {
    return { classification: 'unknown_manual_review', reason: 'one side of the comparison is missing' };
  }
  if (absVariance === 0) {
    return { classification: 'exact_match', reason: 'storefront fare equals the Vakaviti shadow fare exactly' };
  }
  if (Math.abs(absVariance) <= 1.0) {
    return { classification: 'rounding_only', reason: `variance of ${absVariance.toFixed(2)} FJD is within a plausible rounding/display tolerance` };
  }
  if (context.knownPromotion) {
    return { classification: 'discount_promotion_difference', reason: context.knownPromotion };
  }
  if (context.vehicleClassUnmapped) {
    return { classification: 'vehicle_taxonomy_mismatch', reason: context.vehicleClassUnmapped };
  }
  if (context.routeMappingAmbiguous) {
    return { classification: 'route_mapping_mismatch', reason: context.routeMappingAmbiguous };
  }
  if (context.isNegotiatedFare) {
    return { classification: 'negotiation_flexible_fare_difference', reason: 'compared value is a guest-negotiated fare, not the reference fare — expected to differ' };
  }
  if (context.distanceProviderNote) {
    return { classification: 'distance_provider_mismatch', reason: context.distanceProviderNote };
  }
  if (context.suspectedStaleFixedFare) {
    return { classification: 'stale_fixed_fare', reason: context.suspectedStaleFixedFare };
  }
  return {
    classification: 'unknown_manual_review',
    reason: `variance of ${pctVariance.toFixed(1)}% (${absVariance.toFixed(2)} FJD) does not confidently fit any other category from the inputs available — needs a human with visibility into the storefront's own fare table/margin policy.`
  };
}

/**
 * Builds one full shadow-comparison record per Issue #38's required schema
 * and appends it to a local JSONL log. Never touches production D1/KV/R2 —
 * this file lives only in this isolated branch's working tree.
 */
function runShadowComparison(input, logPath) {
  const {
    storefrontId, rawOrigin, rawDestination, canonicalOriginId, canonicalDestinationId,
    canonicalRouteId, vehicleClassId, existingStorefrontFareFjd, distanceKm,
    journeyMinutes, tripType, pickupTime, classificationContext
  } = input;

  const shadow = computeVakavitiRetailFare({ vehicleClassId, distanceKm, tripType, pickupTime });
  const shadowFare = shadow.ok ? shadow.retailFareFjd : null;
  const absVariance = shadowFare != null ? Math.round((existingStorefrontFareFjd - shadowFare) * 100) / 100 : null;
  const pctVariance = shadowFare != null && shadowFare !== 0
    ? Math.round((absVariance / shadowFare) * 1000) / 10
    : null;

  const mismatch = shadowFare != null
    ? classifyMismatch({
        existingFare: existingStorefrontFareFjd,
        shadowFare,
        absVariance,
        pctVariance,
        context: classificationContext || {}
      })
    : { classification: 'unknown_manual_review', reason: shadow.error };

  const record = {
    timestamp: new Date().toISOString(),
    storefront: storefrontId,
    rawOrigin, rawDestination,
    canonicalOriginId, canonicalDestinationId, canonicalRouteId,
    vehicleClass: vehicleClassId,
    existingStorefrontFareFjd,
    vakavitiShadowFareFjd: shadowFare,
    absoluteVarianceFjd: absVariance,
    percentageVariance: pctVariance,
    pricingRuleUsed: shadow.pricingRuleUsed || null,
    distanceKm,
    journeyMinutes: journeyMinutes || null,
    confidence: shadow.ok ? (canonicalRouteId ? 'high' : 'medium') : 'low',
    mismatchClassification: mismatch.classification,
    diagnosticReason: mismatch.reason
  };

  if (logPath) {
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
  }
  return record;
}

module.exports = { computeVakavitiRetailFare, classifyMismatch, runShadowComparison, SNAPSHOT };
