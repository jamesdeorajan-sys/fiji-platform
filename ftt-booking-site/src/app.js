/* ═══════════════════════════════════════════════════════════════════════════
   FIJI TOUR TRANSFERS — app.js
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── PRICING CONSTANTS — FJD, TIERED TO MATCH FIJI MARKET ────────────────────
// Pricing in this file is HYBRID:
//
//   1. PUBLISHED ROUTES (Nadi Airport ↔ a hotel in ROUTES_DATA): the
//      calculator reads the published one-way price directly from
//      ROUTES_DATA. Calculator output exactly matches the table.
//
//   2. EVERYTHING ELSE (custom locations, hotel-to-hotel transfers,
//      airport-to-airport, etc.): the TIER formula below is used as
//      a smooth-curve estimate.
//
// The TIER constants were fitted (28 April 2026, v0.12) against the
// "smooth" subset of ROUTES_DATA — the rows where price scales with
// distance in a predictable way. Outlier rows (Ba Town, Volivoli,
// Marriott Momi minibus, Coral Coast 60-98km plateau) were excluded
// from the fit because they don't follow a smooth curve. For those
// destinations, the lookup in (1) gives the exact published price.
//
// Zones: 0–20 km (city/Denarau)  →  20–60 km (mid: Natadola/Momi/Sigatoka)
//        60+ km (Coral Coast / Pacific Harbour / Suva long-haul)
const TIER = {
  sedan:   { base: 5,  z1: 3.55, z2: 1.10, z3: 1.10 },
  minivan: { base: 21, z1: 4.11, z2: 1.35, z3: 1.35 },
  minibus: { base: 35, z1: 5.16, z2: 1.47, z3: 1.47 }
};

// ─── A4: MULTI-CURRENCY DISPLAY ──────────────────────────────────────────────
// Charging is always in FJD. The currency toggle in the pricing panel only
// changes the on-screen number so tourists from AU/US/NZ/UK/EU don't have
// to mental-convert. The conversion factors below are mid-market reference
// rates (sources: Wise 30-day average and Xe live, fetched 28 April 2026).
//
// MAINTENANCE: review monthly. If FX moves more than 5% against any pair,
// update both the rate and the cache version. See EXCHANGE_RATES.md for the
// review checklist.
const FX_RATES = {
  FJD: { factor: 1,    symbol: 'FJ$', name: 'Fijian dollar'    },
  AUD: { factor: 0.64, symbol: 'AU$', name: 'Australian dollar' },
  USD: { factor: 0.45, symbol: 'US$', name: 'US dollar'         },
  NZD: { factor: 0.77, symbol: 'NZ$', name: 'New Zealand dollar'},
  GBP: { factor: 0.33, symbol: '£',   name: 'British pound'     },
  EUR: { factor: 0.39, symbol: '€',   name: 'Euro'              }
};

// Currently selected display currency, defaults to FJD. The chosen value is
// remembered for the page session via localStorage so a returning customer
// who picked AUD last time sees AUD this time too.
function getDisplayCurrency() {
  if (state.displayCurrency) return state.displayCurrency;
  try {
    const saved = localStorage.getItem('ftt_currency');
    if (saved && FX_RATES[saved]) {
      state.displayCurrency = saved;
      return saved;
    }
  } catch (e) {}
  state.displayCurrency = 'FJD';
  return 'FJD';
}

// Format a FJD price as a human-readable string in the currently selected
// display currency. Examples:
//   formatPrice(129)            → "FJ$129"  (default)
//   formatPrice(129)  // AUD    → "AU$83"
//   formatPrice(129)  // USD    → "US$58"
// Rounded to nearest whole unit — fractional cents look noisy in display.
function formatPrice(fjd) {
  const code = getDisplayCurrency();
  const rate = FX_RATES[code];
  if (!rate || code === 'FJD') return `FJ$${fjd}`;
  const converted = Math.round(fjd * rate.factor);
  return `${rate.symbol}${converted}`;
}

// Called by the currency dropdown. Persists the choice and re-renders all
// UI surfaces that show prices.
function onCurrencyChange() {
  const sel = document.getElementById('currencySelect');
  if (!sel) return;
  state.displayCurrency = sel.value;
  try { localStorage.setItem('ftt_currency', sel.value); } catch (e) {}
  // Re-render everything that shows a price
  if (state.distanceKm) updatePricing();
  buildRoutesTable();
}
const NIGHT_SURCHARGE  = 0.20;   // 10pm–6am
const RETURN_MULTIPLIER = 1.85;  // return = ~1.85x one-way (small discount on second leg)
const DISCOUNT_THRESHOLD = 50;   // Apply discount when subtotal > FJ$50
const DISCOUNT_RATE      = 0.10; // 10% off

// Centralised price calculation — returns subtotal, discount, and final.
// vehicleKey defaults to the currently-selected vehicle but can be passed
// explicitly so the per-vehicle cards in step 1 can show their own discount.
//
// The 10% loyalty discount applies to TRANSFER-ONLY bookings over FJ$50.
// Tour bookings (where a tour is in state) are excluded from the loyalty
// discount — tours already carry their own listed-price discounts (15-30%
// off on the tour cards) and the loyalty discount doesn't combine.
// Source of truth is state.selectedTour. The DOM banner is just the visible
// reflection of that state.
function bookingHasTour() {
  return !!state.selectedTour;
}
function calculateTotal(vehicleKey) {
  const k = vehicleKey || state.selectedVehicle;
  if (!k || !state.prices[k]) return {
    vehiclePrice: 0, extras: 0, tourPerPax: 0, tourTotal: 0,
    transferSubtotal: 0, subtotal: 0, discount: 0, final: 0,
    qualifies: false, suppressedByTour: false, hasTour: false
  };
  const vehiclePrice = state.prices[k];
  const extras       = state.extrasTotal;
  const transferSubtotal = vehiclePrice + extras;

  // Tour cost = per-person price × number of passengers. A tour is a single
  // experience so the return-trip multiplier (already in vehiclePrice) does
  // NOT apply here. minPax in TOURS_DATA is enforced at booking validation
  // time, not here — calculateTotal trusts state.passengers.
  const hasTour      = !!state.selectedTour;
  const tourPerPax   = hasTour ? state.selectedTour.price : 0;
  const tourTotal    = hasTour ? tourPerPax * state.passengers : 0;

  const subtotal     = transferSubtotal + tourTotal;
  const overThreshold = subtotal > DISCOUNT_THRESHOLD;
  // Loyalty discount (10% off > FJ$50) is suppressed when a tour is in the
  // booking — the tour already carries its own listed discount on the live
  // site (e.g. "30% OFF" badges), and stacking a second discount would
  // over-discount the bundle. Driver coordinator has discretion to apply
  // a courtesy discount manually if appropriate.
  const qualifies    = overThreshold && !hasTour;
  const discount     = qualifies ? Math.round(subtotal * DISCOUNT_RATE) : 0;
  const final        = subtotal - discount;
  const suppressedByTour = overThreshold && hasTour;
  return {
    vehiclePrice, extras, tourPerPax, tourTotal, transferSubtotal,
    subtotal, discount, final, qualifies, suppressedByTour, hasTour
  };
}

// ─── EMOJI STRIPPER ──────────────────────────────────────────────────────────
// Removes leading emoji + trailing emoji from a string. Used for confirmation
// card and WhatsApp messages so they read cleanly even when emojis would
// fail to render (older email clients, plain-text terminals, CRMs, etc).
function stripEmoji(str) {
  if (!str) return str;
  // Remove ALL emoji-class characters and surrounding whitespace
  const emojiRe = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20D0}-\u{20FF}]+/gu;
  return str.replace(emojiRe, '').replace(/\s{2,}/g, ' ').trim();
}

// ─── APP STATE ────────────────────────────────────────────────────────────────
const state = {
  pickup: null, destination: null,
  distanceKm: 0, durationMin: 0,
  tripType: 'one-way', passengers: 2, luggage: 2,
  selectedVehicle: null, extrasTotal: 0,
  prices: { sedan: 0, minivan: 0, minibus: 0 },
  // selectedTour holds the full TOURS_DATA entry when a tour is in the booking,
  // null otherwise. Set by selectTour(), cleared by removeTourBanner().
  // Used by calculateTotal() to add tour cost (price × passengers) to the total.
  selectedTour: null,
  // MILESTONE 11 (guest widget integration, isolated preview): real
  // nadi-dispatch-api /quote result for the CURRENT custom-destination
  // address (pickup=NAN only - see the section below for why). null until
  // a fetch resolves; forAddress guards against a slow, stale response
  // landing after the guest has already changed the address.
  quoteResult: null,
  // MILESTONE 12 (departing guest, bidirectional /quote): mirrors
  // quoteResult above but for a custom PICKUP address when destination is
  // the fixed Nadi Airport (direction='to_airport'). Same forAddress guard,
  // same shape - kept as a separate field rather than reusing quoteResult
  // because both can legitimately be mid-flight at once if a guest fiddles
  // with both fields (only one is ever actually used for pricing, gated by
  // which end is CUSTOM_* and which is 'NAN').
  pickupQuoteResult: null,
  // Resolved marketplace zone for the current destination, ANY type (fixed
  // or custom) - used only for POST /bookings' destination_zone field, not
  // for pricing. null until resolved.
  destZoneName: null,
  destZonePending: false,
  destZoneFetchedFor: null,
};

// ─── DISTANCE HELPERS ────────────────────────────────────────────────────────
// Haversine returns straight-line distance. Viti Levu's coastal road winds
// significantly so we apply a road-distance multiplier (~1.55x) which gives
// accurate driving distances vs Google Maps for Nadi → Coral Coast / Suva.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
// Apply an adaptive road multiplier: short trips around Nadi follow a near-direct
// road (≈1.55x straight-line), but the south coast Queens Highway sweeps inland
// and around bays so long trips have a higher actual road distance (≈1.7x).
function roadKm(lat1, lng1, lat2, lng2) {
  const straight = haversineKm(lat1, lng1, lat2, lng2);
  // Multiplier blends from 1.55 (short) to 1.70 (long) over the first 100km
  const t = Math.min(1, straight / 100);
  const mult = 1.55 + 0.15 * t;
  return straight * mult;
}
// Fiji Queens Road averages ~40 km/h in town and ~70 km/h on open highway.
// This piecewise model matches Google Maps drive times closely:
//   first 10 km @ 40 km/h (in town)
//   next 30 km @ 60 km/h (suburban + sugar belt)
//   60+ km    @ 75 km/h (open highway)
function estimateMinutes(km) {
  let min = 5;                                                  // door-handover overhead
  const a = Math.min(km, 10),
        b = Math.max(0, Math.min(km - 10, 30)),
        c = Math.max(0, km - 40);
  min += (a / 40 + b / 60 + c / 75) * 60;
  return Math.round(min);
}
function formatDuration(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min/60), m = min%60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
function isNightPickup() {
  const hr = parseInt((document.getElementById('travelTime')?.value || '10:00').split(':')[0]);
  return hr >= 22 || hr < 6;
}

// Lazily-built map of destValue → { sedan, minivan, minibus } published prices.
// The map is built from ROUTES_DATA (declared further down in this file) on
// first call. The published table is intrinsically Nadi Airport ↔ hotel,
// so the lookup also fires for the reverse direction (hotel → Nadi Airport).
let _publishedPriceMap = null;
function getPublishedPriceMap() {
  if (_publishedPriceMap) return _publishedPriceMap;
  _publishedPriceMap = {};
  if (typeof ROUTES_DATA !== 'undefined') {
    for (const r of ROUTES_DATA) {
      _publishedPriceMap[r.destValue] = { sedan: r.s, minivan: r.v, minibus: r.m };
    }
  }
  return _publishedPriceMap;
}

// Returns published one-way prices when the route is Nadi Airport ↔ a known
// destination from ROUTES_DATA, otherwise null. Caller falls back to calcPrice.
function lookupPublishedPrices(pickupVal, destVal) {
  if (!pickupVal || !destVal) return null;
  const map = getPublishedPriceMap();
  // Nadi Airport → hotel
  if (pickupVal === 'NAN' && map[destVal]) return map[destVal];
  // Hotel → Nadi Airport (return leg, same published price)
  if (destVal === 'NAN' && map[pickupVal]) return map[pickupVal];
  return null;
}

// Apply night surcharge / return multiplier to a one-way base price. When a
// modifier is applied the result is rounded UP to the nearest FJ$5 (the
// pricing convention). When no modifier applies the input is returned
// unchanged so that published table prices (e.g. FJ$49) aren't bumped to
// the next multiple of 5.
function applyModifiers(p) {
  const night  = isNightPickup();
  const ret    = state.tripType === 'return';
  if (!night && !ret) return p;
  if (night) p *= (1 + NIGHT_SURCHARGE);
  if (ret)   p *= RETURN_MULTIPLIER;
  return Math.ceil(p / 5) * 5;
}

function calcPrice(type, km) {
  const R = TIER[type];
  // Distance allocated to each pricing zone
  const z1 = Math.min(km, 20);
  const z2 = Math.max(0, Math.min(km - 20, 40));
  const z3 = Math.max(0, km - 60);
  // The formula path always rounds up to nearest FJ$5.
  const raw = R.base + z1 * R.z1 + z2 * R.z2 + z3 * R.z3;
  const rounded = Math.ceil(raw / 5) * 5;
  return applyModifiers(rounded);
}

// Compute prices for all three vehicles for a given pickup/destination pair.
// Uses the published lookup when the route is in ROUTES_DATA (Nadi Airport ↔
// known hotel) so the calculator and the published routes table never drift.
// Falls back to the TIER formula for custom locations and hotel-to-hotel.
//
// MILESTONE 11: when pickup is Nadi Airport and the destination is a custom
// address with a REAL, resolved /quote result for THAT exact address text,
// use the real Google-Maps-backed fare instead of the TIER estimate - see
// fetchQuoteForAddress() below. Falls through to the existing estimate while
// the async fetch is in flight, hasn't been triggered yet, or failed - the
// guest is never left with a blank price. Fixed (non-custom) destinations
// are untouched - published prices already come from real ROUTES_DATA and
// don't need Google's help.
function computePrices(pickupVal, destVal, km) {
  if (pickupVal === 'NAN' && destVal === 'CUSTOM_DEST') {
    const addr = document.getElementById('customDestAddress')?.value.trim();
    const q = state.quoteResult;
    if (addr && q && q.forAddress === addr && q.outcome === 'resolved') {
      return {
        sedan:   applyModifiers(q.fares.sedan),
        minivan: applyModifiers(q.fares.minivan),
        minibus: applyModifiers(q.fares.minibus),
        source:  'quote'
      };
    }
  }
  // MILESTONE 12: symmetric departing-guest case - real Google-backed fare
  // for a custom pickup address quoted to the fixed Nadi Airport.
  if (destVal === 'NAN' && pickupVal === 'CUSTOM_PICKUP') {
    const addr = document.getElementById('customPickupAddress')?.value.trim();
    const q = state.pickupQuoteResult;
    if (addr && q && q.forAddress === addr && q.outcome === 'resolved') {
      return {
        sedan:   applyModifiers(q.fares.sedan),
        minivan: applyModifiers(q.fares.minivan),
        minibus: applyModifiers(q.fares.minibus),
        source:  'quote'
      };
    }
  }
  const pub = lookupPublishedPrices(pickupVal, destVal);
  if (pub) {
    return {
      sedan:   applyModifiers(pub.sedan),
      minivan: applyModifiers(pub.minivan),
      minibus: applyModifiers(pub.minibus),
      source:  'published'
    };
  }
  return {
    sedan:   calcPrice('sedan',   km),
    minivan: calcPrice('minivan', km),
    minibus: calcPrice('minibus', km),
    source:  'estimate'
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MILESTONE 11/12 — guest widget integration (isolated preview, NOT live).
// Wires nadi-dispatch-api's /quote and /bookings into the existing booking
// flow. /quote is airport-ANCHORED, not general point-to-point: it can
// answer "Nadi Airport -> this address" (direction='from_airport', arriving
// guest, Milestone 11) or "this address -> Nadi Airport" (direction=
// 'to_airport', departing guest, Milestone 12) - never hotel-to-hotel with
// no airport involved. Real /quote pricing AND POST /bookings are scoped to
// exactly two cases: pickup === 'NAN' (arriving), or pickup === 'CUSTOM_PICKUP'
// && destination === 'NAN' (departing). Every other combination keeps
// today's WhatsApp-only flow completely unchanged - not a regression, an
// explicit, flagged scope boundary.
// ═══════════════════════════════════════════════════════════════════════════

const NADI_API_BASE = 'https://api.nadiairporttransfers.com';

// Real marketplace zone names (nadi-marketplace-db's zones table) - lets a
// FIXED destination's own data-area text resolve to a POST /bookings
// destination_zone for free (no API call) when it's an exact match, which
// covers the large majority of the site's real destinations.
const MARKETPLACE_ZONE_NAMES = new Set([
  'Nadi', 'Nadi Airport', 'Wailoaloa', 'Denarau', 'Sonaisali', 'Vuda Point',
  'Lautoka', 'Momi Bay', 'Natadola', 'Sigatoka', 'Coral Coast',
  'Pacific Harbour', 'Ba', 'Rakiraki', 'Suva', 'Nausori',
]);
// Real, unambiguous alias, not a guess - Port Denarau marina is
// geographically within the Denarau zone.
const AREA_ZONE_ALIASES = { 'Port Denarau': 'Denarau' };

let quoteDebounceTimer = null;
let pickupQuoteDebounceTimer = null;
let zoneResolveTimer = null;

// Real Google-Maps-backed price + zone for an airport-anchored trip to/from
// an arbitrary address. Calls /quote once per vehicle type in parallel - the
// backend caches by address text AND direction, not vehicle type, so only
// the FIRST of the three is a real, billable Google API call; the other two
// are free cache hits (confirmed in the Milestone 9 real cache-dedup test).
// direction: 'from_airport' (default, Milestone 11 - Nadi Airport -> address,
// arriving guest) or 'to_airport' (Milestone 12 - address -> Nadi Airport,
// departing guest).
async function fetchQuoteForAddress(addressText, direction = 'from_airport') {
  try {
    const [sedanRes, minivanRes, minibusRes] = await Promise.all(
      ['sedan', 'minivan', 'minibus'].map(vt =>
        fetch(`${NADI_API_BASE}/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addressText, vehicle_type: vt, direction }),
        }).then(r => r.json()).catch(() => null)
      )
    );
    if (!sedanRes || !sedanRes.ok) return { outcome: 'error' };
    if (sedanRes.outcome === 'needs_manual_confirmation' || sedanRes.outcome === 'needs_water_transfer') {
      return {
        outcome: sedanRes.outcome,
        whatsappLink: sedanRes.whatsapp_link || null,
        message: sedanRes.message || 'This destination needs manual confirmation — please message us on WhatsApp.',
      };
    }
    if (sedanRes.outcome === 'resolved' && minivanRes?.ok && minibusRes?.ok) {
      return {
        outcome: 'resolved',
        distanceKm: sedanRes.distance_km,
        fares: {
          sedan:   sedanRes.quoted_fare_fjd,
          minivan: minivanRes.quoted_fare_fjd,
          minibus: minibusRes.quoted_fare_fjd,
        },
        nearestZoneName: sedanRes.nearest_zone ? sedanRes.nearest_zone.name : null,
      };
    }
    return { outcome: 'error' };
  } catch (err) {
    return { outcome: 'error' };
  }
}

// Debounced trigger for the custom-destination address input - only fires
// when pickup is Nadi Airport (see the scope note above), the destination
// panel is CUSTOM_DEST, and the address is long enough to be worth a real,
// billable Google API call. 800ms of no typing before firing, matching the
// new Cloudflare Rate Limiting Rule's real 10s/5-request window with room
// to spare for a guest who types, pauses, then edits again.
function maybeDebounceCustomDestQuote() {
  const pickupVal = document.getElementById('pickup')?.value;
  const destVal    = document.getElementById('destination')?.value;
  if (pickupVal !== 'NAN' || destVal !== 'CUSTOM_DEST') return;
  const addr = document.getElementById('customDestAddress')?.value.trim();
  clearTimeout(quoteDebounceTimer);
  if (!addr || addr.length < 8) return;
  if (state.quoteResult && state.quoteResult.forAddress === addr) return; // already have it
  quoteDebounceTimer = setTimeout(async () => {
    const result = await fetchQuoteForAddress(addr, 'from_airport');
    // Guard against a slow response landing after the guest changed the
    // address again in the meantime.
    const currentAddr = document.getElementById('customDestAddress')?.value.trim();
    if (currentAddr !== addr) return;
    state.quoteResult = { forAddress: addr, ...result };
    updatePricing();
  }, 800);
}

// MILESTONE 12: mirrors maybeDebounceCustomDestQuote() above, but for the
// departing-guest direction - fires when destination is the fixed Nadi
// Airport and pickup is the free-text CUSTOM_PICKUP field. Same 800ms
// debounce, same address-length guard, same stale-response guard.
function maybeDebounceCustomPickupQuote() {
  const pickupVal = document.getElementById('pickup')?.value;
  const destVal    = document.getElementById('destination')?.value;
  if (destVal !== 'NAN' || pickupVal !== 'CUSTOM_PICKUP') return;
  const addr = document.getElementById('customPickupAddress')?.value.trim();
  clearTimeout(pickupQuoteDebounceTimer);
  if (!addr || addr.length < 8) return;
  if (state.pickupQuoteResult && state.pickupQuoteResult.forAddress === addr) return; // already have it
  pickupQuoteDebounceTimer = setTimeout(async () => {
    const result = await fetchQuoteForAddress(addr, 'to_airport');
    const currentAddr = document.getElementById('customPickupAddress')?.value.trim();
    if (currentAddr !== addr) return;
    state.pickupQuoteResult = { forAddress: addr, ...result };
    updatePricing();
  }, 800);
}

// Resolves the destination_zone needed for POST /bookings, for a FIXED
// (non-custom) destination. Separate from pricing, which already has
// correct published prices for these and is never touched by this. Free
// string-match against the option's own data-area text first; only a small
// number of real areas (Sabeto, Saweni, Maui Bay, Tavarua, Beqa Island,
// Namosi, Tavua) don't correspond 1:1 to a marketplace zone and need the
// async /quote fallback below - never guessed.
function resolveFixedDestinationZone(destOpt) {
  const area = destOpt?.dataset?.area;
  if (!area) return null;
  if (MARKETPLACE_ZONE_NAMES.has(area)) return area;
  if (AREA_ZONE_ALIASES[area]) return AREA_ZONE_ALIASES[area];
  return 'NEEDS_LOOKUP';
}

// Async fallback for the small number of fixed destinations whose area
// doesn't map for free. Only fetches the zone (via the sedan vehicle type -
// price is discarded, published pricing is already correct and unaffected).
async function resolveDestinationZoneAsync(destName) {
  // Already resolved (or already fetching) for this exact destination -
  // nothing to do. Tracking by name, not just a boolean, so switching
  // between two different lookups always re-fires correctly.
  if (state.destZoneFetchedFor === destName) return;
  clearTimeout(zoneResolveTimer);
  state.destZonePending = true;
  state.destZoneFetchedFor = destName;
  zoneResolveTimer = setTimeout(async () => {
    const result = await fetchQuoteForAddress(destName);
    state.destZonePending = false;
    state.destZoneName = (result.outcome === 'resolved' && result.nearestZoneName) ? result.nearestZoneName : null;
  }, 400);
}

// ─── RELIABLY SET A <SELECT> BY OPTION VALUE ─────────────────────────────────
function setSelectByValue(selectId, targetValue) {
  const sel = document.getElementById(selectId);
  if (!sel || !targetValue) return false;
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === targetValue) { sel.selectedIndex = i; return true; }
  }
  return false;
}

// ─── UPDATE PRICING PANEL ────────────────────────────────────────────────────
//
// Two ways the form can supply a pickup or destination:
//   (a) A real <option> with data-lat / data-lng on it (preset hotel/airport)
//   (b) A "CUSTOM_*" sentinel value that reveals a panel with:
//       - free-text address (for the driver)
//       - a zone dropdown (carries lat/lng for pricing)
//
// resolveLocation() returns { lat, lng, name, area, hotel } or null.
function resolveLocation(which) {
  const sel  = document.getElementById(which);                 // 'pickup' | 'destination'
  const opt  = sel?.options[sel.selectedIndex];
  if (!opt || !opt.value) return null;

  // Custom-location sentinels
  if (opt.value === 'CUSTOM_PICKUP' || opt.value === 'CUSTOM_DEST') {
    // MILESTONE 11: when a real, resolved /quote result exists for the
    // exact current destination address, use it directly - no need for the
    // guest to ALSO pick the approximate zone dropdown below, which is
    // exactly the imprecise fallback /quote exists to improve on. lat/lng
    // are intentionally omitted (null) - updatePricing() uses the quote's
    // own real distance_km directly rather than computing roadKm() from
    // coordinates for this case.
    if (which === 'destination') {
      const addr = document.getElementById('customDestAddress')?.value.trim();
      const q = state.quoteResult;
      if (addr && q && q.forAddress === addr && q.outcome === 'resolved') {
        return { lat: null, lng: null, name: addr, area: q.nearestZoneName || addr, hotel: addr };
      }
    }
    // MILESTONE 12: symmetric to the destination branch above, for a
    // departing guest's custom pickup address once /quote (direction=
    // 'to_airport') has resolved it - same reasoning, lat/lng intentionally
    // null so updatePricing() uses the quote's real distance_km directly.
    if (which === 'pickup') {
      const addr = document.getElementById('customPickupAddress')?.value.trim();
      const q = state.pickupQuoteResult;
      if (addr && q && q.forAddress === addr && q.outcome === 'resolved') {
        return { lat: null, lng: null, name: addr, area: q.nearestZoneName || addr, hotel: addr };
      }
    }
    const zSel = document.getElementById(which === 'pickup' ? 'customPickupZone' : 'customDestZone');
    const aInp = document.getElementById(which === 'pickup' ? 'customPickupAddress' : 'customDestAddress');
    const z    = zSel?.options[zSel.selectedIndex];
    if (!z?.dataset?.lat) return null;
    const addr = stripEmoji(aInp?.value.trim() || z.text);
    return {
      lat:   +z.dataset.lat,
      lng:   +z.dataset.lng,
      name:  addr,
      area:  stripEmoji(z.text),
      hotel: addr
    };
  }

  // Preset option — strip ALL emojis from option text
  if (!opt.dataset?.lat) return null;
  const clean = stripEmoji(opt.text);
  return {
    lat:   +opt.dataset.lat,
    lng:   +opt.dataset.lng,
    name:  clean,
    area:  stripEmoji(opt.dataset.area  || clean),
    hotel: stripEmoji(opt.dataset.hotel || clean)
  };
}

function onPickupChange()      { togglePickupPanel();   updatePricing(); updateFlightHint(); }
function onDestinationChange() { toggleDestPanel();     updatePricing(); }

// A1: Show the friendly flight-monitoring promise inline when the pickup is
// Nadi Airport. Hide it for hotel-departure bookings where it doesn't apply.
function updateFlightHint() {
  const hint = document.getElementById('flightHint');
  if (!hint) return;
  const pickupVal = document.getElementById('pickup')?.value;
  hint.style.display = (pickupVal === 'NAN') ? 'block' : 'none';
}

// Wired to the flight input — re-runs pricing (no behavioural change) and
// fades the hint once the customer has actually entered a flight number, so
// they aren't nagged after they've already complied.
function onFlightInput() {
  updatePricing();
  const hint = document.getElementById('flightHint');
  const flightVal = document.getElementById('flightNum')?.value.trim();
  if (hint && flightVal) hint.style.display = 'none';
}
function togglePickupPanel() {
  const sel  = document.getElementById('pickup');
  const open = sel?.value === 'CUSTOM_PICKUP';
  const p    = document.getElementById('customPickupPanel');
  if (p) p.style.display = open ? 'block' : 'none';
}
function toggleDestPanel() {
  const sel  = document.getElementById('destination');
  const open = sel?.value === 'CUSTOM_DEST';
  const p    = document.getElementById('customDestPanel');
  if (p) p.style.display = open ? 'block' : 'none';
}

// MILESTONE 12: shared by both the destination (arriving guest) and pickup
// (departing guest) quote flows - whichever end is the free-text address,
// if /quote determined it needs a human (garbage address, or a genuine
// water-transfer destination), render the same concierge path instead of a
// fabricated price. routeLabel is built by the caller since only it knows
// which end is the real address text and which is the fixed airport.
function renderQuoteNeedsHuman(q, routeLabel) {
  const panel   = document.getElementById('pricingPanel');
  const empty   = document.getElementById('emptyState');
  const nextBtn = document.getElementById('nextBtn1');
  if (document.getElementById('pricingRoute')) document.getElementById('pricingRoute').textContent = routeLabel;
  if (document.getElementById('pricingMeta')) document.getElementById('pricingMeta').textContent = q.message;
  const vcEl = document.getElementById('vehicleCards');
  if (vcEl) {
    vcEl.innerHTML = q.whatsappLink
      ? `<a href="${q.whatsappLink}" target="_blank" rel="noopener" class="btn-whatsapp">💬 Confirm this address on WhatsApp</a>`
      : `<p>Please contact us directly to confirm pricing for this address.</p>`;
  }
  if (panel) panel.style.display = 'block';
  if (empty) empty.style.display = 'none';
  if (nextBtn) nextBtn.disabled = true; // never let a guest book against a fabricated price
}

function updatePricing() {
  const panel   = document.getElementById('pricingPanel');
  const empty   = document.getElementById('emptyState');
  const nextBtn = document.getElementById('nextBtn1');
  const pickupVal = document.getElementById('pickup')?.value;
  const destVal   = document.getElementById('destination')?.value;

  // MILESTONE 11/12: fire these BEFORE the resolveLocation() checks below -
  // a real, valid guest interaction is typing an address before (or
  // without ever) touching the secondary "approximate zone" dropdown
  // resolveLocation requires for the old estimate path. /quote only needs
  // the address text, so waiting on that dropdown too would defeat much of
  // the point of replacing it with a real lookup. Each is a no-op unless
  // its own pickup/destination combination is active with real address text.
  maybeDebounceCustomDestQuote();
  maybeDebounceCustomPickupQuote();

  // MILESTONE 11: a custom destination that /quote has determined needs a
  // human (garbage address, or a genuine water-transfer destination) never
  // gets a fabricated price - show the real concierge path instead of the
  // normal pricing panel. Checked here, BEFORE the resolveLocation()/km
  // early-return below, so it renders even if the guest never touches the
  // secondary zone dropdown that path requires.
  const currentDestAddr = destVal === 'CUSTOM_DEST' ? document.getElementById('customDestAddress')?.value.trim() : null;
  const dq = state.quoteResult;
  if (pickupVal === 'NAN' && destVal === 'CUSTOM_DEST' && currentDestAddr && dq && dq.forAddress === currentDestAddr
      && (dq.outcome === 'needs_manual_confirmation' || dq.outcome === 'needs_water_transfer')) {
    renderQuoteNeedsHuman(dq, `Nadi Airport → ${currentDestAddr}`);
    return;
  }

  // MILESTONE 12: symmetric check for a departing guest's custom pickup
  // address that /quote determined needs a human.
  const currentPickupAddr = pickupVal === 'CUSTOM_PICKUP' ? document.getElementById('customPickupAddress')?.value.trim() : null;
  const pq = state.pickupQuoteResult;
  if (destVal === 'NAN' && pickupVal === 'CUSTOM_PICKUP' && currentPickupAddr && pq && pq.forAddress === currentPickupAddr
      && (pq.outcome === 'needs_manual_confirmation' || pq.outcome === 'needs_water_transfer')) {
    renderQuoteNeedsHuman(pq, `${currentPickupAddr} → Nadi Airport`);
    return;
  }

  const p = resolveLocation('pickup');
  const d = resolveLocation('destination');

  if (!p || !d) {
    if (panel) panel.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  // MILESTONE 11/12: a resolved custom-address quote (either end) carries
  // its own real distance_km (from Google, via nadi-dispatch-api) - the
  // custom end's lat/lng are null for this case (see resolveLocation()
  // above), so roadKm() would produce garbage; use the real value directly
  // instead. Only one of these two can be true at once (computePrices'
  // scope boundary is the same: pickup=NAN+dest=CUSTOM_DEST XOR
  // dest=NAN+pickup=CUSTOM_PICKUP).
  const kmFromQuote = (destVal === 'CUSTOM_DEST' && d.lat === null && state.quoteResult?.outcome === 'resolved')
    ? state.quoteResult.distanceKm
    : (destVal === 'NAN' && pickupVal === 'CUSTOM_PICKUP' && p.lat === null && state.pickupQuoteResult?.outcome === 'resolved')
      ? state.pickupQuoteResult.distanceKm : null;
  const km  = kmFromQuote !== null ? kmFromQuote : roadKm(p.lat, p.lng, d.lat, d.lng);
  const min = estimateMinutes(km);
  state.distanceKm  = km;
  state.durationMin = min;
  state.pickup      = p;
  state.destination = d;

  // MILESTONE 11/12: fire the async real-zone lookup for FIXED destinations
  // (the custom-destination /quote call already fired above). Doesn't
  // block this synchronous render - re-calls updatePricing() itself once
  // it resolves. Gate relaxed from "pickupVal === 'NAN'" to also cover the
  // departing-guest case (pickup=CUSTOM_PICKUP, dest=NAN) - for that case
  // resolveFixedDestinationZone resolves 'Nadi Airport' for free (it's in
  // MARKETPLACE_ZONE_NAMES), so this never triggers an extra async /quote
  // call for the departing flow, it just lets state.destZoneName populate
  // correctly so submitMarketplaceBooking() has a real destination_zone.
  if ((pickupVal === 'NAN' || (pickupVal === 'CUSTOM_PICKUP' && destVal === 'NAN')) && destVal !== 'CUSTOM_DEST' && destVal) {
    const destOpt = document.getElementById('destination')?.selectedOptions?.[0];
    const zone = resolveFixedDestinationZone(destOpt);
    if (zone === 'NEEDS_LOOKUP') {
      resolveDestinationZoneAsync(d.hotel || d.name);
    } else {
      state.destZoneFetchedFor = null;
      state.destZoneName = zone;
    }
  } else if (destVal === 'CUSTOM_DEST') {
    // Reset stale data from a previous fixed-destination selection - the
    // real zone for a custom address is computed fresh at confirm-time by
    // resolveConfirmedDestinationZone(), from state.quoteResult directly.
    state.destZoneName = null;
    state.destZoneFetchedFor = null;
  }

  // Hybrid pricing: published lookup for known Nadi Airport ↔ hotel routes,
  // smooth-curve fallback for everything else.
  const priced    = computePrices(pickupVal, destVal, km);
  state.prices    = { sedan: priced.sedan, minivan: priced.minivan, minibus: priced.minibus };
  state.priceSource = priced.source;  // 'published' | 'estimate' | 'quote'

  const suffix   = state.tripType === 'return' ? ' (return)' : '';
  const fromName = p.name.replace(/^[✈⛵🏙📍]\s*/,'');
  const toName   = d.hotel || d.name;
  const isCustom = pickupVal === 'CUSTOM_PICKUP' || destVal === 'CUSTOM_DEST';
  // Show "Estimate" caveat for custom locations OR for any route that fell
  // back to the formula (e.g. hotel-to-hotel, Mamanuca pickups).
  const isEstimate = isCustom || priced.source === 'estimate';
  if (document.getElementById('pricingRoute'))
    document.getElementById('pricingRoute').textContent = `${fromName} → ${toName}${suffix}`;
  if (document.getElementById('pricingMeta'))
    document.getElementById('pricingMeta').textContent =
      `${km.toFixed(1)} km · approx. ${formatDuration(min)}`
      + (isNightPickup() ? ' · Night surcharge applied' : '')
      + (isEstimate ? ' · Estimate — driver may confirm exact fare' : '');

  // Swap the discount banner copy when a tour is in the booking — the
  // 10% loyalty discount only applies to transfer-only bookings.
  const banner = document.getElementById('discountBanner');
  if (banner) {
    const txt = banner.querySelector('.discount-banner-text');
    if (bookingHasTour()) {
      if (txt) txt.textContent = '10% loyalty discount applies to transfer-only bookings — your tour already includes its own listed discount';
      banner.classList.add('discount-banner--tour');
    } else {
      if (txt) txt.textContent = `10% off automatically applied to bookings over ${formatPrice(DISCOUNT_THRESHOLD)}`;
      banner.classList.remove('discount-banner--tour');
    }
  }

  const vcEl = document.getElementById('vehicleCards');
  if (vcEl) vcEl.innerHTML = buildVehicleCards();
  if (panel) panel.style.display = 'block';
  if (empty) empty.style.display = 'none';
  if (nextBtn) nextBtn.disabled = !state.selectedVehicle;

  // Tour-bundle summary: show combined transfer + tour total when both
  // a tour and a vehicle are in the booking. Only renders after vehicle
  // selection so the tour-cost line has a real transfer figure to add to.
  const bundleEl = document.getElementById('tourBundleSummary');
  if (bundleEl) {
    if (state.selectedTour && state.selectedVehicle) {
      const t = calculateTotal();
      const paxLabel = state.passengers === 1 ? 'person' : 'people';
      bundleEl.innerHTML = `
        <div class="tbs-row">
          <span class="tbs-label">Transfer (${{ sedan: 'Sedan', minivan: 'Minivan', minibus: 'Minibus' }[state.selectedVehicle]})</span>
          <span class="tbs-value">${formatPrice(t.transferSubtotal)}</span>
        </div>
        <div class="tbs-row">
          <span class="tbs-label">Tour: ${state.selectedTour.name}<br><span class="tbs-sub">${formatPrice(t.tourPerPax)} × ${state.passengers} ${paxLabel}</span></span>
          <span class="tbs-value">${formatPrice(t.tourTotal)}</span>
        </div>
        <div class="tbs-row tbs-total">
          <span class="tbs-label">Total (transfer + tour)</span>
          <span class="tbs-value">${formatPrice(t.final)}</span>
        </div>`;
      bundleEl.style.display = 'block';
    } else {
      bundleEl.style.display = 'none';
      bundleEl.innerHTML = '';
    }
  }

  // Refresh step 2 if visible
  const step2 = document.getElementById('step2');
  if (step2 && step2.style.display !== 'none') {
    const vdc = document.getElementById('vehicleDetailCards');
    if (vdc) vdc.innerHTML = buildVehicleDetailCards();
  }
}

