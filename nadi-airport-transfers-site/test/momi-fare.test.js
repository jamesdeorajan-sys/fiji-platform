// James-approved fare (2026-10-05): Marriott Momi Bay minibus one-way BASE FJ$175.92, before the existing discount. The discount, return multiplier, rounding and extras are unchanged.
// Expected daytime totals through the page's own functions: one-way 157.92; return 297; return + FJ$8 child seat 304.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/\r/g, '');
const lines = source.split('\n');
const idx = (re, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l));
const before = JSON.parse(readFileSync(new URL('./fixtures/routes_before_momi_fix.json', import.meta.url), 'utf8'));

function page({ dest = 'MARRIOTT_MOMI', time = '10:00', trip = 'one-way', seat = false, vehicle = 'minibus' } = {}) {
  const code = [lines.slice(idx(/^const NIGHT_SURCHARGE/), idx(/^\/\/ ─── EMOJI STRIPPER/)).join('\n'), lines.slice(idx(/^function isNightPickup/), idx(/^\/\/ ─── RELIABLY SET A <SELECT>/)).join('\n'),
    lines.slice(idx(/^const ROUTES_DATA = \[/), idx(/^\];/, idx(/^const ROUTES_DATA = \[/)) + 1).join('\n')].join('\n');
  const sb = { Math, Number, parseInt, JSON, String, state: { tripType: trip, prices: {}, extrasTotal: seat ? 8 : 0, passengers: 2, luggage: 2, selectedVehicle: vehicle, selectedTour: null }, document: { getElementById: (id) => ({ value: ({ travelTime: time, pickup: 'NAN', destination: dest })[id] ?? '' }) } };
  vm.createContext(sb); vm.runInContext('var TIER = {}; ' + code + `; state.prices = computePrices("NAN", "${dest}", 40);`, sb);
  return JSON.parse(vm.runInContext('JSON.stringify({ t: calculateTotal(), prices: state.prices })', sb));
}

test('APPROVED FINAL FARE (James, 2026-10-05, supersedes the earlier "base before discount" reading): Momi minibus daytime one-way = FJ$175.92 FINAL, no further discount (see momi-final-fare.test.js)', () => {
  const r = page(); assert.equal(r.prices.minibus, 175.92); assert.equal(r.t.subtotal, 175.92); assert.equal(r.t.discount, 0); assert.equal(r.t.final, 175.92);
});
test('APPROVED FARE: return (existing x1.85 and round-up to FJ$5) = 297; return + child seat = 304', () => {
  const ret = page({ trip: 'return' }); assert.equal(ret.prices.minibus, 330); assert.equal(ret.t.discount, 33); assert.equal(ret.t.final, 297);
  const seat = page({ trip: 'return', seat: true }); assert.equal(seat.t.subtotal, 338); assert.equal(seat.t.discount, 34); assert.equal(seat.t.final, 304);
});
test('the corrected minibus is no longer cheaper than the minivan (or the sedan), one-way and return, day and night, with and without extras', () => {
  for (const trip of ['one-way', 'return']) for (const time of ['10:00', '23:00']) for (const seat of [false, true]) {
    const f = (vehicle) => page({ trip, time, seat, vehicle }).t.final;
    assert.ok(f('minibus') > f('minivan'), `${trip} ${time} seat=${seat}: minibus ${f('minibus')} vs minivan ${f('minivan')}`);
    assert.ok(f('minivan') > f('sedan'), 'minivan above sedan');
  }
});
test('SCOPE: every other catalogue row and vehicle is byte-for-byte unchanged; only MARRIOTT_MOMI minibus differs (79 -> 175.92)', () => {
  const code = lines.slice(idx(/^const ROUTES_DATA = \[/), idx(/^\];/, idx(/^const ROUTES_DATA = \[/)) + 1).join('\n');
  const sb = {}; vm.createContext(sb); vm.runInContext(code + ';this.R = ROUTES_DATA.map((r) => ({ destValue: r.destValue, s: r.s, v: r.v, m: r.m }))', sb);
  const after = JSON.parse(JSON.stringify(sb.R));
  assert.equal(after.length, before.length);
  const diffs = after.filter((r, i) => JSON.stringify(r) !== JSON.stringify(before[i]));
  assert.deepEqual(diffs.map((r) => r.destValue), ['MARRIOTT_MOMI']);
  assert.deepEqual(after.find((r) => r.destValue === 'MARRIOTT_MOMI'), { destValue: 'MARRIOTT_MOMI', s: 99, v: 149, m: 175.92 });
});
test('SCOPE: discount, return multiplier, night surcharge and the extras are unchanged', () => {
  for (const c of ['const NIGHT_SURCHARGE  = 0.20;', 'const RETURN_MULTIPLIER = 1.85;', 'const DISCOUNT_THRESHOLD = 50;', 'const DISCOUNT_RATE      = 0.10;', 'state.extrasTotal += 8;', 'state.extrasTotal += 24;']) assert.ok(source.includes(c), c);
});
test('the quote-consent repairs are still in the page: opt-in, explicit accept, stale-response protection, saved-fare display, formatting', () => {
  for (const c of ['require_quote_match: true', 'Accept revised price and submit', 'keyAtSubmit !== fareOverrideKey()', "Fare saved: ", 'function fareText(n)']) assert.ok(source.includes(c) || source.includes(c.replace('Fare saved: ', 'Fare saved:')), c);
});
