const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const js = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const PROD = '520ca9d';

function grabFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}
const grabConst = (n) => { const m = js.match(new RegExp('const ' + n + '\\s*= [^;]+;')); assert.ok(m, n); return m[0]; };

const FAST = (src) => src
  .replace(/const LIVE_FARE_FETCH_TIMEOUT_MS = \d+;/, 'const LIVE_FARE_FETCH_TIMEOUT_MS = 40;')
  .replace(/const LIVE_FARE_RETRY_DELAYS_MS = \[[^\]]*\];/, 'const LIVE_FARE_RETRY_DELAYS_MS = [15, 30];')
  .replace(/const LIVE_FARE_TTL_MS = \d+;/, 'const LIVE_FARE_TTL_MS = 200;');
const SOURCE = FAST([
  ...['LIVE_FARE_FETCH_TIMEOUT_MS', 'LIVE_FARE_TTL_MS', 'LIVE_FARE_MAX_ATTEMPTS', 'LIVE_FARE_RETRY_DELAYS_MS', 'LIVE_FARE_CLASSES', 'DISCOUNT_THRESHOLD', 'DISCOUNT_RATE', 'NEGOTIATION_FLOOR_RATIO'].map(grabConst),
  ...['liveFareEligible', 'applyLiveFares', 'renderLiveFareNote', 'startLiveFareFetch', 'retryLiveFares', 'applyOrFetchLiveFares', 'calculateTotal', 'resolveNegotiationEligibility', 'renderFareTiers'].map((n) => grabFn(js, n)),
].join('\n\n'));

function makeEl(extra = {}) {
  const el = { style: {}, value: '', textContent: '', disabled: false, children: [], parentNode: null, ...extra };
  let text = '';
  delete el.textContent;
  Object.defineProperty(el, 'textContent', { get: () => text, set: (v) => { text = v; el.children.length = 0; } }); // like the DOM: assigning text clears child nodes
  el.setAttribute = () => {};
  el.appendChild = (c) => { el.children.push(c); c.parentNode = el; return c; };
  el.insertBefore = (c) => { el.children.push(c); c.parentNode = el; return c; };
  return el;
}