// ─── VEHICLE CONFIG ──────────────────────────────────────────────────────────
// maxBags is realistic for full-size luggage. Most short trips, bag count
// roughly matches pax count; for surf/dive groups bags can drive vehicle choice.
const VEHICLES = [
  { key:'sedan',   icon:'🚗', name:'Sedan',   maxPax:3,  maxBags:3,  cap:'1–3 passengers',  shortName:'Private Sedan' },
  { key:'minivan', icon:'🚐', name:'Minivan',  maxPax:7,  maxBags:7,  cap:'4–7 passengers',  shortName:'Private Minivan' },
  { key:'minibus', icon:'🚌', name:'Minibus',  maxPax:12, maxBags:14, cap:'8–12 passengers', shortName:'Minibus' }
];

// Returns true if the vehicle can carry both the passengers and the luggage
function vehicleFits(v) {
  return state.passengers <= v.maxPax && state.luggage <= v.maxBags;
}

// Recommended vehicle considering BOTH passengers and luggage (the limiting factor)
function recommendedVehicle(pax, bags) {
  pax  = pax  ?? state.passengers ?? 1;
  bags = bags ?? state.luggage ?? 0;
  for (const v of VEHICLES) {
    if (pax <= v.maxPax && bags <= v.maxBags) return v.key;
  }
  return 'minibus'; // fallback for extreme cases
}

