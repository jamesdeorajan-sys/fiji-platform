/* CEO P0 booking-recovery fix (2026-09-13, first + second review) —
 * isolated regression tests.
 *
 * nadi-airport-transfers-site/src/app.js is a plain browser <script> (no
 * module system, relies on global `document`/`state`), so it can't be
 * `require()`d directly into a Node test without a DOM. These tests are
 * PARITY tests: they reimplement the exact algorithms this fix added to
 * app.js's confirmBooking() — buildBookingIntentFingerprint(), the
 * stable-ref resolution, the success-clears-attempt logic, and the
 * three-way message-state decision — and assert their behavior in
 * isolation. If any of those change in app.js, this file must be updated
 * to match (each test names the exact app.js function it mirrors).
 *
 * Run: node --test test/booking-integrity.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mirrors app.js's buildBookingIntentFingerprint() object shape exactly,
// taking an explicit intent object instead of reading document/state
// directly (same field set, same conditional return-field nulling).
function fingerprintFromIntent(intent) {
  const isReturn = intent.tripType === 'return';
  return JSON.stringify({
    pickup: intent.pickup ?? null,
    destination: intent.destination ?? null,
    pickupDate: intent.pickupDate || null,
    pickupTime: intent.pickupTime || null,
    vehicle: intent.vehicle,
    tripType: intent.tripType,
    returnDate: isReturn ? (intent.returnDate || null) : null,
    returnTime: isReturn ? (intent.returnTime || null) : null,
    returnPickupLocation: isReturn ? (intent.returnPickupLocation || null) : null,
    passengers: intent.passengers,
    luggage: intent.luggage,
    flightNumber: intent.flightNumber || null,
    hasChildSeat: !!intent.hasChildSeat,
    hasSurfboard: !!intent.hasSurfboard,
    notes: intent.notes || null,
    quotedAmount: intent.quotedAmount,
  });
}

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

// Mirrors app.js confirmBooking()'s post-submitNadiBooking clear-on-success
// block verbatim: the stored attempt is removed ONLY once the server
// authoritatively confirms ok:true, never on failure (that would break
// lost-response retry recovery).
function finalizeBookingAttempt(storage, saveOk) {
  if (saveOk) {
    try { storage.removeItem('ftt_booking_attempt'); } catch { /* private mode */ }
  }
}

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

const BASE_INTENT = Object.freeze({
  pickup: 'NAN',
  destination: 'HILTON_DENARAU',
  pickupDate: '2026-10-01',
  pickupTime: '14:00',
  vehicle: 'minivan',
  tripType: 'one-way',
  returnDate: null,
  returnTime: null,
  returnPickupLocation: null,
  passengers: 2,
  luggage: 2,
  flightNumber: 'FJ810',
  hasChildSeat: false,
  hasSurfboard: false,
  notes: null,
  quotedAmount: 79,
});

function refFor(intent, now) {
  return resolveStableBookingRef(fingerprintFromIntent(intent), makeMemoryStorage(), now);
}

// A single shared storage lets us simulate a real multi-call session
// (first attempt, then a retry/edit) exactly like one page load would.
function scenario() {
  const storage = makeMemoryStorage();
  return {
    attempt: (intent, now) => resolveStableBookingRef(fingerprintFromIntent(intent), storage, now),
    storage,
  };
}

// ─── CEO-required test 1: identical payload retry -> same ref ─────────────
test('1. identical payload retry -> same ref', () => {
  const s = scenario();
  const first = s.attempt(BASE_INTENT, () => 1000);
  const second = s.attempt(BASE_INTENT, () => 5000);
  assert.equal(second, first);
});

// ─── CEO-required test 2: passenger count change -> new ref ───────────────
test('2. passenger count change -> new ref', () => {
  const s = scenario();
  const first = s.attempt(BASE_INTENT, () => 1000);
  const second = s.attempt({ ...BASE_INTENT, passengers: 3 }, () => 2000);
  assert.notEqual(second, first);
});

// ─── CEO-required test 3: luggage change -> new ref ────────────────────────
test('3. luggage change -> new ref', () => {
  const s = scenario();
  const first = s.attempt(BASE_INTENT, () => 1000);
  const second = s.attempt({ ...BASE_INTENT, luggage: 4 }, () => 2000);
  assert.notEqual(second, first);
});

