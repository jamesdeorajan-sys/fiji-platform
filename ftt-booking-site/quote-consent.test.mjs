// FijiDash quote consent (2026-10-05, preview): the guest is shown a total, asks to book it, and the booking system must never quietly save a different one.
//   - the page code is the REAL candidate app.js (functions sliced and run in a vm sandbox);
//   - the Worker is the REAL deployed Worker (dry-run bundle of production, test-fixtures/worker-deployed-7a32a034.mjs) over an in-memory database seeded from
//     a read-only production pricing snapshot (2026-09-27); every outbound call the Worker makes is recorded and BLOCKED. No network, no live booking.
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

function fn(name) {
  const s = src.indexOf(`function ${name}(`); assert.ok(s >= 0, name);
  const from = src.lastIndexOf('\n', s) + 1; const head = src.slice(from, s).includes('async ') ? from : s;
  let i = src.indexOf('{', s), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return (src.slice(s - 6, s) === 'async ' ? 'async ' : '') + src.slice(s, i + 1); }
  throw new Error('unbalanced ' + name);
}
const konst = (n) => { const m = src.match(new RegExp('const ' + n + '\\s*= [^;]+;')); assert.ok(m, n); return m[0]; };
const FUNCS = ['bookingHasTour', 'fareOverrideKey', 'dropStaleFareOverride', 'fareText', 'calculateTotal', 'calculateTotalFromPublishedPrices', 'renderPriceBlock', 'bookingRequest', 'submitMarketplaceBooking', 'reviewRevisedFare', 'showBulaSuccess', 'bulaFirstName', 'hideBookingWidget'];
const CODE = ['DISCOUNT_THRESHOLD', 'DISCOUNT_RATE'].map(konst).join('\n') + '\n' + FUNCS.map(fn).join('\n');

// a minimal DOM: elements by id, created on demand, enough for the price block, the notice, the buttons and the success card
function makeDom(fields) {
  const els = new Map();
  const mk = (id) => {
    const e = { id, style: {}, children: [], dataset: {}, textContent: '', innerHTML: '', value: '', checked: false, disabled: false, parentNode: null, attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; }, remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; if (this.id) els.delete(this.id); },
      appendChild(c) { c.parentNode = this; this.children.push(c); if (c.id) els.set(c.id, c); return c; },
      insertBefore(c, ref) { c.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); if (c.id) els.set(c.id, c); return c; },
      insertAdjacentHTML() {}, scrollIntoView() {}, focus() {} };
    return e;
  };
  const get = (id) => { if (!els.has(id)) { const e = mk(id); Object.assign(e, fields[id] || {}); els.set(id, e); if (id === 'priceBreakdown' || id === 'bulaLeadText') { const p = mk('parent-of-' + id); p.children.push(e); e.parentNode = p; } } return els.get(id); };
  return { els, document: { getElementById: get, createElement: () => mk(''), querySelector: (sel) => (/btn-confirm/.test(sel) ? get('confirmBtn') : null) } };
}

async function scenario({ zone = 'Nadi', dest = 'MERCURE_NADI', vehicle = 'sedan', trip = 'one-way', seat = false, time = '10:00', prices, staticFare, bookingResponder } = {}) {
  const rig = await createRig({ bundle: BUNDLE });
  const dom = makeDom({
    firstName: { value: 'QA' }, lastName: { value: 'Test' }, phone: { value: '+61400000000' }, email: { value: 'qa-test@example.invalid' }, flightNum: { value: 'FJ1' }, notes: { value: '' },
    travelDate: { value: '2026-10-20' }, travelTime: { value: time }, pickup: { value: 'NAN' }, destination: { value: dest }, returnDate: { value: '2026-10-27' }, returnTime: { value: '10:00' }, returnPickupLocation: { value: 'Hotel' },
    'extra-seat': { checked: seat }, 'extra-surf': { checked: false }, confirmBtn: { textContent: '✓ Confirm booking request' },
  });
  const sent = [];
  const sb = {
    Math, Number, JSON, String, Promise, Date, console, isFinite, setTimeout, clearTimeout, AbortController, Error,
    document: dom.document, window: {}, NADI_API_BASE: 'https://api.nadiairporttransfers.com', BOAT_DESTINATION_IDS: {}, BULA_WA_ICON_SVG: '',
    state: { tripType: trip, prices: prices || { sedan: staticFare, minivan: 99, minibus: 199 }, extrasTotal: seat ? 8 : 0, passengers: 2, luggage: 2, selectedVehicle: vehicle, selectedTour: null, distanceKm: 6.8, durationMin: 12, fareOverride: null, boatQuoteResult: null, currentBookingRef: null, confirmBookingInFlight: false },
    resolveConfirmedPickupZone: () => 'Nadi Airport', resolveConfirmedDestinationZone: () => zone, resolveDurableNotes: (x) => x || null, getAttributionForPayload: () => ({}), trackBookingFunnel() {},
    reportBookingSyncFailure: async (...a) => { sb.escalations.push(a); }, escalations: [], formatPrice: (n) => `FJ$${n}`, buildWhatsAppURL: () => 'https://wa.me/x', setBulaModifyLink() {}, buildConfirmation: () => { sb.rebuilt = (sb.rebuilt || 0) + 1; sb.renderPriceBlock(); }, showStep: (n) => { sb.step = n; },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); sent.push(body);
      const r = await rig.post(body);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
    },
  };
  vm.createContext(sb);
  vm.runInContext(CODE, sb);
  return { sb, rig, dom, sent };
}
const money = (n) => Math.round(n * 100) / 100;