// ─── VEHICLE CARD HTML ───────────────────────────────────────────────────────
function buildVehicleCards() {
  const recommended = recommendedVehicle();
  return VEHICLES.map(v => {
    const fits     = vehicleFits(v);
    const isRec    = v.key === recommended;
    const cls = ['vehicle-card'];
    if (state.selectedVehicle === v.key) cls.push('selected');
    if (!fits)                           cls.push('disabled');
    if (isRec && fits)                   cls.push('recommended');
    // Why doesn't this fit?
    let warn = '';
    if (!fits) {
      if (state.passengers > v.maxPax)   warn = `Too small for ${state.passengers} pax`;
      else                               warn = `Not enough space for ${state.luggage} bags`;
    }
    const onclick = fits
      ? `onclick="selectVehicle('${v.key}',this)"`
      : `onclick="alertCapacity('${v.name}',${v.maxPax},${v.maxBags})"`;
    const badge = !fits
      ? `<div class="vehicle-badge warn">${warn}</div>`
      : (isRec ? `<div class="vehicle-badge rec">★ Recommended</div>` : '');
    // Show discounted price if the per-vehicle price alone qualifies
    const t = calculateTotal(v.key);
    const priceBlock = t.qualifies
      ? `<div class="vehicle-price"><span class="price-old">${formatPrice(t.subtotal)}</span> ${formatPrice(t.final)}</div>
         <div class="vehicle-price-sub">10% off applied</div>`
      : `<div class="vehicle-price">${formatPrice(state.prices[v.key])}</div>
         <div class="vehicle-price-sub">per vehicle</div>`;
    return `
      <div class="${cls.join(' ')}" ${onclick}>
        ${badge}
        <div class="vehicle-icon">${v.icon}</div>
        <div class="vehicle-name">${v.name}</div>
        <div class="vehicle-cap">${v.cap}<br><span class="vehicle-cap-sub">Up to ${v.maxBags} bags</span></div>
        ${priceBlock}
      </div>`;
  }).join('');
}

