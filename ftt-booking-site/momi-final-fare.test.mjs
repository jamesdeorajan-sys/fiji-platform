// FijiDash (production source 8c6f920) - James's clarified commercial decision (2026-10-05): Nadi Airport -> Fiji Marriott Resort Momi Bay, MINIBUS, daytime ONE-WAY, no extras: FJ$175.92 is the
// FINAL fare, the standard 10% discount already included (no further 10%; 157.92 is not the intended fare). That exact journey only. FijiDash production still carried the superseded catalogue figure
// (minibus 79) and its review step swaps in the booking system's pre-discount reference fare (175.92) and then applied the discount again. Not newly approved: night, one-way + extras, other
// vehicles/routes. The approved return figures (297 / 304) are preserved (FijiDash production recorded 292.45 / 300.45 for them because the review swap replaced the page figure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'src', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(here, 'src', 'transfer', 'fiji-marriott-resort-momi-bay.html'), 'utf8').replace(/\r\n/g, '\n');
const between = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
function fn(name) { const s = src.indexOf(`function ${name}(`); assert.ok(s >= 0, name); let i = src.indexOf('{', s), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return (src.slice(s - 6, s) === 'async ' ? 'async ' : '') + src.slice(s, i + 1); } throw new Error(name); }
const konst = (n) => { const m = src.match(new RegExp('const ' + n + '\\s*= [^;]+;')); assert.ok(m, n); return m[0]; };
const rs = src.indexOf('const ROUTES_DATA = ['); const ROUTES = src.slice(rs, src.indexOf('\n];', rs) + 3);
const PRICING = 'var TIER = {};\n' + between('const NIGHT_SURCHARGE', '// ─── EMOJI STRIPPER') + '\n' + between('function isNightPickup', '// ─── RELIABLY SET A <SELECT>') + '\n' + ROUTES;
const el = (extra = {}) => ({ style: {}, value: '', textContent: '', innerHTML: '', disabled: false, parentNode: null, setAttribute() {}, appendChild() {}, insertBefore() {}, remove() {}, ...extra });

function ctx({ dest = 'MARRIOTT_MOMI', vehicle = 'minibus', trip = 'one-way', time = '10:00', seat = false, surf = false, fetchFare } = {}) {
  const vals = { travelTime: time, pickup: 'NAN', destination: dest };
  const sb = { Math, Number, parseInt, JSON, String, Date, isFinite, Promise, setTimeout, console, BOAT_DESTINATION_IDS: {},
    state: { tripType: trip, prices: {}, extrasTotal: (seat ? 8 : 0) + (surf ? 24 : 0), passengers: 2, luggage: 2, selectedVehicle: vehicle, selectedTour: null, priceSource: 'published' },
    document: { getElementById: (id) => (id in vals ? el({ value: vals[id] }) : el()) },
    updatePricing() {}, stopNegotiationPolling() {}, renderPriceBlock() {}, formatPrice: String, resolveConfirmedPickupZone: () => 'Nadi Airport', resolveConfirmedDestinationZone: () => 'Momi Bay',
    fetchRealReferenceFare: async (pz, dz, vt, tt) => (fetchFare ? fetchFare(vt, tt) : null) };
  vm.createContext(sb);
  vm.runInContext([PRICING, konst('NEGOTIATION_FLOOR_RATIO'), fn('resolveNegotiationEligibility'), fn('renderFareTiers')].join('\n') + `; state.prices = computePrices('NAN', ${JSON.stringify(dest)}, 40);`, sb);
  return sb;
}
const total = (o, vk) => JSON.parse(vm.runInContext(`JSON.stringify(calculateTotal(${vk ? JSON.stringify(vk) : ''}))`, ctx(o)));
const review = async (o) => { const sb = ctx(o); sb.renderFareTiers(); await new Promise((r) => setTimeout(r, 5)); return JSON.parse(vm.runInContext('JSON.stringify(calculateTotal())', sb)); };

test('FijiDash production catalogue still had the superseded Momi minibus figure 79; the candidate carries the approved 175.92 and changes no other catalogue row', () => {
  const rows = (s) => { const i = s.indexOf('const ROUTES_DATA = ['); const code = s.slice(i, s.indexOf('\n];', i) + 3); const sb = {}; vm.createContext(sb); vm.runInContext(code + ';this.R = ROUTES_DATA.map((r) => [r.destValue, r.s, r.v, r.m])', sb); return JSON.parse(JSON.stringify(sb.R)); };
  const base = rows(src);
  const momi = base.find((r) => r[0] === 'MARRIOTT_MOMI'); assert.deepEqual(momi, ['MARRIOTT_MOMI', 99, 149, 175.92]);
});

