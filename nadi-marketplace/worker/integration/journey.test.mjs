// Cross-component journey: catalogue -> selection -> reference fare -> review -> submitted amount -> saved amount -> response -> admin/driver alerts, for the approved Momi minibus FINAL-fare
// change, using the REAL page functions (NAT and FijiDash, candidate AND released), the REAL Worker (candidate AND current production source), an in-memory database, and a network guard:
// every outbound call the Worker attempts is recorded and BLOCKED. No network, no production data.
// Required environment (paths to the exact source files under review):
//   NAT_NEW_APP_JS, FD_NEW_APP_JS            the candidate page sources
//   NAT_OLD_APP_JS, FD_OLD_APP_JS            the released production page sources (NAT c5ee3b1, FijiDash 8c6f920)
//   WORKER_OLD_DIR                           the production Worker source directory (0b961a4)
// The candidate Worker is this directory's parent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const NEW_DIR = path.join(here, '..');
const need = ['NAT_NEW_APP_JS', 'FD_NEW_APP_JS', 'NAT_OLD_APP_JS', 'FD_OLD_APP_JS', 'WORKER_OLD_DIR'];
const missing = need.filter((k) => !process.env[k]);
const skip = missing.length ? `set ${missing.join(', ')}` : false;
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
console.warn = () => {};

async function worker(dir) {
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
const el = (extra = {}) => ({ style: {}, value: '', textContent: '', innerHTML: '', checked: false, disabled: false, parentNode: null, children: [], setAttribute() {}, appendChild() {}, insertBefore() {}, remove() {}, ...extra });
function fnSrc(src, name) { const s = src.indexOf(`function ${name}(`); if (s < 0) return ''; let i = src.indexOf('{', s), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return (src.slice(s - 6, s) === 'async ' ? 'async ' : '') + src.slice(s, i + 1); } throw new Error(name); }
const between = (src, a, b) => { const i = src.indexOf(a); return src.slice(i, src.indexOf(b, i + a.length)); };
const pricingCode = (src) => { const rs = src.indexOf('const ROUTES_DATA = ['); return 'var TIER = {};\n' + between(src, 'const NIGHT_SURCHARGE', '// ─── EMOJI STRIPPER') + '\n' + between(src, 'function isNightPickup', '// ─── RELIABLY SET A <SELECT>') + '\n' + src.slice(rs, src.indexOf('\n];', rs) + 3); };

