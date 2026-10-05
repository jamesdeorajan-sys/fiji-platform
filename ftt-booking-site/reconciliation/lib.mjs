// Shared harness for the reconciliation and journey scripts. The REAL page code (functions sliced from each app.js, run in a vm sandbox) and the REAL deployed
// Worker (dry-run bundle of the production script) over an in-memory database seeded from a read-only production pricing snapshot. Every outbound call the
// Worker attempts is recorded and blocked by the rig. No network, no live booking, no message.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(here, '..');
const { createRig } = await import(pathToFileURL(path.join(root, 'test-fixtures', 'real-worker-rig.mjs')).href);
export const { snap } = await import(pathToFileURL(path.join(root, 'test-fixtures', 'real-worker-harness.mjs')).href);
export const BUNDLE = path.join(root, 'test-fixtures', 'worker-deployed-7a32a034.mjs');
console.warn = () => {};

const git = (args) => execFileSync('git', args, { cwd: root, maxBuffer: 1e8, encoding: 'utf8' }).replace(/\r\n/g, '\n');
const readSrc = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
export const SOURCES = {
  'fd-prod': () => git(['show', '8c6f920:ftt-booking-site/src/app.js']),
  'fd-cand': () => readSrc(path.join(root, 'src', 'app.js')),
  nat: () => readSrc(process.env.NAT_APP_JS || path.join(root, 'test-fixtures', 'nat-site-c5ee3b1', 'app.js')),
};

const between = (src, a, b) => { const i = src.indexOf(a); if (i < 0) throw new Error('marker ' + a); const j = src.indexOf(b, i + a.length); if (j < 0) throw new Error('end ' + b); return src.slice(i, j); };
function fn(src, name) { const s = src.indexOf(`function ${name}(`); if (s < 0) return ''; let i = src.indexOf('{', s), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return src.slice(s, i + 1); } throw new Error('unbalanced ' + name); }
const konst = (src, n) => { const m = src.match(new RegExp('const ' + n + '\\s*= [^;]+;')); return m ? m[0] : ''; };
export function slices(src, live) {
  const A = between(src, 'const NIGHT_SURCHARGE', '// ─── EMOJI STRIPPER');
  const B = between(src, 'function isNightPickup', '// ─── RELIABLY SET A <SELECT>');
  const rs = src.indexOf('const ROUTES_DATA = ['); const C = src.slice(rs, src.indexOf('\n];', rs) + 3);
  let D = '';
  if (live !== 'none') {
    D = ['NEGOTIATION_FLOOR_RATIO', 'LIVE_FARE_FETCH_TIMEOUT_MS', 'LIVE_FARE_TTL_MS', 'LIVE_FARE_MAX_ATTEMPTS', 'LIVE_FARE_RETRY_DELAYS_MS', 'LIVE_FARE_CLASSES', 'PAGE_RETURN_CONVENTION_DESTS'].map((n) => konst(src, n)).join('\n')
      + '\n' + ['pageReturnConventionApplies', 'liveFareEligible', 'applyLiveFares', 'renderLiveFareNote', 'startLiveFareFetch', 'retryLiveFares', 'applyOrFetchLiveFares', 'resolveNegotiationEligibility', 'renderFareTiers'].map((n) => fn(src, n)).join('\n');
  }
  return { code: 'var TIER = {};\n' + A + '\n' + B + '\n' + C + '\n' + D, routes: C };
}
export function routesOf(src) { const sb = {}; vm.createContext(sb); vm.runInContext(slices(src, 'none').routes + ';this.R = ROUTES_DATA;', sb); return JSON.parse(JSON.stringify(sb.R)); }

