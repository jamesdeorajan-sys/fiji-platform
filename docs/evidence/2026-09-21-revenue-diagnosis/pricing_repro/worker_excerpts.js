// EXCERPTS ONLY - copied verbatim from the deployed nadi-dispatch-api bundle (Workers content API, GET-only, 2026-09-20).
// Deployed version 80de8469-0fb6-4784-8b66-c199bd5ef7f2 (2026-09-06T15:34:52Z). No secrets appear in these ranges (env keys are referenced by name only).
// Bundle line numbers are given so they can be re-located in a fresh download.

// ---- bundle lines 9-70: pricing helpers ----
var RETURN_MULTIPLIER = 1.85;
var NIGHT_SURCHARGE = 0.2;
var DISCOUNT_THRESHOLD_FJD = 50;
var DISCOUNT_RATE = 0.1;
function computeBaseFare({ flagfallFjd, baseRateFjdPerKm, distanceKm }) {
  if (flagfallFjd === null || flagfallFjd === void 0) return null;
  if (baseRateFjdPerKm === null || baseRateFjdPerKm === void 0) return null;
  if (distanceKm === null || distanceKm === void 0) return null;
  return flagfallFjd + baseRateFjdPerKm * distanceKm;
}
__name(computeBaseFare, "computeBaseFare");
function applyZoneMultiplier(baseFareFjd, remoteMultiplier) {
  const multiplier = remoteMultiplier === null || remoteMultiplier === void 0 ? 1 : remoteMultiplier;
  return baseFareFjd * multiplier;
}
__name(applyZoneMultiplier, "applyZoneMultiplier");
function applyTripTypeMultiplier(fareFjd, tripType) {
  if (tripType === "return") return fareFjd * RETURN_MULTIPLIER;
  return fareFjd;
}
__name(applyTripTypeMultiplier, "applyTripTypeMultiplier");
function isNightPickup(pickupTime) {
  if (!pickupTime) return false;
  const hour = parseInt(String(pickupTime).split(":")[0], 10);
  if (!isFinite(hour)) return false;
  return hour >= 22 || hour < 6;
}
__name(isNightPickup, "isNightPickup");
function applyNightSurcharge(fareFjd, pickupTime) {
  return isNightPickup(pickupTime) ? fareFjd * (1 + NIGHT_SURCHARGE) : fareFjd;
}
__name(applyNightSurcharge, "applyNightSurcharge");
var CHILD_SEAT_FJD = 8;
var SURFBOARD_FJD = 24;
function applyExtras(fareFjd, { hasChildSeat, hasSurfboard }) {
  let total = fareFjd;
  if (hasChildSeat) total += CHILD_SEAT_FJD;
  if (hasSurfboard) total += SURFBOARD_FJD;
  return total;
}
__name(applyExtras, "applyExtras");
function applyLoyaltyDiscount(subtotalFjd, hasTour) {
  if (hasTour || subtotalFjd <= DISCOUNT_THRESHOLD_FJD) {
    return { discountFjd: 0, finalFjd: Math.round(subtotalFjd * 100) / 100 };
  }
  const discountFjd = Math.round(subtotalFjd * DISCOUNT_RATE);
  return { discountFjd, finalFjd: Math.round((subtotalFjd - discountFjd) * 100) / 100 };
}
__name(applyLoyaltyDiscount, "applyLoyaltyDiscount");
function computeFinalTotal(fareFjd) {
  return Math.round(fareFjd * 100) / 100;
}
__name(computeFinalTotal, "computeFinalTotal");
function computeBoatFare({ adults, children, adultFareFjd, childFareFjd }) {
  if (adultFareFjd === null || adultFareFjd === void 0) return null;
  const childTotal = children > 0 ? children * (childFareFjd || 0) : 0;
  return Math.round((adults * adultFareFjd + childTotal) * 100) / 100;
}
__name(computeBoatFare, "computeBoatFare");
function assertSanePricing({ oneWayEquivalentFjd, finalTotalFjd, tripType, minRatio = 1.5, maxRatio = 2.2 }) {
  if (tripType !== "return") return { sane: true };
  if (!oneWayEquivalentFjd || oneWayEquivalentFjd <= 0) {

// ---- bundle lines 1945-2030: server-side quote verification inside createBookingRecord (the [pricing-drift] replacement) ----
      lastReferrer: null,
      lastLandingPath: null,
      attributionSource: null
    };
  }
  let pricingNote = null;
  const isBoatBooking = vehicleType === "boat";
  if (verificationMode === "authoritative") {
    if (isBoatBooking) {
      if (commissionBaseFjd !== null && quotedAmount < commissionBaseFjd) {
        pricingNote = `boat booking quoted_amount (${quotedAmount}) is less than its own verified land-leg portion (${commissionBaseFjd})`;
        console.warn(`[pricing-sanity] ${pricingNote} - ${pickupZone} -> ${destinationZone}`);
      }
    } else {
      const authoritative = await computeAuthoritativePrice(env, {
        pickupZone,
        destinationZone,
        vehicleType,
        tripType,
        pickupTime,
        hasChildSeat,
        hasSurfboard
      });
      if (!authoritative.ok) {
        console.warn(`[pricing-authoritative-unavailable] ${authoritative.error} - ${pickupZone} -> ${destinationZone} ${vehicleType} ${tripType}, falling back to client-trusted quoted_amount`);
      } else {
        const serverFjd = authoritative.transferPlusExtrasFjd;
        const serverFjdDiscounted = applyLoyaltyDiscount(serverFjd, false).finalFjd;
        if (tripType === "return") {
          const oneWayEquivalent = await computeAuthoritativePrice(env, {
            pickupZone,
            destinationZone,
            vehicleType,
            tripType: "one-way",
            pickupTime,
            hasChildSeat,
            hasSurfboard
          });
          if (oneWayEquivalent.ok) {
            const saneCheck = assertSanePricing({
              oneWayEquivalentFjd: oneWayEquivalent.transferPlusExtrasFjd,
              finalTotalFjd: serverFjd,
              tripType
            });
            if (!saneCheck.sane) {
              await createEscalation(env, {
                source: "guest",
                triggerType: "needs_manual_confirmation",
                context: `Pricing sanity check failed for a return-trip booking: ${saneCheck.reason}. ${pickupZone} -> ${destinationZone}, ${vehicleType} - computed return total FJD ${serverFjd} vs one-way equivalent FJD ${oneWayEquivalent.transferPlusExtrasFjd}. Booking blocked, needs manual confirmation.`,
                sourceIp
              });
              return { ok: false, errors: ["Could not confirm a reliable price for this booking automatically. We've alerted our team and will follow up via WhatsApp to confirm your fare."] };
            }
          }
        }
        if (!hasTour && !isCustomAddress) {
          if (quotedAmount < serverFjdDiscounted * 0.8 || quotedAmount > serverFjdDiscounted * 1.3) {
            console.warn(`[pricing-drift] client sent ${quotedAmount}, outside the plausible published-price range (formula reference ${serverFjdDiscounted}) for ${pickupZone} -> ${destinationZone} ${vehicleType} ${tripType} - replacing with the server number`);
            quotedAmount = serverFjdDiscounted;
          }
          distanceKm = authoritative.distanceKm;
        } else if (isCustomAddress && !hasTour) {
          if (quotedAmount < serverFjdDiscounted * 0.7 || quotedAmount > serverFjdDiscounted * 3) {
            pricingNote = `custom-address quoted_amount (${quotedAmount}) is outside the plausible range for this route (zone-floor reference ${serverFjdDiscounted})`;
            console.warn(`[pricing-sanity] ${pricingNote} - ${pickupZone} -> ${destinationZone}`);
          }
        }
        if (hasTour) {
          const remainder = quotedAmount - serverFjd;
          if (remainder < 0) {
            const reason = `tour booking quoted_amount (${quotedAmount}) is less than its own verified transfer+extras portion (${serverFjd})`;
            console.warn(`[pricing-sanity] ${reason} - ${pickupZone} -> ${destinationZone}`);
            await createEscalation(env, {
              source: "guest",
              triggerType: "needs_manual_confirmation",
              context: `Pricing sanity check failed for a tour booking: ${reason}. ${pickupZone} -> ${destinationZone}, ${vehicleType}. Booking blocked, needs manual confirmation.`,
              sourceIp
            });
            return { ok: false, errors: ["Could not confirm a reliable price for this tour booking automatically. We've alerted our team and will follow up via WhatsApp to confirm your fare."] };
          }
        }
      }
    }
  }
  const fuelRow = await env.DB.prepare(`SELECT multiplier FROM fuel_index ORDER BY id DESC LIMIT 1`).first();
  const fuelMultiplierApplied = fuelRow ? fuelRow.multiplier : 1;