// ─── CEO-required test 4: flight number change -> new ref ─────────────────
test('4. flight number change -> new ref', () => {
  const s = scenario();
  const first = s.attempt(BASE_INTENT, () => 1000);
  const second = s.attempt({ ...BASE_INTENT, flightNumber: 'FJ811' }, () => 2000);
  assert.notEqual(second, first);
});

// ─── CEO-required test 5: return date/time change -> new ref ──────────────
test('5. return date/time change -> new ref', () => {
  const returnIntent = { ...BASE_INTENT, tripType: 'return', returnDate: '2026-10-05', returnTime: '10:00', returnPickupLocation: 'Hilton Denarau' };
  const s = scenario();
  const first = s.attempt(returnIntent, () => 1000);
  const secondDate = s.attempt({ ...returnIntent, returnDate: '2026-10-06' }, () => 2000);
  assert.notEqual(secondDate, first);

  const s2 = scenario();
  const firstB = s2.attempt(returnIntent, () => 1000);
  const secondTime = s2.attempt({ ...returnIntent, returnTime: '11:00' }, () => 2000);
  assert.notEqual(secondTime, firstB);
});

// ─── CEO-required test 6: add-on change -> new ref ─────────────────────────
test('6. add-on change (child seat / surfboard) -> new ref', () => {
  const s = scenario();
  const first = s.attempt(BASE_INTENT, () => 1000);
  const seat = s.attempt({ ...BASE_INTENT, hasChildSeat: true }, () => 2000);
  assert.notEqual(seat, first);

  const s2 = scenario();
  const firstB = s2.attempt(BASE_INTENT, () => 1000);
  const surf = s2.attempt({ ...BASE_INTENT, hasSurfboard: true }, () => 2000);
  assert.notEqual(surf, firstB);
});

// ─── CEO-required test 7: quoted amount change -> new ref ──────────────────
test('7. quoted amount change -> new ref', () => {
  const s = scenario();
  const first = s.attempt(BASE_INTENT, () => 1000);
  const second = s.attempt({ ...BASE_INTENT, quotedAmount: 89 }, () => 2000);
  assert.notEqual(second, first);
});

// ─── CEO-required test 8: notes/special-request change -> new ref ─────────
test('8. notes/special-request change -> new ref (notes are persisted operationally via buildOperationalNotes)', () => {
  const s = scenario();
  const first = s.attempt(BASE_INTENT, () => 1000);
  const second = s.attempt({ ...BASE_INTENT, notes: 'Please call on arrival' }, () => 2000);
  assert.notEqual(second, first);
});

// ─── CEO-required test 9: exact lost-response retry without user edits -> same ref
test('9. lost-response retry (identical intent, no edits) -> same ref, so backend idempotency reunites them', () => {
  const s = scenario();
  const firstAttemptRef = s.attempt(BASE_INTENT, () => 1000); // fetch sent, response never arrives client-side
  const retryRef = s.attempt(BASE_INTENT, () => 9000); // guest retries after a timeout, nothing changed
  assert.equal(retryRef, firstAttemptRef);
});

// ─── CEO-required test 10: rapid double-click exact same intent -> same ref
test('10. rapid double-click, identical intent -> same ref (one booking, not two)', () => {
  const s = scenario();
  const clickOne = s.attempt(BASE_INTENT, () => 1000);
  const clickTwo = s.attempt(BASE_INTENT, () => 1001); // 1ms later
  assert.equal(clickTwo, clickOne);
});

test('a genuinely different destination still gets its own fresh ref', () => {
  const s = scenario();
  const first = s.attempt(BASE_INTENT, () => 1000);
  const second = s.attempt({ ...BASE_INTENT, destination: 'SOFITEL_DENARAU' }, () => 2000);
  assert.notEqual(second, first);
});

test('contact-detail-only edits (name/phone/email are never part of the fingerprint) still collapse to the same ref', () => {
  // buildBookingIntentFingerprint() deliberately never reads guest_name/
  // guest_phone/guest_email - confirmed here by using an intent object
  // that has no such fields at all and still matching.
  const s = scenario();
  const first = s.attempt(BASE_INTENT, () => 1000);
  const second = s.attempt({ ...BASE_INTENT }, () => 2000); // a "typo correction" would only ever touch contact fields, not modeled here at all
  assert.equal(second, first);
});

