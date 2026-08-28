// Booking-route safety (post-activation hotfix, 2026-08-28).
//
// Two live production offers were found storing a combined "https://... | tel:..." string in
// booking_route, which /go/deal/:id then passed straight into c.redirect() verbatim - a
// malformed, unvalidated Location header on a real booking path. validateBookingRoute() is the
// one place "is this string safe to use as a single redirect target" is decided, called at both
// write-time (deal extraction/correction, deal-exchange-model.ts) and redirect-time
// (/go/deal/:id, deal-exchange-ui.ts) so neither path can drift from the other. Kept in its own
// module with zero internal imports specifically so both deal-exchange-model.ts and
// deal-exchange-listing.ts/deal-exchange-ui.ts can depend on it without creating a cycle (listing
// already imports from model).
//
// A value is valid only if it is EXACTLY one URI in the allow-listed scheme set - no
// combined/secondary destination, no whitespace, no control characters, nothing left over.
const ALLOWED_BOOKING_ROUTE_SCHEMES = new Set(['https:', 'mailto:', 'tel:']);

export interface BookingRouteValidation {
  ok: boolean;
  canonical: string | null;
  reason: string | null;
}

export function validateBookingRoute(route: string | null | undefined): BookingRouteValidation {
  if (route === null || route === undefined) {
    return { ok: true, canonical: null, reason: null }; // absent route is valid - "no route configured"
  }
  if (route.length === 0) {
    return { ok: false, canonical: null, reason: 'empty string is not a valid route - use null for "no route"' };
  }
  if (route !== route.trim()) {
    return { ok: false, canonical: null, reason: 'leading or trailing whitespace' };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F-\x9F]/.test(route)) {
    return { ok: false, canonical: null, reason: 'contains control characters' };
  }
  if (/\s/.test(route)) {
    return { ok: false, canonical: null, reason: 'contains internal whitespace - must be exactly one URI, not a combined value' };
  }
  if (route.includes('|') || route.includes(',') || route.includes(';')) {
    return { ok: false, canonical: null, reason: 'contains a separator character - must be exactly one destination' };
  }
  if (route.startsWith('//')) {
    return { ok: false, canonical: null, reason: 'protocol-relative URL not permitted' };
  }
  if (/^(javascript|data|file|vbscript):/i.test(route)) {
    return { ok: false, canonical: null, reason: 'unsupported/unsafe scheme' };
  }
  let parsed: URL;
  try {
    parsed = new URL(route);
  } catch {
    return { ok: false, canonical: null, reason: 'not a syntactically valid URI' };
  }
  if (!ALLOWED_BOOKING_ROUTE_SCHEMES.has(parsed.protocol)) {
    return { ok: false, canonical: null, reason: `scheme "${parsed.protocol}" not in allow-list (https:, mailto:, tel:)` };
  }
  if (parsed.protocol === 'mailto:') {
    const addr = route.slice('mailto:'.length);
    if (!/^[^\s@,;|]+@[^\s@,;|]+\.[^\s@,;|]+$/.test(addr)) {
      return { ok: false, canonical: null, reason: 'mailto: address is not a single valid email' };
    }
  }
  if (parsed.protocol === 'tel:') {
    const num = route.slice('tel:'.length);
    if (!/^\+?[0-9()\-.]{5,20}$/.test(num)) {
      return { ok: false, canonical: null, reason: 'tel: number is not a single valid phone number' };
    }
  }
  if (parsed.protocol === 'https:' && !parsed.hostname) {
    return { ok: false, canonical: null, reason: 'https: URL missing hostname' };
  }
  return { ok: true, canonical: route, reason: null };
}
