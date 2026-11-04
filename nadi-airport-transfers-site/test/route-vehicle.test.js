// NAT route-to-vehicle conversion candidate r1 (ceo/nat-route-vehicle-conversion-r1, from production 9eff91b).
// Proves: the flight number is optional and still stored; the Sedan is preselected only when it fits; nothing else changed
// (pricing, 10% discount, save payload, notification/hand-off code are byte-identical to production); the measurement events
// are OFF unless switched on. The real-browser mobile journey (320/360/390/430) is test/journey/route-vehicle-journey.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { routeVehicleBase } from './route-vehicle-revert.js';

const rd = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const app = rd('app.js'), html = rd('index.html'), funnel = rd('funnel-nat.js');
const baseApp = routeVehicleBase('app.js'), baseHtml = routeVehicleBase('index.html'), baseFunnel = routeVehicleBase('funnel-nat.js');

function fnSrc(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1); }
  throw new Error('unbalanced ' + name);
}
const vehiclesSrc = (src) => src.slice(src.indexOf('const VEHICLES'), src.indexOf('];', src.indexOf('const VEHICLES')) + 2);

// ── 1. Flight number is optional ─────────────────────────────────────────────────────────────────
function flightHarness(overrides = {}) {
  const values = { firstName: 'Test', lastName: 'Guest', email: 'test@example.com', phone: '+12025550123', pickup: 'NAN', flightNum: '' };
  const fields = Object.fromEntries(Object.entries({ ...values, ...overrides }).map(([id, value]) => [id, { value, checked: false, focus() { this.focused = true; }, reportValidity() {}, setCustomValidity() {}, scrollIntoView() {} }]));
  fields.flightUnknown = { checked: false }; fields.flightError = { hidden: true };
  const c = { document: { getElementById: (id) => fields[id] }, state: { selectedVehicle: null }, VEHICLES: [], resolveLocation: () => ({}), showStep: (n) => { c.step = n; }, alert: (m) => { c.alerted = m; }, buildVehicleDetailCards: () => '', buildConfirmation: () => {} };
  vm.createContext(c);
  vm.runInContext(app.slice(app.indexOf('function validateBookingContact()'), app.indexOf('// ─── TOUR BANNER')), c);
  return { c, fields };
}
test('a guest from Nadi Airport WITHOUT a flight number reaches the vehicle step in one tap (no checkbox, no error, no focus jump)', () => {
  const { c, fields } = flightHarness();
  assert.equal(c.validateArrivalFlight(), true);
  c.goToStep(2);
  assert.equal(c.step, 2);
  assert.equal(fields.flightError.hidden, true);
  assert.notEqual(fields.flightNum.focused, true);
  assert.equal(c.alerted, undefined);
});
test('a guest WITH a flight number still reaches the vehicle step, and the value is untouched', () => {
  const { c, fields } = flightHarness({ flightNum: 'FJ411' });
  c.goToStep(2);
  assert.equal(c.step, 2);
  assert.equal(fields.flightNum.value, 'FJ411');
});
test('the ticked-checkbox path from the old gate still works (draft compatibility)', () => {
  const { c, fields } = flightHarness(); fields.flightUnknown.checked = true; c.goToStep(2); assert.equal(c.step, 2);
});
test('a non-airport pickup is unaffected', () => { const { c } = flightHarness({ pickup: 'HOTEL' }); assert.equal(c.validateArrivalFlight(), true); });
test('markup: "Flight number — optional", the supporting sentence, no second checkbox shown, hidden checkbox kept for saved drafts', () => {
  assert.ok(html.includes('Flight number — optional'));
  assert.ok(html.includes('<p id="flightHelp" class="field-hint" style="margin-top:8px">You can send this later if you don\'t have it yet.</p>'));
  assert.ok(html.includes('id="flightNum" class="field-input" aria-describedby="flightHelp"'));
  const m = html.match(/<label class="field-hint"[^>]*>\s*<input type="checkbox" id="flightUnknown"[^>]*>/);
  assert.ok(m && /display:none/.test(m[0]) && /\bhidden\b/.test(m[0]) && /aria-hidden="true"/.test(m[0]), 'the old checkbox is hidden from sight and from assistive tech');
  assert.ok(html.includes('<label class="field-label" for="flightNum">'), 'label still tied to the input');
  assert.ok(html.includes('<p id="flightError" role="alert" hidden>'));
});
test('the flight number is still stored and sent when supplied (payload and WhatsApp text code unchanged)', () => {
  assert.ok(app.includes("flight_number: flightNum || null"));
  assert.ok(app.includes("`Flight:     ${flight}`"));
  for (const f of ['submitNadiBooking', 'buildWhatsAppURL']) assert.equal(fnSrc(app, f), fnSrc(baseApp, f), f + ' must be byte-identical to production');
});

