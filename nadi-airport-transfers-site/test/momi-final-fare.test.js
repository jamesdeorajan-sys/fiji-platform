// James's clarified commercial decision (2026-10-05): Nadi Airport -> Fiji Marriott Resort Momi Bay, MINIBUS, daytime ONE-WAY, no extras: FJ$175.92 is the FINAL fare - the standard
// 10% discount is ALREADY INCLUDED (do not deduct another 10%; 157.92 is not the intended fare). Approved ONLY for that route/vehicle/journey. Not newly approved: night, one-way + extras
// (reported below), any other vehicle/route. The approved return figures (297 / 304) are unchanged. Real page functions run in a sandbox; nothing touches the network.
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

test('APPROVED FINAL FARE: the exact journey shows FJ$175.92 as the total with NO discount line (subtotal 175.92, discount 0, final 175.92)', () => {
  const t = total({});
  assert.equal(t.vehiclePrice, 175.92); assert.equal(t.subtotal, 175.92); assert.equal(t.discount, 0); assert.equal(t.final, 175.92);
  assert.equal(t.qualifies, false, 'the vehicle card / confirmation must not render a 10% discount row for this fare');
  assert.equal(t.approvedFinalFare, true);
});
test('the per-vehicle card (calculateTotal(vehicleKey)) shows the same final fare even while another vehicle is selected; the other vehicle cards are unchanged', () => {
  assert.equal(total({ vehicle: 'sedan' }, 'minibus').final, 175.92);
  assert.deepEqual([total({ vehicle: 'minibus' }, 'sedan').final, total({ vehicle: 'minibus' }, 'minivan').final], [89, 134]);
});
test('NO DOUBLE DISCOUNT: the total equals the catalogue figure exactly - no further 10% (157.92 is never produced for the exact journey)', () => {
  const sb = page({}); const t = JSON.parse(vm.runInContext('JSON.stringify(calculateTotal())', sb));
  assert.equal(t.final, sb.state.prices.minibus); assert.notEqual(t.final, 157.92);
});
test('APPROVED RETURN FIGURES PRESERVED: day return 297, return + child seat 304 (the existing Nadi convention)', () => {
  assert.equal(total({ trip: 'return' }).final, 297); assert.equal(total({ trip: 'return', seat: true }).final, 304);
  assert.equal(total({ trip: 'return' }).approvedFinalFare, undefined, 'returns are not an approved final-fare journey');
});
test('NOT NEWLY APPROVED - characterised, unchanged: night one-way, one-way + child seat, one-way + surfboard keep the existing arithmetic (and the interaction is REPORTED: one-way + seat is cheaper than the approved extras-free fare)', () => {
  assert.equal(total({ time: '23:00' }).final, 193); assert.equal(total({ time: '22:00' }).final, 193); assert.equal(total({ time: '05:59' }).final, 193);
  assert.equal(total({ time: '21:59' }).final, 175.92); assert.equal(total({ time: '06:00' }).final, 175.92);
  const seat = total({ seat: true }); assert.deepEqual([seat.subtotal, seat.discount, seat.final], [183.92, 18, 165.92]);
  assert.equal(total({ surf: true }).final, 179.92);
  assert.ok(seat.final < 175.92, 'INTERACTION to report to James: adding a child seat LOWERS the one-way total (165.92 < 175.92)');
});
test('OTHER PRICING UNCHANGED: every other route, vehicle, trip type, extras and time is identical to the pre-change arithmetic (round(10%) discount above FJ$50, return x1.85 rounded up to FJ$5, night x1.2)', () => {
  const sbR = {}; vm.createContext(sbR); vm.runInContext(routesBlock + ';this.R = ROUTES_DATA', sbR);
  let checked = 0;
  for (const r of sbR.R) for (const v of ['sedan', 'minivan', 'minibus']) for (const trip of ['one-way', 'return']) for (const seat of [false, true]) for (const time of ['10:00', '23:00']) {
    const base = r[{ sedan: 's', minivan: 'v', minibus: 'm' }[v]]; const night = time === '23:00'; const ret = trip === 'return';
    const price = night || ret ? Math.ceil(base * (night ? 1.2 : 1) * (ret ? 1.85 : 1) / 5) * 5 : base;
    const sub = price + (seat ? 8 : 0); const expected = sub > 50 ? sub - Math.round(sub * 0.1) : sub;
    const approved = r.destValue === 'MARRIOTT_MOMI' && v === 'minibus' && trip === 'one-way' && !seat && !night;
    const got = total({ dest: r.destValue, vehicle: v, trip, seat, time }).final;
    assert.equal(got, approved ? 175.92 : expected, `${r.destValue} ${v} ${trip} seat=${seat} ${time}`); checked++;
  }
  assert.ok(checked >= 35 * 3 * 2 * 2 * 2 - 1);
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
    pickup: { value: 'NAN' }, destination: { value: over.dest || 'MARRIOTT_MOMI' }, returnDate: { value: '2026-10-19' }, returnTime: { value: '10:00' }, returnPickupLocation: { value: 'Hotel' }, 'extra-seat': { checked: !!over.seat }, 'extra-surf': { checked: false } };
  const sb = { Math, Number, parseInt, JSON, String, document: { getElementById: (id) => fields[id] }, state: { selectedVehicle: over.vehicle || 'minibus', tripType: over.trip || 'one-way', prices: {}, extrasTotal: over.seat ? 8 : 0, passengers: 2, luggage: 2, distanceKm: 40, selectedTour: null, fareOverride: null },
    NADI_API_BASE: 'https://api.test', buildOperationalNotes: () => 'notes', fareText: (n) => String(n), bookingRequest: async (url, o) => { calls.push(JSON.parse(o.body)); return { response: { ok: true, status: 201 }, data: { ok: true, booking_id: 7, booking: { quoted_amount: 175.92, quoted_currency: 'FJD' } } }; }, reportNadiSyncFailure: async () => {} };
  vm.createContext(sb);
  vm.runInContext('var TIER = {}; ' + CODE + `; state.prices = computePrices("NAN", ${JSON.stringify(over.dest || 'MARRIOTT_MOMI')}, 40);` + '\n' + source.slice(source.indexOf('async function submitNadiBooking('), source.indexOf('// Same non-blocking, fire-and-forget escalation pattern')), sb);
  return { sb, calls };
}
test('the booking request names the approved final fare ONLY for the exact journey, and sends exactly 175.92', async () => {
  const a = submitSandbox(); const r = await a.sb.submitNadiBooking('FTT-T1', 'Momi Bay');
  assert.equal(r.ok, true); assert.equal(a.calls[0].quoted_amount, 175.92); assert.equal(a.calls[0].approved_final_fare_id, 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY'); assert.equal(a.calls[0].require_quote_match, true);
  for (const o of [{ trip: 'return' }, { seat: true }, { time: '23:00' }, { vehicle: 'minivan' }, { dest: 'HILTON_DENARAU' }]) {
    const b = submitSandbox(o); await b.sb.submitNadiBooking('FTT-T2', 'Momi Bay');
    assert.equal(b.calls[0].approved_final_fare_id, undefined, JSON.stringify(o));
  }
  const ret = submitSandbox({ trip: 'return' }); await ret.sb.submitNadiBooking('FTT-T3', 'Momi Bay'); assert.equal(ret.calls[0].quoted_amount, 297);
});

// ---- the public Momi route page
test('Momi route page: the minibus one-way is shown as FJ$175.92 FINAL (not a pre-discount base, no further 10%), the return is 330 before / 297 after, and 157.92 appears nowhere (table, FAQ, JSON-LD)', () => {
  assert.ok(!/157\.92/.test(html), 'no 157.92 anywhere on the page');
  const table = html.slice(html.indexOf('<table class="rp-fare-table">'), html.indexOf('</table>'));
  const tr = table.match(/<tr><td>Minibus<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/);
  assert.ok(tr); assert.match(tr[1], /FJ\$175\.92/); assert.match(tr[1], /final fare/i); assert.ok(!/&rarr;/.test(tr[1]), 'no before -> after discount arrow for the final fare');
  assert.match(tr[2], /FJ\$330 &rarr; FJ\$297/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = ld.find((o) => o['@type'] === 'FAQPage').mainEntity.find((q) => /cost/.test(q.name)).acceptedAnswer.text;
  const visible = html.match(/<div class="rp-faq-item"><h3>How much does a Nadi Airport to Fiji Marriott Resort Momi Bay transfer cost\?<\/h3><p>([^<]*)<\/p>/)[1];
  assert.equal(visible, faq); assert.match(faq, /FJ\$175\.92 final fare/); assert.match(faq, /no further discount/i); assert.match(faq, /Minibus return: FJ\$330 before discount \(FJ\$297 after/);
  const spec = ld.find((o) => o['@type'] === 'Service').offers.priceSpecification;
  assert.equal(Number(spec.maxPrice), 175.92); assert.ok(!/157\.92/.test(spec.description)); assert.match(spec.description, /175\.92/);
  for (const text of [visible, faq, spec.description]) for (const sentence of text.split(/\.\s/).filter((x) => x.includes('175.92'))) assert.ok(!/before( the)?( booking)? discount/i.test(sentence), `175.92 is never described as a pre-discount amount: ${sentence}`);
});
test('SCOPE: the released quote-consent, retry, formatting and money-format protections are still in the page', () => {
  for (const c of ['require_quote_match: true', 'Accept revised price and submit', 'keyAtSubmit !== fareOverrideKey()', 'function fareText(n)', 'revised_from_amount']) assert.ok(source.includes(c), c);
});

// RELEASE BLOCKER (price inversion I1, found by the Momi minibus grid): adding a child seat or surfboard LOWERS the approved one-way total (165.92 < 175.92). Visible TODO until James decides the
// extras rule for the approved final fare (see MOMI-DECISION-TABLE.md in the Worker branch). The characterisation above (165.92) is the passing record of today's behaviour.
test('INVARIANT I1: extras never lower the approved daytime one-way total', { todo: 'RELEASE BLOCKER - owner decision pending (extras on the approved final fare)' }, () => {
  const base = total({}).final;
  for (const o of [{ seat: true }, { surf: true }, { seat: true, surf: true }]) assert.ok(total(o).final >= base, JSON.stringify(o));
});
