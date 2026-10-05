// Shared harness for the cross-component tests: the REAL page functions (NAT and FijiDash, candidate and released) in a vm sandbox, the REAL Worker (candidate and production source)
// over an in-memory database, every outbound call the Worker attempts recorded and BLOCKED. No network, no production data.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
export const NEW_DIR = path.join(here, '..');
export const need = ['NAT_NEW_APP_JS', 'FD_NEW_APP_JS', 'NAT_OLD_APP_JS', 'FD_OLD_APP_JS', 'WORKER_OLD_DIR'];
export const missing = need.filter((k) => !process.env[k]);
export const skip = missing.length ? `set ${missing.join(', ')}` : false;
export const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
console.warn = () => {};

export async function worker(dir) {
  const { loadWorker, makeEnv } = await import(pathToFileURL(path.join(dir, 'test-fixtures', 'worker-harness.mjs')).href);
  const w = (await loadWorker(dir)).default; const h = makeEnv({ settings: { admin_alert_phone: '+61400000001' } }); const env = { ...h.env, WHATSAPP_PHONE_ID: 'TEST-PHONE-ID', WHATSAPP_TOKEN: 'TEST-TOKEN' }; const blocked = [];
  const run = async (req) => {
    const real = globalThis.fetch; globalThis.fetch = async (url, init = {}) => { let body = init.body; try { body = JSON.parse(init.body); } catch { /* not json */ } blocked.push({ url: String(url), body }); return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
    const pending = [];
    try { const res = await w.fetch(req, env, { waitUntil: (p) => pending.push(p) }); const body = await res.json().catch(() => null); await Promise.allSettled(pending); return { status: res.status, body }; } finally { globalThis.fetch = real; }
  };
  let ip = 0;
  return {
    h, blocked,
    post: (payload) => run(new Request('https://api.nadiairporttransfers.com/bookings', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', origin: 'https://example.invalid' }, body: JSON.stringify(payload) })),
    get: (q) => run(new Request('https://api.nadiairporttransfers.com' + q, { headers: { 'CF-Connecting-IP': `203.0.113.${(++ip % 250) + 1}` } })),
    saved: () => h.inserted.at(-1) || null, decision: () => { const e = h.events.filter((x) => x.event_type === 'created').at(-1); return e && e.metadata && e.metadata.pricing_decision; },
    alertTexts: () => blocked.flatMap((f) => { const c = f.body && f.body.template && f.body.template.components; return (c || []).flatMap((x) => x.parameters || []).filter((p) => p.type === 'text').map((p) => p.text); }),
  };
}

// ---- page runners (real functions from the page source, in a vm sandbox)
export const el = (extra = {}) => ({ style: {}, value: '', textContent: '', innerHTML: '', checked: false, disabled: false, parentNode: null, children: [], setAttribute() {}, appendChild() {}, insertBefore() {}, remove() {}, ...extra });
export function fnSrc(src, name) { const s = src.indexOf(`function ${name}(`); if (s < 0) return ''; let i = src.indexOf('{', s), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return (src.slice(s - 6, s) === 'async ' ? 'async ' : '') + src.slice(s, i + 1); } throw new Error(name); }
export const between = (src, a, b) => { const i = src.indexOf(a); return src.slice(i, src.indexOf(b, i + a.length)); };
export const pricingCode = (src) => { const rs = src.indexOf('const ROUTES_DATA = ['); return 'var TIER = {};\n' + between(src, 'const NIGHT_SURCHARGE', '// ─── EMOJI STRIPPER') + '\n' + between(src, 'function isNightPickup', '// ─── RELIABLY SET A <SELECT>') + '\n' + src.slice(rs, src.indexOf('\n];', rs) + 3); };

// one journey through one page build and one Worker: returns every stage
export async function journey({ site, src, w, o = {} }) {
  const { vehicle = 'minibus', trip = 'one-way', time = '10:00', seat = false, surf = false } = o; const ref = `INT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const vals = { firstName: 'Zed', lastName: 'Testperson', phone: '+61411222333', email: 'zed.testperson@example.invalid', flightNum: 'FJ1', notes: '', travelDate: '2026-10-20', travelTime: time, pickup: 'NAN', destination: 'MARRIOTT_MOMI', returnDate: '2026-10-27', returnTime: '10:00', returnPickupLocation: 'Fiji Marriott Resort Momi Bay' };
  const state = { tripType: trip, prices: {}, extrasTotal: (seat ? 8 : 0) + (surf ? 24 : 0), passengers: 2, luggage: 2, selectedVehicle: vehicle, selectedTour: null, distanceKm: 38.6, durationMin: 52, fareOverride: null, boatQuoteResult: null, priceSource: 'published', destZoneName: 'Momi Bay' };
  const sb = { Math, Number, parseInt, JSON, String, Date, isFinite, Promise, setTimeout, clearTimeout, AbortController, Error, console, BOAT_DESTINATION_IDS: {}, NADI_API_BASE: 'https://api.nadiairporttransfers.com', state,
    document: { getElementById: (id) => (id === 'extra-seat' || id === 'extra-surf' ? el({ value: '', checked: id === 'extra-seat' ? !!seat : !!surf }) : id in vals ? el({ value: vals[id] }) : el()), createElement: () => el(), querySelector: () => el() },
    updatePricing() {}, stopNegotiationPolling() {}, renderPriceBlock() {}, formatPrice: String, resolveConfirmedPickupZone: () => 'Nadi Airport', resolveConfirmedDestinationZone: () => 'Momi Bay', resolveDurableNotes: (x) => x || null, getAttributionForPayload: () => ({}),
    trackBookingFunnel() {}, reportBookingSyncFailure: async () => {}, reportNadiSyncFailure: async () => {}, buildOperationalNotes: () => 'notes', fareText: (n) => String(n), fareOverrideKey: () => 'k',
    fetchRealReferenceFare: async (pz, dz, vt, tt) => { const r = await w.get(`/reference-fare?pickup_zone=${encodeURIComponent(pz)}&destination_zone=${encodeURIComponent(dz)}&vehicle_type=${vt}&trip_type=${tt}`); return r.status === 200 && r.body.ok ? r.body.reference_fare_fjd : null; },
    fetch: async (url, init) => { const body = JSON.parse(init.body); sb.lastSubmitted = body; const r = await w.post(body); sb.lastResponse = r; return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }; },
    bookingRequest: async (url, init) => { const body = JSON.parse(init.body); sb.lastSubmitted = body; const r = await w.post(body); sb.lastResponse = r; return { response: { ok: r.status >= 200 && r.status < 300, status: r.status }, data: r.body }; } };
  vm.createContext(sb);
  const common = pricingCode(src) + `\n; state.prices = computePrices('NAN', 'MARRIOTT_MOMI', 40);`;
  const total = () => JSON.parse(vm.runInContext('JSON.stringify(calculateTotal())', sb));
  if (site === 'nat') {
    vm.runInContext(common + '\n' + src.slice(src.indexOf('async function submitNadiBooking('), src.indexOf('// Same non-blocking, fire-and-forget escalation pattern')), sb);
    const selection = total().final; const review = selection;                       // NAT quotes the published catalogue at every step
    const result = await sb.submitNadiBooking(ref, 'Momi Bay');
    return { selection, review, referenceFare: null, submitted: sb.lastSubmitted && sb.lastSubmitted.quoted_amount, approvedId: sb.lastSubmitted && sb.lastSubmitted.approved_final_fare_id, status: sb.lastResponse && sb.lastResponse.status, responseAmount: sb.lastResponse && sb.lastResponse.body && sb.lastResponse.body.booking && sb.lastResponse.body.booking.quoted_amount, result, ref };
  }
  const fdFns = ['bookingHasTour', 'resolveNegotiationEligibility', 'renderFareTiers', 'approvedMomiMinibusReturn', 'bookingRequest', 'submitMarketplaceBooking'].map((n) => fnSrc(src, n)).filter(Boolean).filter((x) => !/^async function bookingRequest/.test(x)).join('\n');
  vm.runInContext(common + '\n' + (src.match(/const NEGOTIATION_FLOOR_RATIO\s*= [^;]+;/) || [''])[0] + '\n' + fdFns, sb);
  const selection = total().final;
  sb.renderFareTiers(); await new Promise((r) => setTimeout(r, 20));
  const review = total().final; const referenceFare = state.prices[vehicle];
  const result = await sb.submitMarketplaceBooking(ref);
  return { selection, review, referenceFare, submitted: sb.lastSubmitted && sb.lastSubmitted.quoted_amount, approvedId: sb.lastSubmitted && sb.lastSubmitted.approved_final_fare_id, status: sb.lastResponse && sb.lastResponse.status, responseAmount: sb.lastResponse && sb.lastResponse.body && sb.lastResponse.body.booking && sb.lastResponse.body.booking.quoted_amount, result, ref };
}

export const srcs = () => ({ natNew: read(process.env.NAT_NEW_APP_JS), fdNew: read(process.env.FD_NEW_APP_JS), natOld: read(process.env.NAT_OLD_APP_JS), fdOld: read(process.env.FD_OLD_APP_JS) });