function buildVehicleDetailCards() {
  const recommended = recommendedVehicle();
  const details = {
    sedan:   { features:['Air-conditioned','Up to 3 bags','Direct to resort','30-min free wait'] },
    minivan: { features:['Air-conditioned','Up to 7 bags','Direct to resort','Child seat available','Wi-Fi on request'] },
    minibus: { features:['Air-conditioned','Up to 14 bags','Ideal for groups','Multiple drop-offs available'] }
  };
  return VEHICLES.map(v => {
    const fits  = vehicleFits(v);
    const isRec = v.key === recommended;
    const cls = ['vehicle-detail-card'];
    if (state.selectedVehicle === v.key) cls.push('selected');
    if (!fits)                           cls.push('disabled');
    if (isRec && fits)                   cls.push('recommended');
    let warn = '';
    if (!fits) {
      if (state.passengers > v.maxPax)   warn = `Too small for ${state.passengers} pax`;
      else                               warn = `Not enough space for ${state.luggage} bags`;
    }
    const onclick = fits
      ? `onclick="selectVehicleDetail('${v.key}',this)"`
      : `onclick="alertCapacity('${v.name}',${v.maxPax},${v.maxBags})"`;
    const badge = !fits
      ? `<div class="vehicle-badge warn">${warn}</div>`
      : (isRec ? `<div class="vehicle-badge rec">★ Recommended</div>` : '');
    const t = calculateTotal(v.key);
    const priceBlock = t.qualifies
      ? `<div class="vd-price"><span class="price-old">${formatPrice(t.subtotal)}</span> ${formatPrice(t.final)}<div class="vd-price-saving">You save ${formatPrice(t.discount)} (10% off)</div></div>`
      : `<div class="vd-price">${formatPrice(state.prices[v.key])}</div>`;
    return `
      <div class="${cls.join(' ')}" ${onclick}>
        ${badge}
        <div class="vd-icon">${v.icon}</div>
        <div class="vd-name">Private ${v.name}</div>
        <div class="vd-cap">Up to ${v.maxPax} passengers · ${v.maxBags} bags</div>
        <div class="vd-features">${details[v.key].features.map(f=>`<div class="vd-feature">${f}</div>`).join('')}</div>
        ${priceBlock}
      </div>`;
  }).join('');
}

function alertCapacity(vName, maxPax, maxBags) {
  const reasons = [];
  if (state.passengers > maxPax)   reasons.push(`${state.passengers} passengers (${vName} fits ${maxPax})`);
  if (state.luggage    > maxBags)  reasons.push(`${state.luggage} bags (${vName} fits ${maxBags})`);
  alert(`This vehicle is too small.\nYou have: ${reasons.join(' and ')}.\nPlease pick a larger vehicle.`);
}

function selectVehicle(key, el) {
  const v = VEHICLES.find(x => x.key === key);
  if (v && !vehicleFits(v)) { alertCapacity(v.name, v.maxPax, v.maxBags); return; }
  state.selectedVehicle = key;
  document.querySelectorAll('.vehicle-card').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
  const nb = document.getElementById('nextBtn1');
  if (nb) nb.disabled = false;
  // Tour bundle summary depends on which vehicle is selected — refresh it
  if (state.selectedTour) updatePricing();
}
function selectVehicleDetail(key, el) {
  const v = VEHICLES.find(x => x.key === key);
  if (v && !vehicleFits(v)) { alertCapacity(v.name, v.maxPax, v.maxBags); return; }
  state.selectedVehicle = key;
  document.querySelectorAll('.vehicle-detail-card').forEach(c => c.classList.remove('selected'));
  if (el) el.classList.add('selected');
  updateExtras();
}

// ─── EXTRAS ──────────────────────────────────────────────────────────────────
function updateExtras() {
  state.extrasTotal = 0;
  if (document.getElementById('extra-seat')?.checked) state.extrasTotal += 8;
  if (document.getElementById('extra-surf')?.checked) state.extrasTotal += 24;
  // Re-render vehicle cards so discount/total updates as add-ons toggle
  refreshAfterCapacityChange();
}

// ─── TRIP TYPE ────────────────────────────────────────────────────────────────
function setTripType(type, btn) {
  state.tripType = type;
  document.querySelectorAll('.trip-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (state.distanceKm > 0) updatePricing();
}

// ─── PAX / LUGGAGE ────────────────────────────────────────────────────────────
function refreshAfterCapacityChange() {
  // Auto-upgrade if current vehicle is now too small for either pax or bags
  if (state.selectedVehicle) {
    const v = VEHICLES.find(x => x.key === state.selectedVehicle);
    if (v && !vehicleFits(v)) {
      state.selectedVehicle = recommendedVehicle();
    }
  }
  const vc = document.getElementById('vehicleCards');
  if (vc && state.distanceKm > 0) vc.innerHTML = buildVehicleCards();
  const vdc = document.getElementById('vehicleDetailCards');
  const step2 = document.getElementById('step2');
  if (vdc && step2 && step2.style.display !== 'none') vdc.innerHTML = buildVehicleDetailCards();
  // Tour bundle total scales with passengers — re-run pricing so the summary
  // panel and confirmation card both reflect the new pax count.
  if (state.selectedTour) updatePricing();
}
function changePax(delta) {
  state.passengers = Math.max(1, Math.min(12, state.passengers + delta));
  const el = document.getElementById('paxNum');
  if (el) el.textContent = state.passengers;
  refreshAfterCapacityChange();
}
function changeLuggage(delta) {
  state.luggage = Math.max(0, Math.min(20, state.luggage + delta));
  const el = document.getElementById('luggageNum');
  if (el) el.textContent = state.luggage;
  refreshAfterCapacityChange();
}

// ─── SWAP LOCATIONS ──────────────────────────────────────────────────────────
function swapLocations() {
  const pSel = document.getElementById('pickup');
  const dSel = document.getElementById('destination');
  if (!pSel || !dSel) return;

  const pv = pSel.value, dv = dSel.value;

  // The pickup dropdown only contains 4 presets + CUSTOM_PICKUP, while destination
  // has a much larger list. If the destination value isn't valid for pickup,
  // fall back to forcing a custom-pickup with the existing dest details.
  let pickupSetOk = setSelectByValue('pickup', dv);
  if (!pickupSetOk) {
    setSelectByValue('pickup', 'CUSTOM_PICKUP');
    // Try to derive a zone from the destination
    const dOpt = dSel.options[dSel.selectedIndex];
    if (dOpt?.dataset?.area) {
      const zoneSel = document.getElementById('customPickupZone');
      // Match zone by area name
      const area = dOpt.dataset.area.toLowerCase();
      for (let i = 0; i < (zoneSel?.options.length || 0); i++) {
        if (zoneSel.options[i].text.toLowerCase().includes(area)) {
          zoneSel.selectedIndex = i; break;
        }
      }
      const addrInp = document.getElementById('customPickupAddress');
      if (addrInp) addrInp.value = dOpt.dataset.hotel || dOpt.text;
    }
  }

  setSelectByValue('destination', pv);
  togglePickupPanel();
  toggleDestPanel();
  updatePricing();
}

// ─── STEP NAVIGATION ─────────────────────────────────────────────────────────
function showStep(n) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step${i}`);
    if (el) el.style.display = (i === n) ? 'block' : 'none';
  }
  const succ = document.getElementById('stepSuccess');
  if (succ) succ.style.display = 'none';
  for (let i = 1; i <= 4; i++) {
    const ind = document.getElementById(`step-ind-${i}`);
    if (!ind) continue;
    ind.classList.remove('active','done');
    if (i === n) ind.classList.add('active');
    else if (i < n) ind.classList.add('done');
  }
}

function goToStep(n) {
  if (n === 4) {
    const fn = document.getElementById('firstName')?.value.trim();
    const ln = document.getElementById('lastName')?.value.trim();
    const em = document.getElementById('email')?.value.trim();
    const ph = document.getElementById('phone')?.value.trim();
    if (!fn || !ln || !em || !ph) { alert('Please fill in all required fields.'); return; }
    buildConfirmation();
  }
  if (n === 2) {
    if (!state.selectedVehicle) { alert('Please select a vehicle first.'); return; }
    // Capacity guard — checks both pax and luggage
    const v = VEHICLES.find(x => x.key === state.selectedVehicle);
    if (v && !vehicleFits(v)) {
      const rec = VEHICLES.find(x => x.key === recommendedVehicle());
      const reasons = [];
      if (state.passengers > v.maxPax)  reasons.push(`${state.passengers} passengers`);
      if (state.luggage    > v.maxBags) reasons.push(`${state.luggage} bags`);
      alert(`Your ${v.name} can't carry ${reasons.join(' and ')}. We've switched you to a ${rec.name}.`);
      state.selectedVehicle = rec.key;
    }
    const vdc = document.getElementById('vehicleDetailCards');
    if (vdc) vdc.innerHTML = buildVehicleDetailCards();
  }
  if (n === 3) {
    // Lock-in capacity check on confirm-vehicle step
    const v = VEHICLES.find(x => x.key === state.selectedVehicle);
    if (v && !vehicleFits(v)) {
      const reasons = [];
      if (state.passengers > v.maxPax)  reasons.push(`${state.passengers} pax (fits ${v.maxPax})`);
      if (state.luggage    > v.maxBags) reasons.push(`${state.luggage} bags (fits ${v.maxBags})`);
      alert(`This vehicle is too small: ${reasons.join(', ')}. Please pick a larger one.`);
      return;
    }
  }
  showStep(n);
  document.getElementById('booking')?.scrollIntoView({ behavior:'smooth', block:'start' });
}

// ─── TOUR BANNER ─────────────────────────────────────────────────────────────
// Two functions intentionally:
//   removeTourBannerDOM()  — strips the banner element only. Used internally
//                            by showTourBanner() to avoid duplicate banners.
//   removeTourBanner()     — full clear: strips DOM AND nulls state. Used by
//                            the customer-facing "✕ Clear" button.
//
// HISTORY: in v0.16 these were one function. showTourBanner() called
// removeTourBanner() to dedupe the DOM, which silently nulled state.selectedTour
// even when a tour was being selected. The new tour was set in state by
// selectTour() BEFORE showTourBanner() ran, then immediately wiped by the
// dedupe call inside it. Net result: tour visible in banner UI but invisible
// to calculateTotal(), so transfer-only price showed at confirmation.
// Caught when a real customer (James Derajan, NAN→Natadola horse riding)
// hit confirmation showing FJ$184 transfer-only with no tour line.
function removeTourBannerDOM() {
  document.getElementById('tourBanner')?.remove();
}
function showTourBanner(t) {
  removeTourBannerDOM();  // dedupe DOM only — must NOT touch state.selectedTour
  const banner = document.createElement('div');
  banner.id = 'tourBanner';
  banner.className = 'tour-banner';
  banner.innerHTML = `
    <div class="tour-banner-left">
      <span class="tour-banner-emoji">${t.emoji}</span>
      <div>
        <div class="tour-banner-label">Tour selected</div>
        <div class="tour-banner-name">${t.name}</div>
        <div class="tour-banner-meta">
          <span>⏱ ${t.duration}</span>
          <span>📍 ${t.route}</span>
          <span>👥 Min ${t.minPax} pax</span>
        </div>
      </div>
    </div>
    <div class="tour-banner-right">
      <div class="tour-banner-price">FJ$${t.price}<span>/person</span></div>
      <button class="tour-banner-clear" onclick="removeTourBanner()">✕ Clear</button>
    </div>`;
  const step1 = document.getElementById('step1');
  const firstRow = step1?.querySelector('.field-row');
  if (step1 && firstRow) step1.insertBefore(banner, firstRow);
}
function removeTourBanner() {
  removeTourBannerDOM();
  // Clear state so calculateTotal stops adding tour cost
  state.selectedTour = null;
  // Re-run pricing so the loyalty discount can re-qualify now that the
  // booking is transfer-only again.
  updatePricing();
}

// ─── SELECT TOUR → POPULATE BOOKING FORM ─────────────────────────────────────
function selectTour(idx) {
  const t = TOURS_DATA[idx];
  if (!t) return;
  const b = t.bookingData;

  // Stash the full tour entry in state. calculateTotal() reads this to add
  // the tour line to subtotal/final. Cleared by removeTourBanner().
  state.selectedTour = t;

  // Step 1: make booking form visible at step 1
  showStep(1);

  // Step 2: set selects
  setSelectByValue('pickup', b.pickupValue);
  setSelectByValue('destination', b.destValue);

  // Step 3: trip type buttons
  state.tripType = b.tripType || 'return';
  document.querySelectorAll('.trip-btn').forEach(btn => {
    const txt = btn.textContent.trim().toLowerCase();
    const active = state.tripType === 'return' ? txt.includes('return') : txt.includes('one');
    btn.classList.toggle('active', active);
  });

  // Step 4: passengers
  state.passengers = b.passengers || 2;
  const paxEl = document.getElementById('paxNum');
  if (paxEl) paxEl.textContent = state.passengers;

  // Step 5: notes
  const notesEl = document.getElementById('notes');
  if (notesEl) notesEl.value = b.notes || '';

  // Step 6: banner
  showTourBanner(t);

  // Hide custom panels (since selectTour uses preset options)
  togglePickupPanel();
  toggleDestPanel();

  // Step 7: trigger pricing after DOM settles
  setTimeout(updatePricing, 10);

  // Step 8: scroll up to booking form
  setTimeout(() => {
    document.getElementById('booking')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }, 50);
}

// ─── CONFIRMATION ────────────────────────────────────────────────────────────
function buildConfirmation() {
  const fn    = document.getElementById('firstName').value.trim();
  const ln    = document.getElementById('lastName').value.trim();
  const em    = document.getElementById('email').value.trim();
  const ph    = document.getElementById('phone').value.trim();
  const date  = document.getElementById('travelDate').value;
  const time  = document.getElementById('travelTime').value;
  const flight = document.getElementById('flightNum').value || '—';
  const notes  = document.getElementById('notes').value || '—';
  const vName  = { sedan:'Private Sedan', minivan:'Private Minivan', minibus:'Minibus' }[state.selectedVehicle];
  const t      = calculateTotal();
  const suffix = state.tripType === 'return' ? ' (return)' : ' (one-way)';
  const dateStr = date ? new Date(date+'T00:00:00').toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'long',year:'numeric'}) : '—';

  const card = document.getElementById('confirmationCard');
  if (!card) return;

  let totalRows = '';
  // Three cases:
  //  (a) Tour booking — show transfer line + tour line + total. No discount.
  //  (b) Transfer-only with discount qualified (subtotal > FJ$50).
  //  (c) Transfer-only, no discount (under threshold).
  if (t.hasTour) {
    const paxLabel = state.passengers === 1 ? 'person' : 'people';
    totalRows = `
      <div class="confirm-row"><span class="confirm-label">Transfer</span><span class="confirm-value">FJ$${t.transferSubtotal}</span></div>
      <div class="confirm-row"><span class="confirm-label">Tour: ${state.selectedTour.name} (FJ$${t.tourPerPax} × ${state.passengers} ${paxLabel})</span><span class="confirm-value">FJ$${t.tourTotal}</span></div>
      <div class="confirm-row total"><span class="confirm-label">Total price</span><span class="confirm-value price">FJ$${t.final}</span></div>`;
  } else if (t.qualifies) {
    totalRows = `
      <div class="confirm-row"><span class="confirm-label">Subtotal</span><span class="confirm-value">FJ$${t.subtotal}</span></div>
      <div class="confirm-row discount"><span class="confirm-label">★ 10% discount (orders FJ$50+)</span><span class="confirm-value">−FJ$${t.discount}</span></div>
      <div class="confirm-row total"><span class="confirm-label">Total price</span><span class="confirm-value price">FJ$${t.final}</span></div>`;
  } else {
    totalRows = `<div class="confirm-row total"><span class="confirm-label">Total price</span><span class="confirm-value price">FJ$${t.final}</span></div>`;
  }

  card.innerHTML = [
    ['Passenger',       `${fn} ${ln}`],
    ['Contact',         `${em} · ${ph}`],
    ['From',            stripEmoji(state.pickup?.name) || '—'],
    ['To',              stripEmoji(state.destination?.hotel) || '—'],
    ['Date & time',     `${dateStr} at ${time}`],
    ['Vehicle',         vName],
    ['Passengers',      `${state.passengers} adults · ${state.luggage} bags`],
    ['Flight number',   flight],
    ['Distance',        `${state.distanceKm.toFixed(1)} km · approx. ${formatDuration(state.durationMin)}`],
    ['Trip type',       suffix],
    ['Special requests',notes],
  ].map(([l,v]) => `<div class="confirm-row"><span class="confirm-label">${l}</span><span class="confirm-value">${v}</span></div>`).join('')
  + totalRows;
}

// ─── WHATSAPP MESSAGE ────────────────────────────────────────────────────────
function buildWhatsAppURL(ref) {
  const fn    = document.getElementById('firstName').value.trim();
  const ln    = document.getElementById('lastName').value.trim();
  const em    = document.getElementById('email').value.trim();
  const ph    = document.getElementById('phone').value.trim();
  const date  = document.getElementById('travelDate').value;
  const time  = document.getElementById('travelTime').value;
  const flight = document.getElementById('flightNum').value.trim() || 'Not provided';
  const notes  = document.getElementById('notes').value.trim() || 'None';
  const vName  = { sedan:'Private Sedan', minivan:'Private Minivan', minibus:'Minibus' }[state.selectedVehicle];
  const t      = calculateTotal();
  const tripLabel = state.tripType === 'return' ? 'Return' : 'One-way';
  const dateStr = date ? new Date(date+'T00:00:00').toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'long',year:'numeric'}) : 'Not set';
  const extras = [];
  if (document.getElementById('extra-lei')?.checked)  extras.push('Shell lei welcome');
  if (document.getElementById('extra-seat')?.checked) extras.push('Child/baby seat (+FJ$8)');
  if (document.getElementById('extra-stop')?.checked) extras.push('Supermarket stop');
  if (document.getElementById('extra-surf')?.checked) extras.push('Surfboard/oversized (+FJ$24)');

  const fromName = stripEmoji(state.pickup?.name) || '—';
  const toName   = stripEmoji(state.destination?.hotel) || '—';
  const areaName = stripEmoji(state.destination?.area)  || '—';

  // Build the price block — three cases:
  //  (a) Tour booking — show transfer + tour line + total. No discount applies.
  //  (b) Transfer-only with discount qualified.
  //  (c) Transfer-only, no discount.
  let priceLines;
  if (t.hasTour) {
    const paxLabel = state.passengers === 1 ? 'person' : 'people';
    priceLines = [
      `Transfer:    FJ$${t.transferSubtotal}`,
      `Tour (${state.passengers} ${paxLabel}): FJ$${t.tourPerPax}/pp × ${state.passengers} = FJ$${t.tourTotal}`,
      `=====================================`,
      `*TOTAL PRICE: FJ$${t.final}*`,
    ];
  } else if (t.qualifies) {
    priceLines = [
      `Subtotal:    FJ$${t.subtotal}`,
      `Discount:    -FJ$${t.discount} (10% off, orders FJ$50+)`,
      `=====================================`,
      `*TOTAL PRICE: FJ$${t.final}*`,
    ];
  } else {
    priceLines = [
      `=====================================`,
      `*TOTAL PRICE: FJ$${t.final}*`,
    ];
  }

  // When a tour is in the booking, add a dedicated section above the price
  // block so the driver-coordinator sees the tour name clearly. The notes
  // field already contains 'TOUR BOOKING: ...' from selectTour() but a
  // dedicated section is more reliable than relying on free-text notes.
  const tourSection = t.hasTour
    ? [
        ``,
        `*TOUR BOOKED*`,
        `-------------------------------------`,
        `Tour:       ${state.selectedTour.name}`,
        `Duration:   ${state.selectedTour.duration}`,
        `Per person: FJ$${t.tourPerPax} (min ${state.selectedTour.minPax} pax)`,
      ]
    : [];

  const msg = [
    `*NEW BOOKING REQUEST*`,
    `Fiji Tour Transfers`,
    `Booking ref: *${ref}*`,
    `=====================================`,``,
    `*PASSENGER DETAILS*`,
    `-------------------------------------`,
    `Name:     ${fn} ${ln}`,
    `Email:    ${em}`,
    `WhatsApp: ${ph}`,``,
    `*JOURNEY*`,
    `-------------------------------------`,
    `From:     ${fromName}`,
    `To:       ${toName}`,
    `Area:     ${areaName}`,
    `Date:     ${dateStr}`,
    `Pickup:   ${time}`,
    `Trip:     ${tripLabel}`,
    `Distance: ${state.distanceKm.toFixed(1)} km · approx. ${formatDuration(state.durationMin)}`,``,
    `*VEHICLE & PASSENGERS*`,
    `-------------------------------------`,
    `Vehicle:    ${vName}`,
    `Passengers: ${state.passengers} adult(s)`,
    `Luggage:    ${state.luggage} bag(s)`,
    `Flight:     ${flight}`,
    `Add-ons:    ${extras.length ? extras.join(', ') : 'None'}`,``,
    `*SPECIAL REQUESTS*`,
    `-------------------------------------`,
    notes, ``,
    ...tourSection,
    ``,
    ...priceLines,
    `=====================================`, ``,
    `Please confirm availability and payment options.`,
    `Vinaka!`
  ].join('\n');

  return `https://wa.me/61478886145?text=${encodeURIComponent(msg)}`;
}

