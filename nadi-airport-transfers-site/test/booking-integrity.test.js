/* CEO P0 booking-recovery fix (2026-09-13) — isolated regression tests.
 *
 * nadi-airport-transfers-site/src/app.js is a plain browser <script> (no
 * module system, relies on global `document`/`state`), so it can't be
 * `require()`d directly into a Node test without a DOM. These tests are
 * PARITY tests: they reimplement the exact two algorithms this fix added
 * to app.js's confirmBooking() — the stable-idempotency-ref logic and the
 * three-way message-state decision — and assert their behavior in
 * isolation. If either algorithm changes in app.js, this file must be
 * updated to match (each test names the exact app.js lines it mirrors).
 *
 * Run: node --test test/booking-integrity.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirrors app.js confirmBooking()'s ref-resolution block verbatim (the
// sessionStorage key name 'ftt_booking_attempt' and fallback prefix 'FTT-'
// are the real values used there).
function resolveStableBookingRef(fingerprint, storage, now = () => Date.now()) {
  let ref;
  try {
    const stored = JSON.parse(storage.getItem('ftt_booking_attempt') || 'null');
    if (stored && stored.fingerprint === fingerprint && stored.ref) {
      ref = stored.ref;
    }
  } catch { /* storage blocked or corrupt - fall through to a fresh ref */ }
  if (!ref) {
    ref = 'FTT-' + now().toString(36).toUpperCase().slice(-6);
    try { storage.setItem('ftt_booking_attempt', JSON.stringify({ ref, fingerprint })); } catch { /* private mode */ }
  }
  return ref;
}

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
  };
}

test('a retry with the SAME trip fingerprint reuses the SAME ref (fixes bookings #101/#102 in production)', () => {
  const storage = makeMemoryStorage();
  const fingerprint = JSON.stringify(['NAN', 'DENARAU_HOTEL', '2026-10-01', '14:00', 'minivan', 'one-way']);

  const firstRef = resolveStableBookingRef(fingerprint, storage, () => 1000);
  // Simulate a double-click / resubmit a few seconds later, same trip.
  const secondRef = resolveStableBookingRef(fingerprint, storage, () => 4000);

  assert.equal(secondRef, firstRef, 'a retry of the identical trip must reuse the identical client_booking_ref');
});

test('a genuinely different trip (guest changed a field) gets its own fresh ref', () => {
  const storage = makeMemoryStorage();
  const firstFingerprint = JSON.stringify(['NAN', 'DENARAU_HOTEL', '2026-10-01', '14:00', 'minivan', 'one-way']);
  const secondFingerprint = JSON.stringify(['NAN', 'NATADOLA_HOTEL', '2026-10-01', '14:00', 'minivan', 'one-way']);

  const firstRef = resolveStableBookingRef(firstFingerprint, storage, () => 1000);
  const secondRef = resolveStableBookingRef(secondFingerprint, storage, () => 2000);

  assert.notEqual(secondRef, firstRef, 'a different destination is a different booking intent and must not collapse into the first ref');
});

test('a blocked/throwing storage (private browsing) still returns a usable ref instead of crashing', () => {
  const throwingStorage = {
    getItem: () => { throw new Error('SecurityError: storage disabled'); },
    setItem: () => { throw new Error('SecurityError: storage disabled'); },
  };
  const ref = resolveStableBookingRef('anything', throwingStorage, () => 5000);
  assert.match(ref, /^FTT-[0-9A-Z]+$/);
});

test('reproduces the exact live production incident shape (bookings #101/#102: same route/vehicle/price, 3 seconds apart)', () => {
  // This is the real, non-PII shape read from nadi-marketplace-db during
  // the audit: two bookings, same source IP, same pickup/destination/
  // vehicle/quoted_amount, created_at 3 seconds apart, but two DIFFERENT
  // client_booking_ref values (FTT-XT0RT2, FTT-XT0U3W) — proving the old
  // Date.now()-only ref generation was the actual mechanism, not
  // coincidence. With the fix, replaying the same inputs must not do that.
  const storage = makeMemoryStorage();
  const tripFingerprint = JSON.stringify(['NAN', 'NADI_DOWNTOWN', '2026-09-12', '09:00', 'minivan', 'one-way']);

  const ref101 = resolveStableBookingRef(tripFingerprint, storage, () => 1757646426000); // 2026-09-12 03:07:06 UTC (ms)
  const ref102 = resolveStableBookingRef(tripFingerprint, storage, () => 1757646429000); // +3s

  assert.equal(ref101, ref102, 'the fixed logic must collapse this exact real-world incident shape to one ref');
});

// Mirrors app.js confirmBooking()'s three-way message-state branch verbatim
// (saveResult.ok / saveAttempted -> which of the three bulaTitle*/bulaLeadText
// states renders). Extracted as a pure decision function for testability.
function resolveBookingMessageState({ saveOk, saveAttempted }) {
  if (saveOk) return 'SAVED';
  if (saveAttempted) return 'SAVE_FAILED';
  return 'WHATSAPP_ONLY_BY_DESIGN';
}

test('SAVE_CONFIRMED state only when the server actually returned ok:true', () => {
  assert.equal(resolveBookingMessageState({ saveOk: true, saveAttempted: true }), 'SAVED');
});

test('CEO fix 2026-09-13: an attempted-and-failed save gets its own honest state, never the "by design" copy', () => {
  const state = resolveBookingMessageState({ saveOk: false, saveAttempted: true });
  assert.equal(state, 'SAVE_FAILED');
  assert.notEqual(state, 'WHATSAPP_ONLY_BY_DESIGN', 'a real failure must not be disguised as the always-WhatsApp-only design case');
});

test('a route never eligible for server-save (custom address) keeps its original, unchanged copy', () => {
  assert.equal(resolveBookingMessageState({ saveOk: false, saveAttempted: false }), 'WHATSAPP_ONLY_BY_DESIGN');
});
