// NAT small booking improvements (2026-10-11 candidate): journey draft, open-and-Send steps, optional 10% price-beat request.
// Runs the REAL src/booking-extras.js in a vm context against a small DOM double, plus static checks on the real index.html.
// Run: node --test test/booking-extras.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const read = (f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8').replace(/\r/g, '');
const html = read('index.html');
const extrasSrc = read('booking-extras.js');
const sha = (f) => createHash('sha256').update(readFileSync(new URL('../src/' + f, import.meta.url))).digest('hex');
const card = html.slice(html.indexOf('id="bulaSuccess"'), html.indexOf('<div class="bula-divider">'));

// ── 1. SCOPE: nothing the booking, price or save depends on has been touched ─────────────────────────────────────────────
test('SCOPE: app.js and styles.css are byte-identical to the live commit aebfab6 (submit, payload, price, WhatsApp-message code cannot have changed)', () => {
  assert.equal(sha('app.js'), '4dbb46c517bee8b27e46e18ae381d05cca13305c46cf328c8d1a7caf8297e1f4', 'app.js changed: this candidate must not edit booking, price or save code');
  assert.equal(sha('styles.css'), 'ddfccf65c777f2781ce4f4877625749fa4377edda4c2879d0ee49c94b78dd0ff');
});

test('SCOPE: the new script makes no network request, uses no persistent storage and never calls the booking functions', () => {
  const code = extrasSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // comments may name the functions they deliberately do not touch
  for (const banned of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'localStorage', 'indexedDB', 'WebSocket', 'submitNadiBooking', 'confirmBooking', 'saveBooking', 'ftt_booking_attempt', 'api.fijidash', 'workers.dev']) {
    assert.ok(!code.includes(banned), 'booking-extras.js code must not contain: ' + banned);
  }
  assert.ok(!/eval\(/.test(code), 'no eval');
  assert.equal([...extrasSrc.matchAll(/wa\.me\/(\d+)/g)].map((m) => m[1]).join(), '61478886145', 'only the existing team number appears');
});

test('SCOPE: index.html changes are additive: the two new files are loaded after the existing ones with new cache keys; the pinned handoff paragraph and button are unchanged', () => {
  assert.equal(html.match(/<link rel="stylesheet" href="booking-extras\.css\?v=20261011-extras">/g).length, 1);
  assert.equal(html.match(/<script src="booking-extras\.js\?v=20261011-extras"><\/script>/g).length, 1);
  assert.ok(html.indexOf('src="app.js?v=20261005-wa-handoff"') < html.indexOf('src="booking-extras.js'), 'extras loads after app.js');
  assert.ok(card.includes('<p class="bula-handoff" id="bulaHandoff">Tap the green button, then press Send in WhatsApp to send your reservation details. Our Fiji team will reply Bula, vinaka, check your details and confirm your transfer with you.</p>'));
  assert.ok(card.includes('<span>Open WhatsApp — send reservation</span>'));
  assert.ok(card.includes('<p class="bula-handoff-note"><strong>Opening WhatsApp alone does not send your request.</strong> Your transfer is confirmed only after our Fiji team confirms it with you.</p>'));
});

// ── 2. open-and-Send steps ───────────────────────────────────────────────────────────────────────────────────────────────
test('STEPS: a numbered instruction sits between the handoff paragraph and the green button, says Send is pressed in WhatsApp, and claims nothing was sent', () => {
  const i = card.indexOf('id="bulaSteps"');
  assert.ok(i > card.indexOf('id="bulaHandoff"') && i < card.indexOf('id="bulaWaBtn"'));
  const steps = card.slice(i, card.indexOf('</ol>', i));
  assert.equal((steps.match(/<li>/g) || []).length, 3);
  assert.match(steps, /<strong>Tap<\/strong> the green button/);
  assert.match(steps, /<strong>Press Send<\/strong> in WhatsApp/);
  assert.match(steps, /<strong>We reply<\/strong> and confirm with you/);
  assert.match(card, /<p class="bula-steps-note">Nothing reaches our team until you press Send in WhatsApp\.<\/p>/);
  assert.ok(card.indexOf('bula-steps-note') < card.indexOf('id="bulaWaBtn"'), 'the whole instruction is above the button');
  assert.ok(!/(has been sent|was sent|is confirmed|are confirmed|booked|guaranteed)/i.test(steps + card.slice(card.indexOf('bula-steps-note'), card.indexOf('bula-steps-note') + 120)), 'steps never claim a send or a confirmation');
});

