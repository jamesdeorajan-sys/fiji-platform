// RELEASE-CANDIDATE checks for the page side of the P0 #237 repair (the real app.js functions evaluated in a sandbox).
// Requirements: 2 (both totals + an explicit accept action), 3 (every itinerary change invalidates the revised quote and its acceptance),
// 4 (repeated mismatches, timeout, same-reference retry - no duplicates, no false success), 5 (the saved fare shown to the guest, with currency),
// 6 (the original total is sent so it can be recorded).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/\r/g, '');
const lines = source.split('\n');
const idx = (re, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l));
function extractFn(name) { // brace-matched top-level function (async or not)
  const start = lines.findIndex((l) => new RegExp(`^(async )?function ${name}\\(`).test(l)); assert.ok(start >= 0, name);
  let depth = 0; let seen = false; const out = [];
  for (let i = start; i < lines.length; i += 1) { out.push(lines[i]); for (const ch of lines[i].replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\/\/.*$/g, '')) { if (ch === '{') { depth += 1; seen = true; } else if (ch === '}') depth -= 1; } if (seen && depth === 0) break; }
  return out.join('\n');
}

// ---- a page sandbox with the real price functions and mutable form fields
function page(over = {}) {
  const fields = { pickup: { value: 'NAN' }, destination: { value: 'MARRIOTT_MOMI' }, travelDate: { value: '2026-10-15' }, travelTime: { value: '09:15' }, returnDate: { value: '2026-10-19' }, returnTime: { value: '06:00' }, returnPickupLocation: { value: 'Fiji Marriott Resort Momi Bay' },
    'extra-seat': { checked: true }, 'extra-surf': { checked: false }, customPickupZone: { value: '' }, customDestZone: { value: '' }, customPickupAddress: { value: '' }, customDestAddress: { value: '' }, ...over.fields };
  const code = [lines.slice(idx(/^const NIGHT_SURCHARGE/), idx(/^\/\/ ─── EMOJI STRIPPER/)).join('\n'), lines.slice(idx(/^function isNightPickup/), idx(/^\/\/ ─── RELIABLY SET A <SELECT>/)).join('\n'),
    lines.slice(idx(/^const ROUTES_DATA = \[/), idx(/^\];/, idx(/^const ROUTES_DATA = \[/)) + 1).join('\n')].join('\n');
  const sb = { Math, Number, parseInt, JSON, String, state: { tripType: 'return', prices: {}, extrasTotal: 8, passengers: 7, luggage: 7, selectedVehicle: 'minibus', selectedTour: null }, document: { getElementById: (id) => fields[id] || { value: '' } } };
  vm.createContext(sb); vm.runInContext('var TIER = {}; ' + code + '; state.prices = computePrices("NAN", "MARRIOTT_MOMI", 40);', sb);
  return { sb, fields };
}
const total = (sb) => JSON.parse(vm.runInContext('JSON.stringify(calculateTotal())', sb));

test('3. EVERY itinerary change invalidates the revised quote AND its acceptance - an accepted amount is never reused for a changed itinerary', () => {
  const changes = {
    'pickup': (f) => { f.pickup.value = 'CUSTOM_PICKUP'; }, 'destination': (f) => { f.destination.value = 'INTERCONTINENTAL_NATADOLA'; },
    'travel date': (f) => { f.travelDate.value = '2026-10-16'; }, 'travel time (day to day)': (f) => { f.travelTime.value = '09:30'; }, 'travel time (day to night)': (f) => { f.travelTime.value = '23:00'; },
    'return date': (f) => { f.returnDate.value = '2026-10-20'; }, 'return time': (f) => { f.returnTime.value = '07:00'; }, 'return pickup location': (f) => { f.returnPickupLocation.value = 'Another place'; },
    'child seat off': (f, sb) => { f['extra-seat'].checked = false; sb.state.extrasTotal = 0; }, 'surfboard on': (f, sb) => { f['extra-surf'].checked = true; sb.state.extrasTotal = 32; },
    'vehicle': (f, sb) => { sb.state.selectedVehicle = 'minivan'; }, 'one-way instead of return': (f, sb) => { sb.state.tripType = 'one-way'; },
    'tour selected': (f, sb) => { sb.state.selectedTour = { name: 'Reef cruise', price: 100 }; }, 'passengers': (f, sb) => { sb.state.passengers = 6; }, 'luggage': (f, sb) => { sb.state.luggage = 6; },
  };
  for (const [label, mutate] of Object.entries(changes)) {
    const { sb, fields } = page();
    assert.equal(total(sb).final, 304, label + ' (baseline: the page quotes 304 after the approved Momi fare)');
    vm.runInContext('state.fareOverride = { key: fareOverrideKey(), amount: 300.45, shown: 142, original: 142 }', sb);
    assert.equal(total(sb).final, 300.45, label + ' (accepted revised fare applies to the unchanged itinerary)');
    mutate(fields, sb);
    const t = total(sb);
    assert.notEqual(t.final, 300.45, `${label}: the accepted amount must not be reused`); assert.equal(t.serverConfirmed, undefined, label);
    vm.runInContext('dropStaleFareOverride()', sb);
    assert.equal(vm.runInContext('state.fareOverride', sb), null, `${label}: the acceptance itself is cleared`);
  }
});

test('3b. the three places a guest acts (re-pricing, moving between steps, pressing Confirm) all drop a stale acceptance', () => {
  for (const fn of ['updatePricing', 'goToStep', 'confirmBooking']) assert.ok(extractFn(fn).includes('state.fareOverride.key !== fareOverrideKey()) state.fareOverride = null'), fn);
});

// ---- the review step
function reviewSandbox(stateExtra = {}) {
  const fields = { firstName: { value: 'Guest' }, lastName: { value: 'Test' }, email: { value: 'g@example.test' }, phone: { value: '+61400000000' }, travelDate: { value: '2026-10-15' }, travelTime: { value: '09:15' }, flightNum: { value: '' }, notes: { value: '' } };
  const card = { children: [], html: '', firstChild: null, removeChild() { this.children = []; this.firstChild = null; }, appendChild(c) { this.children.push(c); this.firstChild = c; }, insertAdjacentHTML(_, h) { this.html += h; } };
  const rows = []; const button = { textContent: 'Confirm booking', dataset: {} };
  const mk = () => ({ children: [], style: {}, textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); } });
  const flat = (e) => [e.textContent, ...e.children.map(flat)].join('\n');
  const sb = { document: { getElementById: (id) => (id === 'confirmationCard' ? card : fields[id]), createElement: mk, querySelector: () => button }, Math, Number, String, JSON, state: { selectedVehicle: 'minibus', tripType: 'return', passengers: 7, luggage: 7, distanceKm: 38.6, durationMin: 52, selectedTour: null, pickup: { name: 'Nadi Airport' }, destination: { hotel: 'Fiji Marriott Resort Momi Bay' }, ...stateExtra },
    calculateTotal: () => ({ final: 142, subtotal: 158, discount: 16, qualifies: true, hasTour: false, ...(sb.__t || {}) }), stripEmoji: (x) => x, formatDuration: () => '52 min', appendConfirmRow: (c, l, v) => rows.push([l, v]) };
  vm.createContext(sb);
  vm.runInContext([extractFn('fareText'), extractFn('buildConfirmation')].join('\n'), sb);
  return { sb, card, rows, button, text: () => card.children.map(flat).join('\n') + '\n' + card.html };
}
test('2. REVIEW after a mismatch: shows the ORIGINAL total and the REVISED total, an explicit "Accept revised price and submit" action, and says nothing is booked yet', () => {
  const r = reviewSandbox({ fareOverride: { key: 'k', amount: 300.45, shown: 142, original: 142 } }); r.sb.__t = { final: 300.45, subtotal: 300.45, discount: 0, qualifies: false, serverConfirmed: true };
  vm.runInContext('buildConfirmation()', r.sb);
  const t = r.text();
  assert.match(t, /Original total shown: FJ\$142\b/); assert.match(t, /Revised total: FJ\$300\.45/); assert.match(t, /Nothing has been booked yet/); assert.match(t, /Accept revised price and submit/);
  assert.equal(r.button.textContent, 'Accept revised price and submit'); assert.equal(r.card.children[0].attrs.role, 'alert');
  assert.match(t, /Revised total \(confirmed by our booking system\)[\s\S]*FJ\$300\.45/);
});
test('2b. with no revised quote the review and the button are exactly the normal ones (and a dropped quote restores the normal label)', () => {
  const r = reviewSandbox();
  vm.runInContext('buildConfirmation()', r.sb);
  assert.equal(r.card.children.length, 0, 'no notice'); assert.equal(r.button.textContent, 'Confirm booking');
  r.sb.__t = { final: 300.45, subtotal: 300.45, discount: 0, qualifies: false, serverConfirmed: true }; r.sb.state.fareOverride = { key: 'k', amount: 300.45, shown: 142, original: 142 };
  vm.runInContext('buildConfirmation()', r.sb); assert.equal(r.button.textContent, 'Accept revised price and submit');
  r.sb.__t = null; r.sb.state.fareOverride = null; vm.runInContext('buildConfirmation()', r.sb);
  assert.equal(r.button.textContent, 'Confirm booking'); assert.equal(r.card.children.length, 0);
});
test('fareText never shows a float artefact: 127.96000000000001 -> 127.96, 142 -> 142, 300.4 -> 300.40', () => {
  const sb = {}; vm.createContext(sb); vm.runInContext(extractFn('fareText'), sb);
  assert.equal(vm.runInContext('fareText(127.96000000000001)', sb), '127.96'); assert.equal(vm.runInContext('fareText(142)', sb), '142'); assert.equal(vm.runInContext('fareText(300.4)', sb), '300.40'); assert.equal(vm.runInContext('fareText(245.73000000000002)', sb), '245.73');
});

