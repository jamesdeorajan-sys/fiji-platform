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
vm.runInContext(app + '\nthis.__api = { state, computePrices, calculateTotal, roadKm, isNightPickup, updateExtras: () => { state.extrasTotal = 0; if (document.getElementById("extra-seat").checked) state.extrasTotal += 8; if (document.getElementById("extra-surf").checked) state.extrasTotal += 24; } };', sb);
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

const zoneOf = (h) => { const m = D.filter((d) => d.dataset.lat === h.dataset.lat && d.dataset.lng === h.dataset.lng); const a = m[0] && m[0].dataset.area; return a === 'Port Denarau' ? 'Denarau' : a; };
const times = []; for (let h = 0; h < 24; h++) for (const m of ['00', '30']) times.push(`${String(h).padStart(2, '0')}:${m}`);
times.push('05:59', '06:00', '06:01', '21:59', '22:00', '22:01', '00:00', '23:59');
const uniqTimes = [...new Set(times)];
const combos = [[false, false], [true, false], [false, true], [true, true]];
let n = 0;
(async () => {
  const stats = { combos: 0, kept: 0, replaced: 0 }; const perHotel = {}; const byTime = {}; const byExtra = {}; const ex = [];
  for (const h of hotels) {
    const zone = zoneOf(h);
    for (const time of uniqTimes) for (const veh of ['sedan', 'minivan', 'minibus']) for (const [seat, surf] of combos) {
      const { final, km } = clientAmount(h, time, veh, seat, surf);
      const res = await saveThroughWorker({ guest_name: 'ZZ', guest_phone: '0000000000', client_booking_ref: 'M' + (++n), pickup_zone: zone, destination_zone: 'Nadi Airport', vehicle_type: veh, quoted_currency: 'FJD', quoted_amount: final,
        fx_rate_at_booking: 1, distance_km: km, payment_method: 'cash', pickup_date: '2026-09-29', pickup_time: time, trip_type: 'one-way', has_child_seat: seat, has_surfboard: surf, has_tour: false, is_custom_address: false });
      const saved = res.saved && res.saved.quoted_amount; const same = saved === final;
      stats.combos++; same ? stats.kept++ : stats.replaced++;
      const ph = perHotel[h.value] = perHotel[h.value] || { combos: 0, mismatch: 0, examples: [] }; ph.combos++; if (!same) { ph.mismatch++; if (ph.examples.length < 2) ph.examples.push(`${veh}${seat ? '+seat' : ''}${surf ? '+surf' : ''}@${time} ${final}->${saved}`); }
      if (!same) { byTime[time] = (byTime[time] || 0) + 1; const k = `${seat ? 'seat' : ''}${surf ? 'surf' : ''}` || 'none'; byExtra[k] = (byExtra[k] || 0) + 1; }
    }
  }
  const clean = Object.entries(perHotel).filter(([, v]) => v.mismatch === 0).map(([k]) => k);
  console.log(JSON.stringify({ stats, hotelsFullyConsistent: clean.length, consistentHotels: clean.join(' '), mismatchByExtras: byExtra, mismatchTimesCount: Object.keys(byTime).length }, null, 1));
  const inAllow = clean.filter((h) => allow.has(h)), allowBad = [...allow].filter((h) => !clean.includes(h)), extraClean = clean.filter((h) => !allow.has(h));
  console.log('allow-list (29) vs matrix: still fully consistent', inAllow.length, '| allow-listed but NOT consistent under the wider matrix:', allowBad.join(' ') || 'none', '| newly consistent but not allow-listed:', extraClean.join(' ') || 'none');
  for (const h of allowBad) console.log('  ', h, JSON.stringify(perHotel[h]));
  fs.writeFileSync('C:/Users/James/AppData/Local/Temp/nadi-review-20260917/handover/departure_matrix_result.json', JSON.stringify({ stats, perHotel, byTime, byExtra, clean }));
})();