// ── 3. price-beat block: placement, honesty of the wording ───────────────────────────────────────────────────────────────
test('PRICE-BEAT block: collapsed by default, after the main button, before the modification block; optional; separate link', () => {
  const i = card.indexOf('id="priceBeat"');
  assert.ok(i > card.indexOf('id="bulaWaBtn"') && i > card.indexOf('id="bulaRetry"') && i < card.indexOf('class="bula-modify"'));
  const open = card.slice(card.lastIndexOf('<details', i), card.indexOf('>', i));
  assert.ok(!/\bopen\b/.test(open), 'collapsed by default');
  const block = card.slice(i, card.indexOf('</details>', i));
  assert.match(block, /id="pbSend"[^>]*href="https:\/\/wa\.me\/61478886145"/);
  assert.ok(!/required/.test(block), 'no required field: the guest can open the block, leave it empty and still just send');
  assert.ok(!/onclick|onsubmit/i.test(block), 'a plain link: no handler');
});

const plain = (h) => h.replace(/<\/?(strong|em)>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const priceBeatText = () => plain(card.slice(card.indexOf('id="priceBeat"'), card.indexOf('</details>', card.indexOf('id="priceBeat"'))));

test('PRICE-BEAT WORDING (James-approved 10%): says 10% BELOW the verified competitor total, not 10% off our fare', () => {
  const t = priceBeatText();
  assert.match(t, /Found a lower total price elsewhere\? We'll go 10% below it\./);
  assert.match(t, /we will price your transfer 10% below that verified total\. That is 10% below their price, not 10% off ours\./);
});

test('PRICE-BEAT TERMS list every like-for-like condition James specified, in the published wording', () => {
  const t = priceBeatText();
  for (const term of ['the same route and trip type (one-way or return)', 'the same pickup date and time', 'the same vehicle or service, for the same number of passengers', 'the same luggage and requested extras',
    'a total that includes all mandatory charges', 'a current quote that is available for your journey']) assert.ok(t.includes(term), 'missing term: ' + term);
  assert.equal((card.slice(card.indexOf('price-beat-terms')).match(/<li>/g) || []).length >= 6, true);
});

test('PRICE-BEAT is a conditional offer, not a disclaimer: no invented minimum fare or hidden exclusion; no price shown; no unrestricted claim; confirmation only after human verification', () => {
  const t = priceBeatText();
  assert.match(t, /Our Fiji team verifies it, and a reduced fare is confirmed only when they confirm it with you on WhatsApp\. Until then your reservation stays at the fare you were shown\./);
  assert.match(t, /This is optional and does not affect your reservation or the WhatsApp message above\./);
  for (const bad of [/minimum/i, /at least/i, /except/i, /excluding/i, /subject to availability/i, /no promise/i, /not (a )?promise/i, /not guaranteed/i, /at our (sole )?discretion/i, /reserve the right/i, /we may (decline|refuse)/i, /shared shuttle/i,
    /lowest price/i, /cheapest/i, /price guarantee/i, /60[- ]second/i, /any price/i, /always beat/i, /instantly/i]) assert.ok(!bad.test(t), 'forbidden wording: ' + bad);
  assert.ok(!/(FJ\$|\$)\s*\d/.test(t.replace('e.g. FJ$ 40', '')), 'no price appears in the wording');
});

test('PRICE-BEAT block is outside the booking form steps, so it cannot gate or change submission', () => {
  assert.ok(html.indexOf('id="priceBeat"') > html.indexOf('id="bulaSuccess"'));
  const widgetEnd = html.indexOf('</div><!-- /#bookingWidget -->');
  assert.ok(widgetEnd > 0 && html.indexOf('id="priceBeat"') > widgetEnd, 'it lives in the result card, after the booking widget');
});

// ── 4. DOM double for the real script ────────────────────────────────────────────────────────────────────────────────────
function makeEnv({ stored = null, search = '', storageMode = 'ok', ids = {}, appState = {}, options = {} } = {}) {
  const calls = [];
  const timers = [];
  const winListeners = {}; const docListeners = {};
  const els = {};
  const mk = (id, props = {}) => (els[id] = Object.assign({
    id, value: '', checked: false, hidden: false, textContent: '', href: '', className: '', style: {}, dataset: {}, children: [], listeners: {},
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    insertBefore(n) { this.children.unshift(n); }, appendChild(n) { this.children.push(n); }, setAttribute() {}, focus() {},
  }, props));
  for (const id of ['pickup', 'destination', 'customPickupAddress', 'customPickupZone', 'customDestAddress', 'customDestZone', 'travelDate', 'travelTime', 'returnDate', 'returnTime', 'returnPickupLocation',
    'flightNum', 'flightUnknown', 'extra-lei', 'extra-seat', 'extra-stop', 'extra-surf', 'firstName', 'lastName', 'email', 'phone', 'notes', 'step1', 'bookingWidget', 'priceBeat', 'pbPrice', 'pbWhere', 'pbSend', 'bulaRef']) mk(id);
  mk('bulaSuccess', { style: { display: 'none' } }); mk('bulaRetry', { hidden: true });
  Object.assign(els, {}); for (const [id, props] of Object.entries(ids)) Object.assign(els[id], props);
  els.pbSend.href = 'https://wa.me/61478886145';
  const tripBtns = [mk('trip0'), mk('trip1')];
  const data = {};
  const storage = storageMode === 'ok' ? { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: (k) => { delete data[k]; } }
    : storageMode === 'throws' ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } } : null;
  if (stored) data['ftt_journey_draft_v1'] = typeof stored === 'string' ? stored : JSON.stringify(stored);
  let observer = null;
  const opts = Object.assign({ pickup: ['NAN', 'CUSTOM_PICKUP'], destination: ['HOTEL_A', 'HOTEL_B', 'CUSTOM_DEST'], customPickupZone: ['Z1'], customDestZone: ['Z1'] }, options);
  const ctx = {
    console, URLSearchParams, JSON, Math, Date, isFinite, parseInt, String, Object, Array, Number,
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {},
    sessionStorage: undefined,
    MutationObserver: class { constructor(cb) { observer = cb; } observe() {} },
    document: {
      readyState: 'complete', visibilityState: 'visible', body: {},
      getElementById: (id) => els[id] || null,
      querySelectorAll: (sel) => (sel === '.trip-btn' ? tripBtns : []),
      createElement: () => ({ style: {}, dataset: {}, children: [], listeners: {}, className: '', textContent: '', addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, appendChild(n) { this.children.push(n); }, setAttribute() {} }),
      addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
    },
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
    // the existing public functions of app.js, as plain recording doubles that behave like the real ones
    setSelectByValue: (id, v) => { calls.push(['setSelectByValue', id, v]); if (v && (opts[id] || []).includes(v)) { els[id].value = v; return true; } return false; },
    onPickupChange: () => calls.push(['onPickupChange']), onDestinationChange: () => calls.push(['onDestinationChange']),
    changePax: (d) => { calls.push(['changePax', d]); ctx.__state().passengers += d; }, changeLuggage: (d) => { calls.push(['changeLuggage', d]); ctx.__state().luggage += d; },
    setTripType: (t, b) => { calls.push(['setTripType', t, b && b.id]); ctx.__state().tripType = t; },
    updateExtras: () => calls.push(['updateExtras']), updatePricing: () => calls.push(['updatePricing']), refreshAfterCapacityChange: () => calls.push(['refreshAfterCapacityChange']),
    selectVehicle: (k) => { calls.push(['selectVehicle', k]); ctx.__state().selectedVehicle = k; },
    vehicleFits: (v) => ctx.__state().passengers <= v.maxPax && ctx.__state().luggage <= v.maxBags,
    stripEmoji: (s) => String(s || '').replace(/^[✈⛵🏙📍]\s*/, ''),
    fareText: (n) => String(Math.round(Number(n) * 100) / 100),
    calculateTotal: () => ({ final: ctx.__fare ?? 49 }),
  };
  let reloads = 0;
  ctx.window = ctx; ctx.window.location = { search, reload() { reloads += 1; } };
  Object.defineProperty(ctx, 'sessionStorage', { get() { if (storageMode === 'blocked') throw new Error('SecurityError'); return storage || undefined; }, configurable: true });
  vm.createContext(ctx);
  vm.runInContext(`const VEHICLES = [{ key: 'sedan', maxPax: 3, maxBags: 3 }, { key: 'minivan', maxPax: 7, maxBags: 7 }, { key: 'minibus', maxPax: 12, maxBags: 12 }];
    const state = Object.assign({ passengers: 2, luggage: 1, tripType: 'one-way', selectedVehicle: null, selectedTour: null, pickup: { name: '✈ Nadi Airport' }, destination: { hotel: 'Hotel A', name: 'Hotel A' } }, ${JSON.stringify(appState)});
    this.__state = () => state;`, ctx);
  vm.runInContext(extrasSrc, ctx);
  return { ctx, els, calls, data, timers, winListeners, docListeners, reloads: () => reloads, getObserver: () => observer, api: ctx.NadiBookingExtras, state: () => ctx.__state(), tripBtns };
}

