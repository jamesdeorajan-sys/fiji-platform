// Fiji Dash - hotel-to-airport booking capture (issue #59, preview candidate).
// Runs the real helper functions from src/app.js against the REAL option lists parsed from src/index.html.
// Zero network. Run: node --test ftt-booking-site/departure-capture.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8');

function options(selectId) {
  const block = html.match(new RegExp(`<select id="${selectId}"[\\s\\S]*?</select>`))[0];
  return [...block.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map((m) => {
    const attrs = m[2];
    const get = (k) => (attrs.match(new RegExp(`data-${k}="([^"]*)"`)) || [])[1];
    return { value: m[1], textContent: m[3], dataset: { lat: get('lat'), lng: get('lng'), area: get('area') } };
  });
}
const PICKUPS = options('pickup');
const DESTS = options('destination');

function extractFn(name) {
  const re = new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`);
  const m = app.match(re);
  assert.ok(m, `function ${name} not found`);
  return m[0];
}
function extractConst(name) {
  const m = app.match(new RegExp(`const ${name} = [\\s\\S]*?\\n\\]?\\)?;\\n`));
  assert.ok(m, `const ${name} not found`);
  return m[0];
}

function world({ pickupVal, destVal, dests = DESTS, pickups = PICKUPS }) {
  const els = {
    pickup: { value: pickupVal, options: pickups, selectedOptions: [pickups.find((o) => o.value === pickupVal)] },
    destination: { value: destVal, options: dests, selectedOptions: [dests.find((o) => o.value === destVal)] },
    notes: { value: '' },
  };
  const ctx = vm.createContext({ document: { getElementById: (id) => els[id] || null } });
  const src = [
    extractConst('MARKETPLACE_ZONE_NAMES'),
    'const AREA_ZONE_ALIASES = { \'Port Denarau\': \'Denarau\' };',
    extractFn('resolveFixedDestinationZone'),
    extractFn('isHotelPickupToAirport'),
    extractFn('resolveFixedPickupZone'),
    extractFn('withPickupHotelLine'),
    'this.api = { isHotelPickupToAirport, resolveFixedPickupZone, withPickupHotelLine, MARKETPLACE_ZONE_NAMES };',
  ].join('\n');
  vm.runInContext(src, ctx);
  return { api: ctx.api, els };
}

test('all 45 named hotel pickups resolve to exactly one REAL marketplace zone (nothing left ambiguous, nothing invented)', () => {
  const hotels = PICKUPS.filter((o) => /^P_/.test(o.value));
  assert.equal(hotels.length, 45);
  const { api } = world({ pickupVal: 'P_HILTON', destVal: 'NAN' });
  for (const h of hotels) {
    const zone = api.resolveFixedPickupZone(h);
    assert.ok(zone && api.MARKETPLACE_ZONE_NAMES.has(zone), `${h.value} -> ${zone}`);
  }
  assert.equal(api.resolveFixedPickupZone(PICKUPS.find((o) => o.value === 'P_HILTON')), 'Denarau');
});

test('a hotel pickup is NEVER relabelled as Nadi Airport merely to pass eligibility', () => {
  const { api } = world({ pickupVal: 'P_HILTON', destVal: 'NAN' });
  assert.notEqual(api.resolveFixedPickupZone(PICKUPS.find((o) => o.value === 'P_HILTON')), 'Nadi Airport');
  const fn = extractFn('resolveConfirmedPickupZone');
  assert.match(fn, /isHotelPickupToAirport\([\s\S]*?\) \{\s*return resolveFixedPickupZone\(/, 'hotel branch must return the resolved hotel zone');
  assert.equal((fn.match(/'Nadi Airport'/g) || []).length, 1, "the only 'Nadi Airport' return stays the real NAN pickup");
});

test('eligibility is narrow: hotel -> NAN only; other pickups and other destinations are unchanged (WhatsApp fallback)', () => {
  const { api } = world({ pickupVal: 'P_HILTON', destVal: 'NAN' });
  assert.equal(api.isHotelPickupToAirport('P_HILTON', 'NAN'), true);
  assert.equal(api.isHotelPickupToAirport('P_HILTON', 'HILTON_DENARAU'), false, 'hotel -> hotel stays manual');
  assert.equal(api.isHotelPickupToAirport('P_HILTON', 'CUSTOM_DEST'), false);
  for (const v of ['SUV', 'DENARAU_PORT', 'LAUTOKA_PORT', 'NADI_TOWN', 'SUVA_CBD', 'CUSTOM_PICKUP', 'NAN', '', undefined]) {
    assert.equal(api.isHotelPickupToAirport(v, 'NAN'), false, String(v));
  }
});

test('fails closed: ambiguous, missing or non-marketplace zones return null (journey stays on WhatsApp)', () => {
  const pick = { value: 'P_TEST', textContent: 'Test Hotel', dataset: { lat: '1', lng: '2' } };
  const mk = (dests) => world({ pickupVal: 'P_TEST', destVal: 'NAN', dests: [...dests, { value: 'NAN', textContent: 'Nadi', dataset: { area: 'Nadi Airport' } }], pickups: [pick] });
  assert.equal(mk([]).api.resolveFixedPickupZone(pick), null, 'no identical-coordinate counterpart');
  assert.equal(mk([{ value: 'A', dataset: { lat: '1', lng: '2', area: 'Denarau' } }, { value: 'B', dataset: { lat: '1', lng: '2', area: 'Coral Coast' } }]).api.resolveFixedPickupZone(pick), null, 'two zones disagree');
  assert.equal(mk([{ value: 'A', dataset: { lat: '1', lng: '2', area: 'Atlantis' } }]).api.resolveFixedPickupZone(pick), null, 'unknown area needs lookup, not a guess');
  assert.equal(mk([{ value: 'A', dataset: { lat: '1', lng: '2' } }]).api.resolveFixedPickupZone(pick), null, 'no area');
  assert.equal(mk([{ value: 'A', dataset: { lat: '1.0', lng: '2', area: 'Denarau' } }]).api.resolveFixedPickupZone(pick), null, 'near-miss coordinates do not match');
  assert.equal(mk([{ value: 'A', dataset: { lat: '1', lng: '2', area: 'Denarau' } }]).api.resolveFixedPickupZone(pick), 'Denarau');
  assert.equal(world({ pickupVal: 'SUV', destVal: 'NAN' }).api.resolveFixedPickupZone(PICKUPS.find((o) => o.value === 'SUV')), null, 'non-P_ pickups are out of scope');
});

test('the exact pickup hotel reaches the team in notes, without touching other bookings', () => {
  const w = world({ pickupVal: 'P_HILTON', destVal: 'NAN' });
  assert.equal(w.api.withPickupHotelLine(null), 'Pickup at: Hilton Fiji Beach Resort');
  assert.equal(w.api.withPickupHotelLine('Two surfboards'), 'Pickup at: Hilton Fiji Beach Resort\nTwo surfboards');
  const once = w.api.withPickupHotelLine('x');
  assert.equal(w.api.withPickupHotelLine(once), once, 'idempotent on retry');
  const arriving = world({ pickupVal: 'NAN', destVal: 'HILTON_DENARAU' });
  assert.equal(arriving.api.withPickupHotelLine('guest note'), 'guest note');
  assert.equal(arriving.api.withPickupHotelLine(null), null);
});

test('wiring: confirmBooking eligibility requires a resolved zone; negotiation eligibility is unchanged; booking is not retargeted', () => {
  assert.match(app, /isHotelPickupToAirport\(pickupVal, destValForSync\) && !!resolveConfirmedPickupZone\(\)/);
  assert.match(app, /const isEligibleRoute = pickupVal === 'NAN' \|\| \(pickupVal === 'CUSTOM_PICKUP' && destVal === 'NAN'\);/, 'negotiation stays airport-arrival / custom-pickup only');
  assert.match(app, /pickup_zone: pickupZone,\s*\n\s*destination_zone: destinationZone,/);
  assert.match(app, /notes: withPickupHotelLine\(resolveDurableNotes\(/);
  assert.match(html, /app\.js\?v=20260927-departure-capture/);
});
