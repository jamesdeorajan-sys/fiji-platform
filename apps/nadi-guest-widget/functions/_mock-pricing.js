// apps/nadi-guest-widget/functions/_mock-pricing.js
//
// Deterministic, in-memory port of nadi-dispatch-api's pricing.mjs (same
// constants as ../local-dev/pricing_lib.py and
// ../server-proposal/nadi-dispatch-api-custom-address-hardening.md) for use
// by this preview's mock quote.js/bookings.js ONLY. No network call, no
// database, no persistence beyond a single request/response - the only
// exception is IDEMPOTENCY_CACHE and GEOCODE_CACHE below, both plain
// in-memory Maps scoped to this Worker isolate: they exist purely so this
// demo can show idempotency and the quote-then-book flow working, they hold
// no customer PII (idempotency key + a synthetic reference only), and they
// are NOT durable - a cold start or a different edge location clears them.
// This is explicitly a preview-only convenience, not a production pattern.

export const RETURN_MULTIPLIER = 1.85;
export const NIGHT_SURCHARGE = 0.2;
export const DISCOUNT_THRESHOLD_FJD = 50;
export const DISCOUNT_RATE = 0.1;
export const CHILD_SEAT_FJD = 8;
export const SURFBOARD_FJD = 24;

export const PRICING_RULES = [
  { vehicle_type: 'sedan', min: 0, max: 15, rate: 3.592, flagfall: 5.57 },
  { vehicle_type: 'sedan', min: 15, max: 35, rate: 1.568, flagfall: 44.19 },
  { vehicle_type: 'sedan', min: 35, max: 70, rate: 1.438, flagfall: 38.75 },
  { vehicle_type: 'sedan', min: 70, max: 160, rate: 1.12, flagfall: 33.65 },
  { vehicle_type: 'sedan', min: 160, max: 300, rate: 1.852, flagfall: -47.67 },
  { vehicle_type: 'minivan', min: 0, max: 15, rate: 3.581, flagfall: 26.91 },
  { vehicle_type: 'minivan', min: 15, max: 35, rate: 2.622, flagfall: 43.54 },
  { vehicle_type: 'minivan', min: 35, max: 70, rate: 0.479, flagfall: 128.92 },
  { vehicle_type: 'minivan', min: 70, max: 160, rate: 1.764, flagfall: 6.22 },
  { vehicle_type: 'minivan', min: 160, max: 300, rate: 4.815, flagfall: -584.33 },
  { vehicle_type: 'minibus', min: 0, max: 15, rate: 4.133, flagfall: 51.17 },
  { vehicle_type: 'minibus', min: 15, max: 35, rate: 2.622, flagfall: 73.54 },
  { vehicle_type: 'minibus', min: 35, max: 70, rate: 0.956, flagfall: 139 },
  { vehicle_type: 'minibus', min: 70, max: 160, rate: 1.576, flagfall: 66.96 },
  { vehicle_type: 'minibus', min: 160, max: 300, rate: 1.852, flagfall: 132.33 },
];

export function findRule(vehicleType, distanceKm) {
  const matches = PRICING_RULES.filter(
    (r) => r.vehicle_type === vehicleType && r.min <= distanceKm && distanceKm < r.max
  );
  return matches.length ? matches[matches.length - 1] : null;
}

export function computeFareFjd(vehicleType, distanceKm, remoteMultiplier = 1) {
  const rule = findRule(vehicleType, distanceKm);
  if (!rule) return null;
  const base = rule.flagfall + rule.rate * distanceKm;
  return Math.round(base * (remoteMultiplier ?? 1) * 100) / 100;
}

export function isNightPickup(pickupTime) {
  if (!pickupTime) return false;
  const hour = parseInt(String(pickupTime).split(':')[0], 10);
  return Number.isFinite(hour) && (hour >= 22 || hour < 6);
}

export function applyModifiers(fareFjd, { tripType, pickupTime, hasChildSeat, hasSurfboard }) {
  let fare = fareFjd;
  if (tripType === 'return') fare *= RETURN_MULTIPLIER;
  if (isNightPickup(pickupTime)) fare *= 1 + NIGHT_SURCHARGE;
  if (hasChildSeat) fare += CHILD_SEAT_FJD;
  if (hasSurfboard) fare += SURFBOARD_FJD;
  return Math.round(fare * 100) / 100;
}

export function normalizeAddressQuery(raw) {
  return (raw || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

// Sanitized fixture "geocoding" - deterministic, no real Maps API call, no
// real address book. Matches the same two scenarios exercised in
// ../local-dev/mock_nadi_dispatch_api.py so both mocks agree.
const FIXTURE_GEOCODE = {
  'from_airport:42 example lane, martintar': { resolved: true, distanceKm: 8.4, remoteMultiplier: 1.0, zoneName: 'Denarau' },
};

export function fixtureGeocode(direction, address) {
  const key = `${direction}:${normalizeAddressQuery(address)}`;
  return FIXTURE_GEOCODE[key] || { resolved: false };
}

export function syntheticBookingRef() {
  const rand = Math.random().toString(36).toUpperCase().slice(2, 8);
  return `QA-PREVIEW-${rand}`;
}

// Isolate-scoped only - see file header. Never written to KV/D1/any durable
// store, and holds no customer-entered text, only a key hash + reference.
globalThis.__previewIdempotency = globalThis.__previewIdempotency || new Map();
export const IDEMPOTENCY_CACHE = globalThis.__previewIdempotency;