// one journey through one page build and one Worker: returns every stage
async function journey({ site, src, w, o = {} }) {
  const { vehicle = 'minibus', trip = 'one-way', time = '10:00', seat = false } = o; const ref = `INT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const vals = { firstName: 'Zed', lastName: 'Testperson', phone: '+61411222333', email: 'zed.testperson@example.invalid', flightNum: 'FJ1', notes: '', travelDate: '2026-10-20', travelTime: time, pickup: 'NAN', destination: 'MARRIOTT_MOMI', returnDate: '2026-10-27', returnTime: '10:00', returnPickupLocation: 'Fiji Marriott Resort Momi Bay' };
  const state = { tripType: trip, prices: {}, extrasTotal: seat ? 8 : 0, passengers: 2, luggage: 2, selectedVehicle: vehicle, selectedTour: null, distanceKm: 38.6, durationMin: 52, fareOverride: null, boatQuoteResult: null, priceSource: 'published', destZoneName: 'Momi Bay' };
  const sb = { Math, Number, parseInt, JSON, String, Date, isFinite, Promise, setTimeout, clearTimeout, AbortController, Error, console, BOAT_DESTINATION_IDS: {}, NADI_API_BASE: 'https://api.nadiairporttransfers.com', state,
    document: { getElementById: (id) => (id in vals ? el({ value: vals[id], checked: id === 'extra-seat' ? !!seat : false }) : el()), createElement: () => el(), querySelector: () => el() },
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

const srcs = () => ({ natNew: read(process.env.NAT_NEW_APP_JS), fdNew: read(process.env.FD_NEW_APP_JS), natOld: read(process.env.NAT_OLD_APP_JS), fdOld: read(process.env.FD_OLD_APP_JS) });
const CASES = {
  exact: { o: {} }, return: { o: { trip: 'return' } }, returnSeat: { o: { trip: 'return', seat: true } },
  oneWaySeat: { o: { seat: true } }, night: { o: { time: '23:00' } },
};

test('NEW pages + NEW Worker: the exact journey shows, submits, saves, responds and alerts FJ$175.92 end to end (no double discount); return 297 and return + child seat 304 preserved', { skip }, async () => {
  const S = srcs();
  for (const [site, src] of [['nat', S.natNew], ['fd', S.fdNew]]) {
    const w = await worker(NEW_DIR); const j = await journey({ site, src, w });
    assert.deepEqual([j.selection, j.review], [175.92, 175.92], `${site} selection/review`);
    if (site === 'fd') assert.equal(j.referenceFare, 175.92, 'the booking system reference fare (pre-discount formula figure) equals the final fare, so nothing is discounted again');
    assert.equal(j.submitted, 175.92); assert.equal(j.approvedId, 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY'); assert.equal(j.status, 201);
    assert.equal(w.saved().quoted_amount, 175.92); assert.equal(w.saved().settlement_amount_fjd, 175.92); assert.equal(w.decision().outcome, 'matched'); assert.equal(w.decision().reason, 'approved_final_fare');
    assert.equal(j.responseAmount, 175.92, 'the Worker response carries the saved amount');
    if (site === 'nat') assert.equal(j.result.savedAmount, 175.92, 'NAT shows the saved amount from the response (FijiDash production does not display it; that is in the held candidate)');
    const alerts = w.alertTexts().join(' | '); assert.match(alerts, /175\.92/); assert.doesNotMatch(alerts, /157\.92/); assert.doesNotMatch(alerts, /FARE CHECK/);
    for (const [name, want] of [['return', 297], ['returnSeat', 304]]) {
      const w2 = await worker(NEW_DIR); const r = await journey({ site, src, w: w2, o: CASES[name].o });
      assert.equal(r.submitted, want, `${site} ${name} submitted`); assert.equal(w2.saved().quoted_amount, want, `${site} ${name} saved`); assert.equal(r.approvedId, undefined);
    }
  }
});

test('DEPLOYMENT-ORDER MATRIX: new pages with the OLD Worker still save 175.92 (kept in band); old pages (NAT c5ee3b1, FijiDash 8c6f920) with the NEW Worker keep recording the superseded 157.92 - nothing is repriced silently in either direction', { skip }, async () => {
  const S = srcs();
  for (const [site, src] of [['nat', S.natNew], ['fd', S.fdNew]]) {            // page first, Worker not yet updated
    const w = await worker(process.env.WORKER_OLD_DIR); const j = await journey({ site, src, w });
    assert.equal(j.submitted, 175.92); assert.equal(w.saved().quoted_amount, 175.92); assert.equal(w.decision().outcome, 'kept_in_band');
  }
  for (const [site, src, expectSelection] of [['nat', S.natOld, 157.92], ['fd', S.fdOld, 71]]) {   // Worker first, old page/tab still open
    const w = await worker(NEW_DIR); const j = await journey({ site, src, w });
    assert.equal(j.selection, expectSelection, `${site} released page selection`); assert.equal(j.review, 157.92, `${site} released page review`);
    assert.equal(j.submitted, 157.92); assert.equal(j.approvedId, undefined); assert.equal(w.saved().quoted_amount, 157.92); assert.equal(w.decision().outcome, 'matched');
  }
});

test('NOT NEWLY APPROVED - interactions reported, nothing extended: one-way + child seat and the FijiDash night review are LOWER than the approved daytime 175.92; NAT night / seat follow the existing arithmetic', { skip }, async () => {
  const S = srcs(); const rec = {};
  for (const [site, src] of [['nat', S.natNew], ['fd', S.fdNew]]) for (const name of ['oneWaySeat', 'night']) {
    const w = await worker(NEW_DIR); const j = await journey({ site, src, w, o: CASES[name].o }); rec[`${site}:${name}`] = [j.selection, j.review, j.submitted, w.saved() && w.saved().quoted_amount];
  }
  assert.deepEqual(rec['nat:oneWaySeat'], [165.92, 165.92, 165.92, 165.92]); assert.deepEqual(rec['fd:oneWaySeat'], [165.92, 165.92, 165.92, 165.92]);
  assert.deepEqual(rec['nat:night'], [193, 193, 193, 193]);
  assert.deepEqual(rec['fd:night'], [193, 157.92, 157.92, 157.92], 'FijiDash: static selection 193, the live-fare review drops the night modifier -> 157.92 (existing behaviour, release blocker B1 in the pricing review)');
  assert.ok(rec['fd:night'][3] < 175.92 && rec['nat:oneWaySeat'][3] < 175.92);
});

test('SAME-REFERENCE RETRY and OLD-CALLER PROTECTIONS against the new Worker: a replay returns the same booking (no second booking, no second short alert), and a legacy caller far from the fare is still replaced with the FARE CHECK marker', { skip }, async () => {
  const w = await worker(NEW_DIR); const S = srcs();
  const j = await journey({ site: 'nat', src: S.natNew, w }); assert.equal(j.status, 201); const first = w.h.inserted.length;
  const replay = await w.post({ ...w.h.inserted[0], client_booking_ref: j.ref, guest_name: 'Zed Testperson', guest_phone: '+61411222333', pickup_zone: 'Nadi Airport', destination_zone: 'Momi Bay', vehicle_type: 'minibus', quoted_currency: 'FJD', quoted_amount: 157.92, fx_rate_at_booking: 1, payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: '10:00', trip_type: 'one-way', has_child_seat: false, has_surfboard: false, has_tour: false, is_custom_address: false });
  assert.equal(replay.body.idempotent, true); assert.equal(w.h.inserted.length, first); assert.equal(replay.body.booking.quoted_amount, 175.92, 'a stale amount cannot change the saved fare');
  assert.equal(w.alertTexts().filter((t) => /^New booking/.test(t)).length, 1, 'one short staff alert for the booking');
  const legacy = await worker(NEW_DIR);
  const lr = await legacy.post({ guest_name: 'Zed Testperson', guest_phone: '+61411222333', client_booking_ref: 'LEGACY-1', pickup_zone: 'Nadi Airport', destination_zone: 'Momi Bay', vehicle_type: 'minibus', quoted_currency: 'FJD', quoted_amount: 40, fx_rate_at_booking: 1, payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: '10:00', trip_type: 'one-way', has_child_seat: false, has_surfboard: false, has_tour: false, is_custom_address: false });
  assert.equal(lr.status, 201); assert.equal(legacy.saved().quoted_amount, 157.92, 'a legacy caller without the id is repriced to the unchanged formula figure'); assert.match(legacy.alertTexts().join(' | '), /FARE CHECK/);
});
