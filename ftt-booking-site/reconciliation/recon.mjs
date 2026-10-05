// Fare reconciliation across both sites, run entirely in an isolated harness:
//   - the REAL page code (sliced from each app.js and executed in a vm sandbox) produces the advertised / selection / review / submitted amounts;
//   - the REAL deployed Worker (dry-run bundle of the production script, test-fixtures/worker-deployed-7a32a034.mjs) over an in-memory database seeded
//     from a read-only production pricing snapshot (2026-09-27) produces the Worker-calculated and saved amounts;
//   - every outbound call the Worker makes (WhatsApp etc.) is recorded and blocked by the rig. No network, no live booking, no message.
// It decides NO fare: it records what each layer says and classifies the differences.
//   node reconciliation/recon.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outDir = path.resolve(process.argv[2] || path.join(here, 'out'));
const { createRig } = await import(pathToFileURL(path.join(root, 'test-fixtures', 'real-worker-rig.mjs')).href);
const { snap } = await import(pathToFileURL(path.join(root, 'test-fixtures', 'real-worker-harness.mjs')).href);
const BUNDLE = path.join(root, 'test-fixtures', 'worker-deployed-7a32a034.mjs');

const NAT_SRC = process.env.NAT_APP_JS; // path to nadi-airport-transfers-site/src/app.js (released c5ee3b1)
const git = (args, cwd) => execFileSync('git', args, { cwd, maxBuffer: 1e8, encoding: 'utf8' }).replace(/\r\n/g, '\n');
const FD_PROD = git(['show', '8c6f920:ftt-booking-site/src/app.js'], root);
const FD_CAND = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const NAT = fs.readFileSync(NAT_SRC, 'utf8').replace(/\r\n/g, '\n');

const between = (src, a, b, from = 0) => { const i = src.indexOf(a, from); if (i < 0) throw new Error('marker ' + a); const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('end ' + b); return src.slice(i, j); };
function fn(src, name) { const s = src.indexOf(`function ${name}(`); if (s < 0) return ''; let i = src.indexOf('{', s), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return src.slice(s, i + 1); } throw new Error('unbalanced ' + name); }
const konst = (src, n) => { const m = src.match(new RegExp('const ' + n + '\\s*= [^;]+;')); return m ? m[0] : ''; };

function slices(src, live) {
  const A = between(src, 'const NIGHT_SURCHARGE', '// ─── EMOJI STRIPPER');
  const B = between(src, 'function isNightPickup', '// ─── RELIABLY SET A <SELECT>');
  const rs = src.indexOf('const ROUTES_DATA = ['); const C = src.slice(rs, src.indexOf('\n];', rs) + 3);
  let D = '';
  if (live !== 'none') {
    D = ['NEGOTIATION_FLOOR_RATIO', 'LIVE_FARE_FETCH_TIMEOUT_MS', 'LIVE_FARE_TTL_MS', 'LIVE_FARE_MAX_ATTEMPTS', 'LIVE_FARE_RETRY_DELAYS_MS', 'LIVE_FARE_CLASSES'].map((n) => konst(src, n)).join('\n')
      + '\n' + ['liveFareEligible', 'applyLiveFares', 'renderLiveFareNote', 'startLiveFareFetch', 'retryLiveFares', 'applyOrFetchLiveFares', 'resolveNegotiationEligibility', 'renderFareTiers'].map((n) => fn(src, n)).join('\n');
  }
  return { code: 'var TIER = {};\n' + A + '\n' + B + '\n' + C + '\n' + D, routes: C };
}

const MARKETPLACE = new Set(snap.zones.map((z) => z.name));
const ALIAS = { 'Port Denarau': 'Denarau' };
const zoneOf = (area) => (MARKETPLACE.has(area) ? area : ALIAS[area] || null);
const cents = (x) => Math.round(x * 100) / 100;
const km = (zone) => { const r = snap.zone_distance_cache.find((x) => (x.zone_a === 'Nadi Airport' && x.zone_b === zone) || (x.zone_b === 'Nadi Airport' && x.zone_a === zone)); return r ? r.distance_km : null; };