const goodDraft = (over = {}) => ({ v: 1, t: Date.now(), pickup: 'NAN', destination: 'HOTEL_B', customPickupAddress: '', customPickupZone: '', customDestAddress: '', customDestZone: '', travelDate: '2099-03-04', travelTime: '14:30',
  returnDate: '', returnTime: '', returnPickupLocation: '', flightNum: 'FJ411', flightUnknown: false, extras: { lei: true, seat: false, stop: false, surf: true }, tripType: 'one-way', passengers: 4, luggage: 3, vehicle: 'minivan', ...over });

// ── 5. journey draft ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('DRAFT snapshot holds hotel selection and journey details and NEVER name, email, phone or notes', () => {
  const e = makeEnv({ appState: { passengers: 3, luggage: 2, tripType: 'return', selectedVehicle: 'minivan' } });
  Object.assign(e.els.pickup, { value: 'NAN' }); Object.assign(e.els.destination, { value: 'HOTEL_A' });
  Object.assign(e.els.travelDate, { value: '2099-01-02' }); Object.assign(e.els.travelTime, { value: '09:15' }); e.els.flightNum.value = 'FJ391'; e.els['extra-seat'].checked = true;
  Object.assign(e.els.firstName, { value: 'Zed' }); Object.assign(e.els.lastName, { value: 'Quincy' }); Object.assign(e.els.email, { value: 'zed.quincy@example.com' }); Object.assign(e.els.phone, { value: '+61400111222' }); Object.assign(e.els.notes, { value: 'allergic to cats' });
  const d = e.api.snapshotDraft();
  assert.deepEqual({ p: d.pickup, d: d.destination, date: d.travelDate, time: d.travelTime, f: d.flightNum, seat: d.extras.seat, pax: d.passengers, bags: d.luggage, trip: d.tripType, v: d.vehicle }, { p: 'NAN', d: 'HOTEL_A', date: '2099-01-02', time: '09:15', f: 'FJ391', seat: true, pax: 3, bags: 2, trip: 'return', v: 'minivan' });
  const json = JSON.stringify(d);
  for (const secret of ['Zed', 'Quincy', 'zed.quincy', '+61400111222', 'allergic']) assert.ok(!json.includes(secret), 'contact data must not be stored: ' + secret);
  assert.ok(e.api.saveDraft() === true && e.data.ftt_journey_draft_v1 && !e.data.ftt_journey_draft_v1.includes('Zed'));
});

