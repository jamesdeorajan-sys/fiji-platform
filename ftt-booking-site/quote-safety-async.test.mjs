// Quote safety under asynchronous changes (candidate): stale fare-lookup responses (selection AND review), stale PRICE_MISMATCH responses, itinerary edits during
// submission, repeated revised quotes, and manual retry after replies are lost. Real candidate page code + the real deployed Worker bundle where a booking is involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'src', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const { createRig } = await import(pathToFileURL(path.join(here, 'test-fixtures', 'real-worker-rig.mjs')).href);
const BUNDLE = path.join(here, 'test-fixtures', 'worker-deployed-7a32a034.mjs');
console.warn = () => {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };

function fn(name) { const s = src.indexOf(`function ${name}(`); assert.ok(s >= 0, name); let i = src.indexOf('{', s), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return (src.slice(s - 6, s) === 'async ' ? 'async ' : '') + src.slice(s, i + 1); } throw new Error(name); }
const konst = (n) => { const m = src.match(new RegExp('const ' + n + '\\s*= [^;]+;')); assert.ok(m, n); return m[0]; };
const LIVE = ['DISCOUNT_THRESHOLD', 'DISCOUNT_RATE', 'NEGOTIATION_FLOOR_RATIO', 'LIVE_FARE_FETCH_TIMEOUT_MS', 'LIVE_FARE_TTL_MS', 'LIVE_FARE_MAX_ATTEMPTS', 'LIVE_FARE_RETRY_DELAYS_MS', 'LIVE_FARE_CLASSES', 'PAGE_RETURN_CONVENTION_DESTS'].map(konst).join('\n') + '\n'
  + ['bookingHasTour', 'fareOverrideKey', 'fareText', 'calculateTotal', 'calculateTotalFromPublishedPrices', 'pageReturnConventionApplies', 'liveFareEligible', 'applyLiveFares', 'renderLiveFareNote', 'startLiveFareFetch', 'retryLiveFares', 'applyOrFetchLiveFares', 'resolveNegotiationEligibility', 'renderFareTiers'].map(fn).join('\n');
const SUBMIT = ['bookingHasTour', 'fareOverrideKey', 'fareText', 'calculateTotal', 'calculateTotalFromPublishedPrices', 'bookingRequest', 'submitMarketplaceBooking', 'reviewRevisedFare', 'showBulaSuccess', 'bulaFirstName', 'hideBookingWidget', 'renderPriceBlock'].map(fn).join('\n') + '\n' + ['DISCOUNT_THRESHOLD', 'DISCOUNT_RATE', 'ACCEPT_COOLDOWN_MS'].map(konst).join('\n');

const el = (id, extra = {}) => ({ id, style: {}, value: '', checked: false, textContent: '', disabled: false, parentNode: null, children: [], dataset: {}, setAttribute() {}, appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, insertBefore(c) { this.children.push(c); c.parentNode = this; return c; }, remove() {}, scrollIntoView() {}, insertAdjacentHTML() {}, ...extra });
function dom(fields) { const els = new Map(); const get = (id) => { if (!els.has(id)) { const e = el(id, fields[id] || {}); if (id === 'priceBreakdown' || id === 'bulaLeadText') { const p = el('p'); p.children.push(e); e.parentNode = p; } els.set(id, e); } return els.get(id); }; return { els, document: { getElementById: get, createElement: () => el(''), querySelector: () => get('confirmBtn') } }; }

// ---------- A. stale fare-lookup responses ----------
function liveCtx({ fetchImpl, dest = 'HILTON_DENARAU', zone = 'Denarau', trip = 'one-way', vehicle = 'sedan', prices }) {
  const d = dom({ pickup: { value: 'NAN' }, destination: { value: dest }, travelTime: { value: '10:00' }, travelDate: { value: '2026-10-20' } });
  const sb = { Math, Number, JSON, String, Date, isFinite, Promise, setTimeout, console, BOAT_DESTINATION_IDS: {}, document: d.document,
    state: { tripType: trip, prices: prices || { sedan: 49, minivan: 69, minibus: 99 }, priceSource: 'published', destZoneName: zone, extrasTotal: 0, passengers: 2, luggage: 2, selectedVehicle: vehicle, selectedTour: null, liveFares: null, liveFaresPending: null, liveFareAttempts: null, fareOverride: null },
    updatePricing: () => {}, stopNegotiationPolling: () => {}, renderPriceBlock: () => {}, formatPrice: String, resolveConfirmedPickupZone: () => 'Nadi Airport', resolveConfirmedDestinationZone: () => sb.state.destZoneName, fetchRealReferenceFare: fetchImpl };
  vm.createContext(sb); vm.runInContext(LIVE.replace(/const LIVE_FARE_FETCH_TIMEOUT_MS = \d+;/, 'const LIVE_FARE_FETCH_TIMEOUT_MS = 5000;'), sb);
  return { sb, d };
}

