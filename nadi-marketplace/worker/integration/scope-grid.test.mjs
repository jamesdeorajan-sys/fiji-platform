// SCOPE VERIFICATION over the WHOLE grid (every route x vehicle x trip type x extras {none, child seat, surfboard, both} x time {10:00, 23:00}), old vs new, per component:
//   - NAT page (c5ee3b1 -> candidate), FijiDash page (8c6f920 -> candidate): selection (static) and review (live reference-fare swap, FijiDash), and where the page would send the approved id
//   - Worker (0b961a4 -> candidate): the Worker's own calculated total (409 probe) per zone x vehicle x trip x extras x time, without and with the approved id
// "All other pricing unchanged" is therefore stated precisely: it EXCLUDES (a) the FijiDash Momi minibus CATALOGUE change (79 -> 175.92, which moves every Momi minibus selection figure) and
// (b) the FijiDash Momi minibus RETURN review figures (292.45 / 300.45 etc. -> the approved page convention 297 / 304 etc.). Everything else is asserted identical, cell by cell.
// Environment as journey.test.mjs. Isolated; outbound blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { NEW_DIR, skip, worker, srcs, el, fnSrc, pricingCode } from './harness.mjs';
console.warn = () => {};
const ZONES = new Set(['Nadi', 'Wailoaloa', 'Denarau', 'Sonaisali', 'Vuda Point', 'Lautoka', 'Momi Bay', 'Natadola', 'Sigatoka', 'Coral Coast', 'Pacific Harbour', 'Ba', 'Rakiraki', 'Suva', 'Nausori']);
const zoneOf = (area) => (ZONES.has(area) ? area : area === 'Port Denarau' ? 'Denarau' : null);
const VEH = ['sedan', 'minivan', 'minibus']; const TRIPS = ['one-way', 'return']; const TIMES = ['10:00', '23:00'];
const EXTRAS = [['none', false, false], ['seat', true, false], ['surf', false, true], ['both', true, true]];
const routesOf = (src) => { const i = src.indexOf('const ROUTES_DATA = ['); const sb = {}; vm.createContext(sb); vm.runInContext(src.slice(i, src.indexOf('\n];', i) + 3) + ';this.R = ROUTES_DATA.map((r) => ({ destValue: r.destValue, area: r.area }))', sb); return JSON.parse(JSON.stringify(sb.R)); };
const key = (r, v, t, e, tm) => `${r}|${v}|${t}|${e}|${tm === '10:00' ? 'day' : 'night'}`;

async function pageGrid(src, site, refFare) {
  const out = {}; const approved = [];
  for (const r of routesOf(src)) { const zone = zoneOf(r.area); if (!zone) continue;
    for (const v of VEH) for (const t of TRIPS) for (const [en, seat, surf] of EXTRAS) for (const tm of TIMES) {
      const vals = { travelTime: tm, pickup: 'NAN', destination: r.destValue };
      const sb = { Math, Number, parseInt, JSON, String, Date, isFinite, Promise, setTimeout, console, BOAT_DESTINATION_IDS: {}, state: { tripType: t, prices: {}, extrasTotal: (seat ? 8 : 0) + (surf ? 24 : 0), passengers: 2, luggage: 2, selectedVehicle: v, selectedTour: null, priceSource: 'published', fareOverride: null },
        document: { getElementById: (id) => (id in vals ? el({ value: vals[id] }) : el()) }, updatePricing() {}, stopNegotiationPolling() {}, renderPriceBlock() {}, formatPrice: String, fareOverrideKey: () => 'k', resolveConfirmedPickupZone: () => 'Nadi Airport', resolveConfirmedDestinationZone: () => zone,
        fetchRealReferenceFare: async (pz, dz, vt, tt) => refFare(dz, vt, tt) };
      vm.createContext(sb);
      const extra = site === 'fd' ? [(src.match(/const NEGOTIATION_FLOOR_RATIO\s*= [^;]+;/) || [''])[0], ...['resolveNegotiationEligibility', 'renderFareTiers', 'approvedMomiMinibusReturn'].map((n) => fnSrc(src, n))].join('\n') : '';
      vm.runInContext(pricingCode(src) + '\n' + extra + `; state.prices = computePrices('NAN', ${JSON.stringify(r.destValue)}, 40);`, sb);
      const tot = () => JSON.parse(vm.runInContext('JSON.stringify(calculateTotal())', sb)).final;
      const selection = tot(); let review = selection;
      if (site === 'fd') { sb.renderFareTiers(); await new Promise((x) => setTimeout(x, 0)); await new Promise((x) => setImmediate(x)); review = tot(); }
      const k = key(r.destValue, v, t, en, tm); out[k] = { selection, review };
      if (typeof sb.approvedFinalFareFor === 'function' && vm.runInContext('approvedFinalFareFor()', sb)) approved.push(k);
    }
  }
  return { out, approved };
}
const diff = (a, b, field) => Object.keys(a).filter((k) => a[k][field] !== b[k][field]);