test('DRAFT is not taken for a pickup-only form, a tour bundle, or once the result card is showing', () => {
  const none = makeEnv(); none.els.pickup.value = 'NAN'; assert.equal(none.api.snapshotDraft(), null, 'no destination, nothing worth keeping');
  const tour = makeEnv({ appState: { selectedTour: { name: 'Sigatoka' } } }); tour.els.destination.value = 'HOTEL_A'; assert.equal(tour.api.snapshotDraft(), null);
  const done = makeEnv(); done.els.destination.value = 'HOTEL_A'; done.els.bulaSuccess.style.display = 'block'; assert.equal(done.api.saveDraft(), false); assert.equal(done.data.ftt_journey_draft_v1, undefined);
});

test('DRAFT is saved after form events (debounced) and when the page is hidden', () => {
  const e = makeEnv(); e.els.destination.value = 'HOTEL_A';
  for (const t of ['input', 'change', 'click']) assert.ok((e.els.bookingWidget.listeners[t] || []).length >= 1, 'widget listens for ' + t);
  e.els.bookingWidget.listeners.change[0]();
  assert.equal(e.data.ftt_journey_draft_v1, undefined, 'debounced: nothing yet'); assert.equal(e.timers.length, 1);
  e.timers[0](); assert.ok(e.data.ftt_journey_draft_v1, 'written when the timer fires');
  const h = makeEnv(); h.els.destination.value = 'HOTEL_B';
  assert.equal(h.data.ftt_journey_draft_v1, undefined);
  h.ctx.document.visibilityState = 'hidden'; h.docListeners.visibilitychange[0](); assert.ok(h.data.ftt_journey_draft_v1, 'written when the tab is hidden (e.g. guest switches to another app)');
  const p = makeEnv(); p.els.destination.value = 'HOTEL_A'; p.winListeners.pagehide[0](); assert.ok(p.data.ftt_journey_draft_v1, 'written on pagehide');
});

test('RESTORE drives the page\'s own functions, in a safe order, and restores hotel, date, time, flight, passengers, bags, extras and vehicle', () => {
  const e = makeEnv({ stored: goodDraft() });
  assert.equal(e.els.destination.value, 'HOTEL_B'); assert.equal(e.els.pickup.value, 'NAN');
  assert.equal(e.els.travelDate.value, '2099-03-04'); assert.equal(e.els.travelTime.value, '14:30'); assert.equal(e.els.flightNum.value, 'FJ411');
  assert.equal(e.state().passengers, 4); assert.equal(e.state().luggage, 3); assert.equal(e.state().selectedVehicle, 'minivan');
  assert.equal(e.els['extra-lei'].checked, true); assert.equal(e.els['extra-seat'].checked, false); assert.equal(e.els['extra-surf'].checked, true);
  const names = e.calls.map((c) => c[0]);
  assert.ok(names.indexOf('onDestinationChange') < names.indexOf('changePax') && names.indexOf('changePax') < names.indexOf('updateExtras') && names.indexOf('updateExtras') < names.indexOf('selectVehicle'), 'hotel, then capacity, then extras, then vehicle: ' + names.join());
  assert.equal(e.els.step1.children.length, 1, 'the "We kept your trip details" notice is shown');
});