// A sandbox that runs the REAL selection-time functions and the REAL renderFareTiers/calculateTotal.
function makeCtx({ prices, priceSource = 'published', zone = 'Nadi', tripType = 'one-way', extrasTotal = 0, tour = null, passengers = 2, vehicle = 'sedan', dest = 'X_DEST', pickup = 'NAN', boat = false, fetchImpl }) {
  const calls = [];
  const created = [];
  const registry = {
    pickup: makeEl({ value: pickup }), destination: makeEl({ value: dest }),
    vehicleCards: makeEl({ parentNode: makeEl() }), vehicleDetailCards: makeEl({ parentNode: makeEl() }), priceUpdatedNote: makeEl({ parentNode: makeEl() }),
  };
  const ctx = {
    document: {
      getElementById: (id) => registry[id] || created.find((e) => e.id === id) || (id.startsWith('liveFareNote-') ? null : makeEl()),
      createElement: () => { const e = makeEl(); created.push(e); return e; },
    },
    BOAT_DESTINATION_IDS: boat ? { [dest]: true } : {},
    state: { prices: { ...prices }, priceSource, destZoneName: zone, tripType, extrasTotal, selectedTour: tour, passengers, selectedVehicle: vehicle, liveFares: null, liveFaresPending: null, liveFareAttempts: null, liveFareStatus: null },
    // mirrors production: updatePricing() recomputes the static fares, then its hook re-applies / re-checks the live fares
    updatePricing: () => { ctx.__updates++; ctx.state.prices = { ...prices }; ctx.applyOrFetchLiveFares(pickup, dest); },
    __updates: 0, __calls: calls, __registry: registry,
    stopNegotiationPolling: () => {}, renderPriceBlock: () => {}, formatPrice: (x) => String(x),
    resolveConfirmedPickupZone: () => 'Nadi Airport', resolveConfirmedDestinationZone: () => ctx.state.destZoneName,
    fetchRealReferenceFare: fetchImpl || (async (pz, dz, vt, tt) => { calls.push({ pz, dz, vt, tt }); return ctx.__refs ? ctx.__refs[vt] : null; }),
    setTimeout, Promise, Date, isFinite, Math, Number,
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  return ctx;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => wait(25);

// Live server values read on 2026-09-27 (GET /reference-fare, Nadi Airport -> zone; Nadi zone also read for trip_type=return).
const HILTON = { static: { sedan: 49, minivan: 69, minibus: 99 }, refs: { sedan: 47.87, minivan: 69.08, minibus: 99.84 }, zone: 'Denarau', dest: 'HILTON_DENARAU' };
const TANOA = { static: { sedan: 15, minivan: 25, minibus: 45 }, refs: { sedan: 30.15, minivan: 51.42, minibus: 79.46 }, zone: 'Nadi', dest: 'TANOA_INTERNATIONAL' };
const RETURN_TANOA = { static: { sedan: 30, minivan: 50, minibus: 85 }, refs: { sedan: 55.78, minivan: 95.13, minibus: 147.0 }, zone: 'Nadi', dest: 'TANOA_INTERNATIONAL' };

// Journey: selection (with the next updatePricing pass re-applying cached fares), then the REAL review step. Must show one number.
async function journey(route, opts, vehicle) {
  const c = makeCtx({ prices: route.static, zone: route.zone, dest: route.dest, vehicle, ...opts });
  c.__refs = route.refs;
  c.applyOrFetchLiveFares('NAN', route.dest);
  await settle();
  c.state.prices = { ...route.static };                    // updatePricing() recomputes the static fares...
  c.applyOrFetchLiveFares('NAN', route.dest);              // ...and its hook re-applies the cached live fares synchronously
  const selection = c.calculateTotal(vehicle);
  c.renderFareTiers();                                     // review step: its own fetch, unconditional replacement
  await settle();
  const review = c.calculateTotal(vehicle);
  return { selection, review, c };
}

for (const [label, route, opts] of [
  ['in-band route (Hilton: static 49/69/99 vs live 47.87/69.08/91.02)', HILTON, {}],
  ['out-of-band route (Tanoa: static 15/25/45 vs live 30.15/51.42/79.46)', TANOA, {}],
  ['return trip (server fare requested for return)', RETURN_TANOA, { tripType: 'return' }],
  ['night pickup (22:00-06:00; static fares carry the client night modifier): selection and review still agree', { ...HILTON, static: { sedan: 65, minivan: 90, minibus: 130 } }, {}],
  ['add-ons: child seat FJ$8', TANOA, { extrasTotal: 8 }],
  ['add-ons: child seat + surfboard FJ$32', HILTON, { extrasTotal: 32 }],
  ['with a tour in the booking', HILTON, { tour: { price: 120 }, passengers: 3 }],
]) {
  test(`journey consistency: ${label} - selection total equals review total for every vehicle class`, async () => {
    for (const vehicle of ['sedan', 'minivan', 'minibus']) {
      const { selection, review, c } = await journey(route, opts, vehicle);
      assert.equal(selection.final, review.final, `${vehicle}: selection ${selection.final} vs review ${review.final}`);
      assert.equal(selection.vehiclePrice, route.refs[vehicle], `${vehicle}: the server's live number is what is shown`);
      assert.equal(selection.extras, opts.extrasTotal || 0, 'add-ons are added on top exactly as at review');
      assert.equal(c.state.liveFareStatus, 'confirmed');
    }
  });
}

test('return trips request the RETURN fare from the server', async () => {
  const { c } = await journey(RETURN_TANOA, { tripType: 'return' }, 'sedan');
  assert.ok(c.__calls.length >= 3 && c.__calls.every((x) => x.tt === 'return'));
});

test('temporary failure is retried (bounded, with backoff) and recovers without a reload', async () => {
  let n = 0;
  const c = makeCtx({ prices: TANOA.static, zone: 'Nadi', dest: TANOA.dest, fetchImpl: async (pz, dz, vt) => { n++; return n <= 3 ? null : TANOA.refs[vt]; } });
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  assert.equal(c.state.liveFareStatus, 'confirming', 'never presented as confirmed while unresolved');
  await wait(150);
  assert.equal(c.state.liveFareStatus, 'confirmed');
  c.state.prices = { ...TANOA.static };
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  assert.deepEqual({ ...c.state.prices }, TANOA.refs);
  assert.ok(n <= 9, `at most 3 attempts x 3 classes, saw ${n}`);
});

test('persistent failure: bounded attempts, then an honest unresolved state with a Try again control; static fares stay marked as estimates', async () => {
  let n = 0;
  const c = makeCtx({ prices: TANOA.static, zone: 'Nadi', dest: TANOA.dest, fetchImpl: async () => { n++; return null; } });
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  await wait(250);
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  assert.equal(c.state.liveFareStatus, 'unavailable');
  assert.equal(n, 9, 'exactly 3 attempts x 3 classes, then it stops');
  await wait(100);
  assert.equal(n, 9, 'no unbounded retry loop');
  assert.deepEqual({ ...c.state.prices }, TANOA.static, 'nothing invented: static fares untouched');
  const note = c.__registry.vehicleDetailCards.parentNode.children.find((x) => x.id === 'liveFareNote-vehicleDetailCards');
  assert.match(note.textContent, /estimates/);
  assert.doesNotMatch(note.textContent, /confirmed price|charged|collected|paid/i);
  assert.equal(note.style.display, 'block');
  assert.equal(note.children.length, 1, 'Try again button present');
  // explicit retry starts a fresh, again-bounded round
  c.__refs = TANOA.refs;
  c.fetchRealReferenceFare = async (pz, dz, vt) => TANOA.refs[vt];
  c.retryLiveFares();
  await settle();
  assert.equal(c.state.liveFareStatus, 'confirmed');
});

test('partial result: answered classes are shown, the rest stay estimates and are retried until complete', async () => {
  let round = 0;
  const c = makeCtx({ prices: TANOA.static, zone: 'Nadi', dest: TANOA.dest, fetchImpl: async (pz, dz, vt) => { if (vt === 'sedan') round++; return (vt === 'sedan' || round >= 2) ? TANOA.refs[vt] : null; } });
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  await wait(6);                                           // first round answered (sedan only); the retry backoff has not fired yet
  c.state.prices = { ...TANOA.static };
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  assert.equal(c.state.prices.sedan, 30.15);
  assert.equal(c.state.prices.minivan, 25, 'unanswered class not presented as live');
  assert.equal(c.state.liveFareStatus, 'confirming');
  await wait(120);
  c.state.prices = { ...TANOA.static };
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  assert.deepEqual({ ...c.state.prices }, TANOA.refs);
  assert.equal(c.state.liveFareStatus, 'confirmed');
});

test('guest advancing before the lookup resolves: nothing blocks, static fares are labelled as estimates, and the late answer lands consistently', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const c = makeCtx({ prices: TANOA.static, zone: 'Nadi', dest: TANOA.dest, fetchImpl: async (pz, dz, vt) => { await gate; return TANOA.refs[vt]; } });
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  assert.equal(c.state.liveFareStatus, 'confirming');
  assert.match(c.__registry.vehicleCards.parentNode.children.find((x) => x.id === 'liveFareNote-vehicleCards').textContent, /estimates/);
  c.state.selectedVehicle = 'sedan';                       // guest picks a vehicle and continues to review meanwhile
  const early = c.calculateTotal('sedan').final;            // static, unverified
  assert.equal(early, 15);
  c.renderFareTiers();                                      // review step entered before the selection lookup resolved
  release();
  await settle();
  assert.equal(c.calculateTotal('sedan').vehiclePrice, 30.15, 'review confirmed the live fare');
  assert.equal(c.state.liveFareStatus, 'confirmed');
  c.state.prices = { ...TANOA.static };
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  assert.equal(c.calculateTotal('sedan').final, 30.15);
});

test('a slow answer for a previous destination or trip type is discarded', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const c = makeCtx({ prices: TANOA.static, zone: 'Nadi', dest: TANOA.dest, fetchImpl: async () => { await gate; return 99; } });
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  c.state.destZoneName = 'Denarau';
  release();
  await settle();
  assert.equal(c.state.liveFares, null);
  assert.equal(c.__updates, 0);
});

