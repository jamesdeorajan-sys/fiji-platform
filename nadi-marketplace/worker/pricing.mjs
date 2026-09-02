// Fiji Dash — authoritative, named, individually-testable pricing steps
// (Recommendation 2 of the approved server-authoritative-pricing plan).
//
// Everything here is a pure function: primitives in, primitives (or a
// small plain object) out. No env/DB coupling, no Cloudflare-specific
// globals - the two steps that genuinely need a database read
// (resolving a cached distance, looking up a pricing_rules row) take the
// already-fetched row as an input rather than fetching it themselves, so
// the whole file stays importable unmodified by both worker.js (an ES
// module Worker) and Node's built-in test runner directly.
//
// .mjs extension (not .js) is deliberate: it makes this unambiguously an
// ES module by extension alone, with no package.json needed anywhere in
// the repo - keeping the "zero new dependencies" decision from the
// approved plan intact.
//
// Extracted from worker.js's computeFareFjd()/computeRealReferenceFare()
// and app.js's calcPrice()/applyModifiers()/calculateTotal() - this
// becomes the one implementation those two used to duplicate (see the
// Milestone 17 return-multiplier bug for what drift between them costs).

// Must match app.js's own RETURN_MULTIPLIER exactly - documented in both
// places since there's no shared build step between the Worker and the
// static guest-widget site to enforce it automatically.
export const RETURN_MULTIPLIER = 1.85;
export const NIGHT_SURCHARGE = 0.20;       // 10pm-6am
export const DISCOUNT_THRESHOLD_FJD = 50;  // loyalty discount applies above this subtotal
export const DISCOUNT_RATE = 0.10;

// ─── Step 1: distance ───────────────────────────────────────────────────
// Pure pass-through/validation - the actual cache/Google lookup stays in
// worker.js's existing getZoneDistanceKm() and geocoded_addresses read.
// Named as its own step so "which distance source was used" is always an
// explicit, inspectable decision rather than buried in a longer function.
export function resolveDistanceKm({ transferType, cachedDistanceKm }) {
  if (transferType === 'boat') return null; // boat pricing isn't distance-based (see computeBoatFare)
  if (cachedDistanceKm === null || cachedDistanceKm === undefined || !isFinite(cachedDistanceKm)) return null;
  return cachedDistanceKm;
}

// ─── Step 2: base fare ──────────────────────────────────────────────────
// flagfallFjd/baseRateFjdPerKm come from the caller's own pricing_rules
// row lookup (vehicle-type selection happens there, by which row matches)
// - this is the pure formula only.
export function computeBaseFare({ flagfallFjd, baseRateFjdPerKm, distanceKm }) {
  if (flagfallFjd === null || flagfallFjd === undefined) return null;
  if (baseRateFjdPerKm === null || baseRateFjdPerKm === undefined) return null;
  if (distanceKm === null || distanceKm === undefined) return null;
  return flagfallFjd + baseRateFjdPerKm * distanceKm;
}

// ─── Step 3: remote-zone multiplier ─────────────────────────────────────
// Previously a single multiply buried inside computeFareFjd's one-line
// expression. Pulled out so a bad zones.remote_multiplier value (like the
// Natadola coordinate bug found the same day as the return-multiplier
// bug) shows up as one named, testable step instead of an opaque number.
export function applyZoneMultiplier(baseFareFjd, remoteMultiplier) {
  const multiplier = remoteMultiplier === null || remoteMultiplier === undefined ? 1 : remoteMultiplier;
  return baseFareFjd * multiplier;
}

// ─── Step 4: trip-type multiplier ───────────────────────────────────────
// THE step that was silently skipped in the Milestone 17 bug - neither
// GET /reference-fare nor POST /negotiate ever called this (or anything
// like it) before that fix, because trip_type never reached the server
// at all. Kept as its own function specifically so it has its own test:
// "return must equal one-way x RETURN_MULTIPLIER, always."
export function applyTripTypeMultiplier(fareFjd, tripType) {
  if (tripType === 'return') return fareFjd * RETURN_MULTIPLIER;
  return fareFjd;
}

// ─── Step 5: night surcharge ─────────────────────────────────────────────
// Newly possible server-side because pickup_date/pickup_time now exist on
// the bookings payload (itinerary-fields work, Milestone 17/c171ef7) -
// before that the server had no way to know pickup time at all.
export function isNightPickup(pickupTime) {
  if (!pickupTime) return false;
  const hour = parseInt(String(pickupTime).split(':')[0], 10);
  if (!isFinite(hour)) return false;
  return hour >= 22 || hour < 6;
}
export function applyNightSurcharge(fareFjd, pickupTime) {
  return isNightPickup(pickupTime) ? fareFjd * (1 + NIGHT_SURCHARGE) : fareFjd;
}

