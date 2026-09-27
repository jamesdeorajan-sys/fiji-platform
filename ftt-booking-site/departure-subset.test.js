// Fiji Dash - interim consistency gate for departure capture (issue #59, preview candidate; NOT a fare decision).
// Run: node --test ftt-booking-site/departure-subset.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8');
const pickupBlock = html.match(/<select id="pickup"[\s\S]*?<\/select>/)[0];
const hotels = [...pickupBlock.matchAll(/<option value="(P_[A-Z_]+)"/g)].map((m) => m[1]);

const setSrc = app.match(/const DEPARTURE_ONLINE_HOTELS = new Set\(\[[\s\S]*?\]\);/)[0];
const allowed = [...setSrc.matchAll(/'(P_[A-Z_]+)'/g)].map((m) => m[1]);

// The 16 hotels whose displayed fare the real deployed Worker would REPLACE (checked offline, snapshot 2026-09-27).
const EXCLUDED = ['P_HEXAGON', 'P_SMUGGLERS', 'P_TANOA_INTL', 'P_TOKATOKA', 'P_RAFFLES_GATEWAY', 'P_FIJI_GATEWAY', 'P_MERCURE', 'P_TRADEWINDS', 'P_DOUBLETREE', 'P_FIRST_LANDING',
  'P_GRAND_PACIFIC', 'P_HOLIDAY_INN_SUVA', 'P_NOVOTEL_LAMI', 'P_TANOA_PLAZA_SUVA', 'P_VOLIVOLI', 'P_WANANAVU'];

test('the allow-list is exactly the 29 verified hotels and every entry is a real pickup option', () => {
  assert.equal(allowed.length, 29);
  assert.equal(new Set(allowed).size, 29);
  for (const a of allowed) assert.ok(hotels.includes(a), a);
  assert.equal(hotels.length, 45);
  assert.deepEqual([...allowed, ...EXCLUDED].sort(), [...hotels].sort(), 'allowed + excluded partition all 45 hotels');
});

function gate({ pickupVal, tripType = 'one-way', tour = false }) {
  const opt = { value: pickupVal, dataset: { lat: '1', lng: '2' } };
  const els = {
    pickup: { value: pickupVal, selectedOptions: [opt] },
    destination: { value: 'NAN', options: [{ value: 'X', dataset: { lat: '1', lng: '2', area: 'Denarau' } }] },
  };
  const ctx = vm.createContext({ document: { getElementById: (id) => els[id] || null }, state: { tripType }, bookingHasTour: () => tour });
  const fn = (n) => app.match(new RegExp(`(?:async )?function ${n}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`))[0];
  vm.runInContext([setSrc, "const MARKETPLACE_ZONE_NAMES = new Set(['Denarau']);", "const AREA_ZONE_ALIASES = {};", fn('resolveFixedDestinationZone'), fn('isHotelPickupToAirport'), fn('resolveFixedPickupZone'), fn('resolveConfirmedPickupZone'), 'this.r = resolveConfirmedPickupZone();'].join('\n'), ctx);
  return ctx.r;
}

test('gate: a verified hotel saves online (real zone); every excluded hotel, return trip and tour fails closed to WhatsApp', () => {
  assert.equal(gate({ pickupVal: 'P_HILTON' }), 'Denarau');
  assert.equal(gate({ pickupVal: 'P_TANOA_INTL' }), null, 'displayed FJ$10 would be recorded as FJ$30.15');
  assert.equal(gate({ pickupVal: 'P_GRAND_PACIFIC' }), null, 'minibus would be recorded FJ$445.75 vs shown FJ$351');
  for (const h of EXCLUDED) assert.equal(gate({ pickupVal: h }), null, h);
  assert.equal(gate({ pickupVal: 'P_HILTON', tripType: 'return' }), null, 'return departures were not verified');
  assert.equal(gate({ pickupVal: 'P_HILTON', tour: true }), null);
});

test('no fare is changed by the gate, and the cache key is bumped', () => {
  assert.doesNotMatch(app.slice(app.indexOf('const DEPARTURE_ONLINE_HOTELS'), app.indexOf('function resolveFixedPickupZone')), /calcPrice|computePrices|applyModifiers|quoted_amount/);
  assert.match(html, /app\.js\?v=20260927-departure-subset/);
});