test('stale SELECTION lookup: an answer for the previous destination, or the previous trip type, never lands on the new selection', async () => {
  const slow = deferred();
  const c = liveCtx({ fetchImpl: async (pz, dz, vt, tt) => (dz === 'Denarau' ? slow.p.then((v) => v[vt]) : { sedan: 30.15, minivan: 46.42, minibus: 71.46 }[vt]) });
  c.sb.applyOrFetchLiveFares('NAN', 'HILTON_DENARAU');                                  // lookup for Denarau/one-way starts and stalls
  c.sb.state.destZoneName = 'Nadi'; c.sb.state.prices = { sedan: 19, minivan: 49, minibus: 79 };   // guest picks Nadi instead
  c.sb.applyOrFetchLiveFares('NAN', 'MERCURE_NADI'); await wait(30);
  c.sb.state.prices = { sedan: 19, minivan: 49, minibus: 79 }; c.sb.applyOrFetchLiveFares('NAN', 'MERCURE_NADI');
  assert.deepEqual({ ...c.sb.state.prices }, { sedan: 30.15, minivan: 46.42, minibus: 71.46 });
  slow.resolve({ sedan: 47.87, minivan: 69.08, minibus: 91.02 });                       // the OLD Denarau answer arrives late
  await wait(30);
  assert.equal(c.sb.state.liveFares.key.startsWith('Nadi'), true, 'late Denarau answer not stored over the Nadi selection');
  c.sb.state.prices = { sedan: 19, minivan: 49, minibus: 79 }; c.sb.applyOrFetchLiveFares('NAN', 'MERCURE_NADI');
  assert.deepEqual({ ...c.sb.state.prices }, { sedan: 30.15, minivan: 46.42, minibus: 71.46 }, 'Nadi still shows its own live fares');
  // trip type: a one-way answer arriving after the guest switched to return
  const slow2 = deferred();
  const c2 = liveCtx({ fetchImpl: async (pz, dz, vt, tt) => (tt === 'one-way' ? slow2.p.then((v) => v[vt]) : { sedan: 79.56, minivan: 122.1, minibus: 160 }[vt]) });
  c2.sb.applyOrFetchLiveFares('NAN', 'HILTON_DENARAU'); c2.sb.state.tripType = 'return'; c2.sb.state.prices = { sedan: 85, minivan: 130, minibus: 170 };
  c2.sb.applyOrFetchLiveFares('NAN', 'HILTON_DENARAU'); await wait(30);
  slow2.resolve({ sedan: 47.87, minivan: 69.08, minibus: 91.02 }); await wait(30);
  c2.sb.state.prices = { sedan: 85, minivan: 130, minibus: 170 }; c2.sb.applyOrFetchLiveFares('NAN', 'HILTON_DENARAU');
  assert.equal(c2.sb.state.prices.sedan, 79.56, 'the one-way fare never replaces the return fare');
});

test('stale REVIEW lookup (renderFareTiers): a slow answer from an earlier render never overwrites the price of a later render', async () => {
  const first = deferred(); let n = 0;
  const c = liveCtx({ fetchImpl: async () => (++n === 1 ? first.p : 50) });
  c.sb.renderFareTiers(); c.sb.renderFareTiers(); await wait(30);
  assert.equal(c.sb.state.prices.sedan, 50);
  first.resolve(100); await wait(30);
  assert.equal(c.sb.state.prices.sedan, 50, 'old answer ignored');
});

test('stale REVIEW lookup after the guest changed the trip WITHOUT re-entering the review step (Back, then change trip type): the one-way answer must not overwrite the return price', async () => {
  const slow = deferred();
  const c = liveCtx({ fetchImpl: async () => slow.p });
  c.sb.renderFareTiers();                                                  // review step: one-way lookup in flight
  c.sb.state.tripType = 'return'; c.sb.state.prices = { sedan: 85, minivan: 130, minibus: 170 };   // Back -> Step 1 -> Return selected; prices recomputed for the return
  slow.resolve(47.87); await wait(30);
  assert.equal(c.sb.state.prices.sedan, 85, 'return price intact');
});

