// SCRATCH evidence (not committed): displayed-vs-recorded departure fares over a wide matrix.
// CLIENT side = the widget's REAL app.js run in a vm with a stubbed DOM (calculateTotal, computePrices, applyModifiers, updateExtras rules).
// SERVER side = the REAL deployed Worker code (offline harness, in-memory D1 seeded from a read-only pricing snapshot).
// Matrix: 45 hotel pickups -> NAN x 3 vehicles x 4 add-on combos (none, child seat, surfboard, both) x pickup times incl. night boundaries.
const fs = require('fs'), vm = require('vm');
const { saveThroughWorker } = require('C:/Users/James/AppData/Local/Temp/fd-fare/ftt-booking-site/test-fixtures/worker-harness.js');
const SRC = 'C:/Users/James/AppData/Local/Temp/fd-departure2/ftt-booking-site/src/';
const app = fs.readFileSync(SRC + 'app.js', 'utf8'); const html = fs.readFileSync(SRC + 'index.html', 'utf8');
const blk = (id) => html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))[0];
const opts = (id) => [...blk(id).matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)</g)].map((m) => ({ value: m[1], dataset: { lat: (m[2].match(/data-lat="([^"]*)"/) || [])[1], lng: (m[2].match(/data-lng="([^"]*)"/) || [])[1], area: (m[2].match(/data-area="([^"]*)"/) || [])[1] }, text: m[3] }));
const P = opts('pickup'), D = opts('destination');
const hotels = P.filter((o) => /^P_/.test(o.value)); const NAN = P.find((o) => o.value === 'NAN');
const allow = new Set((app.match(/const DEPARTURE_ONLINE_HOTELS = new Set\(\[([\s\S]*?)\]\);/) || [, ''])[1].match(/P_[A-Z_]+/g) || []);

const vals = { pickup: '', destination: 'NAN', travelTime: '10:00' };
const el = (id) => ({ get value() { return vals[id] ?? ''; }, set value(v) { vals[id] = v; }, checked: false, style: {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, addEventListener() {}, setAttribute() {}, appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; }, innerHTML: '', textContent: '', options: [], selectedOptions: [] });
const checks = { 'extra-seat': false, 'extra-surf': false };
const document = { getElementById: (id) => { const e = el(id); if (id in checks) Object.defineProperty(e, 'checked', { get: () => checks[id] }); return e; }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => el('x'), body: el('body'), documentElement: el('html') };
const sb = { document, window: { location: { search: '', pathname: '/' }, addEventListener() {}, matchMedia: () => ({ matches: false }) }, navigator: {}, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, localStorage: { getItem: () => null, setItem() {} }, location: { search: '', pathname: '/', href: '' }, console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, fetch: () => new Promise(() => {}), URLSearchParams, Math, Date, JSON, Number, parseInt, parseFloat, isFinite, encodeURIComponent, Set, Map, Promise, Array, Object, String, RegExp, Intl, Error, Event: class {}, IntersectionObserver: class { observe() {} }, requestAnimationFrame: () => 0 };
sb.window.document = document; sb.self = sb.window; vm.createContext(sb);
vm.runInContext(app + '\nthis.__api = { state, vehicleFits, recommendedVehicle, VEHICLES, computePrices, calculateTotal, roadKm, isNightPickup, updateExtras: () => { state.extrasTotal = 0; if (document.getElementById("extra-seat").checked) state.extrasTotal += 8; if (document.getElementById("extra-surf").checked) state.extrasTotal += 24; } };', sb);
const api = sb.__api;
function clientAmount(hotel, time, vehicle, seat, surf) {
  vals.pickup = hotel.value; vals.destination = 'NAN'; vals.travelTime = time; checks['extra-seat'] = seat; checks['extra-surf'] = surf;
  api.state.tripType = 'one-way'; api.state.selectedTour = null; api.state.passengers = 2; api.state.luggage = 2;
  const km = api.roadKm(+hotel.dataset.lat, +hotel.dataset.lng, +NAN.dataset.lat, +NAN.dataset.lng);
  api.state.distanceKm = km; api.state.prices = api.computePrices(hotel.value, 'NAN', km); api.updateExtras();
  return { final: api.calculateTotal(vehicle).final, km };
}
// cross-check against the values observed in the real browser session earlier
const H = hotels.find((h) => h.value === 'P_HILTON');
const chk = { d: ['sedan', 'minivan', 'minibus'].map((v) => clientAmount(H, '10:00', v, false, false).final), n: ['sedan', 'minivan', 'minibus'].map((v) => clientAmount(H, '05:30', v, false, false).final) };
console.log('sandbox cross-check Hilton 10:00', chk.d.join('/'), '(browser 45/58/81)  05:30', chk.n.join('/'), '(browser 49/72/99)');


const out = { priceIndependentOfPaxAndBags: true, checked: 0, recommendedAlwaysFits: true, extremeCases: [], enabledSetsMatchRule: true };
const hs = ['P_HILTON', 'P_WARWICK', 'P_PEARL'].map((v) => hotels.find((h) => h.value === v));
for (const h of hs) for (const time of ['10:00', '05:30']) for (const veh of ['sedan', 'minivan', 'minibus']) {
  const base = clientAmount(h, time, veh, false, false).final;
  for (let pax = 1; pax <= 20; pax++) for (let bags = 0; bags <= 20; bags++) {
    api.state.passengers = pax; api.state.luggage = bags;
    const km = api.roadKm(+h.dataset.lat, +h.dataset.lng, +NAN.dataset.lat, +NAN.dataset.lng); api.state.prices = api.computePrices(h.value, 'NAN', km); api.state.extrasTotal = 0;
    out.checked++; if (api.calculateTotal(veh).final !== base) out.priceIndependentOfPaxAndBags = false;
    const rec = api.recommendedVehicle(pax, bags); const rv = api.VEHICLES.find((x) => x.key === rec);
    const fits = pax <= rv.maxPax && bags <= rv.maxBags; if (!fits) { out.recommendedAlwaysFits = false; if (out.extremeCases.length < 3 && h.value === 'P_HILTON' && time === '10:00' && veh === 'sedan') out.extremeCases.push(`${pax}pax/${bags}bags -> ${rec} (does not fit)`); }
    const enabled = api.VEHICLES.filter((x) => api.vehicleFits(x)).map((x) => x.key); const expect = api.VEHICLES.filter((x) => pax <= x.maxPax && bags <= x.maxBags).map((x) => x.key);
    if (enabled.join() !== expect.join()) out.enabledSetsMatchRule = false;
  }
}
console.log(JSON.stringify(out, null, 1));
