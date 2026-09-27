/* Marau Stage 1 (PREVIEW ONLY) — client-side booking idempotency key and
 * attempt secret.
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
 * FIX (third independent review, finding 1): a resubmission used to be
 * allowed direct access if it landed within a 60-second "retry grace
 * window" of the original save. Codex replayed a FRESH reference/payload
 * within that window and still got the access token back — a time
 * window proves nothing, since an attacker who captured the reference
 * and payload (both business-shaped, potentially loggable/visible
 * values) can replay them just as easily inside the window as outside
 * it. `attempt_secret` is a SEPARATE random value with no timing
 * component at all: generated once per booking attempt, sent with the
 * first submission, and compared server-side on any resubmission — see
 * worker.js#handleCreateBooking. Only presenting the SAME secret (proof
 * of holding the same client-side state the original submitter did)
 * recovers direct access; timing is irrelevant.
 *
 * Every function here is fully self-contained (no shared module-level
 * `const` referenced from inside a function body) ON PURPOSE: pages.js
 * embeds each function's own source via `.toString()` into the guest
 * app's browser-side <script>, and a shared outer constant does NOT
 * survive that splicing — a previous version of this file referenced
 * such a constant and would have thrown `ReferenceError` the first time
 * a real browser called it, undetected because the test suite only ever
 * imports these functions as normal ES modules (where the shared
 * constant IS in scope) rather than re-parsing the spliced source the
 * way the browser actually runs it. Fixed here by inlining each storage
 * key as a literal inside its own function.
 */

export function getOrCreateClientBookingRef(storage, randomSource) {
  var key = 'marau_pending_booking_ref';
  var existing;
  try {
    existing = storage.getItem(key);
  } catch (e) {
    existing = null;
  }
  if (existing) return existing;
  var ref = 'MARAU-' + randomSource();
  try {
    storage.setItem(key, ref);
  } catch (e) {
    // Storage unavailable (private mode, blocked site data, etc.) — the
    // caller still gets a usable ref for this single request, it just
    // won't survive a reload. Never block the booking on this.
  }
  return ref;
}

export function clearClientBookingRef(storage) {
  try {
    storage.removeItem('marau_pending_booking_ref');
  } catch (e) {
    // best-effort
  }
}

/**
 * A second, INDEPENDENT random value from the same booking attempt — see
 * the file header. Persisted and cleared on the exact same lifecycle as
 * the booking reference (generated once before the first submit, kept
 * until a successful save, then cleared), but never derived from or
 * combined with the reference itself, so knowing one never reveals the
 * other.
 */
export function getOrCreateAttemptSecret(storage, randomSource) {
  var key = 'marau_pending_attempt_secret';
  var existing;
  try {
    existing = storage.getItem(key);
  } catch (e) {
    existing = null;
  }
  if (existing) return existing;
  var secret = randomSource() + '-' + randomSource();
  try {
    storage.setItem(key, secret);
  } catch (e) {
    // best-effort, see getOrCreateClientBookingRef
  }
  return secret;
}

export function clearAttemptSecret(storage) {
  try {
    storage.removeItem('marau_pending_attempt_secret');
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