// ---------- B. submission-side races (real Worker) ----------
async function submitScenario({ staticFare = 19, vehicle = 'sedan', trip = 'one-way', zone = 'Nadi', dest = 'MERCURE_NADI', fetchWrap } = {}) {
  const rig = await createRig({ bundle: BUNDLE }); const sent = [];
  const d = dom({ firstName: { value: 'QA' }, lastName: { value: 'Test' }, phone: { value: '+61400000000' }, email: { value: 'qa-test@example.invalid' }, flightNum: { value: 'FJ1' }, notes: { value: '' }, travelDate: { value: '2026-10-20' }, travelTime: { value: '10:00' }, pickup: { value: 'NAN' }, destination: { value: dest }, returnDate: { value: '2026-10-27' }, returnTime: { value: '10:00' }, returnPickupLocation: { value: 'Hotel' }, 'extra-seat': { checked: false }, 'extra-surf': { checked: false }, confirmBtn: { textContent: 'Confirm' } });
  const real = async (url, init) => { const body = JSON.parse(init.body); sent.push(body); const r = await rig.post(body); return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }; };
  const sb = { Math, Number, JSON, String, Promise, Date, console, isFinite, setTimeout, clearTimeout, AbortController, Error, document: d.document, window: {}, NADI_API_BASE: 'https://api.nadiairporttransfers.com', BOAT_DESTINATION_IDS: {}, BULA_WA_ICON_SVG: '',
    state: { tripType: trip, prices: { sedan: staticFare, minivan: 99, minibus: 199 }, extrasTotal: 0, passengers: 2, luggage: 2, selectedVehicle: vehicle, selectedTour: null, distanceKm: 6.8, durationMin: 12, fareOverride: null, boatQuoteResult: null, currentBookingRef: null, confirmBookingInFlight: false },
    resolveConfirmedPickupZone: () => 'Nadi Airport', resolveConfirmedDestinationZone: () => zone, resolveDurableNotes: (x) => x || null, getAttributionForPayload: () => ({}), trackBookingFunnel() {}, reportBookingSyncFailure: async () => {}, formatPrice: (n) => `FJ$${n}`,
    buildWhatsAppURL: () => 'x', setBulaModifyLink() {}, buildConfirmation: () => { sb.renderPriceBlock(); }, showStep: (n) => { sb.step = n; }, fetch: fetchWrap ? fetchWrap(real) : real };
  vm.createContext(sb); vm.runInContext(SUBMIT, sb);
  return { sb, rig, d, sent };
}

test('itinerary edited WHILE a booking write is in flight: a late 201 reports what was saved, and a late 409 is not attached to the edited trip', async () => {
  // 409 case covered in quote-consent.test.mjs; here the write SUCCEEDS after the edit
  const gate = deferred();
  const s = await submitScenario({ staticFare: 30.15, fetchWrap: (real) => async (u, i) => { await gate.p; return real(u, i); } });
  const key = s.sb.fareOverrideKey();
  const pending = s.sb.submitMarketplaceBooking('FD-RACE1');
  s.d.els.get('extra-seat').checked = true; s.sb.state.extrasTotal = 8;            // guest edits during the write
  gate.resolve(); const r = await pending;
  assert.equal(r.ok, true); assert.equal(s.sent[0].has_child_seat, false, 'the request carried the itinerary it was priced for');
  assert.equal(r.savedAmount, 30.15);
  assert.notEqual(key, s.sb.fareOverrideKey());
  s.sb.showBulaSuccess('FD-RACE1', r.bookingId, r);
  assert.equal(s.d.els.get('bulaFare').textContent, 'Fare saved: FJD 30.15', 'the success card states what was actually saved');
  // a late 409 for the OLD itinerary, then the guest edits again: nothing carries over
  const s2 = await submitScenario({ staticFare: 19 });
  const k2 = s2.sb.fareOverrideKey(); const refused = await s2.sb.submitMarketplaceBooking('FD-RACE2');
  s2.sb.state.selectedVehicle = 'minivan';
  s2.sb.reviewRevisedFare(refused.priceMismatch, k2, null);
  assert.equal(s2.sb.state.fareOverride, null); assert.equal(s2.rig.all.inserted.length, 0);
});