test('APPROVED FINAL FARE at selection: the exact journey totals FJ$175.92 with NO discount (subtotal 175.92, discount 0, final 175.92)', () => {
  const t = total({}); assert.deepEqual([t.subtotal, t.discount, t.final, t.qualifies, t.approvedFinalFare], [175.92, 0, 175.92, false, true]);
  assert.equal(total({ vehicle: 'sedan' }, 'minibus').final, 175.92, 'the minibus vehicle card while another vehicle is selected');
  assert.deepEqual([total({}, 'sedan').final, total({}, 'minivan').final], [89, 134]);
});

test('REFERENCE FARE -> REVIEW: the booking system\'s pre-discount reference fare (175.92) is NOT discounted a second time at review; the total stays 175.92 and nothing says the price changed', async () => {
  const t = await review({ fetchFare: () => 175.92 });
  assert.deepEqual([t.subtotal, t.discount, t.final], [175.92, 0, 175.92]); assert.notEqual(t.final, 157.92);
});

test('APPROVED RETURN FIGURES PRESERVED at review: day return 297, return + child seat 304 - the booking system\'s own return figures (292.45 / 300.45) are NOT swapped in over them', async () => {
  assert.equal((await review({ trip: 'return', fetchFare: () => 292.45 })).final, 297);
  assert.equal((await review({ trip: 'return', seat: true, fetchFare: () => 292.45 })).final, 304);
  assert.equal(total({ trip: 'return' }).final, 297); assert.equal(total({ trip: 'return', seat: true }).final, 304);
});

test('OTHER PRICING UNCHANGED: every other route, vehicle, trip type, extras and time keeps the existing arithmetic (round(10%) above FJ$50, return x1.85 rounded up to FJ$5, night x1.2); the only changed cell is the approved journey (and the Momi catalogue row)', () => {
  const sbR = {}; vm.createContext(sbR); vm.runInContext(ROUTES + ';this.R = ROUTES_DATA', sbR); let n = 0;
  for (const r of sbR.R) for (const v of ['sedan', 'minivan', 'minibus']) for (const trip of ['one-way', 'return']) for (const seat of [false, true]) for (const time of ['10:00', '23:00']) {
    const base = r[{ sedan: 's', minivan: 'v', minibus: 'm' }[v]]; const night = time === '23:00'; const ret = trip === 'return';
    const price = night || ret ? Math.ceil(base * (night ? 1.2 : 1) * (ret ? 1.85 : 1) / 5) * 5 : base; const sub = price + (seat ? 8 : 0); const expected = sub > 50 ? sub - Math.round(sub * 0.1) : sub;
    const approved = r.destValue === 'MARRIOTT_MOMI' && v === 'minibus' && trip === 'one-way' && !seat && !night;
    assert.equal(total({ dest: r.destValue, vehicle: v, trip, seat, time }).final, approved ? 175.92 : expected, `${r.destValue} ${v} ${trip} seat=${seat} ${time}`); n++;
  }
  assert.ok(n > 800);
});

test('NOT NEWLY APPROVED - characterised and REPORTED, not extended: one-way + child seat (165.92) and one-way night (the live-fare review drops the night modifier) are LOWER than the approved 175.92', async () => {
  assert.deepEqual([total({ seat: true }).subtotal, total({ seat: true }).discount, total({ seat: true }).final], [183.92, 18, 165.92]);
  assert.equal(total({ time: '23:00' }).final, 193, 'selection (static) keeps the page night modifier');
  const night = await review({ time: '23:00', fetchFare: () => 175.92 });
  assert.equal(night.final, 157.92, 'REVIEW at night: the live-fare swap removes the modifier and the normal discount applies -> 157.92, below the approved daytime 175.92 (existing night behaviour, B1 in the pricing review)');
  assert.equal(total({ time: '21:59' }).final, 175.92); assert.equal(total({ time: '06:00' }).final, 175.92);
});