test('RESTORE a return trip: the return button is pressed through setTripType and the return pickup location is kept only if the guest had edited it', () => {
  const e = makeEnv({ stored: goodDraft({ tripType: 'return', returnDate: '2099-03-10', returnTime: '08:00', returnPickupLocation: 'Other hotel lobby' }) });
  assert.ok(e.calls.some((c) => c[0] === 'setTripType' && c[1] === 'return' && c[2] === 'trip1'));
  assert.equal(e.els.returnDate.value, '2099-03-10'); assert.equal(e.els.returnPickupLocation.value, 'Other hotel lobby'); assert.equal(e.els.returnPickupLocation.dataset.dirty, 'true');
});

test('RESTORE never shows a capacity alert: a vehicle that no longer fits is not re-selected', () => {
  const e = makeEnv({ stored: goodDraft({ vehicle: 'sedan', passengers: 5 }) });   // sedan seats 3
  assert.ok(!e.calls.some((c) => c[0] === 'selectVehicle'), 'selectVehicle not called'); assert.equal(e.state().selectedVehicle, null);
});

test('RESTORE keeps today\'s default date when the saved date is in the past; ignores malformed times and out-of-range counts', () => {
  const e = makeEnv({ stored: goodDraft({ travelDate: '2000-01-01', travelTime: '25:xx', passengers: 99, luggage: -4 }) });
  assert.equal(e.els.travelDate.value, '', 'past date not applied (the default date stays)'); assert.equal(e.els.travelTime.value, '', 'malformed time not applied');
  assert.equal(e.state().passengers, 12, '99 passengers is clamped to the page maximum of 12'); assert.equal(e.state().luggage, 0, '-4 bags is clamped to 0');
});

test('RESTORE refuses stale, future-dated, wrong-version, corrupt or unknown-hotel drafts and removes them; nothing is restored', () => {
  for (const [label, stored] of [['expired', goodDraft({ t: Date.now() - 7 * 3600 * 1000 })], ['future', goodDraft({ t: Date.now() + 3600 * 1000 })], ['version', goodDraft({ v: 2 })], ['corrupt', '{not json'], ['unknown hotel', goodDraft({ destination: 'HOTEL_GONE' })]]) {
    const e = makeEnv({ stored });
    assert.equal(e.els.destination.value, '', label + ': nothing restored'); assert.equal(e.data.ftt_journey_draft_v1, undefined, label + ': draft removed'); assert.equal(e.els.step1.children.length, 0, label + ': no notice');
  }
});

test('RESTORE is skipped when the guest followed a ?pickup= / ?dest= route link (the link always wins)', () => {
  for (const search of ['?dest=OUTRIGGER_FIJI', '?pickup=NAN&dest=X']) { const e = makeEnv({ stored: goodDraft(), search }); assert.equal(e.els.destination.value, '', search); }
});

test('STORAGE blocked or throwing: no error, no restore, booking form unaffected', () => {
  for (const storageMode of ['throws', 'blocked', 'none']) {
    const e = makeEnv({ stored: goodDraft(), storageMode }); e.els.destination.value = 'HOTEL_A';
    assert.doesNotThrow(() => { e.api.saveDraft(); e.api.clearDraft(); e.api.readDraft(); e.api.restoreDraftIfAny(); }, storageMode);
    assert.equal(e.api.saveDraft(), false, storageMode); assert.equal(e.els.step1.children.length, 0, storageMode);
  }
});

test('DRAFT is cleared when the request is finished (saved, or WhatsApp-only) and KEPT when the save is unknown so "Review and retry" still works', () => {
  const saved = makeEnv({ stored: goodDraft() }); saved.els.bulaSuccess.style.display = 'block'; saved.els.bulaRetry.hidden = true; saved.getObserver()();
  assert.equal(saved.data.ftt_journey_draft_v1, undefined, 'finished: cleared');
  const unknown = makeEnv({ stored: goodDraft() }); unknown.els.bulaSuccess.style.display = 'block'; unknown.els.bulaRetry.hidden = false; unknown.getObserver()();
  assert.ok(unknown.data.ftt_journey_draft_v1, 'unknown save: kept');
});

