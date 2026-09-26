const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const js = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function extractFn(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let i = js.indexOf('{', start), depth = 0;
  for (; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}' && --depth === 0) return js.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}
const CONSTS = ['LIVE_FARE_BAND_LOW', 'LIVE_FARE_BAND_HIGH'].map((n) => { const m = js.match(new RegExp('const ' + n + ' = [^;]+;')); assert.ok(m, n); return m[0]; }).join('\n');
const SOURCE = CONSTS + '\n' + ['liveFareDiscounted', 'applyLiveFares', 'applyOrFetchLiveFares'].map(extractFn).join('\n\n');

function makeCtx({ prices, priceSource = 'published', zone = 'Nadi', tripType = 'one-way', refs, tour = false, boat = false, fetchImpl }) {
  const calls = [];
  const ctx = {
    DISCOUNT_THRESHOLD: 50, DISCOUNT_RATE: 0.10,
    LIVE_FARE_FETCH_TIMEOUT_MS: 50,
    BOAT_DESTINATION_IDS: boat ? { BOAT_X: true } : {},
    bookingHasTour: () => tour,
    state: { prices: { ...prices }, priceSource, destZoneName: zone, tripType, liveFares: null, liveFaresPending: null },
    updatePricing: () => { ctx.__updates++; },
    __updates: 0, __calls: calls,
    fetchRealReferenceFare: fetchImpl || (async (pz, dz, vt, tt) => { calls.push({ pz, dz, vt, tt }); return refs ? refs[vt] : null; }),
    setTimeout, Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  return ctx;
}
const settle = () => new Promise((r) => setTimeout(r, 20));

// Real values read from the live server on 2026-09-27 (GET /reference-fare, Nadi Airport -> zone, one-way).
const NADI_REFS = { sedan: 30.15, minivan: 51.42, minibus: 79.46 };

test('Tanoa/Tokatoka-class routes: static FJ$15/25/45 is replaced by the live fare at selection time (same number the review step shows)', async () => {
  const c = makeCtx({ prices: { sedan: 15, minivan: 25, minibus: 45 }, refs: NADI_REFS });
  c.applyOrFetchLiveFares('NAN', 'TANOA_INTERNATIONAL');
  await settle();
  assert.deepEqual(c.__calls.map((x) => x.vt).sort(), ['minibus', 'minivan', 'sedan']);
  assert.ok(c.__calls.every((x) => x.pz === 'Nadi Airport' && x.dz === 'Nadi' && x.tt === 'one-way'));
  assert.equal(c.__updates, 1, 're-renders once after the fetch resolves');
  // updatePricing() is what recomputes static prices; simulate its next pass, which must now apply the cached live fares synchronously
  c.state.prices = { sedan: 15, minivan: 25, minibus: 45 };
  c.applyOrFetchLiveFares('NAN', 'TANOA_INTERNATIONAL');
  assert.deepEqual({ ...c.state.prices }, NADI_REFS);
  assert.equal(c.__calls.length, 3, 'no refetch and therefore no update loop');
});

test('in-band routes are untouched (Hilton Denarau: FJ$49/69 vs live 47.87/69.08)', async () => {
  const c = makeCtx({ prices: { sedan: 49, minivan: 69, minibus: 95 }, zone: 'Denarau', refs: { sedan: 47.87, minivan: 69.08, minibus: 91.02 } });
  c.applyOrFetchLiveFares('NAN', 'HILTON_DENARAU');
  await settle();
  c.state.prices = { sedan: 49, minivan: 69, minibus: 95 };
  c.applyOrFetchLiveFares('NAN', 'HILTON_DENARAU');
  assert.deepEqual({ ...c.state.prices }, { sedan: 49, minivan: 69, minibus: 95 });
});

test('only the classes outside the server band change (Marriott Momi Bay: minibus 79 vs live 175.92, sedan/minivan in band)', async () => {
  const c = makeCtx({ prices: { sedan: 99, minivan: 149, minibus: 79 }, zone: 'Momi Bay', refs: { sedan: 94.29, minivan: 147.42, minibus: 175.92 } });
  c.applyOrFetchLiveFares('NAN', 'MARRIOTT_MOMI');
  await settle();
  c.state.prices = { sedan: 99, minivan: 149, minibus: 79 };
  c.applyOrFetchLiveFares('NAN', 'MARRIOTT_MOMI');
  assert.deepEqual({ ...c.state.prices }, { sedan: 99, minivan: 149, minibus: 175.92 });
});

test('the band mirrors the server rule on discounted amounts (0.8x lower and 1.3x upper edge)', () => {
  const c = makeCtx({ prices: { sedan: 40, minivan: 0, minibus: 0 }, zone: 'Wailoaloa' });
  c.applyLiveFares({ sedan: 30.36 });                      // 40 / 30.36 = 1.317 > 1.3 -> replaced
  assert.equal(c.state.prices.sedan, 30.36);
  c.state.prices.sedan = 39;
  c.applyLiveFares({ sedan: 30.36 });                      // 39 / 30.36 = 1.285 <= 1.3 -> kept
  assert.equal(c.state.prices.sedan, 39);
  c.state.prices.sedan = 24.5;
  c.applyLiveFares({ sedan: 30.15 });                      // 24.5 / 30.15 = 0.813 >= 0.8 -> kept
  assert.equal(c.state.prices.sedan, 24.5);
  c.state.prices.sedan = 24.0;
  c.applyLiveFares({ sedan: 30.15 });                      // 0.796 < 0.8 -> replaced
  assert.equal(c.state.prices.sedan, 30.15);
});

test('never touches: tours, custom addresses, boat destinations, quote-priced routes, non-airport pickups, unresolved zones', async () => {
  const base = { prices: { sedan: 15, minivan: 25, minibus: 45 }, refs: NADI_REFS };
  for (const [label, opts, pickup, dest] of [
    ['tour', { ...base, tour: true }, 'NAN', 'TANOA_INTERNATIONAL'],
    ['custom dest', base, 'NAN', 'CUSTOM_DEST'],
    ['boat', { ...base, boat: true }, 'NAN', 'BOAT_X'],
    ['quote-priced', { ...base, priceSource: 'quote' }, 'NAN', 'TANOA_INTERNATIONAL'],
    ['non-airport pickup', base, 'DENARAU_PORT', 'TANOA_INTERNATIONAL'],
    ['unresolved zone', { ...base, zone: 'NEEDS_LOOKUP' }, 'NAN', 'TANOA_INTERNATIONAL'],
    ['no zone yet', { ...base, zone: null }, 'NAN', 'TANOA_INTERNATIONAL'],
  ]) {
    const c = makeCtx(opts);
    c.applyOrFetchLiveFares(pickup, dest);
    await settle();
    assert.equal(c.__calls.length, 0, `${label}: no fetch`);
    assert.deepEqual({ ...c.state.prices }, { sedan: 15, minivan: 25, minibus: 45 }, label);
  }
});

test('fetch failure or timeout leaves the static prices exactly as they were (fail-safe)', async () => {
  for (const fetchImpl of [async () => null, () => new Promise(() => {}), async () => { throw new Error('offline'); }]) {
    const c = makeCtx({ prices: { sedan: 15, minivan: 25, minibus: 45 }, fetchImpl });
    c.applyOrFetchLiveFares('NAN', 'TANOA_INTERNATIONAL');
    await new Promise((r) => setTimeout(r, 120));
    c.state.prices = { sedan: 15, minivan: 25, minibus: 45 };
    c.applyOrFetchLiveFares('NAN', 'TANOA_INTERNATIONAL');
    assert.deepEqual({ ...c.state.prices }, { sedan: 15, minivan: 25, minibus: 45 });
  }
});

test('a slow response arriving after the guest changed destination or trip type is discarded', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const c = makeCtx({ prices: { sedan: 15, minivan: 25, minibus: 45 }, fetchImpl: async () => { await gate; return 99; } });
  c.applyOrFetchLiveFares('NAN', 'TANOA_INTERNATIONAL');
  c.state.destZoneName = 'Denarau';
  release();
  await settle();
  assert.equal(c.state.liveFares, null);
  assert.equal(c.__updates, 0);
});

test('return trips ask the server for the return fare (trip_type is passed through)', async () => {
  const c = makeCtx({ prices: { sedan: 30, minivan: 45, minibus: 80 }, tripType: 'return', refs: { sedan: 55.8, minivan: 95.1, minibus: 147 } });
  c.applyOrFetchLiveFares('NAN', 'TANOA_INTERNATIONAL');
  await settle();
  assert.ok(c.__calls.every((x) => x.tt === 'return'));
});

test('source wiring: the hook runs inside updatePricing right after the static prices are set, and no fare table or Worker rule changed', () => {
  const up = extractFn('updatePricing');
  assert.match(up, /state\.priceSource = priced\.source;[^\n]*\n\s*applyOrFetchLiveFares\(pickupVal, destVal\);/);
  const { execFileSync } = require('child_process');
  const repoRoot = path.join(__dirname, '..');
  const base = execFileSync('git', ['show', '520ca9d:ftt-booking-site/src/app.js'], { cwd: repoRoot, maxBuffer: 1e8 }).toString('utf8').replace(/\r\n/g, '\n');
  for (const name of ['calculateTotal', 'computePrices', 'applyModifiers', 'renderFareTiers', 'submitMarketplaceBooking', 'fetchRealReferenceFare']) {
    const grab = (src) => { const s = src.indexOf(`function ${name}(`); let i = src.indexOf('{', s), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return src.slice(s, i + 1); } };
    assert.equal(grab(js), grab(base), `${name} must be byte-identical to production 520ca9d`);
  }
});