test('REPEATED revised quotes: each refusal replaces the revised amount, the ORIGINAL shown total is never overwritten, and only the last accepted amount is saved', async () => {
  const s = await submitScenario({ staticFare: 19 });
  const k = s.sb.fareOverrideKey();
  const r1 = await s.sb.submitMarketplaceBooking('FD-REP'); s.sb.reviewRevisedFare(r1.priceMismatch, k, null);
  assert.equal(s.sb.state.fareOverride.amount, 30.15);
  // the Worker's fare moves between attempts (simulated: the accepted amount is now refused with a different reference fare)
  s.sb.reviewRevisedFare({ reference: 31.5, submitted: 30.15 }, k, null);
  assert.deepEqual([s.sb.state.fareOverride.original, s.sb.state.fareOverride.shown, s.sb.state.fareOverride.amount], [19, 30.15, 31.5]);
  s.sb.reviewRevisedFare({ reference: 30.15, submitted: 31.5 }, k, null);
  assert.equal(s.sb.state.fareOverride.original, 19);
  const ok = await s.sb.submitMarketplaceBooking('FD-REP');
  assert.equal(ok.ok, true); assert.equal(s.sent.at(-1).quoted_amount, 30.15); assert.equal(s.sent.at(-1).revised_from_amount, 19);
  assert.equal(s.rig.all.inserted.length, 1); assert.equal(s.rig.all.inserted[0].quoted_amount, 30.15);
});

test('a refusal arriving after the guest changed VEHICLE or TRIP TYPE is discarded too', async () => {
  for (const mutate of [(sb) => { sb.state.selectedVehicle = 'minivan'; }, (sb) => { sb.state.tripType = 'return'; }]) {
    const s = await submitScenario({ staticFare: 19 }); const k = s.sb.fareOverrideKey(); const r = await s.sb.submitMarketplaceBooking('FD-STALE');
    mutate(s.sb); s.sb.reviewRevisedFare(r.priceMismatch, k, null);
    assert.equal(s.sb.state.fareOverride, null);
  }
});

test('MANUAL RETRY after the replies are LOST (first write committed, its reply lost; the retry\'s reply lost too; the third attempt answers): one booking, the same reference, the saved amount shown', async () => {
  let calls = 0;
  const s = await submitScenario({ staticFare: 30.15, fetchWrap: (real) => async (u, i) => { const r = await real(u, i); calls++; if (calls <= 2) throw new TypeError('Failed to fetch'); return r; } });
  const a = await s.sb.submitMarketplaceBooking('FD-LOST'); assert.equal(a.ok, false); assert.equal(a.resultKind, 'unknown');
  const b = await s.sb.submitMarketplaceBooking('FD-LOST'); assert.equal(b.ok, false); assert.equal(b.resultKind, 'unknown');
  const c = await s.sb.submitMarketplaceBooking('FD-LOST'); assert.equal(c.ok, true); assert.equal(c.idempotent, true);
  assert.equal(s.rig.all.inserted.length, 1, 'exactly one booking'); assert.equal(new Set(s.sent.map((x) => x.client_booking_ref)).size, 1);
  assert.equal(c.savedAmount, 30.15);
});

test('MANUAL RETRY after a LOST reply to the ACCEPTED revised price: the retry replays the same accepted amount against the same reference (idempotent), never a new quote', async () => {
  let calls = 0;
  const s = await submitScenario({ staticFare: 19, fetchWrap: (real) => async (u, i) => { const r = await real(u, i); calls++; if (calls === 2) throw new TypeError('Failed to fetch'); return r; } });
  const k = s.sb.fareOverrideKey(); const first = await s.sb.submitMarketplaceBooking('FD-ACC');   // call 1: 409
  s.sb.reviewRevisedFare(first.priceMismatch, k, null);
  const lost = await s.sb.submitMarketplaceBooking('FD-ACC');                                       // call 2: saved at 30.15, reply lost
  assert.equal(lost.resultKind, 'unknown'); assert.equal(s.rig.all.inserted.length, 1);
  const retry = await s.sb.submitMarketplaceBooking('FD-ACC');                                      // call 3: same ref, same amount
  assert.equal(retry.ok, true); assert.equal(retry.idempotent, true); assert.equal(s.rig.all.inserted.length, 1);
  assert.equal(s.sent[2].quoted_amount, 30.15); assert.equal(s.sent[2].revised_from_amount, 19);
  assert.equal(retry.savedAmount, 30.15);
});
