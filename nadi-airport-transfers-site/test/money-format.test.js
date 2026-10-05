// #238: totals are shown with at most two decimals. Display only - calculateTotal() and every fare are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8').replace(/\r/g, '');
const start = source.indexOf('function fareText(n)'); const sb = {}; vm.createContext(sb);
vm.runInContext(source.slice(start, source.indexOf('function calculateTotal(vehicleKey)')), sb);
test('fareText: artefacts removed, whole dollars whole, cents two decimals', () => {
  for (const [n, t] of [[127.96000000000001, '127.96'], [141.96 - Math.round(14.196), '127.96'], [245.73000000000002, '245.73'], [142, '142'], [300.4, '300.40'], [49, '49']]) assert.equal(vm.runInContext(`fareText(${n})`, sb), t);
});
test('the review and the WhatsApp text print computed totals through fareText (no raw interpolation of t.final / t.subtotal / t.discount)', () => {
  assert.equal(/FJ\$\$\{t\.(final|subtotal|discount|transferSubtotal|tourTotal)\}/.test(source), false);
  assert.ok(source.includes('FJ$${fareText(t.final)}'));
});
test('scope: calculateTotal itself (the fare maths) is untouched', () => {
  const body = source.slice(source.indexOf('function calculateTotal(vehicleKey)'), source.indexOf('function calculateTotal(vehicleKey)') + 3500);
  assert.ok(body.includes('const final        = subtotal - discount;'));
});