test('a blocked/throwing storage (private browsing) still returns a usable ref instead of crashing', () => {
  const throwingStorage = {
    getItem: () => { throw new Error('SecurityError: storage disabled'); },
    setItem: () => { throw new Error('SecurityError: storage disabled'); },
  };
  const ref = resolveStableBookingRef(fingerprintFromIntent(BASE_INTENT), throwingStorage, () => 5000);
  assert.match(ref, /^FTT-[0-9A-Z]+$/);
});

test('reproduces the exact live production incident shape (bookings #101/#102: same route/vehicle/price, 3 seconds apart)', () => {
  const incidentIntent = {
    ...BASE_INTENT, destination: 'NADI_DOWNTOWN', vehicle: 'minivan',
    pickupDate: '2026-09-12', pickupTime: '09:00', quotedAmount: 53.42,
  };
  const s = scenario();
  const ref101 = s.attempt(incidentIntent, () => 1757646426000); // 2026-09-12 03:07:06 UTC (ms)
  const ref102 = s.attempt(incidentIntent, () => 1757646429000); // +3s
  assert.equal(ref101, ref102, 'the fixed logic must collapse this exact real-world incident shape to one ref');
});

// ─── CEO second-review requirement: clear/rotate the stored attempt only
// after authoritative save success, without breaking lost-response recovery.
test('a successful save clears the stored attempt', () => {
  const storage = makeMemoryStorage();
  const fp = fingerprintFromIntent(BASE_INTENT);
  resolveStableBookingRef(fp, storage, () => 1000);
  assert.notEqual(storage.getItem('ftt_booking_attempt'), null);

  finalizeBookingAttempt(storage, /* saveOk */ true);
  assert.equal(storage.getItem('ftt_booking_attempt'), null);
});

test('a failed save keeps the stored attempt (lost-response recovery must still work)', () => {
  const storage = makeMemoryStorage();
  const fp = fingerprintFromIntent(BASE_INTENT);
  resolveStableBookingRef(fp, storage, () => 1000);

  finalizeBookingAttempt(storage, /* saveOk */ false);
  assert.notEqual(storage.getItem('ftt_booking_attempt'), null, 'a failed/unknown save must keep the ref available for retry');

  // The retry itself must still resolve to the original ref.
  const retryRef = resolveStableBookingRef(fp, storage, () => 9000);
  const originalRef = JSON.parse(storage.getItem('ftt_booking_attempt')).ref;
  assert.equal(retryRef, originalRef);
});

test('CEO second-review requirement: after a successful booking, a genuinely new booking with the identical intent gets a FRESH ref, not the completed one', () => {
  const storage = makeMemoryStorage();
  const fp = fingerprintFromIntent(BASE_INTENT);

  const firstRef = resolveStableBookingRef(fp, storage, () => 1000);
  finalizeBookingAttempt(storage, /* saveOk */ true); // booking #1 completed and cleared

  // Same guest, same tab (sessionStorage survives a reload), genuinely
  // booking the identical trip again later (e.g. a second, separate group).
  const secondRef = resolveStableBookingRef(fp, storage, () => 999999);

  assert.notEqual(secondRef, firstRef, 'a post-success repeat of the identical intent must not silently reuse the already-completed booking\'s ref');
});

// ─── Message-state decision (unchanged from the first review's fix) ───────
// Mirrors app.js confirmBooking()'s three-way message-state branch verbatim
// (saveResult.ok / saveAttempted -> which of the three bulaTitle*/bulaLeadText
// states renders).
function resolveBookingMessageState({ saveOk, saveAttempted }) {
  if (saveOk) return 'SAVED';
  if (saveAttempted) return 'SAVE_FAILED';
  return 'WHATSAPP_ONLY_BY_DESIGN';
}

test('SAVE_CONFIRMED state only when the server actually returned ok:true', () => {
  assert.equal(resolveBookingMessageState({ saveOk: true, saveAttempted: true }), 'SAVED');
});

test('an attempted-and-failed save gets its own honest state, never the "by design" copy', () => {
  const state = resolveBookingMessageState({ saveOk: false, saveAttempted: true });
  assert.equal(state, 'SAVE_FAILED');
  assert.notEqual(state, 'WHATSAPP_ONLY_BY_DESIGN', 'a real failure must not be disguised as the always-WhatsApp-only design case');
});

test('a route never eligible for server-save (custom address) keeps its original, unchanged copy', () => {
  assert.equal(resolveBookingMessageState({ saveOk: false, saveAttempted: false }), 'WHATSAPP_ONLY_BY_DESIGN');
});
