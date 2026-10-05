// James-approved fare (2026-10-05): Marriott Momi Bay minibus one-way BASE FJ$175.92, before the existing discount. FijiDash still published 79 (below the
// 99 sedan and 149 minivan). Only that one catalogue figure changes; discount, return multiplier, rounding, night modifier and extras are untouched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const PROD = '8c6f920';
const js = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const prod = execFileSync('git', ['show', `${PROD}:ftt-booking-site/src/app.js`], { cwd: path.join(__dirname, '..'), maxBuffer: 1e8 }).toString('utf8').replace(/\r\n/g, '\n');
const between = (s, a, b) => { const i = s.indexOf(a); const j = s.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, a); return s.slice(i, j); };
const routes = (s) => { const i = s.indexOf('const ROUTES_DATA = ['); const code = s.slice(i, s.indexOf('\n];', i) + 3); const sb = {}; vm.createContext(sb); vm.runInContext(code + ';this.R = ROUTES_DATA.map((r) => ({ destValue: r.destValue, s: r.s, v: r.v, m: r.m, km: r.km, area: r.area }))', sb); return JSON.parse(JSON.stringify(sb.R)); };

function page({ trip = 'one-way', time = '10:00', seat = false, vehicle = 'minibus' } = {}) {
  const code = 'var TIER = {};\n' + between(js, 'const NIGHT_SURCHARGE', '// ─── EMOJI STRIPPER') + '\n' + between(js, 'function isNightPickup', '// ─── RELIABLY SET A <SELECT>') + '\n' + js.slice(js.indexOf('const ROUTES_DATA = ['), js.indexOf('\n];', js.indexOf('const ROUTES_DATA = [')) + 3);
  const sb = { Math, Number, parseInt, JSON, String, state: { tripType: trip, prices: {}, extrasTotal: seat ? 8 : 0, passengers: 2, luggage: 2, selectedVehicle: vehicle, selectedTour: null, fareOverride: null },
    document: { getElementById: (id) => ({ value: ({ travelTime: time, pickup: 'NAN', destination: 'MARRIOTT_MOMI' })[id] ?? '' }) } };
  vm.createContext(sb); vm.runInContext(code + '; state.prices = computePrices("NAN", "MARRIOTT_MOMI", 42);', sb);
  return JSON.parse(vm.runInContext('JSON.stringify({ t: calculateTotal(), prices: state.prices })', sb));
}

test('APPROVED FARE: Momi minibus one-way = FJ$175.92 base -> 157.92 after the existing discount', () => {
  const r = page(); assert.equal(r.prices.minibus, 175.92); assert.equal(r.t.subtotal, 175.92); assert.equal(r.t.discount, 18); assert.equal(r.t.final, 157.92);
});
test('APPROVED FARE: return (existing x1.85 and round-up to FJ$5) = 297; return + child seat = 304', () => {
  const ret = page({ trip: 'return' }); assert.equal(ret.prices.minibus, 330); assert.equal(ret.t.final, 297);
  assert.equal(page({ trip: 'return', seat: true }).t.final, 304);
});
test('the corrected minibus is no longer cheaper than the minivan or the sedan, one-way and return, day and night, with and without a child seat', () => {
  for (const trip of ['one-way', 'return']) for (const time of ['10:00', '23:00']) for (const seat of [false, true]) {
    const f = (vehicle) => page({ trip, time, seat, vehicle }).t.final;
    assert.ok(f('minibus') > f('minivan') && f('minivan') > f('sedan'), `${trip} ${time} seat=${seat}`);
  }
});
test('SCOPE: every other catalogue row and vehicle is unchanged from production; only MARRIOTT_MOMI minibus differs (79 -> 175.92)', () => {
  const before = routes(prod), after = routes(js);
  assert.equal(after.length, before.length);
  const diffs = after.filter((r, i) => JSON.stringify(r) !== JSON.stringify(before[i]));
  assert.deepEqual(diffs.map((r) => r.destValue), ['MARRIOTT_MOMI']);
  assert.deepEqual(before.find((r) => r.destValue === 'MARRIOTT_MOMI').m, 79);
  assert.deepEqual(after.find((r) => r.destValue === 'MARRIOTT_MOMI'), { destValue: 'MARRIOTT_MOMI', s: 99, v: 149, m: 175.92, km: 42, area: 'Momi Bay' });
});
test('SCOPE: discount, return multiplier, night surcharge and the extras are unchanged', () => {
  for (const c of ['const NIGHT_SURCHARGE  = 0.20;', 'const RETURN_MULTIPLIER = 1.85;', 'const DISCOUNT_THRESHOLD = 50;', 'const DISCOUNT_RATE      = 0.10;', 'state.extrasTotal += 8;', 'state.extrasTotal += 24;']) assert.ok(js.includes(c), c);
});

test('the Momi route page advertises exactly the approved figures (minibus 175.92 one-way / 330 return, before discount), in the table, the FAQ and the JSON-LD, with no stale FJ$79 / FJ$150', () => {
  const html = fs.readFileSync(path.join(__dirname, 'src', 'transfer', 'fiji-marriott-resort-momi-bay.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(html, /<td><strong>FJ\$175\.92<\/strong><\/td>\s*<td>FJ\$330<\/td>/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = ld.find((o) => o['@type'] === 'FAQPage').mainEntity[0].acceptedAnswer.text;
  assert.match(faq, /FJ\$175\.92 minibus/); assert.match(faq, /FJ\$330 minibus/); assert.match(faq, /before the booking discount/); assert.match(faq, /child seat FJ\$8 and surfboard FJ\$24/);
  for (const stale of ['FJ$79 minibus', 'FJ$150 minibus', '<strong>FJ$79</strong>', '<td>FJ$150</td>']) assert.equal(html.includes(stale), false, stale);
  const sb = {}; const rows = routes(js).find((r) => r.destValue === 'MARRIOTT_MOMI');
  assert.equal(rows.m, 175.92);
});