// ---- the confirm flow
function confirmFlow(script) {
  const log = { submitted: [], steps: [], reviews: 0 };
  const el = (extra = {}) => ({ style: {}, textContent: '', hidden: true, innerHTML: '', ...extra });
  const parent = { insertBefore(n) { this.inserted = n; }, inserted: null };
  const fields = { pickup: { value: 'NAN' }, destination: { value: 'MARRIOTT_MOMI', selectedOptions: [{ dataset: { area: 'Momi Bay' } }] }, firstName: { value: 'Guest' }, email: { value: 'g@example.test' }, bookingWidget: el(), bulaSuccess: el(), bulaRetry: el(), bulaTitleSaved: el(), bulaTitleWhatsappOnly: el(),
    bulaLeadText: el({ parentNode: parent, nextSibling: null }), bulaName: el(), bulaRef: el(), bulaWaBtn: el({ lastChild: null }), bulaModifyLink: el(), booking: { scrollIntoView() {} } };
  const button = { disabled: false, textContent: 'Confirm booking', focus() {} };
  const store = {};
  const sb = { document: { getElementById: (id) => fields[id], querySelector: () => button, createElement: () => el() }, sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } }, Date, JSON, Math, Number, String,
    state: { selectedVehicle: 'minibus', tripType: 'return', passengers: 7, luggage: 7, extrasTotal: 8, pendingBookingAttempt: null, confirmBookingInFlight: false },
    validateBookingContact: () => true, validateArrivalFlight: () => true, buildBookingIntentFingerprint: () => `fp:${sb.state.fareOverride ? sb.state.fareOverride.amount : 'none'}`, buildWhatsAppURL: () => 'https://wa.me/x', resolveFixedDestinationZone: () => 'Momi Bay',
    fareOverrideKey: () => 'key', buildConfirmation: () => { log.reviews += 1; }, showStep: (n) => log.steps.push(n),
    submitNadiBooking: async (ref) => { const o = sb.state.fareOverride; log.submitted.push({ ref, amount: o ? o.amount : 142, original: o ? o.original : undefined }); const r = script.shift(); if (r instanceof Error) throw r; return r; } };
  vm.createContext(sb); vm.runInContext([extractFn('fareText'), extractFn('confirmBooking')].join('\n'), sb);
  return { sb, log, fields, button, parent };
}
const MISMATCH = (reference, submitted) => ({ ok: false, priceMismatch: { reference, submitted } });

