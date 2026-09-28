/* Marau Stage 1 (PREVIEW ONLY) — guest-facing DISPLAY formatting only.
 * Every function here transforms a value purely for presentation; the
 * underlying raw value (zone code, vehicle class code, full booking
 * reference, numeric price, UTC instant) is NEVER changed anywhere it is
 * stored, compared, or used for authorization/matching/pricing logic —
 * only what gets rendered to a guest changes. Used on BOTH sides: the
 * server (whatsapp_handoff.js's composed messages, worker.js's `deals`
 * `conditions` copy) and the client (spliced into pages.js via
 * `.toString()`, the same established pattern as fiji_time.js and
 * booking_selection.js — every function here is fully self-contained, no
 * outer-scope constant referenced from inside a function body, per the
 * round-3 STORAGE_KEY embedding lesson).
 *
 * FIX (bounded mobile-copy corrections, iPhone screenshots review):
 * eight specific copy issues found on a real device — this file is the
 * shared home for the ones that need the SAME transformation on both the
 * client's own rendering and the server's composed WhatsApp text, so the
 * two can never drift apart.
 */

/**
 * Finding 1 — the pickup card showed a full, effectively unbounded
 * client_booking_ref (a real UUID for every non-test booking —
 * `MARAU-${cryptoRandomId()}`) as if it were a short, memorable
 * reference. This is DISPLAY ONLY: the returned string is never used to
 * look anything up or grant access anywhere — every actual authorization
 * check in this codebase uses the bearer access token, never a booking
 * reference of any length. The full reference is still sent to and
 * stored by the server unchanged; this only shortens what is shown.
 *
 * Specifically detects a real UUID segment (8-4-4-4-12 hex) rather than
 * using a length threshold — a length cutoff would wrongly mangle an
 * already-short, human-chosen reference (e.g. a synthetic test ref like
 * "HOSTED-ACCEPT-001") that just happens to be a bit long but was never
 * meant to be shortened further. Anything without a real UUID segment is
 * returned completely unchanged.
 */
export function shortBookingReference(ref) {
  if (!ref) return ref;
  var str = String(ref);
  var uuid = str.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (!uuid) return str;
  var prefix = str.slice(0, str.indexOf(uuid[0])).replace(/[-_]+$/, '');
  var shortUuid = uuid[0].split('-')[0].toUpperCase();
  return prefix ? (prefix.toUpperCase() + '-' + shortUuid) : shortUuid;
}

/**
 * Finding 2 — offer-derived zone codes ("NAD_AIRPORT", "DENARAU") were
 * shown to guests verbatim, all-caps with underscores, instead of a
 * normal place name. Known codes get an exact label; anything not yet
 * known but still CODE-SHAPED (all uppercase letters/digits/underscores)
 * falls back to a readable Title Case rendering. Anything that is NOT
 * code-shaped — e.g. an ordinary booking's own `pickup_zone`, which is
 * free text the guest typed themselves ("Nadi Airport", already human)
 * — is returned completely unchanged: applying the underscore-splitting
 * fallback to already-human text would mangle it (e.g. lower-casing and
 * only capitalizing the very first letter of "Nadi Airport" would wrongly
 * produce "Nadi airport"). The underlying zone value itself is never
 * altered anywhere else regardless of which path this takes.
 *
 * The known-labels map is INLINED inside the function body on purpose —
 * a module-level constant referenced from inside a function does not
 * survive `.toString()` splicing into pages.js's emitted <script> (the
 * exact STORAGE_KEY bug found and fixed in round 3; every function in
 * this file must stay fully self-contained).
 */
export function humanizeZoneLabel(code) {
  if (!code) return code;
  var known = { NAD_AIRPORT: 'Nadi Airport', DENARAU: 'Denarau' };
  if (known[code]) return known[code];
  if (!/^[A-Z0-9_]+$/.test(String(code))) return code; // not code-shaped — already human text, leave as-is
  return String(code)
    .toLowerCase()
    .split('_')
    .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); })
    .join(' ');
}

/**
 * Finding 2 (vehicle half) — "SEDAN" -> "Sedan", same fallback pattern,
 * same self-contained rule, and the SAME code-shape guard: an ordinary
 * booking's own `vehicle_type` is free text the guest typed themselves
 * (e.g. "Private van, up to 6") and must never be run through this —
 * only used for OFFER-derived `vehicle_class` values, which are always
 * short, all-caps codes.
 */
export function humanizeVehicleClassLabel(code) {
  if (!code) return code;
  var known = { SEDAN: 'Sedan' };
  if (known[code]) return known[code];
  if (!/^[A-Z0-9_]+$/.test(String(code))) return code;
  var str = String(code);
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Finding 3 — prices were shown as a bare "$24.00" with no currency
 * indicator. Every guest-facing price (deal prices, comparison/struck-
 * through prices, requested amounts, and the composed WhatsApp summary)
 * now reads "FJ$24.00" — the numeric amount itself is never touched.
 */
export function formatFijiCurrency(amount) {
  var n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return 'FJ$' + n.toFixed(2);
}