test('legacy behaviour is gone: the page ALWAYS opts in to require_quote_match, and sends whole cents', async () => {
  const { sb, sent } = await scenario({ staticFare: 30.15 });
  const r = await sb.submitMarketplaceBooking('FD-T1');
  assert.equal(r.ok, true);
  assert.equal(sent[0].require_quote_match, true);
  assert.equal(sent[0].quoted_amount, 30.15);
  assert.equal(sent[0].revised_from_amount, undefined, 'no revised_from_amount unless the guest is accepting a revised total');
});

test('REAL Worker: a shown fare far from the Worker fare (Mercure sedan FJ$19 vs 30.15) is REFUSED with 409 - nothing saved, no alert, no message, no sync-failure report', async () => {
  const { sb, rig } = await scenario({ staticFare: 19 });
  const r = await sb.submitMarketplaceBooking('FD-T2');
  assert.equal(r.ok, false);
  assert.deepEqual(JSON.parse(JSON.stringify(r.priceMismatch)), { reference: 30.15, submitted: 19 });
  assert.equal(r.resultKind, undefined, 'a refusal is not an unknown-outcome failure');
  assert.equal(rig.all.inserted.length, 0, 'no booking row');
  assert.equal(rig.all.fetches.length, 0, 'no outbound message of any kind (alerts, driver broadcast)');
  assert.equal(sb.escalations.length, 0, 'not reported as a sync failure');
});

test('REAL Worker, the whole consent journey: refusal -> revised total shown with both figures -> explicit accept -> saved at exactly the accepted amount -> the success card shows the Worker\'s saved amount', async () => {
  const { sb, rig, dom, sent } = await scenario({ staticFare: 19 });
  const keyAtSubmit = sb.fareOverrideKey();
  const first = await sb.submitMarketplaceBooking('FD-T3');
  sb.reviewRevisedFare(first.priceMismatch, keyAtSubmit, dom.document.getElementById('confirmBtn'), '✓ Confirm booking request');
  assert.equal(sb.step, 4, 'back on the review step');
  assert.equal(sb.state.confirmBookingInFlight, false);
  const t = sb.calculateTotal();
  assert.equal(t.serverConfirmed, true); assert.equal(t.final, 30.15);
  assert.equal(dom.els.get('priceTotalValue').textContent, 'FJ$30.15');
  const notice = dom.els.get('fareChangeNotice');
  const text = notice.children.map((c) => c.textContent).join(' | ');
  assert.match(text, /The price for this trip has changed\. Nothing has been booked yet\./);
  assert.match(text, /Original total shown: FJ\$19/); assert.match(text, /Revised total: FJ\$30\.15/);
  assert.equal(dom.els.get('confirmBtn').textContent, 'Accept revised price and submit');
  assert.equal(rig.all.inserted.length, 0, 'still nothing saved: the guest has not accepted yet');
  // the guest accepts: the same Confirm button, the SAME booking reference, exactly the revised amount
  const second = await sb.submitMarketplaceBooking('FD-T3');
  assert.equal(second.ok, true);
  assert.equal(sent[1].quoted_amount, 30.15); assert.equal(sent[1].revised_from_amount, 19); assert.equal(sent[1].client_booking_ref, 'FD-T3'); assert.equal(sent[1].require_quote_match, true);
  assert.equal(rig.all.inserted.length, 1); assert.equal(rig.all.inserted[0].quoted_amount, 30.15);
  const created = rig.all.events.find((e) => e.event_type === 'created').metadata;
  assert.equal(created.pricing_decision.outcome, 'accepted_revised');
  assert.equal(created.pricing_decision.original_shown_amount_fjd, 19);
  // success card: the amount the Worker SAVED, read from its response
  assert.equal(second.savedAmount, 30.15);
  sb.showBulaSuccess('FD-T3', second.bookingId, second);
  assert.equal(dom.els.get('bulaFare').textContent, 'Fare saved: FJD 30.15');
});