// ─── Step 6a: extras ──────────────────────────────────────────────────────
// Added during Step 4 planning (James caught the gap before code was
// written): the two paid extras are fixed constants, not open-ended like
// tours, so they get exactly verified here rather than folded into a
// soft-bounded remainder. Must match app.js's updateExtras() exactly -
// same "no shared build step" caveat as RETURN_MULTIPLIER above.
export const CHILD_SEAT_FJD = 8;
export const SURFBOARD_FJD = 24;
export function applyExtras(fareFjd, { hasChildSeat, hasSurfboard }) {
  let total = fareFjd;
  if (hasChildSeat) total += CHILD_SEAT_FJD;
  if (hasSurfboard) total += SURFBOARD_FJD;
  return total;
}

// ─── Step 6: loyalty discount ────────────────────────────────────────────
// Mirrors calculateTotal()'s existing rule: 10% off transfer-only
// subtotals over FJ$50. hasTour suppresses it entirely (a tour already
// carries its own listed discount, matching app.js's own reasoning).
// Real bug caught by live Step-4 testing: the discount itself rounds to
// the nearest WHOLE DOLLAR in the client (Math.round(subtotal *
// DISCOUNT_RATE), no /100) - not the nearest cent. Using cent precision
// here produced an authoritative price that silently didn't match what
// the guest was actually shown/agreed to (e.g. $69.08 replaced with
// itself instead of the real $62.08 the guest saw, a 10%+ overcharge on
// the stored record). Matched exactly now, not "close enough."
export function applyLoyaltyDiscount(subtotalFjd, hasTour) {
  if (hasTour || subtotalFjd <= DISCOUNT_THRESHOLD_FJD) {
    return { discountFjd: 0, finalFjd: Math.round(subtotalFjd * 100) / 100 };
  }
  const discountFjd = Math.round(subtotalFjd * DISCOUNT_RATE);
  return { discountFjd, finalFjd: Math.round((subtotalFjd - discountFjd) * 100) / 100 };
}

// ─── Step 7: final total ─────────────────────────────────────────────────
// Two distinct rounding conventions coexist in this codebase on purpose
// and must never be blended: published/fixed-table fares (client-side
// only, e.g. ROUTES_DATA) round UP to the nearest FJ$5 as a menu-price
// convention; this server-authoritative formula path keeps 2-decimal-cent
// precision, matching computeFareFjd's existing convention. This function
// is the single place that precision is applied for this path.
export function computeFinalTotal(fareFjd) {
  return Math.round(fareFjd * 100) / 100;
}

// ─── Boat fare (separate pricing model, not distance-based) ─────────────
// adultFareFjd/childFareFjd are real, sourced numbers from the
// destinations table (Milestone 13/14) - this is the same formula
// handleBoatQuote already used inline; extracted so /quote and (once
// wired) /bookings share one implementation instead of two copies.
export function computeBoatFare({ adults, children, adultFareFjd, childFareFjd }) {
  if (adultFareFjd === null || adultFareFjd === undefined) return null;
  const childTotal = children > 0 ? children * (childFareFjd || 0) : 0;
  return Math.round((adults * adultFareFjd + childTotal) * 100) / 100;
}

// ─── Recommendation 4: runtime sanity guardrail ─────────────────────────
// Defined here now (and unit-testable from this step onward) even though
// it isn't wired into worker.js's real request path until the trust-
// boundary flip (plan Step 5) - the pipeline needs to exist first.
// Bound matches the pricing-safety review's own suggestion.
export function assertSanePricing({ oneWayEquivalentFjd, finalTotalFjd, tripType, minRatio = 1.5, maxRatio = 2.2 }) {
  if (tripType !== 'return') return { sane: true };
  if (!oneWayEquivalentFjd || oneWayEquivalentFjd <= 0) {
    return { sane: false, reason: 'missing or invalid one-way equivalent fare to compare against' };
  }
  const ratio = finalTotalFjd / oneWayEquivalentFjd;
  if (ratio < minRatio || ratio > maxRatio) {
    return {
      sane: false,
      ratio,
      reason: `return total is ${ratio.toFixed(2)}x the one-way fare, outside the sane [${minRatio}, ${maxRatio}] bound`,
    };
  }
  return { sane: true, ratio };
}