// ─── CONFIRM BOOKING ─────────────────────────────────────────────────────────
function confirmBooking() {
  // A1: Soft-required flight number for Nadi Airport arrivals.
  // We don't block submission, but if pickup is NAN and the customer left
  // the flight field blank, we surface a one-time confirmation prompt.
  // Pattern matches Welcome Pickups and Klook airport flows.
  const pickupVal = document.getElementById('pickup')?.value;
  const flightVal = document.getElementById('flightNum')?.value.trim();
  if (pickupVal === 'NAN' && !flightVal && !state.flightPromptDismissed) {
    const proceed = confirm(
      'No flight number entered.\n\n'
      + 'We monitor incoming flights so the driver adjusts pickup time '
      + 'automatically if you\'re delayed. Without it, your driver may '
      + 'arrive before you clear customs.\n\n'
      + 'Continue anyway?'
    );
    if (!proceed) {
      // Focus the field so they can fill it in
      document.getElementById('flightNum')?.focus();
      document.getElementById('flightNum')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // They chose to proceed — don't ask again in this booking
    state.flightPromptDismissed = true;
  }

  // Generate the booking reference
  const ref = 'FTT-' + Date.now().toString(36).toUpperCase().slice(-6);

  // Pre-build the WhatsApp URL with the full booking details
  const waUrl = buildWhatsAppURL(ref);

  // Pull customer first name for personalised greeting
  const firstName = document.getElementById('firstName')?.value.trim().split(/\s+/)[0] || 'friend';

  // Populate the Bula success card
  const bulaName = document.getElementById('bulaName');
  if (bulaName) bulaName.textContent = firstName;
  const bulaRef = document.getElementById('bulaRef');
  if (bulaRef) bulaRef.textContent = `Booking ref: ${ref}`;
  const bulaWaBtn = document.getElementById('bulaWaBtn');
  if (bulaWaBtn) bulaWaBtn.href = waUrl;

  // A2: pre-fill the modification link with the booking ref so the customer
  // doesn't have to retype it. Driver coordinator gets a clear request.
  const bulaModifyLink = document.getElementById('bulaModifyLink');
  if (bulaModifyLink) {
    const modifyText = `Hi Fiji Tour Transfers, I'd like to modify booking ${ref}. The change I need is:`;
    bulaModifyLink.href = `https://wa.me/61478886145?text=${encodeURIComponent(modifyText)}`;
  }

  // Hide the entire booking widget, show the Bula success card
  const widget = document.getElementById('bookingWidget');
  if (widget) widget.style.display = 'none';
  const bula = document.getElementById('bulaSuccess');
  if (bula) bula.style.display = 'block';

  // Scroll to the top of the booking section so the success card is centered
  document.getElementById('booking')?.scrollIntoView({ behavior:'smooth', block:'start' });

  // MILESTONE 11/12: also create a real driver-marketplace booking - the
  // actual point of this integration is real guest bookings reaching real
  // online drivers, not just replicating the existing WhatsApp message.
  // Scoped to exactly the two airport-anchored cases /quote can reliably
  // resolve: pickup === 'NAN' (arriving guest, Milestone 11) or pickup ===
  // 'CUSTOM_PICKUP' && destination === 'NAN' (departing guest, Milestone
  // 12). Every other combination is out of scope (see the section note
  // above). Fire-and-forget: never blocks or alters what the guest sees
  // above, and a failure here is never surfaced to them - the WhatsApp
  // confirmation already sent is their real, working confirmation regardless.
  const destValForSync = document.getElementById('destination')?.value;
  if (pickupVal === 'NAN' || (pickupVal === 'CUSTOM_PICKUP' && destValForSync === 'NAN')) {
    submitMarketplaceBooking(ref).catch(() => {});
  }
}

// Resolves the destination_zone for THIS specific confirm - computed fresh
// here rather than trusted from state, since state.destZoneName means two
// different things depending on destination type (see updatePricing()).
function resolveConfirmedDestinationZone() {
  const destVal = document.getElementById('destination')?.value;
  if (destVal === 'CUSTOM_DEST') {
    const addr = document.getElementById('customDestAddress')?.value.trim();
    const q = state.quoteResult;
    return (addr && q && q.forAddress === addr && q.outcome === 'resolved') ? q.nearestZoneName : null;
  }
  return state.destZoneName;
}

// MILESTONE 12: resolves the pickup_zone needed for POST /bookings, for
// THIS specific confirm. Mirrors resolveConfirmedDestinationZone() above,
// but pickup only ever has two marketplace-synced real cases: the fixed
// Nadi Airport (arriving guest, existing behaviour, was previously
// hardcoded inline) or a departing guest's custom address once /quote has
// resolved it. Every other pickup returns null, matching the existing
// scope boundary - submitMarketplaceBooking() skips the sync entirely
// when this comes back empty.
function resolveConfirmedPickupZone() {
  const pickupVal = document.getElementById('pickup')?.value;
  if (pickupVal === 'NAN') return 'Nadi Airport';
  if (pickupVal === 'CUSTOM_PICKUP') {
    const addr = document.getElementById('customPickupAddress')?.value.trim();
    const q = state.pickupQuoteResult;
    return (addr && q && q.forAddress === addr && q.outcome === 'resolved') ? q.nearestZoneName : null;
  }
  return null;
}

async function submitMarketplaceBooking(ref) {
  const pickupZone = resolveConfirmedPickupZone();
  const destinationZone = resolveConfirmedDestinationZone();
  const t = calculateTotal();
  const firstName = document.getElementById('firstName')?.value.trim() || '';
  const lastName  = document.getElementById('lastName')?.value.trim() || '';
  const phone     = document.getElementById('phone')?.value.trim() || '';

  if (!pickupZone || !destinationZone || !state.selectedVehicle || !t.final) {
    // Not enough real, verified data to create a correct booking - skip
    // rather than send a guess. The guest's WhatsApp confirmation is
    // unaffected either way.
    return;
  }

  const payload = {
    guest_name: `${firstName} ${lastName}`.trim() || 'Guest',
    guest_phone: phone,
    pickup_zone: pickupZone,
    destination_zone: destinationZone,
    vehicle_type: state.selectedVehicle,
    quoted_currency: 'FJD', // charging is always FJD - see the A4 currency-toggle note above
    quoted_amount: t.final,
    fx_rate_at_booking: 1,
    distance_km: state.distanceKm,
    payment_method: 'cash', // no payment is collected on this site today - guest pays the driver directly
  };

  try {
    const res = await fetch(`${NADI_API_BASE}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) await reportBookingSyncFailure(ref, payload, data);
  } catch (err) {
    await reportBookingSyncFailure(ref, payload, { error: err.message });
  }
}

// Never lets a failed marketplace-booking sync go unnoticed - fires a real
// escalation so a human sees it, the same fallback pattern the backend
// itself already uses for its own failure modes. Never shown to the guest;
// their WhatsApp confirmation is the real, working path regardless.
async function reportBookingSyncFailure(ref, payload, errorDetail) {
  try {
    await fetch(`${NADI_API_BASE}/escalate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'guest',
        trigger_type: 'app_issue',
        context: `POST /bookings failed for confirmed guest booking ${ref} (WhatsApp confirmation still sent). Payload: ${JSON.stringify(payload)}. Error: ${JSON.stringify(errorDetail)}`.slice(0, 2000),
      }),
    });
  } catch (err) {
    // Last line of defense - nothing more to do client-side if even the
    // escalation call fails.
  }
}