// ── 6. price-beat message ────────────────────────────────────────────────────────────────────────────────────────────────
const claimEnv = () => {
  const e = makeEnv({ appState: { passengers: 2, tripType: 'return', selectedVehicle: 'sedan' } });
  Object.assign(e.els.travelDate, { value: '2099-05-06' }); Object.assign(e.els.travelTime, { value: '10:00' }); Object.assign(e.els.returnDate, { value: '2099-05-12' }); Object.assign(e.els.returnTime, { value: '09:30' }); e.els.flightNum.value = 'FJ391';
  e.els.bulaRef.textContent = 'Booking #281 · Ref: FTT-AB12'; e.ctx.__fare = 47.87;
  return e;
};

test('CLAIM message carries booking reference, route, trip, pickup and return times, flight, vehicle, passengers, fare shown, and the guest\'s own price and source', () => {
  const e = claimEnv(); const ctx = e.api.journeyContext();
  const m = e.api.buildClaimMessage(ctx, { price: 'FJ$ 40', where: 'Example Transfers (example.com)' });
  for (const part of ['price-beat offer (10% below their verified total)', 'Luggage: 1 bag', 'Extras: none', 'Booking #281 · Ref: FTT-AB12', 'Nadi Airport → Hotel A (Return)', 'Pickup: ' + new Date('2099-05-06T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) + ', 10:00', 'Return pickup: ' + new Date('2099-05-12T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) + ', 09:30', 'Flight: FJ391', 'Vehicle: Private Sedan, 2 passengers', 'Fare I was shown: FJ$47.87', 'Their total price (including mandatory charges): FJ$ 40', 'Where I saw it: Example Transfers (example.com)'])
    assert.ok(m.includes(part), 'missing: ' + part + '\n' + m);
});

test('CLAIM never invents a price, availability or confirmation: no reduced figure appears, nothing says accepted/confirmed/booked, and the team is asked to verify first', () => {
  const e = claimEnv(); const ctx = e.api.journeyContext();
  const m = e.api.buildClaimMessage(ctx, { price: '40', where: 'x' });
  const numbers = (m.match(/\d+(?:\.\d+)?/g) || []);
  for (const forbidden of ['36', '36.00', '43.08', '42.0', '37.8']) assert.ok(!numbers.includes(forbidden), 'no derived price ' + forbidden);   // 40*0.9 = 36; 47.87*0.9 = 43.08
  assert.ok(!/(accepted|approved|is confirmed|booked for|guaranteed|available)/i.test(m));
  assert.equal((m.match(/10%/g) || []).length, 1, 'the 10% appears only in the offer sentence');
  assert.match(m, /Please check their quote against my journey above and confirm any new fare with me here before anything changes/);
});

test('CLAIM with nothing typed still produces a usable message that asks the guest to attach the quote; and a not-yet-saved booking is stated as such', () => {
  const e = makeEnv(); e.els.bulaRef.textContent = '';
  const m = e.api.buildClaimMessage(e.api.journeyContext(), {});
  assert.match(m, /Their total price \(including mandatory charges\): I will attach their quote/); assert.match(m, /Where I saw it: I will attach a screenshot or link/); assert.match(m, /MY BOOKING \(not saved online yet\)/);
});

test('CLAIM text from the guest is sanitised and bounded; the final link stays under WhatsApp\'s practical length limit', () => {
  const e = claimEnv();
  const hostile = 'A\u0000B\r\nC\u0007' + 'x'.repeat(500);
  const m = e.api.buildClaimMessage(e.api.journeyContext(), { price: hostile, where: hostile });
  assert.ok(!/[\u0000-\u0009\u000b-\u001f]/.test(m.replace(/\n/g, '')), 'no control characters');
  const url = e.api.buildClaimUrl(e.api.journeyContext(), { price: hostile, where: hostile });
  assert.ok(url.startsWith('https://wa.me/61478886145?text='));
  assert.ok(url.length < 2000, 'url length ' + url.length);
  assert.equal(decodeURIComponent(url.split('?text=')[1]), m, 'what the guest sees in WhatsApp is exactly the built message');
});

test('CLAIM link updates as the guest types, and is set up when the result card appears', () => {
  const e = claimEnv(); e.els.bulaSuccess.style.display = 'block'; e.getObserver()();
  assert.ok(decodeURIComponent(e.els.pbSend.href).includes('Booking #281'));
  e.els.pbPrice.value = 'AUD 55'; e.els.pbPrice.listeners.input[0]();
  assert.ok(decodeURIComponent(e.els.pbSend.href).includes('Their total price (including mandatory charges): AUD 55'));
});