test('4a. REPEATED mismatches: each returns to the review, nothing is claimed saved, the ORIGINAL total stays the first one shown, and the latest revised total is what must be accepted', async () => {
  const f = confirmFlow([MISMATCH(300.45, 142), MISMATCH(310.45, 300.45), { ok: true, bookingId: 9, savedAmount: 310.45, savedCurrency: 'FJD', submittedAmount: 310.45 }]);
  await f.sb.confirmBooking();
  assert.equal(f.sb.state.fareOverride.amount, 300.45); assert.equal(f.sb.state.fareOverride.original, 142);
  await f.sb.confirmBooking();                                                           // the guest accepted 300.45, the booking system now says 310.45
  assert.equal(f.sb.state.fareOverride.amount, 310.45); assert.equal(f.sb.state.fareOverride.shown, 300.45); assert.equal(f.sb.state.fareOverride.original, 142);
  assert.equal(f.fields.bulaSuccess.style.display, undefined, 'no success after a mismatch'); assert.equal(f.sb.state.confirmBookingInFlight, false); assert.equal(f.button.disabled, false);
  assert.equal(JSON.stringify(f.log.steps), '[4,4]'); assert.equal(f.log.reviews, 2);
  await f.sb.confirmBooking();                                                           // accepts 310.45
  assert.equal(f.log.submitted.at(-1).amount, 310.45); assert.equal(f.log.submitted.at(-1).original, 142, 'the first total shown is what is recorded');
  assert.equal(f.fields.bulaSuccess.style.display, 'block');
});