test('a changed itinerary invalidates an accepted revised price: extras, trip type, vehicle, day/night, destination, passengers, bags each drop it', async () => {
  const mutations = {
    'child seat': (sb, dom) => { sb.state.extrasTotal = 8; dom.els.get('extra-seat').checked = true; },
    'trip type': (sb) => { sb.state.tripType = 'return'; },
    'vehicle': (sb) => { sb.state.selectedVehicle = 'minivan'; },
    'night pickup': (sb, dom) => { dom.els.get('travelTime').value = '23:00'; },
    'destination': (sb, dom) => { dom.els.get('destination').value = 'HILTON_DENARAU'; },
    'passengers': (sb) => { sb.state.passengers = 3; },
    'bags': (sb) => { sb.state.luggage = 5; },
    'pickup date': (sb, dom) => { dom.els.get('travelDate').value = '2026-10-21'; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const { sb, dom } = await scenario({ staticFare: 19 });
    sb.state.fareOverride = { key: sb.fareOverrideKey(), amount: 30.15, shown: 19, original: 19 };
    assert.equal(sb.calculateTotal().serverConfirmed, true, 'accepted fare applies to the same itinerary');
    mutate(sb, dom);
    assert.equal(sb.calculateTotal().serverConfirmed, undefined, `${label}: the accepted revised price no longer applies`);
    assert.notEqual(sb.calculateTotal().final, 30.15, `${label}: the total is recomputed from the page's own prices, never the stale override`);
  }
});

test('stale refusal: if the journey changed while the request was out, the refusal is NOT attached to the new journey (no revised price is offered for it)', async () => {
  const { sb, dom } = await scenario({ staticFare: 19 });
  const keyAtSubmit = sb.fareOverrideKey();
  const first = await sb.submitMarketplaceBooking('FD-T5');
  dom.els.get('extra-seat').checked = true; sb.state.extrasTotal = 8;          // the guest changed the trip while the request was in flight
  sb.reviewRevisedFare(first.priceMismatch, keyAtSubmit, dom.document.getElementById('confirmBtn'));
  assert.equal(sb.state.fareOverride, null);
  assert.equal(sb.calculateTotal().serverConfirmed, undefined);
  assert.equal(sb.step, 4);
});

test('acceptance cannot survive a second refusal for a different journey: a later mismatch keeps the ORIGINAL shown total as original_shown', async () => {
  const { sb } = await scenario({ staticFare: 19 });
  const k = sb.fareOverrideKey();
  sb.reviewRevisedFare({ reference: 30.15, submitted: 19 }, k, null);
  sb.reviewRevisedFare({ reference: 31, submitted: 30.15 }, k, null);          // same journey refused again: original stays what the guest FIRST saw
  assert.equal(sb.state.fareOverride.original, 19); assert.equal(sb.state.fareOverride.amount, 31);
});

test('when the saved amount differs from what the guest accepted, the success card says so plainly (never "Fare saved")', async () => {
  const { sb, dom } = await scenario({ staticFare: 30.15 });
  sb.showBulaSuccess('FD-T7', 9, { savedAmount: 42, savedCurrency: 'FJD', submittedAmount: 30.15 });
  assert.match(dom.els.get('bulaFare').textContent, /^Fare recorded by our booking system: FJD 42\. This differs from the 30\.15 you saw; our team will confirm your fare with you\.$/);
  const { sb: sb2, dom: dom2 } = await scenario({ staticFare: 30.15 });
  sb2.showBulaSuccess('FD-T8', 9, { ok: true });   // an older response without a saved amount: no fare line is invented
  assert.equal(dom2.els.get('bulaFare'), undefined);
});

test('the honest unknown state is preserved: a timeout / network error / 5xx is still { ok:false, resultKind:"unknown" } and the SAME ref is reused by Try again', async () => {
  const { sb, sent, rig } = await scenario({ staticFare: 30.15 });
  const realFetch = sb.fetch;
  sb.fetch = async () => { throw new Error('network down'); };
  const failed = await sb.submitMarketplaceBooking('FD-T9');
  assert.equal(failed.ok, false); assert.equal(failed.resultKind, 'unknown'); assert.equal(failed.priceMismatch, undefined);
  sb.fetch = realFetch;
  const retry = await sb.submitMarketplaceBooking('FD-T9');
  assert.equal(retry.ok, true);
  const again = await sb.submitMarketplaceBooking('FD-T9');
  assert.equal(again.ok, true); assert.equal(again.idempotent, true, 'same reference -> the same booking, not a second one');
  assert.equal(rig.all.inserted.length, 1);
  assert.equal(sent.at(-1).client_booking_ref, 'FD-T9');
});

test('a fare the Worker accepts inside its band is saved as shown, and the success card says "Fare saved"; nothing is substituted silently', async () => {
  const { sb, rig, dom } = await scenario({ staticFare: 30.15 });
  const r = await sb.submitMarketplaceBooking('FD-T10');
  assert.equal(r.ok, true); assert.equal(rig.all.inserted[0].quoted_amount, 30.15);
  sb.showBulaSuccess('FD-T10', r.bookingId, r);
  assert.equal(dom.els.get('bulaFare').textContent, 'Fare saved: FJD 30.15');
  const created = rig.all.events.find((e) => e.event_type === 'created').metadata;
  assert.equal(created.pricing_decision.outcome, 'matched');
});

test('the 15-second deadline, analytics-optional guard and escalation path are still in the page', () => {
  assert.match(src, /async function bookingRequest\(url, options, timeoutMs = 15000\)/);
  assert.match(src, /function trackBookingFunnel\(eventType\) \{\n  try \{\n    if \(typeof window\.trackFunnelEvent === 'function'\)/);
  assert.match(src, /return \{ ok: false, resultKind: 'unknown'/);
});