// ── 7. SAFE RESTORATION (acceptance point 2) ─────────────────────────────────────────────────────────────────────────────
const isoDay = (offsetDays) => { const d = new Date(Date.now() + offsetDays * 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const hhmm = (offsetMin) => { const d = new Date(Date.now() + offsetMin * 60000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

test('PAST PICKUP: a saved pickup date that has passed is not restored, the guest is told which date, and the date field is flagged until they touch it', () => {
  const e = makeEnv({ stored: goodDraft({ travelDate: '2020-02-03', travelTime: '14:30' }) });
  assert.equal(e.els.travelDate.value, '', 'the old date is NOT written back (the page keeps its own default)');
  assert.equal(e.els.travelTime.value, '', 'nor its time');
  const notice = e.els.step1.children[0]; assert.ok(notice);
  assert.match(notice.children[0].textContent, /Your earlier pickup date \(.*2020.*\) has passed, so please check the pickup date and time below before you continue\./);
  assert.equal(e.els.travelDate.classList.contains('needs-check'), true, 'date field highlighted');
  e.els.travelDate.listeners.change[0](); assert.equal(e.els.travelDate.classList.contains('needs-check'), false, 'cleared once the guest changes the date');
  assert.equal(e.els.destination.value, 'HOTEL_B', 'the rest of the journey is still restored');
});

test('PAST PICKUP, same day: today with a time that has already gone counts as passed; a time still ahead is restored; no valid time on today is kept', () => {
  const gone = makeEnv({ stored: goodDraft({ travelDate: isoDay(0), travelTime: hhmm(-90) }) });
  const ahead = makeEnv({ stored: goodDraft({ travelDate: isoDay(0), travelTime: hhmm(+90) }) });
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  if (nowMin >= 90 && nowMin < 24 * 60 - 90) {                       // skip the two midnight-straddling windows so the test is never flaky
    assert.equal(gone.els.travelDate.value, '', 'passed time today: not restored'); assert.ok(gone.els.travelDate.classList.contains('needs-check'));
    assert.equal(ahead.els.travelDate.value, isoDay(0), 'a time later today is still valid'); assert.equal(ahead.els.travelTime.value, hhmm(+90));
  }
  const future = makeEnv({ stored: goodDraft({ travelDate: isoDay(5), travelTime: '09:00' }) });
  assert.equal(future.els.travelDate.value, isoDay(5)); assert.equal(future.els.travelDate.classList.contains('needs-check'), false);
});

test('RETURN DATE is revalidated: a passed return date, or one before the restored pickup date, is dropped and the guest is told', () => {
  const past = makeEnv({ stored: goodDraft({ tripType: 'return', returnDate: '2020-02-10', returnTime: '08:00' }) });
  assert.equal(past.els.returnDate.value, ''); assert.match(past.els.step1.children[0].children[0].textContent, /Please choose your return date again\./);
  const before = makeEnv({ stored: goodDraft({ tripType: 'return', travelDate: '2099-03-04', returnDate: '2099-03-01' }) });
  assert.equal(before.els.returnDate.value, '', 'return before pickup is not restored');
  const ok = makeEnv({ stored: goodDraft({ tripType: 'return', travelDate: '2099-03-04', returnDate: '2099-03-09', returnTime: '08:00' }) });
  assert.equal(ok.els.returnDate.value, '2099-03-09');
});

test('REVALIDATED AND RECALCULATED: the draft never stores a fare or price; after restore the page\'s own pricing functions run last, so the fare shown is the current one', () => {
  const e = makeEnv({ appState: { passengers: 3, luggage: 2, selectedVehicle: 'minivan' } }); e.els.destination.value = 'HOTEL_A';
  const d = e.api.snapshotDraft();
  assert.deepEqual(Object.keys(d).sort(), ['customDestAddress', 'customDestZone', 'customPickupAddress', 'customPickupZone', 'destination', 'extras', 'flightNum', 'flightUnknown', 'luggage', 'passengers', 'pickup', 'returnDate',
    'returnPickupLocation', 'returnTime', 't', 'travelDate', 'travelTime', 'tripType', 'v', 'vehicle'], 'an allow-list of keys: nothing else can be persisted');
  assert.ok(!/fare|price|amount|total|quote|override|name|email|phone|notes/i.test(Object.keys(d).join(',')), 'no money, contact or note key');
  const r = makeEnv({ stored: goodDraft() }); const order = r.calls.map((c) => c[0]);
  assert.ok(order.lastIndexOf('updatePricing') > order.lastIndexOf('updateExtras') && order.lastIndexOf('updatePricing') > order.lastIndexOf('changePax'), 'pricing recalculated after capacity/extras are set');
  assert.ok(order.indexOf('selectVehicle') > order.indexOf('updatePricing'), 'vehicle is re-selected only after the fresh prices exist (and only if it still fits)');
});

test('START AGAIN clears the draft, reloads, and the page-hide that follows cannot write it back', () => {
  const e = makeEnv({ stored: goodDraft() });
  const btn = e.els.step1.children[0].children[1]; assert.equal(btn.textContent, 'Start again');
  btn.listeners.click[0]();
  assert.equal(e.data.ftt_journey_draft_v1, undefined, 'draft removed'); assert.equal(e.reloads(), 1, 'page reloaded');
  e.winListeners.pagehide[0](); e.docListeners.visibilitychange && (e.ctx.document.visibilityState = 'hidden', e.docListeners.visibilitychange[0]());
  e.els.bookingWidget.listeners.change[0](); e.timers.forEach((t) => t());
  assert.equal(e.data.ftt_journey_draft_v1, undefined, 'still not written back by pagehide, visibility change or a pending debounce');
});

test('CORRUPTED OR HOSTILE STORAGE CONTENT never throws and never restores anything unsafe', () => {
  const huge = 'x'.repeat(100000);
  const shapes = [['array', '[1,2,3]'], ['string', '"hello"'], ['number', '42'], ['null', 'null'], ['empty object', '{}'], ['wrong types', JSON.stringify({ v: 1, t: Date.now(), destination: 'HOTEL_A', pickup: 7, passengers: 'many', luggage: {}, extras: [1], travelDate: 20260101, tripType: {}, vehicle: ['sedan'], flightNum: 5 })],
    ['proto keys', '{"v":1,"t":' + Date.now() + ',"destination":"HOTEL_A","__proto__":{"polluted":true},"constructor":{"x":1}}'], ['huge strings', JSON.stringify(goodDraft({ flightNum: huge, customDestAddress: huge, customPickupAddress: huge, returnPickupLocation: huge, tripType: 'return' }))],
    ['script text', JSON.stringify(goodDraft({ flightNum: '<img src=x onerror=alert(1)>', customDestAddress: '<script>alert(1)</script>' }))], ['truncated json', '{"v":1,"t":' + Date.now() + ',"dest']];
  for (const [label, stored] of shapes) {
    let e; assert.doesNotThrow(() => { e = makeEnv({ stored }); }, label);
    assert.ok(e.state().passengers >= 1 && e.state().passengers <= 12 && e.state().luggage >= 0 && e.state().luggage <= 20, label + ': counts stay in range');
    assert.ok(({}).polluted === undefined, label + ': no prototype pollution');
    assert.ok(String(e.els.flightNum.value).length <= 20 && String(e.els.customDestAddress.value).length <= 200 && String(e.els.customPickupAddress.value).length <= 200 && String(e.els.returnPickupLocation.value).length <= 200, label + ': restored text is length-capped');
  }
  const html = makeEnv({ stored: JSON.stringify(goodDraft({ flightNum: '<img src=x onerror=alert(1)>' })) });
  assert.equal(html.els.step1.children[0].children[0].textContent.includes('<img'), false, 'restored text is only ever assigned to form values, never into markup');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(extrasSrc), 'the script never builds markup from stored or typed text');
});

test('STORAGE FAILURE modes: blocked, throwing on every call, quota exceeded on write only - the form and booking still work', () => {
  const quota = makeEnv({ stored: goodDraft() }); quota.ctx.sessionStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  quota.els.destination.value = 'HOTEL_A'; assert.doesNotThrow(() => quota.api.saveDraft()); assert.equal(quota.api.saveDraft(), false);
  quota.els.bookingWidget.listeners.input[0](); assert.doesNotThrow(() => quota.timers.forEach((t) => t()));
});

test('CONTACT FIELDS: with name, email, phone and notes filled in, nothing of them is ever written to storage by any save path', () => {
  const e = makeEnv(); e.els.destination.value = 'HOTEL_A';
  Object.assign(e.els.firstName, { value: 'Zed' }); Object.assign(e.els.lastName, { value: 'Quincy' }); Object.assign(e.els.email, { value: 'zed.quincy@example.com' }); Object.assign(e.els.phone, { value: '+61400111222' }); Object.assign(e.els.notes, { value: 'room 12, allergic' });
  e.api.saveDraft(); e.winListeners.pagehide[0](); e.els.bookingWidget.listeners.input[0](); e.timers.forEach((t) => t());
  const all = JSON.stringify(e.data);
  for (const secret of ['Zed', 'Quincy', 'zed.quincy', '61400111222', 'room 12', 'allergic']) assert.ok(!all.includes(secret), secret);
  assert.deepEqual(Object.keys(e.data), ['ftt_journey_draft_v1'], 'one key only');
});

// ── 8. the page-only candidate does not depend on the Worker catalogue validator ───────────────────────────────────────────
test('INDEPENDENCE: this page-only candidate sends no catalogue_ref and depends on no Worker change (the validator is a separate, held gate)', () => {
  for (const f of ['booking-extras.js', 'index.html', 'app.js']) assert.ok(!read(f).includes('catalogue_ref'), f + ' must not reference catalogue_ref');
});