const rig = await createRig({ bundle: BUNDLE });
const refCache = new Map();
async function referenceFare(zone, vehicle, trip) {
  const k = `${zone}|${vehicle}|${trip}`; if (refCache.has(k)) return refCache.get(k);
  const r = await rig.get(`/reference-fare?pickup_zone=${encodeURIComponent('Nadi Airport')}&destination_zone=${encodeURIComponent(zone)}&vehicle_type=${vehicle}&trip_type=${trip}`);
  const v = r.status === 200 && r.body && r.body.ok ? r.body.reference_fare_fjd : null; refCache.set(k, v); return v;
}
let refN = 0;
const ref = () => `RECON-${(++refN).toString(36).toUpperCase()}`;
const payload = ({ zone, vehicle, trip, time, seat, amount, optIn, k }) => ({
  guest_name: 'QA Test', guest_phone: '+61400000000', guest_email: 'qa-test@example.invalid', client_booking_ref: ref(),
  pickup_zone: 'Nadi Airport', destination_zone: zone, vehicle_type: vehicle, quoted_currency: 'FJD', quoted_amount: amount, fx_rate_at_booking: 1, distance_km: k,
  payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: time, trip_type: trip, has_child_seat: seat, has_surfboard: false, has_tour: false, is_custom_address: false,
  ...(optIn ? { require_quote_match: true } : {}),
});
const workerCalc = new Map();
async function workerCalculated(c) { // far below the band: the Worker replaces it with its own authoritative (discounted) amount; no booking outcome depends on this probe
  const key = [c.zone, c.vehicle, c.trip, c.time, c.seat].join('|'); if (workerCalc.has(key)) return workerCalc.get(key);
  const r = await rig.post(payload({ ...c, amount: 1, optIn: false }));
  const v = r.status === 201 ? { ok: true, amount: r.saved.quoted_amount } : { ok: false, status: r.status, error: (r.body && (r.body.errors || r.body.error) || '').toString().slice(0, 120) };
  workerCalc.set(key, v); return v;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function makeCtx(src, variant, c, rowRef) {
  const sl = slices(src, variant === 'nat' ? 'none' : 'live');
  const el = () => ({ style: {}, value: '', textContent: '', disabled: false, parentNode: null, setAttribute() {}, appendChild() {}, insertBefore() {}, remove() {} });
  const vals = { travelTime: c.time, pickup: 'NAN', destination: rowRef.destValue, travelDate: '2026-10-20', returnDate: '2026-10-27', returnTime: '10:00' };
  const sb = {
    Math, Number, parseInt, JSON, String, Date, isFinite, Promise, setTimeout, console,
    BOAT_DESTINATION_IDS: {},
    state: { tripType: c.trip, prices: {}, extrasTotal: c.seat ? 8 : 0, passengers: 2, luggage: 2, selectedVehicle: c.vehicle, selectedTour: null, priceSource: 'published', destZoneName: c.zone, liveFares: null, liveFaresPending: null, liveFareAttempts: null, fareOverride: null },
    document: { getElementById: (id) => (id in vals ? { ...el(), value: vals[id], checked: false } : el()), createElement: el, querySelector: () => null },
    updatePricing: () => {}, stopNegotiationPolling: () => {}, renderPriceBlock: () => {}, formatPrice: String,
    resolveConfirmedPickupZone: () => 'Nadi Airport', resolveConfirmedDestinationZone: () => c.zone,
    fetchRealReferenceFare: async (pz, dz, vt, tt) => referenceFare(dz, vt, tt),
  };
  vm.createContext(sb);
  vm.runInContext(sl.code.replace(/const LIVE_FARE_FETCH_TIMEOUT_MS = \d+;/, 'const LIVE_FARE_FETCH_TIMEOUT_MS = 2000;'), sb);
  return sb;
}

// Selection-time and review-time amounts exactly as each page produces them for ONE case.
async function pageAmounts(variant, src, c, row) {
  const sb = makeCtx(src, variant, c, row);
  const priced = vm.runInContext(`JSON.stringify(computePrices('NAN', ${JSON.stringify(row.destValue)}, ${row.km}))`, sb);
  const p = JSON.parse(priced);
  sb.state.prices = { sedan: p.sedan, minivan: p.minivan, minibus: p.minibus }; sb.state.priceSource = p.source;
  const tot = () => vm.runInContext(`JSON.stringify(calculateTotal(${JSON.stringify(c.vehicle)}))`, sb);
  const staticT = JSON.parse(tot());
  let selection = staticT, review = staticT;
  if (variant !== 'nat' && c.zone) {
    if (variant === 'fd-cand') {
      vm.runInContext(`applyOrFetchLiveFares('NAN', ${JSON.stringify(row.destValue)})`, sb);   // first lookup (async)
      await wait(15);
      sb.state.prices = { sedan: p.sedan, minivan: p.minivan, minibus: p.minibus };              // the next updatePricing() recomputes the static fares...
      vm.runInContext(`applyOrFetchLiveFares('NAN', ${JSON.stringify(row.destValue)})`, sb);   // ...and the cached live fares are applied on top
      selection = JSON.parse(tot());
    }
    // review step (renderFareTiers swaps in the server reference fare for the selected vehicle on eligible routes)
    if (variant === 'fd-cand') sb.state.prices = { sedan: p.sedan, minivan: p.minivan, minibus: p.minibus };
    vm.runInContext('renderFareTiers()', sb);
    await wait(15);
    review = JSON.parse(tot());
    if (variant === 'fd-cand') { /* selection already mirrors the live fares */ } else { selection = staticT; }
  }
  return { advertisedBase: row[{ sedan: 's', minivan: 'v', minibus: 'm' }[c.vehicle]], published: p[c.vehicle], source: p.source, selection, review };
}

const TIMES = [{ label: 'day 10:00', t: '10:00', night: false }, { label: 'night 23:00', t: '23:00', night: true }];
const EXTRAS = [{ label: 'none', seat: false }, { label: 'child seat', seat: true }];
// 'lookup down' variants: the live /reference-fare lookup is unavailable, so the page can only use its own published table (selection = review = static)
const VARIANTS = [['NAT-live(c5ee3b1)', 'nat', NAT, true], ['FD-prod(8c6f920)', 'fd-prod', FD_PROD, false], ['FD-candidate', 'fd-cand', FD_CAND, true],
  ['FD-prod(8c6f920) lookup-down', 'nat', FD_PROD, false], ['FD-candidate lookup-down', 'nat', FD_CAND, true]];

console.warn = () => {}; // the Worker logs a warning for every probe; not needed here
const rows = [];
for (const [label, variant, src, optInFlag] of VARIANTS) {
  const routes = (() => { const sb = {}; vm.createContext(sb); vm.runInContext(slices(src, 'none').routes + ';this.R = ROUTES_DATA;', sb); return JSON.parse(JSON.stringify(sb.R)); })();
  for (const route of routes) {
    const zone = zoneOf(route.area);
    for (const vehicle of ['sedan', 'minivan', 'minibus']) for (const trip of ['one-way', 'return']) for (const ex of EXTRAS) for (const tm of TIMES) {
      const c = { zone, vehicle, trip, time: tm.t, seat: ex.seat, k: zone ? km(zone) : null };
      const base = { site: label, route: route.destValue, area: route.area, zone: zone || '(needs address lookup)', vehicle, direction: 'airport -> destination (arrival)', trip, time: tm.label, extras: ex.label };
      let page;
      try { page = await pageAmounts(variant, src, c, route); } catch (e) { rows.push({ ...base, error: 'page: ' + String(e.message).slice(0, 100), cls: 'HARNESS_ERROR' }); continue; }
      const sel = cents(page.selection.final), rev = cents(page.review.final);
      const out = { ...base, advertised_one_way_base: page.advertisedBase, published_table_amount: page.published, selection: sel, review: rev, submitted: rev };
      if (!zone || c.k === null) { rows.push({ ...out, worker_calculated: null, saved: null, cls: 'ZONE_NOT_IN_PRICING_DATA', note: 'destination zone is resolved by address lookup at booking time; the offline snapshot has no distance for it' }); continue; }
      const wc = await workerCalculated(c);
      if (!wc.ok) { rows.push({ ...out, worker_calculated: null, saved: null, cls: 'MISSING_PRICING_RULE', note: `Worker cannot price this route: ${wc.status} ${wc.error}` }); continue; }
      const optIn = optInFlag;
      const r = await rig.post(payload({ ...c, amount: rev, optIn }));
      const w = wc.amount;
      let cls, saved = null, note = '';
      const inBand = rev >= 0.8 * w && rev <= 1.3 * w;
      if (r.status === 201) {
        saved = r.saved.quoted_amount;
        if (Math.abs(saved - rev) < 0.005) cls = Math.abs(rev - w) < 0.005 ? 'MATCH' : 'IN_BAND_DIFFERENCE';
        else cls = 'SILENT_SUBSTITUTION';
      } else if (r.status === 409 && r.body && r.body.code === 'PRICE_MISMATCH') { cls = 'CONSENT_REQUIRED'; note = `guest shown ${rev}, accepts ${r.body.reference_fare_fjd} before anything is saved`; }
      else { cls = 'REJECTED'; note = `${r.status} ${(r.body && (r.body.errors || r.body.error) || '').toString().slice(0, 100)}`; }
      rows.push({ ...out, worker_calculated: w, in_band: inBand, saved, cls, selection_review_mismatch: sel !== rev, note });
    }
  }
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'reconciliation_rows.json'), JSON.stringify(rows));
const cols = ['site', 'route', 'area', 'zone', 'vehicle', 'direction', 'trip', 'time', 'extras', 'advertised_one_way_base', 'published_table_amount', 'selection', 'review', 'submitted', 'worker_calculated', 'saved', 'in_band', 'selection_review_mismatch', 'cls', 'note'];
const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => { const v = r[c] ?? ''; return /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v; }).join(','))).join('\n');
fs.writeFileSync(path.join(outDir, 'reconciliation_rows.csv'), csv);
const summary = {};
for (const r of rows) { const s = (summary[r.site] ||= { rows: 0, byClass: {}, selection_review_mismatch: 0, night_saved_without_surcharge: 0 }); s.rows++; s.byClass[r.cls] = (s.byClass[r.cls] || 0) + 1; if (r.selection_review_mismatch) s.selection_review_mismatch++; if (r.time.startsWith('night') && r.saved !== null && r.worker_calculated !== null && r.saved < r.worker_calculated - 0.005) s.night_saved_without_surcharge++; }
fs.writeFileSync(path.join(outDir, 'reconciliation_summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log('outbound calls the Worker attempted (all blocked):', rig.all.fetches.length, '| bookings created in the in-memory DB:', rig.all.inserted.length);