const MARKETPLACE = new Set(snap.zones.map((z) => z.name));
const ALIAS = { 'Port Denarau': 'Denarau' };
export const zoneOf = (area) => (MARKETPLACE.has(area) ? area : ALIAS[area] || null);
export const cents = (x) => Math.round(x * 100) / 100;
export const kmOf = (zone) => { const r = snap.zone_distance_cache.find((x) => (x.zone_a === 'Nadi Airport' && x.zone_b === zone) || (x.zone_b === 'Nadi Airport' && x.zone_a === zone)); return r ? r.distance_km : null; };
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function newEnv() {
  const rig = await createRig({ bundle: BUNDLE });
  const refCache = new Map(); let refN = 0;
  const referenceFare = async (zone, vehicle, trip) => {
    const k = `${zone}|${vehicle}|${trip}`; if (refCache.has(k)) return refCache.get(k);
    const r = await rig.get(`/reference-fare?pickup_zone=${encodeURIComponent('Nadi Airport')}&destination_zone=${encodeURIComponent(zone)}&vehicle_type=${vehicle}&trip_type=${trip}`);
    const v = r.status === 200 && r.body && r.body.ok ? r.body.reference_fare_fjd : null; refCache.set(k, v); return v;
  };
  const ref = () => `RECON-${(++refN).toString(36).toUpperCase()}`;
  const payload = ({ zone, vehicle, trip, time, returnTime = '10:00', seat, amount, optIn, k, revisedFrom }) => ({
    guest_name: 'QA Test', guest_phone: '+61400000000', guest_email: 'qa-test@example.invalid', client_booking_ref: ref(),
    pickup_zone: 'Nadi Airport', destination_zone: zone, vehicle_type: vehicle, quoted_currency: 'FJD', quoted_amount: amount, fx_rate_at_booking: 1, distance_km: k,
    payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: time, trip_type: trip, has_child_seat: seat, has_surfboard: false, has_tour: false, is_custom_address: false,
    ...(trip === 'return' ? { return_date: '2026-10-27', return_time: returnTime, return_pickup_location: 'Hotel' } : {}),
    ...(optIn ? { require_quote_match: true } : {}), ...(revisedFrom !== undefined ? { revised_from_amount: revisedFrom } : {}),
  });
  const workerCalc = new Map();
  const workerCalculated = async (c) => { // far below the band: the Worker replaces it with its own authoritative (discounted) amount
    const key = [c.zone, c.vehicle, c.trip, c.time, c.seat].join('|'); if (workerCalc.has(key)) return workerCalc.get(key);
    const r = await rig.post(payload({ ...c, amount: 1, optIn: false }));
    const v = r.status === 201 ? { ok: true, amount: r.saved.quoted_amount } : { ok: false, status: r.status, error: (r.body && (r.body.errors || r.body.error) || '').toString().slice(0, 120) };
    workerCalc.set(key, v); return v;
  };
  return { rig, referenceFare, payload, workerCalculated };
}

function makeCtx(env, src, variant, c, row) {
  const sl = slices(src, variant === 'nat' ? 'none' : 'live');
  const el = () => ({ style: {}, value: '', textContent: '', disabled: false, parentNode: null, setAttribute() {}, appendChild() {}, insertBefore() {}, remove() {} });
  const vals = { travelTime: c.time, pickup: 'NAN', destination: row.destValue, travelDate: '2026-10-20', returnDate: '2026-10-27', returnTime: c.returnTime || '10:00' };
  const sb = {
    Math, Number, parseInt, JSON, String, Date, isFinite, Promise, setTimeout, console, BOAT_DESTINATION_IDS: {},
    state: { tripType: c.trip, prices: {}, extrasTotal: c.seat ? 8 : 0, passengers: 2, luggage: 2, selectedVehicle: c.vehicle, selectedTour: null, priceSource: 'published', destZoneName: c.zone, liveFares: null, liveFaresPending: null, liveFareAttempts: null, fareOverride: null },
    document: { getElementById: (id) => (id in vals ? { ...el(), value: vals[id], checked: false } : el()), createElement: el, querySelector: () => null },
    updatePricing: () => {}, stopNegotiationPolling: () => {}, renderPriceBlock: () => {}, formatPrice: String,
    resolveConfirmedPickupZone: () => 'Nadi Airport', resolveConfirmedDestinationZone: () => c.zone,
    fetchRealReferenceFare: async (pz, dz, vt, tt) => env.referenceFare(dz, vt, tt),
  };
  vm.createContext(sb);
  vm.runInContext(sl.code.replace(/const LIVE_FARE_FETCH_TIMEOUT_MS = \d+;/, 'const LIVE_FARE_FETCH_TIMEOUT_MS = 2000;'), sb);
  return sb;
}

