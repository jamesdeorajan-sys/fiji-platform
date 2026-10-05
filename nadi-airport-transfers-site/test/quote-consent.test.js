// P0 booking #237 (FTT-UKAZTE): the guest saw FJ$142, the booking system saved and alerted FJ$300.45, and the guest was never told.
// The page prices from its published table (minibus FJ$79 for Marriott Momi Bay: return 150 + child seat 8 - 10% = 142); the booking system prices
// from its own distance formula (175.92 x 1.85 + 8 - 33 = 300.45). Repair: the page opts in to require_quote_match; on a mismatch nothing is saved,
// the guest is shown the booking system's fare on the review step and must accept it, and the amount that is saved is the amount they accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/\r/g, '');
const lines = source.split('\n');
const idx = (re, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l));
const between = (a, b) => lines.slice(idx(a), idx(b)).join('\n');

// ---- the page's own price functions and catalogue, evaluated in a sandbox
function pricing({ time = '09:15', trip = 'return', seat = true, vehicle = 'minibus', dest = 'MARRIOTT_MOMI' } = {}) {
  const calcStart = idx(/^const NIGHT_SURCHARGE/);
  const code = [
    lines.slice(calcStart, idx(/^\/\/ ─── EMOJI STRIPPER/)).join('\n'),
    lines.slice(idx(/^function isNightPickup/), idx(/^\/\/ ─── RELIABLY SET A <SELECT>/)).join('\n'),
    lines.slice(idx(/^const ROUTES_DATA = \[/), idx(/^\];/, idx(/^const ROUTES_DATA = \[/)) + 1).join('\n'),
  ].join('\n');
  const sb = { Math, Number, parseInt, JSON, state: { tripType: trip, prices: {}, extrasTotal: seat ? 8 : 0, passengers: 7, selectedVehicle: vehicle, selectedTour: null },
    document: { getElementById: (id) => ({ value: ({ travelTime: time, pickup: 'NAN', destination: dest })[id] ?? '' }) } };
  vm.createContext(sb);
  vm.runInContext('var TIER = {}; ' + code + '; state.prices = computePrices("NAN", "' + dest + '", 40);', sb);
  return sb;
}

test('the page now quotes the exact #237 itinerary FJ$304 (it quoted 142 before the approved Momi fare) (minibus 79 -> return 150, child seat 8, 10% off) from its published table', () => {
  const sb = pricing();
  const t = vm.runInContext('calculateTotal()', sb);
  assert.equal(t.vehiclePrice, 330); assert.equal(t.subtotal, 338); assert.equal(t.discount, 34); assert.equal(t.final, 304); // after the approved Momi minibus fare (was 150/158/16/142 = booking #237)
  assert.equal(vm.runInContext('state.prices.source', sb), 'published');
  assert.equal(vm.runInContext('isNightPickup()', sb), false);
});

test('an ACCEPTED booking-system fare replaces the displayed total ONLY for the same pricing inputs; changing the trip, vehicle, extras or day/night drops it', () => {
  const calcSrc = between(/^\/\/ P0 booking #237/, /^\/\/ James-approved FINAL fare/);
  assert.ok(calcSrc.includes('fareOverrideKey'), 'the override exists');
  const sb = pricing();
  vm.runInContext(calcSrc.replace(/function calculateTotal\(vehicleKey\) \{[\s\S]*$/, '') , sb); // fareOverrideKey only
  // re-evaluate the real calculateTotal wrapper on top of the page's own published calculation
  const wrapper = lines.slice(idx(/^function calculateTotal\(vehicleKey\)/), idx(/^\/\/ James-approved FINAL fare/)).join('\n');
  vm.runInContext(wrapper.replace('function calculateTotal(', 'function calculateTotalWithOverride('), sb);
  vm.runInContext('state.fareOverride = { key: fareOverrideKey(), amount: 300.45, shown: 142 };', sb);
  const t = vm.runInContext('calculateTotalWithOverride()', sb);
  assert.equal(JSON.stringify([t.final, t.subtotal, t.discount, t.qualifies, t.serverConfirmed]), JSON.stringify([300.45, 300.45, 0, false, true]));
  vm.runInContext('state.extrasTotal = 0', sb);
  assert.equal(vm.runInContext('calculateTotalWithOverride()', sb).serverConfirmed, undefined, 'extras changed: the accepted fare no longer applies');
  vm.runInContext('state.extrasTotal = 8; state.tripType = "one-way"', sb);
  assert.equal(vm.runInContext('calculateTotalWithOverride()', sb).serverConfirmed, undefined, 'trip type changed: dropped');
});

// ---- the submit
const submitSrc = () => source.slice(source.indexOf('async function submitNadiBooking('), source.indexOf('// Same non-blocking, fire-and-forget escalation pattern'));
function submitSandbox(response) {
  const calls = []; const escalations = [];
  const fields = { firstName: { value: 'Guest' }, lastName: { value: 'Test' }, phone: { value: '+61400000000' }, email: { value: 'g@example.test' }, flightNum: { value: '' }, notes: { value: '' }, travelDate: { value: '2026-10-15' }, travelTime: { value: '09:15' },
    returnDate: { value: '2026-10-19' }, returnTime: { value: '06:00' }, returnPickupLocation: { value: 'Fiji Marriott Resort Momi Bay' }, 'extra-seat': { checked: true }, 'extra-surf': { checked: false } };
  const sb = { document: { getElementById: (id) => fields[id] }, state: { selectedVehicle: 'minibus', tripType: 'return', distanceKm: 40, passengers: 7, luggage: 7, destination: { hotel: 'Fiji Marriott Resort Momi Bay' } },
    NADI_API_BASE: 'https://api.test', JSON, Number, approvedFinalFareFor: () => null, APPROVED_FINAL_FARE_ID: 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY', calculateTotal: () => ({ final: 142 }), buildOperationalNotes: () => 'notes',
    bookingRequest: async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return response; }, reportNadiSyncFailure: async (...a) => { escalations.push(a); } };
  vm.createContext(sb); vm.runInContext(submitSrc(), sb);
  return { sb, calls, escalations };
}
test('the page sends the amount it SHOWED, and opts in to require_quote_match', async () => {
  const { sb, calls } = submitSandbox({ response: { ok: true, status: 201 }, data: { ok: true, booking_id: 7 } });
  const r = await sb.submitNadiBooking('FTT-TEST', 'Momi Bay');
  assert.equal(r.ok, true); assert.equal(calls[0].body.quoted_amount, 142); assert.equal(calls[0].body.require_quote_match, true); assert.equal(calls[0].body.has_child_seat, true);
});
test('a 409 PRICE_MISMATCH is surfaced as a price mismatch - not a failed save: no sync-failure alert, nothing claimed', async () => {
  const { sb, escalations } = submitSandbox({ response: { ok: false, status: 409 }, data: { ok: false, code: 'PRICE_MISMATCH', reference_fare_fjd: 300.45, submitted_amount_fjd: 142, errors: ['x'] } });
  const r = await sb.submitNadiBooking('FTT-TEST', 'Momi Bay');
  assert.equal(r.ok, false); assert.equal(JSON.stringify(r.priceMismatch), JSON.stringify({ reference: 300.45, submitted: 142 }));
  assert.equal(escalations.length, 0);
});
test('any other failure is still a failed save (unchanged)', async () => {
  const { sb, escalations } = submitSandbox({ response: { ok: false, status: 400 }, data: { ok: false, errors: ['nope'] } });
  const r = await sb.submitNadiBooking('FTT-TEST', 'Momi Bay');
  assert.equal(r.ok, false); assert.equal(r.priceMismatch, undefined); assert.equal(escalations.length, 1);
});

// ---- the confirm flow
function confirmSandbox(results) {
  const log = { confirmations: 0, steps: [], submitted: [] };
  const fields = { pickup: { value: 'NAN' }, destination: { value: 'MARRIOTT_MOMI', selectedOptions: [{ dataset: { area: 'Momi Bay' } }] }, firstName: { value: 'Guest' }, email: { value: 'g@example.test' },
    bookingWidget: { style: {} }, bulaSuccess: { style: {} }, bulaRetry: { hidden: true }, bulaTitleSaved: { style: {} }, bulaTitleWhatsappOnly: { style: {}, textContent: '' }, bulaLeadText: { textContent: '', innerHTML: '' }, bulaName: {}, bulaRef: {}, bulaWaBtn: { lastChild: null }, bulaModifyLink: {}, booking: { scrollIntoView() {} } };
  const button = { disabled: false, textContent: 'Confirm', focus() {} };
  const sb = { document: { getElementById: (id) => fields[id], querySelector: () => button }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, Date, JSON,
    state: { selectedVehicle: 'minibus', tripType: 'return', passengers: 7, luggage: 7, extrasTotal: 8, pendingBookingAttempt: null, confirmBookingInFlight: false },
    validateBookingContact: () => true, validateArrivalFlight: () => true, buildBookingIntentFingerprint: () => 'fp', buildWhatsAppURL: () => 'https://wa.me/x',
    resolveFixedDestinationZone: () => 'Momi Bay', fareOverrideKey: () => 'key', buildConfirmation: () => { log.confirmations += 1; }, showStep: (n) => { log.steps.push(n); },
    submitNadiBooking: async (ref) => { log.submitted.push({ ref, override: sb.state.fareOverride && sb.state.fareOverride.amount }); return results.shift(); } };
  vm.createContext(sb);
  vm.runInContext(source.slice(source.indexOf('async function confirmBooking()'), source.indexOf('// Reopen the existing form')), sb);
  return { sb, log, fields, button };
}
test('MISMATCH on confirm: nothing is claimed saved, the guest is returned to the review with the new fare, the button works again, and the attempt reference is kept', async () => {
  const { sb, log, fields, button } = confirmSandbox([{ ok: false, priceMismatch: { reference: 300.45, submitted: 142 } }, { ok: true, bookingId: 238 }]);
  await sb.confirmBooking();
  assert.equal(JSON.stringify(sb.state.fareOverride), JSON.stringify({ key: 'key', amount: 300.45, shown: 142, original: 142 }));
  assert.equal(log.confirmations, 1, 'the review is rebuilt with the new fare'); assert.equal(JSON.stringify(log.steps), '[4]');
  assert.equal(fields.bulaSuccess.style.display, undefined, 'no success card'); assert.equal(fields.bookingWidget.style.display, undefined, 'the form stays');
  assert.equal(fields.bulaRetry.hidden, true, 'not presented as a failed save either');
  assert.equal(button.disabled, false); assert.equal(sb.state.confirmBookingInFlight, false);
  const firstRef = log.submitted[0].ref; assert.ok(firstRef);
  // the guest accepts: the same Confirm now submits with the accepted fare in force
  await sb.confirmBooking();
  assert.equal(log.submitted.length, 2); assert.equal(log.submitted[1].override, 300.45);
  assert.equal(log.submitted[1].ref, firstRef, 'same reference: no booking existed, nothing duplicated');
  assert.equal(fields.bulaSuccess.style.display, 'block'); assert.equal(sb.state.confirmBookingInFlight, true);
});

test('the review step tells the guest plainly, with both totals and an explicit accept action', () => {
  const start = source.indexOf('function buildConfirmation()');
  const body = source.slice(start, start + 9000);
  for (const text of ['Original total shown: FJ$', 'Revised total: FJ$', 'Accept revised price and submit', 'Nothing has been booked yet']) assert.ok(body.includes(text), text);
  assert.ok(source.includes('Revised total (confirmed by our booking system)'));
  assert.ok(body.includes("setAttribute('role', 'alert')"));
});