test('a verified answer is revalidated after its TTL while the last verified fares stay displayed', async () => {
  const c = makeCtx({ prices: TANOA.static, zone: 'Nadi', dest: TANOA.dest });
  c.__refs = TANOA.refs;
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  await settle();
  const first = c.__calls.length;
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  assert.equal(c.__calls.length, first, 'fresh answer reused, no refetch');
  await wait(230);
  c.__refs = { sedan: 31.0, minivan: 52.0, minibus: 80.0 };
  c.state.prices = { ...TANOA.static };
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  assert.equal(c.state.prices.sedan, 30.15, 'stale-but-verified fare still shown while revalidating');
  await settle();
  c.state.prices = { ...TANOA.static };
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  assert.equal(c.state.prices.sedan, 31.0, 'revalidated');
});

test('never applies to custom addresses, boats, non-airport pickups, quote-priced or unresolved-zone routes', async () => {
  for (const [label, opts, pickup, dest] of [
    ['custom dest', {}, 'NAN', 'CUSTOM_DEST'], ['boat', { boat: true, dest: 'BOAT_X' }, 'NAN', 'BOAT_X'], ['non-airport pickup', {}, 'DENARAU_PORT', 'X_DEST'],
    ['quote-priced', { priceSource: 'quote' }, 'NAN', 'X_DEST'], ['unresolved zone', { zone: 'NEEDS_LOOKUP' }, 'NAN', 'X_DEST'], ['no zone yet', { zone: null }, 'NAN', 'X_DEST'],
  ]) {
    const c = makeCtx({ prices: TANOA.static, ...opts });
    c.__refs = TANOA.refs;
    c.applyOrFetchLiveFares(pickup, dest);
    await settle();
    assert.equal(c.__calls.length, 0, `${label}: no fetch`);
    assert.deepEqual({ ...c.state.prices }, TANOA.static, label);
    assert.equal(c.state.liveFareStatus, 'n/a', label);
  }
});