// Reset the booking flow without a full page reload — closes the Bula card
// and reopens the booking widget, fresh state.
function resetBooking() {
  // Hide Bula success
  const bula = document.getElementById('bulaSuccess');
  if (bula) bula.style.display = 'none';

  // Show booking widget again
  const widget = document.getElementById('bookingWidget');
  if (widget) widget.style.display = '';

  // Reset state — easiest path is full reload to clear all form fields,
  // selects, custom panels, vehicle selection, and pricing
  location.reload();
}

// ─── ROUTES TABLE DATA — distances/prices match the tiered TIER pricing ─────
// destValue maps to an <option> value in the destination <select> so the
// "Book →" button can pre-fill the form. Choose the most representative
// hotel for grouped rows (e.g., "Hilton / Sheraton / Westin" → HILTON_DENARAU).
const ROUTES_DATA = [
  // Nadi & Wailoaloa
  { destValue:"NADI_DOWNTOWN",          dest:"Nadi Town Centre",                    area:"Nadi",            km:5,   time:"13 min",      s:19,  v:49,  m:79  },
  { destValue:"TANOA_INTERNATIONAL",    dest:"Tanoa International / Tokatoka",      area:"Nadi Airport",    km:2,   time:"8 min",       s:15,  v:25,  m:45  },
  { destValue:"MERCURE_NADI",           dest:"Mercure / Tradewinds Hotel",          area:"Nadi",            km:5,   time:"13 min",      s:19,  v:49,  m:79  },
  { destValue:"WAILOALOA_BEACH",        dest:"Wailoaloa Beach Hotels",              area:"Wailoaloa",       km:8,   time:"17 min",      s:39,  v:59,  m:89  },
  { destValue:"CROWNE_PLAZA_NADI_BAY",  dest:"Crowne Plaza / Smugglers / Ramada",   area:"Wailoaloa",       km:8,   time:"17 min",      s:39,  v:59,  m:89  },
  // Denarau
  { destValue:"HILTON_DENARAU",         dest:"Hilton / Sheraton / Westin Denarau",  area:"Denarau",         km:12,  time:"22 min",      s:49,  v:69,  m:99  },
  { destValue:"SOFITEL_DENARAU",        dest:"Sofitel / Radisson / Wyndham",        area:"Denarau",         km:12,  time:"22 min",      s:49,  v:69,  m:99  },
  { destValue:"PORT_DENARAU_MARINA",    dest:"Port Denarau Marina (Yasawa Flyer)",  area:"Denarau",         km:13,  time:"23 min",      s:49,  v:69,  m:99  },
  // Sonaisali / Vuda
  { destValue:"DOUBLETREE_SONAISALI",   dest:"DoubleTree Sonaisali Island",         area:"Sonaisali",       km:18,  time:"28 min",      s:69,  v:89,  m:119 },
  { destValue:"FIRST_LANDING",          dest:"First Landing Beach Resort",          area:"Vuda Point",      km:22,  time:"32 min",      s:79,  v:99,  m:129 },
  { destValue:"VUDA_MARINA",            dest:"Vuda Marina (Yacht Haven)",           area:"Vuda Point",      km:20,  time:"30 min",      s:79,  v:99,  m:129 },
  // Lautoka
  { destValue:"LAUTOKA_HOTEL",          dest:"Lautoka City Centre",                 area:"Lautoka",         km:28,  time:"38 min",      s:89,  v:119, m:149 },
  { destValue:"TANOA_LAUTOKA",          dest:"Tanoa Waterfront / Cathay Lautoka",   area:"Lautoka",         km:28,  time:"38 min",      s:89,  v:119, m:149 },
  { destValue:"LAUTOKA_CRUISE",         dest:"Lautoka Cruise Terminal",             area:"Lautoka",         km:30,  time:"40 min",      s:89,  v:119, m:149 },
  // Momi / Natadola
  { destValue:"MARRIOTT_MOMI",          dest:"Fiji Marriott Resort Momi Bay",       area:"Momi Bay",        km:42,  time:"52 min",      s:99,  v:149, m:79  },
  { destValue:"INTERCONTINENTAL_NATADOLA", dest:"InterContinental Natadola / Yatule", area:"Natadola",      km:38,  time:"48 min",      s:99,  v:149, m:179 },
  { destValue:"ROBINSON_CRUSOE",        dest:"Robinson Crusoe Island (Likuri)",     area:"Natadola",        km:50,  time:"58 min",      s:99,  v:149, m:179 },
  // Sigatoka
  { destValue:"SIGATOKA_SAND_DUNES",    dest:"Sigatoka Town / Sand Dunes",          area:"Sigatoka",        km:60,  time:"1 hr 6 min",  s:129, v:159, m:199 },
  { destValue:"BEDARRA_INN",            dest:"Bedarra / Gecko's / Sandy Point",     area:"Sigatoka",        km:62,  time:"1 hr 8 min",  s:129, v:159, m:199 },
  { destValue:"KULA_ECO",               dest:"Kula Wild Adventure Park",            area:"Sigatoka",        km:62,  time:"1 hr 8 min",  s:129, v:159, m:199 },
  // Coral Coast
  { destValue:"SHANGRI_LA_YANUCA",      dest:"Shangri-La Yanuca Island",            area:"Coral Coast",     km:72,  time:"1 hr 16 min", s:129, v:159, m:199 },
  { destValue:"HIDEAWAY_RESORT",        dest:"Hideaway Resort / Tambua Sands",      area:"Coral Coast",     km:90,  time:"1 hr 30 min", s:129, v:159, m:199 },
  { destValue:"CRUSOES_RETREAT",        dest:"Crusoe's Retreat / Mango Bay",        area:"Coral Coast",     km:93,  time:"1 hr 32 min", s:129, v:159, m:199 },
  { destValue:"OUTRIGGER_FIJI",         dest:"Outrigger Fiji Beach Resort",         area:"Coral Coast",     km:98,  time:"1 hr 36 min", s:129, v:159, m:199 },
  { destValue:"THE_WARWICK",            dest:"The Warwick / The Naviti",            area:"Coral Coast",     km:100, time:"1 hr 38 min", s:149, v:189, m:239 },
  { destValue:"BEACHHOUSE_FIJI",        dest:"The Beachouse Fiji",                  area:"Coral Coast",     km:115, time:"1 hr 50 min", s:169, v:199, m:259 },
  // Pacific Harbour
  { destValue:"ARTS_VILLAGE",           dest:"Pacific Harbour Arts Village",        area:"Pacific Harbour", km:145, time:"2 hr 14 min", s:199, v:269, m:299 },
  { destValue:"PEARL_SOUTH_PACIFIC",    dest:"Pearl South Pacific Resort",          area:"Pacific Harbour", km:145, time:"2 hr 14 min", s:199, v:269, m:299 },
  { destValue:"UPRISING",               dest:"Uprising Beach Resort",               area:"Pacific Harbour", km:147, time:"2 hr 16 min", s:199, v:269, m:299 },
  { destValue:"NANUKU_RESORT",          dest:"Nanuku Resort Fiji (Auberge)",        area:"Pacific Harbour", km:150, time:"2 hr 18 min", s:199, v:269, m:299 },
  // North
  { destValue:"BA_HOTEL",               dest:"Ba Town",                             area:"Ba",              km:58,  time:"1 hr 4 min",  s:169, v:199, m:249 },
  { destValue:"VOLIVOLI_BEACH",         dest:"Volivoli / Wananavu Beach Resort",    area:"Rakiraki",        km:135, time:"2 hr 6 min",  s:249, v:299, m:349 },
  // Suva
  { destValue:"GRAND_PACIFIC",          dest:"Grand Pacific Hotel Suva",            area:"Suva",            km:198, time:"2 hr 56 min", s:319, v:369, m:499 },
  { destValue:"TANOA_PLAZA_SUVA",       dest:"Tanoa Plaza / Holiday Inn Suva",      area:"Suva",            km:198, time:"2 hr 56 min", s:319, v:369, m:499 },
  { destValue:"NAUSORI_AIRPORT",        dest:"Nausori Airport (SUV)",               area:"Nausori",         km:225, time:"3 hr 18 min", s:369, v:499, m:549 },
];

function buildRoutesTable() {
  const tbody = document.getElementById('routesTableBody');
  if (!tbody) return;
  function priceCell(price) {
    if (price > DISCOUNT_THRESHOLD) {
      const discounted = price - Math.round(price * DISCOUNT_RATE);
      return `<span class="price-old">${formatPrice(price)}</span><strong>${formatPrice(discounted)}</strong>`;
    }
    return `<strong>${formatPrice(price)}</strong>`;
  }
  tbody.innerHTML = ROUTES_DATA.map((r, i) => `
    <tr>
      <td>${r.dest}<br><span class="area-badge">${r.area}</span></td>
      <td>${r.km} km</td>
      <td>${r.time}</td>
      <td>${priceCell(r.s)}</td>
      <td>${priceCell(r.v)}</td>
      <td>${priceCell(r.m)}</td>
      <td><button class="btn-book" onclick="bookRoute(${i})">Book →</button></td>
    </tr>`).join('');
}

// Pre-fills the booking form with a route from the table and scrolls to it
function bookRoute(idx) {
  const r = ROUTES_DATA[idx];
  if (!r) return;

  // Default pickup is Nadi Airport (the published rates assume that origin).
  // Custom panels closed.
  setSelectByValue('pickup', 'NAN');
  togglePickupPanel();

  // Destination: the route's mapped option in the destination dropdown.
  const destOk = setSelectByValue('destination', r.destValue);
  toggleDestPanel();

  if (!destOk) {
    console.warn('bookRoute: destValue not found in dropdown:', r.destValue);
  }

  // Default to one-way (matches the published per-vehicle prices in the table)
  state.tripType = 'one-way';
  document.querySelectorAll('.trip-btn').forEach(btn => {
    const txt = btn.textContent.trim().toLowerCase();
    btn.classList.toggle('active', txt.includes('one'));
  });

  // Make sure step 1 is visible (the pickup/dest fields live in step 1)
  showStep(1);

  // Recalculate price for the new route
  setTimeout(updatePricing, 10);

  // Scroll up to the booking section with a brief highlight flash
  setTimeout(() => {
    const booking = document.getElementById('booking');
    if (booking) {
      booking.scrollIntoView({ behavior:'smooth', block:'start' });
      const card = booking.querySelector('.booking-card');
      if (card) {
        card.classList.add('flash-highlight');
        setTimeout(() => card.classList.remove('flash-highlight'), 1500);
      }
    }
  }, 50);
}

