// Local integration test: selection vs review vs the amount the REAL deployed Worker would save.
// - Client side: the real FijiDash functions (applyOrFetchLiveFares / renderFareTiers / calculateTotal) run in a sandbox.
// - Server side: the real deployed Worker (test-fixtures/worker-deployed-7a32a034.mjs) handles GET /reference-fare and POST /bookings
//   against an in-memory D1 seeded from a read-only snapshot of the real zones, pricing rules and distances (test-fixtures/).
// No network, no live booking. This is a CHARACTERIZATION of current behaviour: it does not decide any fare or fix any rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadWorker, makeEnv, saveThroughWorker, snap } = require('./test-fixtures/worker-harness.js');

const js = fs.readFileSync(path.join(__dirname, 'src', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function grabFn(name) {
  const start = js.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let i = js.indexOf('{', start), depth = 0;
  for (; i < js.length; i++) { if (js[i] === '{') depth++; else if (js[i] === '}' && --depth === 0) return js.slice(start, i + 1); }
  throw new Error('unbalanced ' + name);
}
const grabConst = (n) => { const m = js.match(new RegExp('const ' + n + '\\s*= [^;]+;')); assert.ok(m, n); return m[0]; };
const SOURCE = [
  ...['LIVE_FARE_FETCH_TIMEOUT_MS', 'LIVE_FARE_TTL_MS', 'LIVE_FARE_MAX_ATTEMPTS', 'LIVE_FARE_RETRY_DELAYS_MS', 'LIVE_FARE_CLASSES', 'DISCOUNT_THRESHOLD', 'DISCOUNT_RATE', 'NEGOTIATION_FLOOR_RATIO'].map(grabConst),
  ...['liveFareEligible', 'applyLiveFares', 'renderLiveFareNote', 'startLiveFareFetch', 'retryLiveFares', 'applyOrFetchLiveFares', 'calculateTotal', 'calculateTotalFromPublishedPrices', 'fareOverrideKey', 'fareText', 'resolveNegotiationEligibility', 'renderFareTiers'].map(grabFn),
].join('\n\n');

const stubEl = () => { const e = { style: {}, value: '', textContent: '', disabled: false, parentNode: null }; e.setAttribute = () => {}; e.appendChild = () => {}; e.insertBefore = () => {}; return e; };

// Real Worker GET /reference-fare, used by the client code exactly as the browser would.
async function workerReferenceFare(zone, vehicle, tripType) {
  const worker = (await loadWorker()).default;
  const { env } = makeEnv();
  const url = `https://api.nadiairporttransfers.com/reference-fare?pickup_zone=${encodeURIComponent('Nadi Airport')}&destination_zone=${encodeURIComponent(zone)}&vehicle_type=${vehicle}&trip_type=${tripType}`;
  const res = await worker.fetch(new Request(url, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env, { waitUntil() {} });
  const j = await res.json();
  assert.equal(j.ok, true, `reference-fare ${zone} ${vehicle} ${tripType}: ${JSON.stringify(j)}`);
  return j.reference_fare_fjd;
}

async function clientAmounts({ zone, vehicle, tripType, extrasTotal }) {
  const refsByClass = {};
  for (const v of ['sedan', 'minivan', 'minibus']) refsByClass[v] = await workerReferenceFare(zone, v, tripType);
  const ctx = {
    document: { getElementById: (id) => (id === 'pickup' ? { value: 'NAN' } : id === 'destination' ? { value: 'X_DEST' } : stubEl()), createElement: stubEl },
    BOAT_DESTINATION_IDS: {},
    state: { prices: { sedan: 1, minivan: 1, minibus: 1 }, priceSource: 'published', destZoneName: zone, tripType, extrasTotal, selectedTour: null, passengers: 2, selectedVehicle: vehicle, liveFares: null, liveFaresPending: null, liveFareAttempts: null, liveFareStatus: null },
    updatePricing: () => {}, stopNegotiationPolling: () => {}, renderPriceBlock: () => {}, formatPrice: String,
    resolveConfirmedPickupZone: () => 'Nadi Airport', resolveConfirmedDestinationZone: () => zone,
    fetchRealReferenceFare: async (pz, dz, vt, tt) => refsByClass[vt],
    setTimeout, Promise, Date, isFinite, Math, Number,
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  ctx.applyOrFetchLiveFares('NAN', 'X_DEST');
  await new Promise((r) => setTimeout(r, 5));
  ctx.state.prices = { sedan: 1, minivan: 1, minibus: 1 };
  ctx.applyOrFetchLiveFares('NAN', 'X_DEST');                      // selection (cached live fares applied)
  const selection = ctx.calculateTotal(vehicle).final;
  ctx.renderFareTiers();                                            // review step, its own lookup
  await new Promise((r) => setTimeout(r, 5));
  const review = ctx.calculateTotal(vehicle).final;
  return { selection, review, ref: refsByClass[vehicle] };
}

const payloadFor = ({ zone, vehicle, tripType, time, seat, surf, amount, km }) => ({
  guest_name: 'QA Test', guest_phone: '+61400000000', guest_email: 'qa-test@example.invalid', client_booking_ref: `FD-IT${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  pickup_zone: 'Nadi Airport', destination_zone: zone, vehicle_type: vehicle, quoted_currency: 'FJD', quoted_amount: amount, fx_rate_at_booking: 1, distance_km: km,
  payment_method: 'cash', pickup_date: '2026-09-28', pickup_time: time, trip_type: tripType, has_child_seat: seat, has_surfboard: surf, has_tour: false, is_custom_address: false,
});

const ZONES = snap.zone_distance_cache.map((r) => (r.zone_a === 'Nadi Airport' ? r.zone_b : r.zone_a)).filter((z) => z !== 'Nadi Airport');
const EXTRAS = [{ label: 'none', seat: false, surf: false, total: 0 }, { label: 'child seat', seat: true, surf: false, total: 8 }, { label: 'surfboard', seat: false, surf: true, total: 24 }, { label: 'seat+surfboard', seat: true, surf: true, total: 32 }];
const TIMES = [{ label: 'day 10:00', t: '10:00', night: false }, { label: 'day 06:00 edge', t: '06:00', night: false }, { label: 'night 22:00 edge', t: '22:00', night: true }, { label: 'night 23:00', t: '23:00', night: true }, { label: 'night 05:00', t: '05:00', night: true }];

let RESULTS;
async function grid() {
  if (RESULTS) return RESULTS;
  RESULTS = [];
  for (const zone of ZONES) {
    const km = snap.zone_distance_cache.find((r) => r.zone_a === zone || r.zone_b === zone).distance_km;
    for (const vehicle of ['sedan', 'minivan', 'minibus']) {
      for (const tripType of ['one-way', 'return']) {
        for (const ex of EXTRAS) {
          const c = await clientAmounts({ zone, vehicle, tripType, extrasTotal: ex.total });
          for (const tm of TIMES) {
            const base = { zone, vehicle, tripType, time: tm.t, seat: ex.seat, surf: ex.surf, km };
            const sent = await saveThroughWorker(payloadFor({ ...base, amount: cents(c.review) }));      // what the client submits (whole cents: submitMarketplaceBooking rounds)
            const probe = await saveThroughWorker(payloadFor({ ...base, amount: 1 }));            // far below the band: the Worker replaces it with its own authoritative amount
            RESULTS.push({ zone, vehicle, tripType, extras: ex.label, time: tm.label, night: tm.night, selection: c.selection, review: c.review, status: sent.status, error: sent.status === 201 ? null : (sent.body && sent.body.errors && sent.body.errors[0]), saved: sent.saved ? sent.saved.quoted_amount : null, authoritative: probe.saved ? probe.saved.quoted_amount : null });
          }
        }
      }
    }
  }
  return RESULTS;
}
const cents = (x) => Math.round(x * 100) / 100;

test('harness sanity: the real Worker applies its documented pricing rules (night x1.2, extras, 10% loyalty, return x1.85)', async () => {
  const worker = (await loadWorker()).default;
  assert.equal(typeof worker.fetch, 'function');
  const ow = await workerReferenceFare('Nadi', 'sedan', 'one-way');
  const rt = await workerReferenceFare('Nadi', 'sedan', 'return');
  assert.equal(ow, 30.15);
  assert.equal(cents(rt), cents(ow * 1.85));
  // authoritative amounts read back through POST /bookings (band probe): night adds 20% before extras and loyalty discount
  const day = (await saveThroughWorker(payloadFor({ zone: 'Nadi', vehicle: 'sedan', tripType: 'one-way', time: '10:00', seat: false, surf: false, amount: 1, km: 6.844 }))).saved.quoted_amount;
  const night = (await saveThroughWorker(payloadFor({ zone: 'Nadi', vehicle: 'sedan', tripType: 'one-way', time: '23:00', seat: false, surf: false, amount: 1, km: 6.844 }))).saved.quoted_amount;
  assert.equal(day, 30.15);
  assert.equal(night, cents(30.15 * 1.2 > 50 ? 30.15 * 1.2 - Math.round(30.15 * 1.2 * 0.1) : 30.15 * 1.2));
});

test('DAYTIME: selection = review = amount the Worker would save = the Worker\'s own authoritative amount, for every class, trip type and add-on', async () => {
  const day = (await grid()).filter((r) => !r.night && r.status === 201);
  assert.ok(day.length > 500, `covered ${day.length} daytime cases`);
  for (const r of day) {
    const id = JSON.stringify([r.zone, r.vehicle, r.tripType, r.extras, r.time]);
    assert.equal(r.selection, r.review, `selection vs review ${id}`);
    assert.equal(r.saved, cents(r.review), `saved vs review ${id}`);
    assert.equal(cents(r.saved), cents(r.authoritative), `saved vs Worker authoritative (to the cent) ${id}`);
  }
});

test('NIGHT (22:00-06:00): selection = review always; the saved amount is EITHER the submitted amount (Worker accepts it inside its band) OR the Worker\'s authoritative amount', async () => {
  const night = (await grid()).filter((r) => r.night && r.status === 201);
  assert.ok(night.length > 300);
  for (const r of night) {
    const id = JSON.stringify([r.zone, r.vehicle, r.tripType, r.extras, r.time]);
    assert.equal(r.selection, r.review, `selection vs review ${id}`);
    assert.ok(r.saved === cents(r.review) || r.saved === r.authoritative, `saved ${r.saved} is neither submitted ${r.review} nor authoritative ${r.authoritative} ${id}`);
  }
});

test('CHARACTERIZATION (register R17, not a fix): at night the client amount omits the surcharge; the Worker keeps that lower amount whenever it falls inside its 0.8x-1.3x band', async () => {
  const night = (await grid()).filter((r) => r.night && r.status === 201);
  const keptWithoutSurcharge = night.filter((r) => r.saved === cents(r.review) && cents(r.review) < r.authoritative);
  const replacedBySurcharge = night.filter((r) => r.saved === r.authoritative && cents(r.review) !== r.authoritative);
  const agree = night.filter((r) => cents(r.review) === r.authoritative);
  const summary = {
    nightCases: night.length,
    savedWithoutNightSurcharge: keptWithoutSurcharge.length,
    replacedByWorkerAuthoritative: replacedBySurcharge.length,
    alreadyEqual: agree.length,
    largestShortfallFjd: Math.max(0, ...keptWithoutSurcharge.map((r) => cents(r.authoritative - r.saved))),
    dayCases: (await grid()).filter((r) => !r.night && r.status === 201).length,
    rejectedBySanityCheck: (await grid()).filter((r) => r.status !== 201).length,
  };
  fs.writeFileSync(path.join(require('os').tmpdir(), 'night-pricing-summary.json'), JSON.stringify(summary, null, 1));
  console.log('night-pricing summary', JSON.stringify(summary));
  // Guard rails on the characterization itself (they fail if the Worker or client changes, forcing a conscious update):
  assert.ok(keptWithoutSurcharge.length > 0, 'the gap exists today');
  assert.equal(keptWithoutSurcharge.length + replacedBySurcharge.length + agree.length, night.length);
  for (const r of keptWithoutSurcharge) assert.ok(cents(r.review) >= 0.8 * r.authoritative && cents(r.review) <= 1.3 * r.authoritative, 'kept only inside the band');
  for (const r of replacedBySurcharge) assert.ok(cents(r.review) < 0.8 * r.authoritative || cents(r.review) > 1.3 * r.authoritative, 'replaced only outside the band');
});

test('night returns and add-ons are covered', async () => {
  const night = (await grid()).filter((r) => r.night && r.status === 201);
  assert.ok(night.some((r) => r.tripType === 'return') && night.some((r) => r.tripType === 'one-way'));
  for (const ex of EXTRAS) assert.ok(night.some((r) => r.extras === ex.label), ex.label);
  for (const t of ['night 22:00 edge', 'night 23:00', 'night 05:00']) assert.ok(night.some((r) => r.time === t), t);
  assert.ok((await grid()).some((r) => !r.night && r.time === 'day 06:00 edge'), '06:00 is daytime');
});

test('RESOLVED in the deployed Worker (register R19, 2026-09-27 ratio fix): no return-trip booking with add-ons is rejected any more, at any time of day', async () => {
  const all = await grid();
  assert.equal(all.filter((r) => r.status !== 201).length, 0, 'every case in the grid is accepted by the deployed Worker');
  assert.ok(all.some((r) => r.tripType === 'return' && r.extras !== 'none'), 'the grid does cover return trips with add-ons');
});

test("FIXED in the candidate (register R2): the client submits whole cents, so the Worker no longer stores float tails such as 127.96000000000001", async () => {
  const ok = (await grid()).filter((r) => r.status === 201);
  const tailsOnScreen = ok.filter((r) => r.review !== cents(r.review));
  assert.ok(tailsOnScreen.length > 0, 'the raw client arithmetic does still produce float tails');
  assert.equal(ok.filter((r) => r.saved !== cents(r.saved)).length, 0, 'no stored amount has a float tail');
  for (const r of tailsOnScreen.filter((x) => !x.night)) assert.equal(r.saved, cents(r.review));
});
