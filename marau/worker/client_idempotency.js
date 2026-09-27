/* Marau Stage 1 (PREVIEW ONLY) — client-side booking idempotency key.
 *
 * FIX for a P1 Codex finding: submitting the guest app's booking form
 * twice (a double-click, a reload-and-resubmit, a client timeout retry)
 * created two separate bookings with two different server-generated
 * references, because the client never sent a `client_booking_ref` and
 * the server minted a fresh random one on every call that omitted it.
 * The server's own idempotency (INSERT OR IGNORE keyed on
 * client_booking_ref, already tested) only ever works if the SAME key is
 * sent twice — it was never given the chance to.
 *
 * This function is the ONE place that key is generated. It is written as
 * a plain, dependency-injected function (a storage object and a random
 * source are passed in, not read from globals) specifically so it can be
 * unit-tested directly in Node with a fake storage AND embedded verbatim
 * into the guest app's browser-side <script> — see pages.js, which
 * imports this file and splices `getOrCreateClientBookingRef.toString()`
 * and `clearClientBookingRef.toString()` into the emitted HTML, so the
 * browser runs the EXACT same source this file's own tests exercise,
 * not a hand-copied duplicate that could drift out of sync.
 *
 * Behaviour: the FIRST call (nothing pending) generates a fresh, random
 * reference and persists it. Every call after that, until
 * clearClientBookingRef() runs (only after a genuinely successful save —
 * see pages.js), returns the SAME persisted value — this is what makes a
 * reload or a retried submit reuse the original attempt's key instead of
 * minting a new one. Scoping: the key is stored under a single
 * fixed-name slot ("one booking attempt in flight at a time" per
 * device/tab), not derived from guest-supplied data (email/phone), so it
 * can't be predicted or reused across a DIFFERENT guest's attempt.
 */

const STORAGE_KEY = 'marau_pending_booking_ref';

export function getOrCreateClientBookingRef(storage, randomSource) {
  var existing;
  try {
    existing = storage.getItem(STORAGE_KEY);
  } catch (e) {
    existing = null;
  }
  if (existing) return existing;
  var ref = 'MARAU-' + randomSource();
  try {
    storage.setItem(STORAGE_KEY, ref);
  } catch (e) {
    // Storage unavailable (private mode, blocked site data, etc.) — the
    // caller still gets a usable ref for this single request, it just
    // won't survive a reload. Never block the booking on this.
  }
  return ref;
}

export function clearClientBookingRef(storage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch (e) {
    // best-effort
  }
}

export function defaultRandomSource() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return Date.now() + '-' + Math.random().toString(16).slice(2);
}