// ─── TOURS DATA — 16 featured tours from fijitourtransfers.com ───────────────
// Pricing converted from live AU$ on the main site to FJD at 1.45x.
// `liveUrl` links to the live tour page on fijitourtransfers.com.
// `image` references the actual hero image used on the live site.
// `bookingData` powers the auto-fill into the transfer booking form.
const TOURS_DATA = [
  {
    name:'Nadi Cultural Night Tour',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/04/Nadi-Cultural-Night-Tour-Fiji-Up-to-15-Off-6-870x555-1-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/nadi-cultural-night-tour-fiji-up-to-15-off/',
    label:'Cultural Experience', labelColor:'#dc2626', bg:'#fef2f2', emoji:'🌺',
    desc:'Sevusevu kava welcome, traditional meke dance performance, lovo earth-oven feast, village walk and Fijian storytelling.',
    duration:'4 hrs evening', minPax:2,
    price:196, oldPrice:230, discount:'15% OFF',
    route:'From Nadi & Denarau hotels',
    bookingData:{
      pickupValue:'NAN', destValue:'SIGATOKA_TOWN', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Nadi Cultural Night Tour (4 hrs). Kava ceremony, meke, lovo dinner. Please confirm pickup time and number of guests.'
    }
  },
  {
    name:'Natadola Beach Horse Riding',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/04/Natadola-Beach-Horse-Riding-Fiji-–-AU95-2-870x555-1-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/natadola-beach-horse-riding-fiji-au95/',
    label:'Beach Adventure', labelColor:'#0891b2', bg:'#ecfeff', emoji:'🐎',
    desc:'Guided horse ride along iconic Natadola Beach. Suits all riding levels — confident horses, expert local guides, world-class views.',
    duration:'50 minutes', minPax:1,
    price:138,
    route:'Natadola Beach (transfer add-on available)',
    bookingData:{
      pickupValue:'NAN', destValue:'INTERCONTINENTAL_NATADOLA', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Natadola Beach Horse Riding (50 min). Please advise riding experience level and rider weights.'
    }
  },
  {
    name:'Natadola Beach Cross Country Horse Riding',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/04/Natadola-Beach-Cross-Country-Horse-Riding-Fiji-3-870x555-1-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/natadola-beach-cross-country-horse-riding-fiji/',
    label:'Beach + Country', labelColor:'#0891b2', bg:'#ecfeff', emoji:'🐴',
    desc:'Beach gallop combined with cross-country trail through cane fields, native bush and traditional villages. Longer ride for confident riders.',
    duration:'1 hour', minPax:1,
    price:181,
    route:'Natadola Beach',
    bookingData:{
      pickupValue:'NAN', destValue:'INTERCONTINENTAL_NATADOLA', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Natadola Cross Country Horse Riding (1 hr). Please advise riding experience and weights.'
    }
  },
  {
    name:'Coral Coast Beach Horse Riding',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/04/Coral-Coast-Beach-Horse-Riding-Tour-Fiji-1-1-870x555-1-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/coral-coast-beach-horse-riding-tour-fiji/',
    label:'Premium Beach Ride', labelColor:'#0891b2', bg:'#ecfeff', emoji:'🌅',
    desc:'Premium horse ride along the pristine Coral Coast. Hotel pickup from Shangri-La, Outrigger, Warwick, Naviti & all major Coral Coast resorts.',
    duration:'1 hour', minPax:1,
    price:138, oldPrice:184, discount:'25% OFF',
    route:'Coral Coast (Shangri-La to Warwick)',
    bookingData:{
      pickupValue:'NAN', destValue:'OUTRIGGER_FIJI', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Coral Coast Beach Horse Riding (1 hr). Please advise current resort, riding experience and rider weights.'
    }
  },
  {
    name:'Biausevu Waterfall & Village Trek',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/04/484951001_1065235435650745_1627320383873036326_n-870x555-2-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/biausevu-waterfall-hiking-tour-in-sigatoka-fiji/',
    label:'Waterfall Hike', labelColor:'#0d9488', bg:'#f0fdfa', emoji:'💦',
    desc:'Jungle hike to spectacular Biausevu waterfall (waterfall swim included), kava ceremony at Biausevu village, village walk and traditional lunch.',
    duration:'3 hrs', minPax:2,
    price:271, oldPrice:387, discount:'30% OFF',
    route:'Sigatoka',
    bookingData:{
      pickupValue:'NAN', destValue:'BEDARRA_INN', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Biausevu Waterfall & Village Trek (3 hrs). Hike, swim & village lunch. Please advise fitness level and group size.'
    }
  },
  {
    name:'Sigatoka River Cruise + Biausevu Waterfall',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/04/3333-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/sigatoka-river-cruise-tour-biausevu-waterfall-tour/',
    label:'Combo Day Tour', labelColor:'#0d9488', bg:'#f0fdfa', emoji:'🛶',
    desc:'Long-boat cruise up the Sigatoka River to Tau village, kava ceremony, jungle waterfall hike at Biausevu, traditional Fijian lunch. Two iconic tours, one day.',
    duration:'6 hrs', minPax:2,
    price:218,
    route:'Sigatoka',
    bookingData:{
      pickupValue:'NAN', destValue:'SIGATOKA_SAND_DUNES', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Sigatoka River Cruise + Biausevu Waterfall combo (6 hrs). Please advise number of guests.'
    }
  },
  {
    name:'Coral Coast Full Day Experience',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/04/Coral-Coast-Full-Day-Tour-2-1-870x555-1.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/coral-coast-full-day-tour-fiji/',
    label:'Full Day Tour', labelColor:'#1d4ed8', bg:'#eff6ff', emoji:'🌊',
    desc:'Sigatoka Sand Dunes + Kula Wild Adventure Park + Biausevu village kava ceremony + beach time on the Coral Coast. Lunch included.',
    duration:'6 hrs', minPax:1,
    price:174,
    route:'From Nadi or Denarau',
    bookingData:{
      pickupValue:'NAN', destValue:'SHANGRI_LA_YANUCA', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Coral Coast Full Day Experience (6 hrs). Sigatoka Sand Dunes + Kula Wild + village kava + beach + lunch included.'
    }
  },
  {
    name:'Nadi Zip Line Tour',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/04/Nadi-Zip-Line-Tour-Fiji-2024-2-870x555-1-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/nadi-zip-line-tour-fiji-2025/',
    label:'Adventure', labelColor:'#b91c1c', bg:'#fef2f2', emoji:'🪂',
    desc:'Zip line adventure through Sleeping Giant rainforest in the Nadi hills. 5 platforms, 16 lines, jungle canopy views. All safety gear and instruction included.',
    duration:'3 hrs', minPax:1,
    price:320, oldPrice:355, discount:'10% OFF',
    route:'From Nadi & Denarau hotels',
    bookingData:{
      pickupValue:'NAN', destValue:'NADI_DOWNTOWN', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Nadi Zip Line Tour (3 hrs). 16 zip lines through rainforest canopy. Please advise weights (45-120kg limit) and ages.'
    }
  },
  {
    name:'Nausori Highland Off-Road ATV Adventure',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/04/453222176_122149630076247556_7809408372744184951_n-870x555-1-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/nausori-highland-off-road-atv-bike-adventure-fiji/',
    label:'High-Adrenaline', labelColor:'#b91c1c', bg:'#fef2f2', emoji:'🏍',
    desc:'ATV bike adventure through Nausori Highlands rainforest, river crossings, mountain views and remote villages. Driver instruction provided.',
    duration:'5 hrs', minPax:1,
    price:434, oldPrice:619, discount:'30% OFF',
    route:'From Nadi & Denarau',
    bookingData:{
      pickupValue:'NAN', destValue:'NADI_DOWNTOWN', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Nausori Highland Off-Road ATV (5 hrs). Please advise number of riders, ages and any prior ATV experience.'
    }
  },
  {
    name:'Snorkel with Sharks',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/03/WhatsApp-Image-2026-01-23-at-14.10.04-870x555-1-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/snorkel-with-sharks-in-fiji/',
    label:'Marine Adventure', labelColor:'#0e7490', bg:'#ecfeff', emoji:'🦈',
    desc:'Snorkel with reef sharks in their natural habitat. Smaller, less intense alternative to the famous Beqa Lagoon dive — perfect for non-divers.',
    duration:'4 hrs', minPax:2,
    price:244,
    route:'From Pacific Harbour or transfer included',
    bookingData:{
      pickupValue:'NAN', destValue:'PEARL_SOUTH_PACIFIC', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Snorkel with Sharks (4 hrs). Please advise swimming ability and snorkelling experience for all guests.'
    }
  },
  {
    name:'Mamanuca Islands All-Inclusive Sailing Cruise',
    image:'https://fijitourtransfers.com/wp-content/uploads/2025/02/Whales_Tale_fish_feeding_006_med-900x600.jpg',
    liveUrl:'https://fijitourtransfers.com/st_tour/fiji-mamanuca-islands-all-inclusive-sailing-cruise/',
    label:'Island Cruise', labelColor:'#0369a1', bg:'#f0f9ff', emoji:'⛵',
    desc:'Full-day sailing cruise through the Mamanucas. Fish feeding, snorkelling, lunch on board, drinks included. Departs Port Denarau.',
    duration:'7 hrs', minPax:1,
    price:262,
    route:'Departs Port Denarau Marina',
    bookingData:{
      pickupValue:'NAN', destValue:'PORT_DENARAU_MARINA', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Mamanuca Islands Sailing Cruise (7 hrs). Departs Port Denarau. Please advise current hotel for transfer.'
    }
  },
  {
    name:'Whale\'s Tale Cruises (Denarau)',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/03/480423163_567337009674871_1228509504795453619_n-900x600.jpg',
    liveUrl:'https://fijitourtransfers.com/st_tour/whales-tale-day-cruise/',
    label:'Premium Day Cruise', labelColor:'#0369a1', bg:'#f0f9ff', emoji:'🚢',
    desc:'Premium full-day cruise to a private island in the Mamanucas. Gourmet lunch, premium drinks, snorkelling, beach access. Adults-only experience.',
    duration:'7 hrs', minPax:1,
    price:361,
    route:'Departs Port Denarau Marina',
    bookingData:{
      pickupValue:'NAN', destValue:'PORT_DENARAU_MARINA', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Whale\'s Tale Day Cruise (7 hrs). Departs Port Denarau. Please advise current hotel for transfer and number of adults.'
    }
  },
  {
    name:'Naihehe Cave Tour (Sigatoka)',
    image:'https://fijitourtransfers.com/wp-content/uploads/2024/03/Explore-Naihehe-Cave-Tour-Sigatoka-Fiji-4-870x555-1-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/explore-nahehe-cave-tour-sigatoka-fiji/',
    label:'Cultural Adventure', labelColor:'#7c3aed', bg:'#faf5ff', emoji:'🦇',
    desc:'Explore the largest cave in Fiji, once a hideout for Fijian warriors. Includes longboat upriver journey, village kava ceremony and cave torch-lit exploration.',
    duration:'3 hrs', minPax:2,
    price:232,
    route:'From Sigatoka & Coral Coast',
    bookingData:{
      pickupValue:'NAN', destValue:'BEDARRA_INN', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Naihehe Cave Tour (3 hrs). Please advise current hotel for transfer.'
    }
  },
  {
    name:'Sabeto Hot Springs & Mud Pool',
    image:'https://fijitourtransfers.com/wp-content/uploads/2026/03/39-870x555-1-870x555-1-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/mud-pool-tour-fiji/',
    label:'Wellness', labelColor:'#9333ea', bg:'#faf5ff', emoji:'♨',
    desc:'Soak in natural geothermal mud pools and warm springs nestled at the foot of the Sleeping Giant. Includes Sabeto Garden of the Sleeping Giant orchid garden visit.',
    duration:'4 hrs', minPax:1,
    price:276,
    route:'From Nadi & Denarau hotels',
    bookingData:{
      pickupValue:'NAN', destValue:'NADI_DOWNTOWN', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Sabeto Hot Springs & Mud Pool Tour (4 hrs). Please advise current hotel and number of guests.'
    }
  },
  {
    name:'Suva City Day Tour',
    image:'https://fijitourtransfers.com/wp-content/uploads/2023/10/Kava-fruit-marekt-1-675x450253-1-1-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/suva-city-tour/',
    label:'City Tour', labelColor:'#1e40af', bg:'#eff6ff', emoji:'🌇',
    desc:'Explore Fiji\'s capital — Government Buildings, Albert Park, Thurston Gardens, Fiji Museum, Suva Municipal Market and the Grand Pacific Hotel.',
    duration:'2 hrs in Suva (full day with transfer)', minPax:1,
    price:261,
    route:'From Pacific Harbour & Coral Coast',
    bookingData:{
      pickupValue:'NAN', destValue:'GRAND_PACIFIC', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Suva City Day Tour (2 hrs in Suva, full day with transfer). Please advise current hotel and group size.'
    }
  },
  {
    name:'Sigatoka Coastal Fishing Charter',
    image:'https://fijitourtransfers.com/wp-content/uploads/2024/03/501019817_734191625790448_8981032551289993391_n-900x600.webp',
    liveUrl:'https://fijitourtransfers.com/st_tour/sigatoka-coastal-fishing-charter-fiji/',
    label:'Fishing Charter', labelColor:'#0e7490', bg:'#ecfeff', emoji:'🎣',
    desc:'Coastal fishing charter for tuna, mahi-mahi, walu and trevally. All gear and bait provided. Half-day options available.',
    duration:'3 hrs', minPax:2,
    price:544,
    route:'Departs Sigatoka coast',
    bookingData:{
      pickupValue:'NAN', destValue:'BEDARRA_INN', tripType:'return', passengers:2,
      notes:'TOUR BOOKING: Sigatoka Coastal Fishing Charter (3 hrs). Please advise current hotel and number of anglers.'
    }
  },
];

