// James's approvals (2026-10-05): Nadi Airport -> Fiji Marriott Resort Momi Bay, MINIBUS, daytime (06:00-21:59) ONE-WAY: the transfer is FJ$175.92 FINAL (the standard 10% discount is already
// included); extras are added at FJ$8 / FJ$24 with NO further discount: totals 175.92 / 183.92 / 199.92 / 207.92. NIGHT is on HOLD (not approved, not implemented); returns 297 / 304 unchanged.
// Real page functions run in a sandbox; nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/\r/g, '');
const lines = source.split('\n');
const html = readFileSync(new URL('../src/transfer/fiji-marriott-resort-momi-bay.html', import.meta.url), 'utf8').replace(/\r/g, '');
const idx = (re, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l));
const slice = (a, b) => lines.slice(idx(a), idx(b)).join('\n');
const routesBlock = lines.slice(idx(/^const ROUTES_DATA = \[/), idx(/^\];/, idx(/^const ROUTES_DATA = \[/)) + 1).join('\n');
function fnSrc(name) { const s = source.indexOf(`function ${name}(`); if (s < 0) return ''; let i = source.indexOf('{', s), d = 0; for (; i < source.length; i++) { if (source[i] === '{') d++; else if (source[i] === '}' && --d === 0) return source.slice(s, i + 1); } throw new Error(name); }
const CODE = [slice(/^const NIGHT_SURCHARGE/, /^\/\/ ─── EMOJI STRIPPER/), slice(/^function isNightPickup/, /^\/\/ ─── RELIABLY SET A <SELECT>/), routesBlock].join('\n');

function page({ dest = 'MARRIOTT_MOMI', pickup = 'NAN', time = '10:00', trip = 'one-way', seat = false, surf = false, vehicle = 'minibus', tour = null } = {}) {
  const sb = { Math, Number, parseInt, JSON, String, state: { tripType: trip, prices: {}, extrasTotal: (seat ? 8 : 0) + (surf ? 24 : 0), passengers: 2, luggage: 2, selectedVehicle: vehicle, selectedTour: tour, fareOverride: null },
    document: { getElementById: (id) => ({ value: ({ travelTime: time, pickup, destination: dest })[id] ?? '', checked: false }) } };
  vm.createContext(sb); vm.runInContext('var TIER = {}; ' + CODE + `; state.prices = computePrices(${JSON.stringify(pickup)}, ${JSON.stringify(dest)}, 40);`, sb);
  return sb;
}
const total = (o, vehicleKey) => JSON.parse(vm.runInContext(`JSON.stringify(calculateTotal(${vehicleKey ? JSON.stringify(vehicleKey) : ''}))`, page(o)));

const APPROVED = [[{}, 175.92, 0], [{ seat: true }, 183.92, 8], [{ surf: true }, 199.92, 24], [{ seat: true, surf: true }, 207.92, 32]];
test('APPROVED FINAL FARE + EXTRAS: 175.92 / 183.92 / 199.92 / 207.92 with NO discount line (subtotal = final, discount 0, extras 0/8/24/32, transfer component 175.92)', () => {
  for (const [o, want, extras] of APPROVED) {
    const t = total(o);
    assert.equal(t.vehiclePrice, 175.92); assert.equal(t.extras, extras); assert.equal(t.subtotal, want); assert.equal(t.discount, 0); assert.equal(t.final, want);
    assert.equal(t.qualifies, false, 'no 10% discount row'); assert.equal(t.approvedFinalFare, true);
  }
});
test('the per-vehicle card (calculateTotal(vehicleKey)) shows the same final fare even while another vehicle is selected; the other vehicle cards are unchanged', () => {
  assert.equal(total({ vehicle: 'sedan' }, 'minibus').final, 175.92);
  assert.deepEqual([total({ vehicle: 'minibus' }, 'sedan').final, total({ vehicle: 'minibus' }, 'minivan').final], [89, 134]);
});
test('NO DOUBLE DISCOUNT: the no-extras total equals the catalogue figure exactly, and the superseded discounted totals 157.92 / 165.92 / 179.92 / 186.92 are never produced', () => {
  const sb = page({}); const t = JSON.parse(vm.runInContext('JSON.stringify(calculateTotal())', sb));
  assert.equal(t.final, sb.state.prices.minibus);
  for (const [o] of APPROVED) assert.ok(![157.92, 165.92, 179.92, 186.92].includes(total(o).final));
});
test('INVARIANT I1 (passing regression): adding extras can never LOWER the fare - none <= child seat <= surfboard <= both, in the day AND at night; steps are exactly 8 / 24 / 32', () => {
  for (const time of ['10:00', '21:59', '06:00', '22:00', '23:00', '05:59']) {
    const [n, c, sf, b] = [{}, { seat: true }, { surf: true }, { seat: true, surf: true }].map((o) => total({ ...o, time }).final);
    assert.ok(n <= c && c <= b && n <= sf && sf <= b, time + ': ' + [n, c, sf, b]);
  }
  const d = [{}, { seat: true }, { surf: true }, { seat: true, surf: true }].map((o) => total(o).final); assert.deepEqual(d.map((x) => Math.round((x - d[0]) * 100) / 100), [0, 8, 24, 32]);
});
test('BOUNDARIES: 21:59 and 06:00 are day (approved totals, with and without extras); 22:00 and 05:59 are night and keep the EXISTING arithmetic (night is on HOLD: 193 / 201 / 215 / 222 - the proposed 211.10 / 219.10 / 235.10 / 243.10 are NOT implemented)', () => {
  for (const time of ['21:59', '06:00', '10:00']) for (const [o, want] of APPROVED) assert.equal(total({ ...o, time }).final, want, time + JSON.stringify(o));
  for (const time of ['22:00', '05:59', '23:00', '00:00']) {
    assert.deepEqual([{}, { seat: true }, { surf: true }, { seat: true, surf: true }].map((o) => total({ ...o, time }).final), [193, 201, 215, 222], time);
    assert.equal(total({ time }).approvedFinalFare, undefined, 'night is not an approved final-fare journey');
  }
});
test('ITINERARY EDITS: switching one-way <-> return, extras, vehicle or tour re-derives the fare each time (approved only for the exact journey; a stale selection never carries the approved fare elsewhere)', () => {
  const sb = page({ seat: true }); const run = (e) => JSON.parse(vm.runInContext(e + '; state.prices = computePrices("NAN", "MARRIOTT_MOMI", 40); JSON.stringify(calculateTotal())', sb));
  assert.equal(run('0').final, 183.92);
  assert.equal(run("state.tripType = 'return'").final, 304);
  assert.equal(run("state.tripType = 'one-way'").final, 183.92);
  assert.equal(run("state.extrasTotal = 32").final, 207.92);
  assert.equal(run("state.extrasTotal = 0").final, 175.92);
  assert.equal(run("state.extrasTotal = 5").approvedFinalFare, undefined);
  assert.equal(run("state.extrasTotal = 8; state.selectedVehicle = 'minivan'").approvedFinalFare, undefined);
  assert.equal(run("state.selectedVehicle = 'minibus'; state.selectedTour = { name: 'X', price: 100 }").approvedFinalFare, undefined);
});

test('APPROVED RETURN FIGURES PRESERVED: day return 297, return + child seat 304 (the existing Nadi convention)', () => {
  assert.equal(total({ trip: 'return' }).final, 297); assert.equal(total({ trip: 'return', seat: true }).final, 304);
  assert.equal(total({ trip: 'return' }).approvedFinalFare, undefined, 'returns are not an approved final-fare journey');
});
test('HELD (night): the existing night arithmetic is unchanged - night one-way is 193 / 201 / 215 / 222 on NAT, i.e. HIGHER than the approved daytime totals (no inversion on NAT)', () => {
  assert.equal(total({ time: '23:00' }).final, 193); assert.equal(total({ time: '23:00', seat: true }).final, 201); assert.equal(total({ time: '23:00', surf: true }).final, 215); assert.equal(total({ time: '23:00', seat: true, surf: true }).final, 222);
});
test('OTHER PRICING UNCHANGED: every other route, vehicle, trip type, extras and time is identical to the pre-change arithmetic (round(10%) discount above FJ$50, return x1.85 rounded up to FJ$5, night x1.2); only the approved day one-way minibus cells (extras 0 / 8 / 24 / 32) differ', () => {
  const sbR = {}; vm.createContext(sbR); vm.runInContext(routesBlock + ';this.R = ROUTES_DATA', sbR);
  let checked = 0, approvedCells = 0;
  for (const r of sbR.R) for (const v of ['sedan', 'minivan', 'minibus']) for (const trip of ['one-way', 'return']) for (const [seat, surf] of [[false, false], [true, false], [false, true], [true, true]]) for (const time of ['10:00', '23:00']) {
    const base = r[{ sedan: 's', minivan: 'v', minibus: 'm' }[v]]; const night = time === '23:00'; const ret = trip === 'return';
    const price = night || ret ? Math.ceil(base * (night ? 1.2 : 1) * (ret ? 1.85 : 1) / 5) * 5 : base;
    const sub = price + (seat ? 8 : 0) + (surf ? 24 : 0); const expected = sub > 50 ? sub - Math.round(sub * 0.1) : sub;
    const approved = r.destValue === 'MARRIOTT_MOMI' && v === 'minibus' && trip === 'one-way' && !night;
    const got = total({ dest: r.destValue, vehicle: v, trip, seat, surf, time }).final;
    if (approved) { approvedCells++; assert.equal(got, Math.round((175.92 + (seat ? 8 : 0) + (surf ? 24 : 0)) * 100) / 100); } else assert.equal(got, expected, r.destValue + ' ' + v + ' ' + trip + ' seat=' + seat + ' surf=' + surf + ' ' + time);
    checked++;
  }
  assert.equal(approvedCells, 4); assert.ok(checked >= 35 * 3 * 2 * 4 * 2 - 1);
});
test('the approval does not leak: another Momi Bay hotel, a custom pickup, a tour and the departure direction keep the normal discount arithmetic', () => {
  assert.equal(total({ dest: 'HILTON_DENARAU' }).approvedFinalFare, undefined);
  const dep = page({}); dep.document.getElementById = (id) => ({ value: ({ travelTime: '10:00', pickup: 'CUSTOM_PICKUP', destination: 'NAN' })[id] ?? '', checked: false });
  assert.equal(JSON.parse(vm.runInContext('JSON.stringify(calculateTotal())', dep)).approvedFinalFare, undefined, 'departure direction');
  assert.equal(total({ tour: { name: 'X', price: 100 } }).approvedFinalFare, undefined);
});
test('the routes table (home page) shows 175.92 once, as a FINAL fare, for the Momi minibus - no struck-through base and no 157.92 - and every other cell is unchanged', () => {
  const rows = {}; const sb = { Math, document: { getElementById: (id) => (id === 'routesTableBody' ? rows : null) }, formatPrice: (n) => `FJ$${n}`, DISCOUNT_THRESHOLD: 50, DISCOUNT_RATE: 0.1 };
  vm.createContext(sb); vm.runInContext(routesBlock + '\n' + fnSrc('isApprovedFinalFareCell') + '\n' + fnSrc('buildRoutesTable') + '; buildRoutesTable();', sb);
  const momi = rows.innerHTML.split('</tr>').find((r) => r.includes('Fiji Marriott Resort Momi Bay'));
  const cells = [...momi.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  assert.ok(!/157\.92/.test(momi)); assert.match(cells[5], /FJ\$175\.92/); assert.ok(!/price-old/.test(cells[5]), 'no struck-through base'); assert.match(cells[5], /final fare/i);
  assert.match(cells[3], /price-old[^>]*>FJ\$99[\s\S]*FJ\$89/); assert.match(cells[4], /price-old[^>]*>FJ\$149[\s\S]*FJ\$134/);
});

// ---- the submit: the id is sent only for the approved journey
function submitSandbox(over = {}) {
  const calls = [];
  const fields = { firstName: { value: 'Guest' }, lastName: { value: 'Test' }, phone: { value: '+61400000000' }, email: { value: 'g@example.test' }, flightNum: { value: '' }, notes: { value: '' }, travelDate: { value: '2026-10-15' }, travelTime: { value: over.time || '10:00' },
    pickup: { value: 'NAN' }, destination: { value: over.dest || 'MARRIOTT_MOMI' }, returnDate: { value: '2026-10-19' }, returnTime: { value: '10:00' }, returnPickupLocation: { value: 'Hotel' }, 'extra-seat': { checked: !!over.seat }, 'extra-surf': { checked: !!over.surf } };
  const sb = { Math, Number, parseInt, JSON, String, document: { getElementById: (id) => fields[id] }, state: { selectedVehicle: over.vehicle || 'minibus', tripType: over.trip || 'one-way', prices: {}, extrasTotal: (over.seat ? 8 : 0) + (over.surf ? 24 : 0), passengers: 2, luggage: 2, distanceKm: 40, selectedTour: null, fareOverride: null },
    NADI_API_BASE: 'https://api.test', buildOperationalNotes: () => 'notes', fareText: (n) => String(n), bookingRequest: async (url, o) => { calls.push(JSON.parse(o.body)); return { response: { ok: true, status: 201 }, data: { ok: true, booking_id: 7, booking: { quoted_amount: 1, quoted_currency: 'FJD' } } }; }, reportNadiSyncFailure: async () => {} };
  vm.createContext(sb);
  vm.runInContext('var TIER = {}; ' + CODE + `; state.prices = computePrices("NAN", ${JSON.stringify(over.dest || 'MARRIOTT_MOMI')}, 40);` + '\n' + source.slice(source.indexOf('async function submitNadiBooking('), source.indexOf('// Same non-blocking, fire-and-forget escalation pattern')), sb);
  return { sb, calls };
}
test('the booking request names the approved final fare ONLY for the exact journey (day one-way, with or without the two extras) and sends exactly 175.92 / 183.92 / 199.92 / 207.92', async () => {
  for (const [o, want] of [[{}, 175.92], [{ seat: true }, 183.92], [{ surf: true }, 199.92], [{ seat: true, surf: true }, 207.92]]) {
    const a = submitSandbox(o); const r = await a.sb.submitNadiBooking('FTT-T1', 'Momi Bay');
    assert.equal(r.ok, true); assert.equal(a.calls[0].quoted_amount, want, JSON.stringify(o)); assert.equal(a.calls[0].approved_final_fare_id, 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY'); assert.equal(a.calls[0].require_quote_match, true);
  }
  for (const o of [{ trip: 'return' }, { time: '23:00' }, { time: '22:00', seat: true }, { time: '05:59' }, { vehicle: 'minivan' }, { dest: 'HILTON_DENARAU' }]) {
    const b = submitSandbox(o); await b.sb.submitNadiBooking('FTT-T2', 'Momi Bay');
    assert.equal(b.calls[0].approved_final_fare_id, undefined, JSON.stringify(o));
  }
  const ret = submitSandbox({ trip: 'return' }); await ret.sb.submitNadiBooking('FTT-T3', 'Momi Bay'); assert.equal(ret.calls[0].quoted_amount, 297);
  const retSeat = submitSandbox({ trip: 'return', seat: true }); await retSeat.sb.submitNadiBooking('FTT-T4', 'Momi Bay'); assert.equal(retSeat.calls[0].quoted_amount, 304);
});
test('the discount banner does not promise 10% off the approved final fare when Momi Bay is the destination; every other destination keeps the standard banner', () => {
  const sb = { formatPrice: (n) => 'FJ$' + n, DISCOUNT_THRESHOLD: 50 }; vm.createContext(sb); vm.runInContext(fnSrc('discountBannerText'), sb);
  assert.match(sb.discountBannerText('MARRIOTT_MOMI'), /final fare.*discount already included/); assert.equal(sb.discountBannerText('HILTON_DENARAU'), '10% off automatically applied to bookings over FJ$50');
});

// ---- the public Momi route page
test('Momi route page: the minibus one-way is FJ$175.92 FINAL with extras at FJ$183.92 / 199.92 / 207.92 and NO further discount (table, FAQ, JSON-LD agree), the return is 330 before / 297 after, and no superseded discounted total appears', () => {
  for (const old of ['157.92', '165.92', '179.92', '186.92']) assert.ok(!html.includes(old), 'no ' + old + ' anywhere on the page');
  const table = html.slice(html.indexOf('<table class="rp-fare-table">'), html.indexOf('</table>'));
  const tr = table.match(/<tr><td>Minibus<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/);
  assert.ok(tr); assert.match(tr[1], /FJ\$175\.92/); assert.match(tr[1], /final fare/i); assert.ok(!/&rarr;/.test(tr[1]), 'no before -> after discount arrow for the final fare');
  assert.match(tr[2], /FJ\$330 &rarr; FJ\$297/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = ld.find((o) => o['@type'] === 'FAQPage').mainEntity.find((q) => /cost/.test(q.name)).acceptedAnswer.text;
  const visible = html.match(/<div class="rp-faq-item"><h3>How much does a Nadi Airport to Fiji Marriott Resort Momi Bay transfer cost\?<\/h3><p>([^<]*)<\/p>/)[1];
  assert.equal(visible, faq); assert.match(faq, /FJ\$175\.92 final fare/); assert.match(faq, /no further discount/i); assert.match(faq, /Minibus return: FJ\$330 before discount \(FJ\$297 after/);
  for (const t of ['FJ$183.92', 'FJ$199.92', 'FJ$207.92']) { assert.ok(faq.includes(t), t); assert.ok(html.includes(t), t); }
  assert.ok(!/added before the discount/i.test(html), 'the page must not say extras are added before a discount for the minibus one-way');
  const spec = ld.find((o) => o['@type'] === 'Service').offers.priceSpecification;
  assert.equal(Number(spec.maxPrice), 175.92); assert.match(spec.description, /175\.92/); assert.match(spec.description, /183\.92/);
  for (const text of [visible, faq, spec.description]) for (const sentence of text.split(/\.\s/).filter((x) => x.includes('175.92'))) assert.ok(!/before( the)?( booking)? discount/i.test(sentence), '175.92 is never described as a pre-discount amount: ' + sentence);
});
test('SCOPE: the released quote-consent, retry, formatting and money-format protections are still in the page', () => {
  for (const c of ['require_quote_match: true', 'Accept revised price and submit', 'keyAtSubmit !== fareOverrideKey()', 'function fareText(n)', 'revised_from_amount']) assert.ok(source.includes(c), c);
});