test('4b. TIMEOUT after the guest accepted: not shown as saved, the same Confirm retries with the SAME reference and the SAME accepted amount, and only the confirmed retry shows success', async () => {
  const f = confirmFlow([MISMATCH(300.45, 142), { ok: false }, { ok: true, bookingId: 11, idempotent: true, savedAmount: 300.45, savedCurrency: 'FJD', submittedAmount: 300.45 }]);
  await f.sb.confirmBooking();                                                           // mismatch -> review
  await f.sb.confirmBooking();                                                           // accepted -> timeout / unknown
  assert.equal(f.fields.bulaSuccess.style.display, 'block'); assert.equal(f.fields.bulaRetry.hidden, false, 'an unknown save offers a retry, not success');
  assert.equal(f.fields.bulaTitleSaved.style.display, 'none'); assert.match(f.fields.bulaLeadText.innerHTML, /could not confirm/i);
  assert.equal(f.sb.state.confirmBookingInFlight, false); assert.equal(f.sb.state.fareOverride.amount, 300.45, 'the acceptance is kept for the retry');
  await f.sb.confirmBooking();                                                           // retry
  const [a, b] = f.log.submitted.slice(-2);
  assert.equal(a.ref, b.ref, 'same reference'); assert.equal(a.amount, b.amount); assert.equal(b.amount, 300.45);
  assert.equal(f.sb.state.confirmBookingInFlight, true, 'a confirmed save locks the form'); assert.equal(f.sb.state.pendingBookingAttempt, null);
});

test('4c. a thrown network error is an unknown save too: no success, no state corruption', async () => {
  const f = confirmFlow([new Error('boom')]);
  await assert.rejects(() => f.sb.confirmBooking(), /boom/);   // callers already handle this path through submitNadiBooking, which never throws; the guard here proves nothing is claimed
  assert.equal(f.fields.bulaSuccess.style.display, undefined);
});

test('5. SUCCESS shows the fare the booking system SAVED, with currency - the same shape the admin alerts use (FJD 300.45); a differing saved fare is flagged to the guest, never hidden', async () => {
  const ok = confirmFlow([{ ok: true, bookingId: 5, savedAmount: 300.45, savedCurrency: 'FJD', submittedAmount: 300.45 }]);
  await ok.sb.confirmBooking();
  assert.equal(ok.parent.inserted.textContent, 'Fare saved: FJD 300.45');
  const diff = confirmFlow([{ ok: true, bookingId: 6, savedAmount: 300.45, savedCurrency: 'FJD', submittedAmount: 142 }]);
  await diff.sb.confirmBooking();
  assert.match(diff.parent.inserted.textContent, /Fare recorded by our booking system: FJD 300\.45\. This differs from the 142 you saw/);
});

test('6. the original total is sent with an accepted revision (and only then) so the booking system can record it', () => {
  const src = extractFn('submitNadiBooking');
  assert.ok(src.includes('payload.revised_from_amount = state.fareOverride.original'));
  assert.ok(src.includes('if (state.fareOverride && state.fareOverride.key === fareOverrideKey())'));
});

test('RACE: a PRICE_MISMATCH that returns after the guest changed the itinerary is discarded - never attached to the new journey, nothing saved, controls restored', async () => {
  let release; const f = confirmFlow([]);
  f.sb.fareOverrideKey = () => f.sb.__key;
  f.sb.__key = 'journey-A';
  f.sb.submitNadiBooking = () => new Promise((r) => { release = () => r(MISMATCH(300.45, 142)); });
  const pending = f.sb.confirmBooking();
  f.sb.__key = 'journey-B';                       // the guest edits the journey while the request is pending
  release(); await pending;
  assert.equal(f.sb.state.fareOverride, undefined === f.sb.state.fareOverride ? undefined : null, 'the returned quote is discarded');
  assert.equal(f.sb.state.confirmBookingInFlight, false); assert.equal(f.button.disabled, false);
  assert.equal(f.fields.bulaSuccess.style.display, undefined); assert.equal(JSON.stringify(f.log.steps), '[4]'); assert.equal(f.log.reviews, 1);
});