test('no leak: the approval does not apply to other routes, a tour, or the departure direction', () => {
  assert.equal(total({ dest: 'HILTON_DENARAU' }).approvedFinalFare, undefined);
  const sb = ctx({}); sb.state.selectedTour = { name: 'X', price: 100 }; assert.equal(JSON.parse(vm.runInContext('JSON.stringify(calculateTotal())', sb)).approvedFinalFare, undefined);
  const dep = ctx({}); dep.document.getElementById = (id) => el({ value: ({ travelTime: '10:00', pickup: 'CUSTOM_PICKUP', destination: 'NAN' })[id] ?? '' }); assert.equal(JSON.parse(vm.runInContext('JSON.stringify(calculateTotal())', dep)).approvedFinalFare, undefined);
});

test('the routes table, the mobile route rows and the vehicle cards show 175.92 once as a FINAL fare (no struck-through base, no 157.92); every other cell keeps its discount display', () => {
  const rows = {};
  const sb = { Math, document: { getElementById: (id) => (id === 'routesTableBody' ? rows : null) }, formatPrice: (n) => `FJ$${n}`, DISCOUNT_THRESHOLD: 50, DISCOUNT_RATE: 0.1, buildMobileRoutesList() {} };
  vm.createContext(sb); vm.runInContext(ROUTES + '\n' + fn('isApprovedFinalFareCell') + '\n' + fn('buildRoutesTable') + '; buildRoutesTable();', sb);
  const momi = rows.innerHTML.split('</tr>').find((r) => r.includes('Fiji Marriott Resort Momi Bay')); const cells = [...momi.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert.ok(!/157\.92/.test(momi)); assert.match(cells[5], /FJ\$175\.92/); assert.ok(!/price-old/.test(cells[5])); assert.match(cells[5], /final fare/i); assert.match(cells[3], /price-old[^>]*>FJ\$99[\s\S]*FJ\$89/);
  const mob = { Math, formatPrice: (n) => `FJ$${n}`, DISCOUNT_THRESHOLD: 50, DISCOUNT_RATE: 0.1, mobileRouteVehicle: {}, MOBILE_VEHICLE_FIELD: { sedan: 's', minivan: 'v', minibus: 'm' } };
  vm.createContext(mob); vm.runInContext(fn('isApprovedFinalFareCell') + '\n' + fn('renderMobileVehicleRow') + `; var out = renderMobileVehicleRow({ origIdx: 0, destValue: 'MARRIOTT_MOMI', s: 99, v: 149, m: 175.92 }, { key: 'minibus', name: 'Minibus', icon: 'x' }); var other = renderMobileVehicleRow({ origIdx: 1, destValue: 'HILTON_DENARAU', s: 49, v: 69, m: 99 }, { key: 'minibus', name: 'Minibus', icon: 'x' });`, mob);
  assert.ok(!/price-old/.test(mob.out) && /FJ\$175\.92/.test(mob.out) && !/157\.92/.test(mob.out)); assert.match(mob.other, /price-old[^>]*>FJ\$99[\s\S]*FJ\$89/);
  const cards = src.slice(src.indexOf('function buildVehicleCards'), src.indexOf('function buildVehicleCards') + 4000);
  assert.match(cards, /t\.approvedFinalFare \? 'final fare, no further discount' : 'per vehicle'/);
});

// ---- the booking request (stubbed network): the id is sent ONLY for the exact journey, with exactly 175.92; nothing else about the payload changes
function submitCtx(o = {}) {
  const sent = []; const vals = { firstName: 'Zed', lastName: 'Test', phone: '+61411222333', email: 'zed.test@example.invalid', flightNum: 'FJ1', notes: '', travelDate: '2026-10-20', travelTime: o.time || '10:00', pickup: 'NAN', destination: 'MARRIOTT_MOMI', returnDate: '2026-10-27', returnTime: '10:00', returnPickupLocation: 'Hotel' };
  const sb = { Math, Number, parseInt, JSON, String, Date, isFinite, Promise, setTimeout, clearTimeout, AbortController, Error, console, BOAT_DESTINATION_IDS: {}, NADI_API_BASE: 'https://api.test',
    state: { tripType: o.trip || 'one-way', prices: {}, extrasTotal: o.seat ? 8 : 0, passengers: 2, luggage: 2, selectedVehicle: o.vehicle || 'minibus', selectedTour: null, distanceKm: 38.6, boatQuoteResult: null, priceSource: 'published' },
    document: { getElementById: (id) => (id in vals ? el({ value: vals[id], checked: id === 'extra-seat' ? !!o.seat : false }) : el()) },
    resolveConfirmedPickupZone: () => 'Nadi Airport', resolveConfirmedDestinationZone: () => 'Momi Bay', resolveDurableNotes: (x) => x || null, getAttributionForPayload: () => ({}), trackBookingFunnel() {}, reportBookingSyncFailure: async () => {},
    fetch: async (u, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 201, json: async () => ({ ok: true, booking_id: 9, booking: { quoted_amount: sent.at(-1).quoted_amount, quoted_currency: 'FJD' } }) }; } };
  vm.createContext(sb);
  vm.runInContext([PRICING, fn('bookingHasTour'), fn('bookingRequest'), fn('submitMarketplaceBooking')].join('\n') + `; state.prices = computePrices('NAN', 'MARRIOTT_MOMI', 40);`, sb);
  return { sb, sent };
}
test('the booking request names the approved final fare only for the exact journey (and sends 175.92); a return sends 297; the 15s timeout, honest unknown wording and same-reference retry stay', async () => {
  const a = submitCtx(); const r = await a.sb.submitMarketplaceBooking('FD-T1'); assert.equal(r.ok, true);
  assert.equal(a.sent[0].quoted_amount, 175.92); assert.equal(a.sent[0].approved_final_fare_id, 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY'); assert.equal(a.sent[0].client_booking_ref, 'FD-T1');
  for (const o of [{ trip: 'return' }, { seat: true }, { time: '23:00' }, { vehicle: 'minivan' }]) { const b = submitCtx(o); await b.sb.submitMarketplaceBooking('FD-T2'); assert.equal(b.sent[0].approved_final_fare_id, undefined, JSON.stringify(o)); }
  const ret = submitCtx({ trip: 'return' }); await ret.sb.submitMarketplaceBooking('FD-T3'); assert.equal(ret.sent[0].quoted_amount, 297);
  assert.match(src, /async function bookingRequest\(url, options, timeoutMs = 15000\)/); assert.match(src, /resultKind: 'unknown'/); assert.match(src, /function trackBookingFunnel\(eventType\)/);
});

test('FijiDash Momi route page: minibus one-way FJ$175.92 as a FINAL fare (never pre-discount, no further 10%), return FJ$330 before discount, no stale FJ$79 / FJ$150 / 157.92', () => {
  assert.ok(!/157\.92|FJ\$79 minibus|FJ\$150 minibus|<strong>FJ\$79<\/strong>|<td>FJ\$150<\/td>/.test(html));
  assert.match(html, /<td><strong>FJ\$175\.92<\/strong> <span[^>]*>final fare[^<]*<\/span><\/td>\s*<td>FJ\$330<\/td>/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = ld.find((o) => o['@type'] === 'FAQPage').mainEntity[0].acceptedAnswer.text;
  assert.match(faq, /FJ\$175\.92 as a final fare/); assert.match(faq, /no further discount/i); assert.match(faq, /FJ\$330 minibus/);
  for (const sentence of faq.split(/\.\s/).filter((x) => x.includes('175.92'))) assert.ok(!/before( the)?( booking)? discount/i.test(sentence), sentence);
});

// RELEASE BLOCKERS (price inversions found by the Momi minibus grid). Visible TODOs until James decides the extras and night rules for the approved final fare (MOMI-DECISION-TABLE.md in the Worker
// branch); the characterisations above (165.92; night review 157.92) are the passing record of today's behaviour.
const PENDING = 'RELEASE BLOCKER - owner decision pending (extras / night rules for the approved Momi minibus final fare)';
test('INVARIANT I1: extras never lower the approved daytime one-way total (selection and review)', { todo: PENDING }, async () => {
  const base = (await review({ fetchFare: () => 175.92 })).final;
  for (const o of [{ seat: true }, { surf: true }, { seat: true, surf: true }]) assert.ok((await review({ ...o, fetchFare: () => 175.92 })).final >= base, JSON.stringify(o));
});
test('INVARIANT I2: the night one-way REVIEW is never below the approved daytime fare', { todo: PENDING }, async () => {
  assert.ok((await review({ time: '23:00', fetchFare: () => 175.92 })).final >= (await review({ fetchFare: () => 175.92 })).final);
});
