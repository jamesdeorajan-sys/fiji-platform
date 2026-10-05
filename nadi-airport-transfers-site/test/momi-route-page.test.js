// The Momi Bay route page must advertise exactly what the booking calculator charges (James-approved minibus base FJ$175.92). Fare rules are NOT changed here:
// the page figures are derived from the calculator in app.js and compared. Before discount = calculateTotal().subtotal; after discount = calculateTotal().final.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/\r/g, '').split('\n');
const html = readFileSync(new URL('../src/transfer/fiji-marriott-resort-momi-bay.html', import.meta.url), 'utf8').replace(/\r/g, '');
const idx = (re, from = 0) => app.findIndex((l, i) => i >= from && re.test(l));
const code = [app.slice(idx(/^const NIGHT_SURCHARGE/), idx(/^\/\/ ─── EMOJI STRIPPER/)).join('\n'), app.slice(idx(/^function isNightPickup/), idx(/^\/\/ ─── RELIABLY SET A <SELECT>/)).join('\n'), app.slice(idx(/^const ROUTES_DATA = \[/), idx(/^\];/, idx(/^const ROUTES_DATA = \[/)) + 1).join('\n')].join('\n');
function calc(vehicle, trip) {
  const sb = { Math, Number, parseInt, JSON, String, state: { tripType: trip, prices: {}, extrasTotal: 0, passengers: 2, luggage: 2, selectedVehicle: vehicle, selectedTour: null }, document: { getElementById: (id) => ({ value: ({ travelTime: '10:00', pickup: 'NAN', destination: 'MARRIOTT_MOMI' })[id] ?? '' }) } };
  vm.createContext(sb); vm.runInContext('var TIER = {}; ' + code + '; state.prices = computePrices("NAN","MARRIOTT_MOMI",40);', sb);
  return JSON.parse(vm.runInContext('JSON.stringify(calculateTotal())', sb));
}
const money = (n) => `FJ$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const rows = {}; for (const [label, v] of [['Sedan', 'sedan'], ['Minivan', 'minivan'], ['Minibus', 'minibus']]) rows[label] = { oneWay: calc(v, 'one-way'), ret: calc(v, 'return') };

test('the fare table shows, for every vehicle, the calculator\'s before-discount and after-discount figures (one-way and return) - nothing else', () => {
  const table = html.slice(html.indexOf('<table class="rp-fare-table">'), html.indexOf('</table>'));
  for (const [label, r] of Object.entries(rows)) {
    const tr = table.match(new RegExp(`<tr><td>${label}</td><td>([^<]*)</td><td>([^<]*)</td></tr>`));
    assert.ok(tr, label);
    // the minibus one-way is James's approved FINAL fare (2026-10-05): shown once, as final, never as a before -> after discount pair
    assert.equal(tr[1], r.oneWay.approvedFinalFare ? `${money(r.oneWay.final)} final fare (no further discount)` : `${money(r.oneWay.subtotal)} &rarr; ${money(r.oneWay.final)}`, `${label} one-way`);
    assert.equal(tr[2], `${money(r.ret.subtotal)} &rarr; ${money(r.ret.final)}`, `${label} return`);
  }
});
test('Momi minibus is exactly the approved figures: 175.92 FINAL one-way (no further discount), 330 -> 297 return; and it is no longer below the minivan or sedan', () => {
  assert.deepEqual([rows.Minibus.oneWay.subtotal, rows.Minibus.oneWay.final, rows.Minibus.ret.subtotal, rows.Minibus.ret.final], [175.92, 175.92, 330, 297]);
  assert.equal(rows.Minibus.oneWay.discount, 0);
  for (const k of ['oneWay', 'ret']) { assert.ok(rows.Minibus[k].final > rows.Minivan[k].final); assert.ok(rows.Minivan[k].final > rows.Sedan[k].final); }
});
test('sedan and minivan return figures are reconciled to the calculator (185/166 and 280/252) - their fare rules are untouched', () => {
  assert.deepEqual([rows.Sedan.oneWay.subtotal, rows.Sedan.oneWay.final, rows.Sedan.ret.subtotal, rows.Sedan.ret.final], [99, 89, 185, 166]);
  assert.deepEqual([rows.Minivan.oneWay.subtotal, rows.Minivan.oneWay.final, rows.Minivan.ret.subtotal, rows.Minivan.ret.final], [149, 134, 280, 252]);
  for (const stale of ['FJ$276', 'FJ$146', 'FJ$79']) assert.equal(html.includes(stale), false, `no stale figure ${stale}`);
  assert.equal(/FJ\$183(?!\.92)/.test(html), false, 'no stale FJ$183 (FJ$183.92 is the approved child-seat total)');
});
test('the visible FAQ and the FAQPage JSON-LD give the same answer, with every figure from the calculator and extras stated as additional', () => {
  const visible = html.match(/<div class="rp-faq-item"><h3>How much does a Nadi Airport to Fiji Marriott Resort Momi Bay transfer cost\?<\/h3><p>([^<]*)<\/p>/)[1];
  const ld = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = ld.find((o) => o['@type'] === 'FAQPage').mainEntity.find((q) => /cost/.test(q.name)).acceptedAnswer.text;
  assert.equal(visible, faq);
  for (const r of [rows.Sedan, rows.Minivan, rows.Minibus]) for (const n of [r.oneWay.subtotal, r.oneWay.final, r.ret.subtotal, r.ret.final]) assert.ok(visible.includes(money(n)), money(n));
  assert.match(visible, /Extras are additional: child seat FJ\$8 and surfboard FJ\$24/); assert.match(visible, /daytime pickups/);
});
test('JSON-LD price range spans every displayed one-way vehicle price (before discount) and states the after-discount figures; all JSON-LD blocks parse', () => {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const spec = ld.find((o) => o['@type'] === 'Service').offers.priceSpecification;
  const oneWayBefore = Object.values(rows).map((r) => r.oneWay.subtotal);
  assert.equal(Number(spec.minPrice), Math.min(...oneWayBefore)); assert.equal(Number(spec.maxPrice), Math.max(...oneWayBefore));
  assert.ok(Number(spec.maxPrice) >= Number(spec.minPrice) && Number(spec.maxPrice) === 175.92);
  for (const n of [89, 134, 99, 149, 175.92]) assert.ok(spec.description.includes(money(n)), money(n));
  assert.ok(!spec.description.includes('157.92'));
  assert.match(spec.description, /before the booking discount/); assert.match(spec.description, /175\.92 as a final fare/);
});
test('the visible short answer and the table note distinguish before and after discount, and say extras are additional', () => {
  assert.match(html, /FJ\$99<\/strong> one-way before the booking discount \(<strong>FJ\$89<\/strong> after the existing 10% discount\) and <strong>FJ\$185<\/strong> return \(<strong>FJ\$166<\/strong> after\)/);
  assert.match(html, /the first figure is the fare before discount and the second is what the booking tool quotes after the existing 10% discount/);
  assert.match(html, /The minibus one-way FJ\$175\.92 is a final fare: the standard discount is already included and no further discount is taken/);
  assert.match(html, /Extras on the minibus one-way are added at their listed price with no further discount \(FJ\$183\.92 with a child seat, FJ\$199\.92 with a surfboard, FJ\$207\.92 with both\)/);
  assert.match(html, /For the other fares, extras are additional \(child seat FJ\$8, surfboard FJ\$24 per booking\)/);
});
test('SCOPE: only this route page and its test changed; the deployed booking repairs are intact in app.js', () => {
  for (const c of ['require_quote_match: true', 'Accept revised price and submit', 'keyAtSubmit !== fareOverrideKey()', 'function fareText(n)', 'm:175.92']) assert.ok(app.join('\n').includes(c), c);
});