// ── 2. Sedan preselect only when valid ───────────────────────────────────────────────────────────
function vehicleHarness(state = {}) {
  const ctx = { state: { passengers: 2, luggage: 2, selectedVehicle: null, vehicleNotice: '', ...state } };
  vm.createContext(ctx);
  vm.runInContext([vehiclesSrc(app), fnSrc(app, 'vehicleFits'), fnSrc(app, 'preselectSedanIfFits'), fnSrc(app, 'clearUnfitVehicle')].join('\n'), ctx);
  return ctx;
}
test('Sedan is preselected for 1-3 passengers with up to 3 bags', () => {
  for (const [pax, bags] of [[1, 0], [2, 2], [3, 3], [1, 3], [3, 1]]) { const c = vehicleHarness({ passengers: pax, luggage: bags }); c.preselectSedanIfFits(); assert.equal(c.state.selectedVehicle, 'sedan', `${pax} pax ${bags} bags`); }
});
test('NO invalid default: 4+ passengers or 4+ bags leave nothing selected (guest chooses explicitly, as before)', () => {
  for (const [pax, bags] of [[4, 2], [7, 7], [8, 3], [12, 12], [2, 4], [3, 8], [1, 14]]) { const c = vehicleHarness({ passengers: pax, luggage: bags }); c.preselectSedanIfFits(); assert.equal(c.state.selectedVehicle, null, `${pax} pax ${bags} bags`); }
});
test('a guest choice is never overridden', () => {
  const c = vehicleHarness({ selectedVehicle: 'minivan', passengers: 2, luggage: 2 }); c.preselectSedanIfFits(); assert.equal(c.state.selectedVehicle, 'minivan');
});
test('an auto-preselected Sedan is dropped when the party outgrows it, and returns only if it fits again', () => {
  const c = vehicleHarness(); c.preselectSedanIfFits(); assert.equal(c.state.selectedVehicle, 'sedan');
  c.state.passengers = 4; c.preselectSedanIfFits(); assert.equal(c.state.selectedVehicle, null, 'no unfit default survives');
  c.state.passengers = 3; c.preselectSedanIfFits(); assert.equal(c.state.selectedVehicle, 'sedan');
});
test('a Sedan the GUEST picked is handled by the existing clearUnfitVehicle path, not silently swapped', () => {
  const c = vehicleHarness({ selectedVehicle: 'sedan', passengers: 5 }); c.preselectSedanIfFits();
  assert.equal(c.state.selectedVehicle, 'sedan', 'preselect leaves guest choices alone');
  assert.match(c.clearUnfitVehicle(), /Sedan can't carry 5 passengers/); assert.equal(c.state.selectedVehicle, null);
});
test('explicit taps clear the auto flag; updatePricing preselects before the cards are drawn', () => {
  assert.equal((app.match(/state\.vehicleAuto = false;/g) || []).length, 3, 'selectVehicle, selectVehicleDetail and the unfit drop');
  assert.ok(app.indexOf('preselectSedanIfFits();\n  setVehicleCards(\'vehicleCards\', buildVehicleCards());') > 0);
});
test('step 2 still shows the guest what is selected and lets them change it; Continue is enabled by a valid selection', () => {
  const sync = fnSrc(app, 'syncVehicleStep');
  assert.ok(sync.includes('Selected: Private ${v.name}. Continue when you\'re ready.'));
  assert.equal(fnSrc(app, 'selectVehicleDetail').includes('alertCapacity'), true, 'unfit vehicles still explain why');
});

// ── 3. Nothing else changed: pricing, discount, save contract, hand-off, notifications ──────────
test('pricing, the 10% discount, capacity rules, the save payload, idempotency, hand-off and retry code are byte-identical to production 9eff91b', () => {
  const names = ['calculateTotal', 'computePrices', 'formatPrice', 'vehicleFits', 'recommendedVehicle', 'buildVehicleCards', 'buildVehicleDetailCards', 'alertCapacity', 'buildBookingIntentFingerprint',
    'submitNadiBooking', 'buildWhatsAppURL', 'confirmBooking', 'getNatAttributionForPayload', 'captureNatAttribution', 'validateBookingContact', 'goToStep', 'updateExtras', 'refreshAfterCapacityChange'];
  for (const n of names) assert.equal(fnSrc(app, n), fnSrc(baseApp, n), `${n} changed`);
  for (const k of ['DISCOUNT_THRESHOLD', 'const VEHICLES']) assert.equal(app.includes(k), baseApp.includes(k));
  assert.equal(vehiclesSrc(app), vehiclesSrc(baseApp));
});
test('app.js differs from production ONLY in validateArrivalFlight, the new preselectSedanIfFits (+ its one call) and three auto-flag lines', () => {
  let t = app;
  t = t.replace(fnSrc(app, 'validateArrivalFlight'), fnSrc(baseApp, 'validateArrivalFlight'));
  const cs = t.indexOf('// Route-to-vehicle conversion candidate r1'); const ce = t.indexOf('// Returns true if the vehicle can carry both');
  assert.ok(cs > 0 && ce > cs); t = t.slice(0, cs) + t.slice(ce);
  t = t.replace("  preselectSedanIfFits();\n", '').split('  state.vehicleAuto = false;\n').join('');
  // the comment block above validateArrivalFlight is the only other text added
  const c1 = t.indexOf('// Flight number is OPTIONAL (route-to-vehicle'); const c2 = t.indexOf('function validateArrivalFlight()'); if (c1 >= 0) t = t.slice(0, c1) + t.slice(c2);
  assert.equal(t, baseApp);
});
test('index.html differs from production ONLY in the flight markup and the two cache keys', () => {
  let t = html.replace('app.js?v=20261104-route-vehicle', 'app.js?v=20261016-attribution').replace('funnel-nat.js?v=20261104-funnel-v2off', 'funnel-nat.js?v=20261015-funnel');
  const a = t.indexOf('              Flight number — optional'), b = t.indexOf('            <div id="flightHint"');
  const a0 = baseHtml.indexOf('              Flight number\n'), b0 = baseHtml.indexOf('            <div id="flightHint"');
  assert.ok(a > 0 && a0 > 0);
  assert.equal(t.slice(0, a) + t.slice(b), baseHtml.slice(0, a0) + baseHtml.slice(b0));
});
test('both changed scripts carry a NEW cache key so browsers (4 h max-age) fetch them', () => {
  assert.equal(html.split('app.js?v=20261104-route-vehicle').length, 2);
  assert.equal(html.split('funnel-nat.js?v=20261104-funnel-v2off').length, 2);
  assert.ok(!html.includes('app.js?v=20261016-attribution'));
});

// ── 4. Measurement events: OFF by default, exact names when switched on ─────────────────────────
function el(id, extra = {}) { return { id, value: '', style: { display: '' }, hidden: false, offsetParent: {}, textContent: '', disabled: false, checked: false, classList: { contains: () => false }, closest: () => null, ...extra }; }
function funnelPage(src) {
  const els = { booking: el('booking'), pickup: el('pickup'), destination: el('destination'), step2: el('step2', { style: { display: 'none' } }), step3: el('step3', { style: { display: 'none' } }), bulaSuccess: el('bulaSuccess', { style: { display: 'none' } }), bulaRef: el('bulaRef'), bulaLeadText: el('bulaLeadText') };
  const listeners = {}; const observers = []; const store = {};
  const document = { readyState: 'complete', referrer: '', getElementById: (id) => els[id] || null, querySelector: () => null, addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } };
  const c = { window: {}, document, location: { pathname: '/', search: '' }, URLSearchParams, JSON, Array, Object, Uint8Array, Math, Blob: class {},
    sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } }, crypto: { randomUUID: () => 'sid-1' },
    navigator: { sendBeacon: () => { throw new Error('must not send'); } }, fetch: () => { throw new Error('must not fetch'); },
    MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} } };
  c.window.__NAT_FUNNEL_CAPTURE = []; c.window.window = c.window; vm.createContext(c);
  vm.runInContext('Object.assign(globalThis, window); window = globalThis;', c); vm.runInContext(src, c);
  const fire = (type, target) => (listeners[type] || []).forEach((fn) => fn({ target }));
  return { c, els, fire, mutate: () => observers.forEach((o) => o.cb([])), events: () => c.__NAT_FUNNEL_CAPTURE.map((e) => e.event_type), payloads: () => c.__NAT_FUNNEL_CAPTURE };
}
function journey(p) {
  p.els.pickup.value = 'NAN'; p.fire('change', p.els.pickup); p.els.destination.value = 'HILTON_DENARAU'; p.fire('change', p.els.destination);
  p.fire('change', { id: 'travelDate' });
  p.els.step2.style.display = 'block'; p.mutate();
  p.fire('change', { classList: { contains: (c) => c === 'vehicle-radio' }, checked: true });
  p.els.step3.style.display = 'block'; p.mutate();
  p.fire('click', { closest: (s) => (s === '.btn-confirm' ? {} : null) });
  p.els.bulaRef.textContent = 'Booking #305 · Ref: FTT-ABC123'; p.els.bulaSuccess.style.display = 'block'; p.mutate();
}
test('V2 OFF (as shipped in this candidate): exactly the events production sends today, nothing new', () => {
  const p = funnelPage(funnel); journey(p);
  assert.deepEqual(p.events(), ['booking_page_view', 'route_selected', 'vehicle_selected', 'details_opened', 'confirm_clicked', 'booking_post_started', 'booking_post_succeeded']);
  const base = funnelPage(baseFunnel); journey(base);
  assert.deepEqual(p.events(), base.events(), 'identical to the production file for the same journey');
});
test('V2 ON (tests only): the eight measurement-plan events fire once each, in funnel order, with no guest data', () => {
  const p = funnelPage(funnel); p.c.__natFunnelV2(true); journey(p);
  const ev = p.events();
  for (const n of ['route_selected', 'journey_details_open', 'journey_details_complete', 'vehicle_step_viewed', 'vehicle_selected', 'guest_details_open', 'save_attempt', 'save_success']) assert.equal(ev.filter((e) => e === n).length, 1, n);
  assert.ok(ev.indexOf('route_selected') < ev.indexOf('journey_details_open') && ev.indexOf('journey_details_open') < ev.indexOf('journey_details_complete') && ev.indexOf('journey_details_complete') < ev.indexOf('vehicle_step_viewed') && ev.indexOf('vehicle_step_viewed') < ev.indexOf('vehicle_selected') && ev.indexOf('vehicle_selected') < ev.indexOf('guest_details_open') && ev.indexOf('guest_details_open') < ev.indexOf('save_attempt') && ev.indexOf('save_attempt') < ev.indexOf('save_success'));
  const KEYS = ['event_type', 'platform', 'session_id', 'first_source', 'first_medium', 'first_campaign', 'first_content', 'first_referrer', 'first_landing_path', 'route_slug'];
  for (const e of p.payloads()) assert.deepEqual(Object.keys(e).sort(), [...KEYS].sort());
});
test('the flag is a hard-coded false in the shipped file', () => { assert.ok(/var V2 = false;/.test(funnel)); });