test('wording never describes a quoted or stored amount as money charged or collected', () => {
  const note = grabFn(js, 'renderLiveFareNote');
  assert.doesNotMatch(note, /charged|collected|paid|payment/i);
});

test('source wiring and scope: hook in updatePricing; fare functions byte-identical to production; renderFareTiers differs only by the three inserted status lines', () => {
  assert.match(grabFn(js, 'updatePricing'), /state\.priceSource = priced\.source;[^\n]*\n\s*applyOrFetchLiveFares\(pickupVal, destVal\);/);
  const base = execFileSync('git', ['show', `${PROD}:ftt-booking-site/src/app.js`], { cwd: path.join(__dirname, '..'), maxBuffer: 1e8 }).toString('utf8').replace(/\r\n/g, '\n');
  for (const name of ['calculateTotal', 'computePrices', 'applyModifiers', 'submitMarketplaceBooking', 'fetchRealReferenceFare', 'bookingRequest', 'reportBookingSyncFailure']) {
    assert.equal(grabFn(js, name), grabFn(base, name), `${name} must be byte-identical to production ${PROD}`);
  }
  const stripped = grabFn(js, 'renderFareTiers').split('\n').filter((l) => !/renderLiveFareNote\(\)/.test(l)).join('\n');
  assert.equal(stripped, grabFn(base, 'renderFareTiers'), 'renderFareTiers: only the status-note lines may differ');
});

test('attempt budget is restored by a verified answer: a later revalidation failure gets a full bounded round again', async () => {
  let mode = 'fail-once';
  let calls = 0;
  const c = makeCtx({ prices: TANOA.static, zone: 'Nadi', dest: TANOA.dest, fetchImpl: async (pz, dz, vt) => { calls++; if (mode === 'fail-once' && calls <= 3) return null; return mode === 'down' ? null : TANOA.refs[vt]; } });
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  await wait(120);
  assert.equal(c.state.liveFareStatus, 'confirmed');
  mode = 'down';
  calls = 0;
  await wait(230);                                          // past the TTL
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  await wait(300);
  assert.equal(calls, 9, 'a full budget of 3 attempts x 3 classes was available again');
  assert.equal(c.state.liveFareStatus, 'stale', 'budget exhausted on an expired answer: last-known fares stay shown but are marked uncertain');
});