function buildToursGrid() {
  const grid = document.getElementById('toursGrid');
  if (!grid) return;
  grid.innerHTML = TOURS_DATA.map((t, i) => {
    const discountBadge = t.discount
      ? `<div class="tour-discount-badge">${t.discount}</div>`
      : '';
    const oldPrice = t.oldPrice
      ? `<span class="tour-price-old">FJ$${t.oldPrice}</span>`
      : '';
    return `
    <div class="tour-card">
      <div class="tour-thumb-wrap">
        <img class="tour-thumb-img" src="${t.image}" alt="${t.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="tour-thumb-fallback" style="background:${t.bg};display:none">
          <span style="font-size:48px">${t.emoji}</span>
        </div>
        ${discountBadge}
      </div>
      <div class="tour-body">
        <div class="tour-label" style="color:${t.labelColor};background:${t.bg}">${t.label}</div>
        <div class="tour-name">${t.name}</div>
        <div class="tour-desc">${t.desc}</div>
        <div class="tour-meta">
          <div class="tour-meta-item">⏱ ${t.duration}</div>
          <div class="tour-meta-item">📍 ${t.route}</div>
        </div>
        <div class="tour-price-row">
          ${oldPrice}<div class="tour-price">FJ$${t.price}</div>
          <div class="tour-price-label">per person from</div>
        </div>
        <div class="tour-cta-row">
          <button class="tour-cta" onclick="selectTour(${i})">Book this tour →</button>
          <a class="tour-link" href="${t.liveUrl}" target="_blank" rel="noopener" title="View live tour page">↗</a>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ─── REVIEWS DATA ────────────────────────────────────────────────────────────
const REVIEWS_DATA = [
  { stars:5, text:'"Driver was waiting in arrivals with our name. Shell lei, cold water, and a supermarket stop on the way. Couldn\'t have been easier arriving with two kids after a 10-hour flight from Sydney."', name:'Sarah M.', location:'Sydney, AU', source:'Google', color:'#0066cc' },
  { stars:5, text:'"Junior Ali drove us from the airport to Coral Coast — 90 minutes and the whole time he was sharing stories about the villages we passed. Spotless vehicle, on time, genuinely friendly."', name:'Mark T.', location:'Auckland, NZ', source:'TripAdvisor', color:'#00b386' },
  { stars:5, text:'"Booked online from Melbourne — easy process. Driver met us at arrivals with a sign, helped with all bags, waited patiently while we stopped at the ATM. Will use again on every Fiji trip."', name:'James & Kel', location:'Melbourne, AU', source:'Google', color:'#7c3aed' },
  { stars:5, text:'"Transferred 8 of us from Nadi to Port Denarau in a large clean Toyota van. Kids seats provided without asking. Excellent communication, arrived on time, competitive pricing. Highly recommend."', name:'The Williamson Family', location:'Brisbane, AU', source:'Google', color:'#b45309' },
  { stars:5, text:'"Used for both airport pickup and the Sigatoka Sand Dunes day tour. The guide was knowledgeable about the archaeology — genuinely one of the highlights of our Fiji trip."', name:'Claire H.', location:'London, UK', source:'TripAdvisor', color:'#dc2626' },
  { stars:5, text:'"Booked a return transfer Nadi to Pacific Harbour for our shark dive trip. Driver was 15 minutes early both ways. Even texted to confirm the morning of. Absolutely faultless."', name:'Ryan & Sophie', location:'Wellington, NZ', source:'Google', color:'#059669' },
];

function buildReviews() {
  const grid = document.getElementById('reviewsGrid');
  if (!grid) return;
  grid.innerHTML = REVIEWS_DATA.map(r => `
    <div class="review-card">
      <div class="review-stars">${'★'.repeat(r.stars)}</div>
      <div class="review-text">${r.text}</div>
      <div class="review-author">
        <div class="review-avatar" style="background:${r.color}">${r.name.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>
        <div>
          <div class="review-name">${r.name}</div>
          <div class="review-location">${r.location}</div>
          <div class="review-source">${r.source} review · Verified</div>
        </div>
      </div>
    </div>`).join('');
}

// ─── FAQ DATA ────────────────────────────────────────────────────────────────
const FAQ_DATA = [
  { q:'Is there Uber in Fiji?', a:'No — Uber does not operate in Fiji. Your reliable options are pre-booked private transfer services (like ours), shared shuttles, or licensed metered taxis. Pre-booking is strongly recommended to avoid negotiating fares after a long flight.' },
  { q:'How long is the drive from Nadi Airport to the Coral Coast?', a:"Journey times depend on your resort: Shangri-La Yanuca ~55 min (72 km), Gecko's / Bedarra ~80 min (82 km), Outrigger Fiji ~95 min (98 km), The Warwick / Naviti ~98 min (100 km). A private transfer is recommended." },
  { q:'How much does a Nadi Airport to Denarau transfer cost?', a:'Private sedan (1–3 pax): FJ$49 per vehicle. Private minivan (4–7 pax): FJ$69. Minibus (8–12 pax): FJ$99. Denarau is approximately 12 km from the airport — 18–20 minutes.' },
  { q:'How is pricing calculated?', a:'Distance-based pricing in FJD with no surge fees. Short trips (Nadi/Denarau): from FJ$19 sedan, FJ$49 minivan. Mid-range (Natadola, Sigatoka): from FJ$99 sedan. Long-haul (Coral Coast, Pacific Harbour, Suva): from FJ$129 sedan. A 20% night surcharge applies for pickups between 10 pm and 6 am. Return bookings are discounted vs two one-ways.' },
  { q:'What if my flight is delayed?', a:'We monitor all incoming flights in real time. If your flight is delayed your driver adjusts automatically — no extra charge. Just provide your flight number at booking.' },
  { q:'Can I stop at a supermarket or ATM on the way?', a:'Yes — all private transfers include one complimentary stop at a supermarket, ATM, bottle shop or pharmacy en route. Mention it in special requests when booking.' },
  { q:'Do you provide baby or child seats?', a:'Yes, on request for a small charge of FJ$8. Specify your children\'s ages in special requests so we can fit the right seat before your arrival.' },
  { q:'How do I find my driver at Nadi Airport?', a:'Your driver waits in the international arrivals hall with a sign showing your name. If you can\'t find them, call or WhatsApp the number on your confirmation immediately.' },
  { q:'Do you offer return transfers?', a:'Yes — book return at the time of booking for a small discount. Your return pickup can be from your resort back to Nadi Airport or anywhere else on Viti Levu.' },
  { q:'Can I change my pickup time after booking?', a:'Yes — pickup time, date, and stops can all be modified free of charge up to 2 hours before your scheduled pickup. Just WhatsApp us with your booking reference. No fees, no questions.' },
  { q:'How far in advance should I book?', a:'We recommend 24–48 hours in advance, especially June–October and Christmas/New Year. For same-day bookings contact us via WhatsApp.' },
];

function buildFAQ() {
  const list = document.getElementById('faqList');
  if (!list) return;
  list.innerHTML = FAQ_DATA.map((f, i) => `
    <div class="faq-item">
      <div class="faq-q" onclick="toggleFaq(${i},this)">${f.q} <span class="faq-arrow">▼</span></div>
      <div class="faq-a" id="faq-a-${i}">${f.a}</div>
    </div>`).join('');
}
function toggleFaq(i, el) {
  const a = document.getElementById(`faq-a-${i}`);
  const wasOpen = a.classList.contains('open');
  document.querySelectorAll('.faq-a').forEach(x => x.classList.remove('open'));
  document.querySelectorAll('.faq-q').forEach(x => x.classList.remove('open'));
  if (!wasOpen) { a.classList.add('open'); el.classList.add('open'); }
}

// ─── TYPEAHEAD SEARCH FOR DESTINATION & PICKUP ───────────────────────────────
// Converts a native <select> (with optgroups) into a searchable dropdown.
// Keeps the underlying <select> functional — just hides it visually.
// Customers see a search input + filterable list. Picking a result sets the
// underlying <select> value, so all existing code (resolveLocation,
// setSelectByValue, swap, selectTour, bookRoute) keeps working unchanged.
function enhanceSelectAsTypeahead(selectId, opts = {}) {
  const sel = document.getElementById(selectId);
  if (!sel || sel.dataset.typeaheadAttached === '1') return;
  sel.dataset.typeaheadAttached = '1';

  // Collect options grouped by optgroup
  const groups = [];
  const ungrouped = [];
  const sentinels = []; // CUSTOM_PICKUP, CUSTOM_DEST, blank
  Array.from(sel.children).forEach(child => {
    if (child.tagName === 'OPTION') {
      if (child.value === '' || !child.dataset.lat) {
        sentinels.push({ value: child.value, text: child.text });
      } else {
        ungrouped.push({ value: child.value, text: child.text, area: child.dataset.area || '' });
      }
    } else if (child.tagName === 'OPTGROUP') {
      const items = Array.from(child.children).map(o => ({
        value: o.value, text: o.text, area: o.dataset.area || ''
      }));
      groups.push({ label: child.label, items });
    }
  });

  // Build the typeahead UI
  const wrap = document.createElement('div');
  wrap.className = 'typeahead-wrap';
  wrap.innerHTML = `
    <button type="button" class="typeahead-trigger" id="${selectId}_ta_trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="typeahead-trigger-text">${opts.placeholder || 'Select...'}</span>
      <span class="typeahead-chevron">▾</span>
    </button>
    <div class="typeahead-panel" id="${selectId}_ta_panel" hidden>
      <div class="typeahead-search-row">
        <input type="text" class="typeahead-search" id="${selectId}_ta_search" placeholder="${opts.searchPlaceholder || 'Type a hotel or area name...'}" autocomplete="off" />
        <button type="button" class="typeahead-close" id="${selectId}_ta_close" aria-label="Close">✕</button>
      </div>
      <div class="typeahead-list" id="${selectId}_ta_list" role="listbox"></div>
    </div>`;

  // Hide the native select but keep it functional
  sel.classList.add('typeahead-hidden-select');
  sel.parentNode.insertBefore(wrap, sel.nextSibling);

  const trigger    = wrap.querySelector('.typeahead-trigger');
  const triggerTxt = wrap.querySelector('.typeahead-trigger-text');
  const panel      = wrap.querySelector('.typeahead-panel');
  const search     = wrap.querySelector('.typeahead-search');
  const list       = wrap.querySelector('.typeahead-list');
  const closeBtn   = wrap.querySelector('.typeahead-close');

  function renderList(filter = '') {
    const f = filter.toLowerCase().trim();
    let sentinelHtml = '';
    let resultsHtml = '';

    // Non-blank sentinels (the custom-address escape hatch) must never be
    // filtered out by search text - a guest whose destination doesn't match
    // anything is exactly who needs this option, so treating it like a
    // normal searchable option (as before) made it disappear along with
    // every other result and left the "no matches" state with nothing
    // clickable at all.
    sentinels.forEach(s => {
      if (s.value === '' && f) return;          // hide blank when searching
      sentinelHtml += `<div class="ta-opt ta-opt-sentinel" data-val="${s.value}">${s.text}</div>`;
    });

    if (!f) {
      // Browse mode (no search text yet): show the full grouped list as-is,
      // ordered by proximity to Nadi the way the groups were authored -
      // nothing to rank when there's nothing to match against.
      ungrouped.forEach(o => {
        resultsHtml += `<div class="ta-opt" data-val="${o.value}">${o.text}<span class="ta-opt-area">${o.area}</span></div>`;
      });
      groups.forEach(g => {
        resultsHtml += `<div class="ta-group-label">${g.label}</div>`;
        g.items.forEach(o => {
          resultsHtml += `<div class="ta-opt" data-val="${o.value}">${o.text}<span class="ta-opt-area">${o.area}</span></div>`;
        });
      });
    } else {
      // Search mode: rank every candidate across both name and area/zone,
      // tightest match first - an exact prefix on the name, then a prefix
      // on the area, then a substring anywhere in the name, then in the
      // area, then (lowest tier) a match only on the group's region label.
      // Group headers are dropped here since ranking mixes items from
      // different groups; the area is still shown inline per option.
      const candidates = ungrouped.concat(
        groups.flatMap(g => g.items.map(o => ({ ...o, groupLabel: g.label })))
      );
      const scored = [];
      candidates.forEach(o => {
        const text = o.text.toLowerCase();
        const area = o.area.toLowerCase();
        const group = (o.groupLabel || '').toLowerCase();
        let score;
        if (text.startsWith(f)) score = 0;
        else if (area.startsWith(f)) score = 1;
        else if (text.includes(f)) score = 2;
        else if (area.includes(f)) score = 3;
        else if (group.includes(f)) score = 4;
        else return;
        scored.push({ o, score });
      });
      scored.sort((a, b) => a.score - b.score); // stable: ties keep original order
      scored.forEach(({ o }) => {
        resultsHtml += `<div class="ta-opt" data-val="${o.value}">${o.text}<span class="ta-opt-area">${o.area}</span></div>`;
      });
    }

    let html = sentinelHtml;
    if (!resultsHtml && f) {
      html += `<div class="ta-empty">No matches for "${filter}". Try the area name (e.g. "Coral Coast"), or pick "📍 Other / not listed" above.</div>`;
    } else {
      html += resultsHtml;
    }
    list.innerHTML = html;

    // Wire option clicks
    list.querySelectorAll('.ta-opt').forEach(el => {
      el.addEventListener('click', () => {
        const val = el.getAttribute('data-val');
        if (!setSelectByValue(selectId, val)) sel.value = val;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        updateTriggerLabel();
        closePanel();
      });
    });
  }

  function updateTriggerLabel() {
    const opt = sel.options[sel.selectedIndex];
    if (opt && opt.value) {
      triggerTxt.textContent = opt.text;
      triggerTxt.classList.remove('placeholder');
    } else {
      triggerTxt.textContent = opts.placeholder || 'Select...';
      triggerTxt.classList.add('placeholder');
    }
  }

  function openPanel() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    search.value = '';
    renderList();
    setTimeout(() => search.focus(), 50);
  }
  function closePanel() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', () => {
    panel.hidden ? openPanel() : closePanel();
  });
  closeBtn.addEventListener('click', closePanel);
  search.addEventListener('input', e => renderList(e.target.value));
  search.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePanel();
    if (e.key === 'Enter') {
      const first = list.querySelector('.ta-opt:not(.ta-opt-sentinel)') || list.querySelector('.ta-opt');
      if (first) first.click();
    }
  });

  // Close when clicking outside
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) closePanel();
  });

  // Keep the trigger label in sync when sel.value is changed externally
  // (by selectTour, swapLocations, bookRoute, etc). Native <select>
  // doesn't fire 'change' on programmatic .selectedIndex updates, so we
  // poll cheaply — 500ms is invisible to users and costs nothing.
  setInterval(updateTriggerLabel, 500);

  updateTriggerLabel();
}

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildRoutesTable();
  buildToursGrid();
  buildReviews();
  buildFAQ();

  // Convert pickup & destination selects into searchable typeahead dropdowns
  enhanceSelectAsTypeahead('pickup', {
    placeholder: 'Select pickup point...',
    searchPlaceholder: 'Search airports, hotels, areas...'
  });
  enhanceSelectAsTypeahead('destination', {
    placeholder: 'Select destination...',
    searchPlaceholder: 'Search 110+ Fiji hotels...'
  });

  // A4: restore the customer's last currency choice if any
  const currencySel = document.getElementById('currencySelect');
  if (currencySel) {
    currencySel.value = getDisplayCurrency();
    // Re-render the routes table so it reflects the chosen currency from
    // the very first paint (buildRoutesTable was already called above with
    // FJD as default; this second call applies the saved currency).
    buildRoutesTable();
  }

  // ─── URL PARAM HANDLER (B2 — supports /transfer/* landing pages) ─────────
  // Hotel landing pages link to the homepage with ?pickup=X&dest=Y query
  // params so the booking widget pre-fills with the right route. The
  // typeahead's setInterval polling (every 500ms) catches up the trigger
  // label automatically — no manual UI sync needed.
  try {
    const params = new URLSearchParams(window.location.search);
    const pickupParam = params.get('pickup');
    const destParam = params.get('dest');
    if (pickupParam && setSelectByValue('pickup', pickupParam)) {
      onPickupChange();
    }
    if (destParam && setSelectByValue('destination', destParam)) {
      onDestinationChange();
    }
  } catch (e) {
    // URLSearchParams missing on very old browsers — silent fail, fine
  }

  // A1: surface the flight-monitoring hint if the default pickup is NAN
  updateFlightHint();

  // Default date = tomorrow
  const dateEl = document.getElementById('travelDate');
  if (dateEl) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateEl.value = tomorrow.toISOString().split('T')[0];
    dateEl.min   = new Date().toISOString().split('T')[0];
  }

  // Nav scroll effect
  const nav = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    nav?.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });

  // Hamburger
  document.getElementById('hamburger')?.addEventListener('click', () => {
    document.getElementById('mobileMenu')?.classList.toggle('open');
  });

  // Close mobile menu on link tap
  document.querySelectorAll('.mobile-menu a').forEach(a => {
    a.addEventListener('click', () => document.getElementById('mobileMenu')?.classList.remove('open'));
  });

  // Smooth scroll — nav anchor links only (not tour buttons)
  document.querySelectorAll('nav a[href^="#"], .footer a[href^="#"], .btn-hero[href^="#"], .btn-nav[href^="#"], .btn-sticky[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior:'smooth', block:'start' }); }
    });
  });
});