// ---- bundle lines 3010-3124: fare formula + computeAuthoritativePrice ----
__name(findNearestZone, "findNearestZone");
async function computeFareFjd(env, vehicleType, distanceKm, remoteMultiplier) {
  const rule = await env.DB.prepare(
    `SELECT base_rate_fjd_per_km, flagfall_fjd FROM pricing_rules
     WHERE vehicle_type = ? AND active = 1 AND distance_min_km <= ? AND (distance_max_km IS NULL OR ? < distance_max_km)
     ORDER BY distance_min_km DESC LIMIT 1`
  ).bind(vehicleType, distanceKm, distanceKm).first();
  if (!rule) return null;
  const baseFare = computeBaseFare({ flagfallFjd: rule.flagfall_fjd, baseRateFjdPerKm: rule.base_rate_fjd_per_km, distanceKm });
  const withZoneMultiplier = applyZoneMultiplier(baseFare, remoteMultiplier);
  return computeFinalTotal(withZoneMultiplier);
}
__name(computeFareFjd, "computeFareFjd");
async function computeZoneToZoneDistanceKm(env, lat1, lng1, lat2, lng2) {
  if (!env.GOOGLE_MAPS_API_KEY) return null;
  try {
    const res = await fetch(GOOGLE_ROUTES_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "routes.distanceMeters"
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: lat1, longitude: lng1 } } },
        destination: { location: { latLng: { latitude: lat2, longitude: lng2 } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        units: "METRIC"
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route || !route.distanceMeters) return null;
    return route.distanceMeters / 1e3;
  } catch (err) {
    return null;
  }
}
__name(computeZoneToZoneDistanceKm, "computeZoneToZoneDistanceKm");
async function getZoneDistanceKm(env, zoneAName, zoneBName, latA, lngA, latB, lngB) {
  const [sortedA, sortedB, sortedLatA, sortedLngA, sortedLatB, sortedLngB] = zoneAName <= zoneBName ? [zoneAName, zoneBName, latA, lngA, latB, lngB] : [zoneBName, zoneAName, latB, lngB, latA, lngA];
  const cached = await env.DB.prepare(
    `SELECT distance_km FROM zone_distance_cache WHERE zone_a = ? AND zone_b = ?`
  ).bind(sortedA, sortedB).first();
  if (cached) return { distanceKm: cached.distance_km, cacheHit: true };
  const distanceKm = await computeZoneToZoneDistanceKm(env, sortedLatA, sortedLngA, sortedLatB, sortedLngB);
  if (distanceKm === null) return { distanceKm: null, cacheHit: false };
  await env.DB.prepare(
    `INSERT OR IGNORE INTO zone_distance_cache (zone_a, zone_b, distance_km) VALUES (?, ?, ?)`
  ).bind(sortedA, sortedB, distanceKm).run();
  return { distanceKm, cacheHit: false };
}
__name(getZoneDistanceKm, "getZoneDistanceKm");
async function computeRealReferenceFare(env, pickupZone, destinationZone, vehicleType, tripType = "one-way") {
  const remoteZoneName = pickupZone === NADI_AIRPORT_ZONE_NAME ? destinationZone : pickupZone;
  const [airportZoneRow, remoteZoneRow] = await Promise.all([
    env.DB.prepare(`SELECT lat, lng FROM zones WHERE name = ?`).bind(NADI_AIRPORT_ZONE_NAME).first(),
    env.DB.prepare(`SELECT lat, lng, remote_multiplier FROM zones WHERE name = ?`).bind(remoteZoneName).first()
  ]);
  if (!airportZoneRow || !remoteZoneRow || airportZoneRow.lat === null || remoteZoneRow.lat === null) {
    return { ok: false, error: "Could not compute a real fare for this route right now. Please try again shortly.", status: 503 };
  }
  const { distanceKm, cacheHit } = await getZoneDistanceKm(
    env,
    NADI_AIRPORT_ZONE_NAME,
    remoteZoneName,
    airportZoneRow.lat,
    airportZoneRow.lng,
    remoteZoneRow.lat,
    remoteZoneRow.lng
  );
  if (distanceKm === null) {
    return { ok: false, error: "Could not compute a real fare for this route right now. Please try again shortly.", status: 503 };
  }
  const oneWayFareFjd = await computeFareFjd(env, vehicleType, distanceKm, remoteZoneRow.remote_multiplier);
  if (!oneWayFareFjd) {
    return { ok: false, error: "No pricing rule found for this route and vehicle type.", status: 400 };
  }
  const referenceFareFjd = computeFinalTotal(applyTripTypeMultiplier(oneWayFareFjd, tripType));
  return { ok: true, referenceFareFjd, distanceKm, cacheHit };
}
__name(computeRealReferenceFare, "computeRealReferenceFare");
async function computeAuthoritativePrice(env, { pickupZone, destinationZone, vehicleType, tripType, pickupTime, hasChildSeat, hasSurfboard }) {
  const remoteZoneName = pickupZone === NADI_AIRPORT_ZONE_NAME ? destinationZone : pickupZone;
  const [airportZoneRow, remoteZoneRow] = await Promise.all([
    env.DB.prepare(`SELECT lat, lng FROM zones WHERE name = ?`).bind(NADI_AIRPORT_ZONE_NAME).first(),
    env.DB.prepare(`SELECT lat, lng, remote_multiplier FROM zones WHERE name = ?`).bind(remoteZoneName).first()
  ]);
  if (!airportZoneRow || !remoteZoneRow || airportZoneRow.lat === null || remoteZoneRow.lat === null) {
    return { ok: false, error: "Could not resolve zone coordinates for authoritative pricing." };
  }
  const { distanceKm } = await getZoneDistanceKm(
    env,
    NADI_AIRPORT_ZONE_NAME,
    remoteZoneName,
    airportZoneRow.lat,
    airportZoneRow.lng,
    remoteZoneRow.lat,
    remoteZoneRow.lng
  );
  if (distanceKm === null) {
    return { ok: false, error: "Could not resolve a real distance for authoritative pricing." };
  }
  const oneWayFareFjd = await computeFareFjd(env, vehicleType, distanceKm, remoteZoneRow.remote_multiplier);
  if (!oneWayFareFjd) {
    return { ok: false, error: "No pricing rule found for this route and vehicle type." };
  }
  const withTripType = applyTripTypeMultiplier(oneWayFareFjd, tripType);
  const withNightSurcharge = applyNightSurcharge(withTripType, pickupTime);
  const withExtras = applyExtras(withNightSurcharge, { hasChildSeat, hasSurfboard });
  return { ok: true, transferPlusExtrasFjd: computeFinalTotal(withExtras), distanceKm };
}
__name(computeAuthoritativePrice, "computeAuthoritativePrice");