test('expired fares whose refresh budget is exhausted expose uncertainty and Try again, and keep the last-known amounts', async () => {
  let mode = 'up';
  const c = makeCtx({ prices: TANOA.static, zone: 'Nadi', dest: TANOA.dest, fetchImpl: async (pz, dz, vt) => (mode === 'up' ? TANOA.refs[vt] : null) });
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  await settle();
  assert.equal(c.state.liveFareStatus, 'confirmed');
  mode = 'down';
  await wait(230);                                          // answer expires (TTL)
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  await wait(300);                                          // refresh budget (3 attempts) used up
  c.state.prices = { ...TANOA.static };
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  assert.equal(c.state.liveFareStatus, 'stale');
  assert.deepEqual({ ...c.state.prices }, TANOA.refs, 'the last-known amounts are retained, not reverted to the static estimate');
  const note = c.__registry.vehicleDetailCards.parentNode.children.find((x) => x.id === 'liveFareNote-vehicleDetailCards');
  assert.match(note.textContent, /couldn't refresh the live price/);
  assert.match(note.textContent, /last amounts we confirmed and may have changed/);
  assert.doesNotMatch(note.textContent, /charged|collected|paid|payment/i);
  assert.equal(note.style.display, 'block');
  assert.equal(note.children.length, 1, 'Try again present');
  // Try again keeps the last-known amounts on screen while it retries, and recovers when the server answers
  c.retryLiveFares();                                       // server still down: the retry must not throw the last-known amounts away
  c.state.prices = { ...TANOA.static };                     // the next updatePricing() pass recomputes the static fares...
  c.applyOrFetchLiveFares('NAN', TANOA.dest);               // ...and must re-apply the retained last-known amounts, not revert to estimates
  assert.deepEqual({ ...c.state.prices }, TANOA.refs, 'amounts retained during the retry');
  mode = 'up';
  await wait(60);
  assert.equal(c.state.liveFareStatus, 'confirmed');
});

test('a review-step lookup failure does not overwrite an already-marked stale state', async () => {
  const c = makeCtx({ prices: TANOA.static, zone: 'Nadi', dest: TANOA.dest });
  c.state.liveFareStatus = 'stale';
  const fn = grabFn(js, 'renderFareTiers');
  assert.match(fn, /liveFareStatus !== 'confirmed' && state\.liveFareStatus !== 'stale'/);
});

test('review caption says "Not submitted yet" before submission; "saved online" wording only exists on the post-save success card', () => {
  const html = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8');
  assert.match(html, /<div class="price-total-sub">Not submitted yet · Fiji team confirms pickup<\/div>/);
  assert.doesNotMatch(html, /price-total-sub">Saved online/);
  assert.match(html, /id="bulaWaReassurance">Your request is already saved online/);
});

test('revalidating an EXPIRED answer also backs off between attempts (no burst of immediate retries)', async () => {
  let mode = 'up';
  const c = makeCtx({ prices: TANOA.static, zone: 'Nadi', dest: TANOA.dest, fetchImpl: async (pz, dz, vt) => { c.__calls.push({ vt }); return mode === 'up' ? TANOA.refs[vt] : null; } });
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  await settle();
  mode = 'down';
  await wait(230);                                          // expire
  c.__calls.length = 0;
  c.applyOrFetchLiveFares('NAN', TANOA.dest);
  await wait(6);                                            // less than the first backoff (15 ms in this harness)
  assert.equal(c.__calls.length, 3, 'exactly one attempt so far');
  await wait(20);
  assert.equal(c.__calls.length, 6, 'second attempt only after the backoff');
  await wait(60);
  assert.equal(c.__calls.length, 9, 'third and last attempt');
  assert.equal(c.state.liveFareStatus, 'stale');
});