// Selection-time and review-time amounts exactly as each page produces them for ONE case (full calculateTotal objects, for audit).
export async function pageAmounts(env, variant, src, c, row) {
  const sb = makeCtx(env, src, variant, c, row);
  const p = JSON.parse(vm.runInContext(`JSON.stringify(computePrices('NAN', ${JSON.stringify(row.destValue)}, ${row.km}))`, sb));
  const reset = () => { sb.state.prices = { sedan: p.sedan, minivan: p.minivan, minibus: p.minibus }; };
  reset(); sb.state.priceSource = p.source;
  const tot = () => JSON.parse(vm.runInContext(`JSON.stringify(calculateTotal(${JSON.stringify(c.vehicle)}))`, sb));
  const staticT = tot();
  let selection = staticT, review = staticT, liveRef = null;
  if (variant !== 'nat' && c.zone) {
    if (variant === 'fd-cand') {
      vm.runInContext(`applyOrFetchLiveFares('NAN', ${JSON.stringify(row.destValue)})`, sb); await wait(15);
      reset();
      vm.runInContext(`applyOrFetchLiveFares('NAN', ${JSON.stringify(row.destValue)})`, sb);
      selection = tot();
      reset();
    }
    vm.runInContext('renderFareTiers()', sb); await wait(15);
    review = tot();
    if (variant === 'fd-prod') selection = staticT;
    liveRef = await env.referenceFare(c.zone, c.vehicle, c.trip);
  }
  return { advertisedBase: row[{ sedan: 's', minivan: 'v', minibus: 'm' }[c.vehicle]], published: p[c.vehicle], source: p.source, selection, review, staticT, liveRef };
}

export async function runCase(env, { variant, src, row, vehicle, trip, time, returnTime, seat, optIn }) {
  const zone = zoneOf(row.area);
  const c = { zone, vehicle, trip, time, returnTime, seat, k: zone ? kmOf(zone) : null };
  const page = await pageAmounts(env, variant, src, c, row);
  const sel = cents(page.selection.final), rev = cents(page.review.final);
  const out = { selection: sel, review: rev, submitted: rev, advertised: page.advertisedBase, calc: { selection: page.selection, review: page.review, static: page.staticT, liveRef: page.liveRef } };
  if (!zone || c.k === null) return { ...out, cls: 'ZONE_NOT_IN_PRICING_DATA', worker: null, saved: null };
  const wc = await env.workerCalculated(c);
  if (!wc.ok) return { ...out, cls: 'MISSING_PRICING_RULE', worker: null, saved: null, note: `${wc.status} ${wc.error}` };
  const r = await env.rig.post(env.payload({ ...c, amount: rev, optIn }));
  const w = wc.amount; let cls, saved = null, note = '';
  if (r.status === 201) { saved = r.saved.quoted_amount; cls = Math.abs(saved - rev) < 0.005 ? (Math.abs(rev - w) < 0.005 ? 'MATCH' : 'IN_BAND_DIFFERENCE') : 'SILENT_SUBSTITUTION'; }
  else if (r.status === 409 && r.body && r.body.code === 'PRICE_MISMATCH') { cls = 'CONSENT_REQUIRED'; note = `refused; Worker fare ${r.body.reference_fare_fjd}`; }
  else { cls = 'REJECTED'; note = `${r.status}`; }
  return { ...out, worker: w, saved, cls, note, inBand: rev >= 0.8 * w && rev <= 1.3 * w };
}