test('PAGES, whole grid: NAT changes exactly ONE cell; FijiDash changes only Momi minibus cells (catalogue + return review); the approved id would be sent for exactly ONE cell on each site', { skip }, async () => {
  const S = srcs(); const w = await worker(process.env.WORKER_OLD_DIR); const cache = new Map();
  const ref = async (zone, vehicle, trip) => { const k = `${zone}|${vehicle}|${trip}`; if (!cache.has(k)) { const r = await w.get(`/reference-fare?pickup_zone=${encodeURIComponent('Nadi Airport')}&destination_zone=${encodeURIComponent(zone)}&vehicle_type=${vehicle}&trip_type=${trip}`); cache.set(k, r.status === 200 && r.body.ok ? r.body.reference_fare_fjd : null); } return cache.get(k); };
  const natOld = await pageGrid(S.natOld, 'nat', ref), natNew = await pageGrid(S.natNew, 'nat', ref);
  const fdOld = await pageGrid(S.fdOld, 'fd', ref), fdNew = await pageGrid(S.fdNew, 'fd', ref);
  assert.ok(Object.keys(natOld.out).length >= 1500, 'grid size ' + Object.keys(natOld.out).length);
  assert.deepEqual(diff(natOld.out, natNew.out, 'selection'), ['MARRIOTT_MOMI|minibus|one-way|none|day'], 'NAT: exactly one cell changes (157.92 -> 175.92)');
  assert.equal(natOld.out['MARRIOTT_MOMI|minibus|one-way|none|day'].selection, 157.92); assert.equal(natNew.out['MARRIOTT_MOMI|minibus|one-way|none|day'].selection, 175.92);
  const fdSel = diff(fdOld.out, fdNew.out, 'selection'), fdRev = diff(fdOld.out, fdNew.out, 'review');
  for (const k of [...fdSel, ...fdRev]) assert.ok(k.startsWith('MARRIOTT_MOMI|minibus|'), `FijiDash change outside Momi minibus: ${k}`);
  assert.equal(fdSel.length, 16, 'EXCLUSION (a): the FijiDash Momi minibus catalogue change (79 -> 175.92) moves all 16 Momi minibus selection figures');
  assert.deepEqual(fdRev.sort(), ['MARRIOTT_MOMI|minibus|one-way|none|day', ...['seat', 'surf', 'both', 'none'].flatMap((e) => ['day', 'night'].map((tm) => `MARRIOTT_MOMI|minibus|return|${e}|${tm}`))].sort(),
    'EXCLUSION (b): FijiDash review changes only for the approved one-way journey and the 8 Momi minibus RETURN cells (292.45 etc. -> the approved page convention)');
  // the Momi exception does not extend: sedan, minivan and every other route are identical on both sites
  for (const [a, b] of [[natOld.out, natNew.out], [fdOld.out, fdNew.out]]) for (const k of Object.keys(a)) if (/^MARRIOTT_MOMI\|(sedan|minivan)\|/.test(k) || !k.startsWith('MARRIOTT_MOMI')) { assert.equal(a[k].selection, b[k].selection, k); assert.equal(a[k].review, b[k].review, k); }
  assert.deepEqual(natNew.approved, ['MARRIOTT_MOMI|minibus|one-way|none|day']); assert.deepEqual(fdNew.approved, ['MARRIOTT_MOMI|minibus|one-way|none|day']);
  assert.deepEqual(natOld.approved.concat(fdOld.approved), [], 'released pages never send an id');
});

test('WORKER, whole grid: WITHOUT the id the candidate Worker calculates exactly what production does in EVERY cell; WITH the id on every cell exactly ONE cell differs (the approved journey)', { skip }, async () => {
  const oldW = await worker(process.env.WORKER_OLD_DIR), newW = await worker(NEW_DIR); let n = 0, diffs = [], idDiffs = [];
  for (const [zone, distance] of [['Nadi', 6.844], ['Wailoaloa', 6.902], ['Denarau', 11.776], ['Sonaisali', 22.09], ['Vuda Point', 19.333], ['Lautoka', 25.431], ['Momi Bay', 38.623], ['Natadola', 54.718], ['Sigatoka', 69.36], ['Coral Coast', 96.705], ['Pacific Harbour', 147.587], ['Ba', 60.081], ['Rakiraki', 130.011], ['Suva', 195.691]]) {
    for (const v of VEH) for (const t of TRIPS) for (const [en, seat, surf] of EXTRAS) for (const tm of TIMES) {
      const body = (extra = {}) => ({ guest_name: 'Zed Testperson', guest_phone: '+61411222333', client_booking_ref: 'SG-' + Math.random().toString(36).slice(2, 9), pickup_zone: 'Nadi Airport', destination_zone: zone, vehicle_type: v, quoted_currency: 'FJD', quoted_amount: 5, fx_rate_at_booking: 1, distance_km: distance, payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: tm, trip_type: t, has_child_seat: seat, has_surfboard: surf, has_tour: false, is_custom_address: false, require_quote_match: true, ...(t === 'return' ? { return_date: '2026-10-27', return_time: '10:00', return_pickup_location: 'Hotel' } : {}), ...extra });
      const ro = (await oldW.post(body())).body, rn = (await newW.post(body())).body, ri = (await newW.post(body({ approved_final_fare_id: 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY' }))).body;
      const a = ro && (ro.reference_fare_fjd ?? `status:${ro.errors}`), b = rn && (rn.reference_fare_fjd ?? `status:${rn.errors}`), c = ri && (ri.reference_fare_fjd ?? `status:${ri.errors}`);
      n++; if (a !== b) diffs.push(`${zone}|${v}|${t}|${en}|${tm}`); if (b !== c) idDiffs.push(`${zone}|${v}|${t}|${en}|${tm}: ${b} -> ${c}`);
    }
  }
  assert.ok(n >= 600, 'grid size ' + n);
  assert.deepEqual(diffs, [], 'without the id the candidate Worker is identical to production in every cell');
  assert.deepEqual(idDiffs, ['Momi Bay|minibus|one-way|none|10:00: 157.92 -> 175.92'], 'with the id sent on EVERY cell, only the approved journey differs (other hotels in Momi Bay, other vehicles, extras, night, returns are not covered)');
});
