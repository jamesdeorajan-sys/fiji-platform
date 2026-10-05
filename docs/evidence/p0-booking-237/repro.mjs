// OFFLINE reproduction of booking #237 (FTT-UKAZTE): no live booking, no message, no network except reading saved production rule dumps.
// CLIENT side = the exact functions from the live app.js (?v=20260921-mobile-ux = commit c6d62a6) evaluated in a sandbox.
// SERVER side = the exact pricing.mjs + computeFareFjd/computeAuthoritativePrice/loyalty/band logic of the deployed Worker source (2125a34) with the saved production pricing_rules/zones/distance cache.
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
const here = (f) => new URL('./' + f, import.meta.url);
const src = fs.readFileSync(here('app_live.js'), 'utf8').replace(/\r/g, '');
const lines = src.split('\n');
const slice = (a, b) => lines.slice(a - 1, b).join('\n');
const find = (re, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l)) + 1;
const nightStart = find(/^const NIGHT_SURCHARGE/);
const calcEnd = find(/^\/\/ ─── EMOJI STRIPPER/) - 1;
const isNightStart = find(/^function isNightPickup/);
const computeEnd = find(/^\/\/ ─── RELIABLY SET A <SELECT>/) - 1;
const routesStart = find(/^const ROUTES_DATA = \[/);
let routesEnd = routesStart; while (!/^\];/.test(lines[routesEnd - 1])) routesEnd += 1;
const markStart = find(/^const MARKETPLACE_ZONE_NAMES/); let markEnd = markStart; while (!/\]\);/.test(lines[markEnd - 1])) markEnd += 1;
const aliasLine = lines.find((l) => l.startsWith('const AREA_ZONE_ALIASES'));
const code = [slice(nightStart, calcEnd), slice(isNightStart, computeEnd), slice(routesStart, routesEnd), slice(markStart, markEnd), aliasLine,
  'function resolveZone(area){ if (MARKETPLACE_ZONE_NAMES.has(area)) return area; if (AREA_ZONE_ALIASES[area]) return AREA_ZONE_ALIASES[area]; return null; }'].join('\n');
const sandbox = { Math, Number, parseInt, console, document: { getElementById: (id) => ({ value: sandbox.__time }) }, state: { tripType: 'one-way', prices: {}, extrasTotal: 0, passengers: 1, selectedVehicle: null, selectedTour: null }, __time: '09:15' };
vm.createContext(sandbox); vm.runInContext('var TIER = {}; ' + code + '; this.fns = { computePrices, calculateTotal, ROUTES_DATA, resolveZone, lookupPublishedPrices, applyModifiers };', sandbox);
const F = sandbox.fns;

// ---- server side
const P = await import(pathToFileURL(new URL('./pricing_2125a34.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href);
const rules = JSON.parse(fs.readFileSync(here('pr_all.json'), 'utf8'))[0].results;
const zones = Object.fromEntries(JSON.parse(fs.readFileSync(here('zn_all.json'), 'utf8'))[0].results.map((z) => [z.name, z.remote_multiplier]));
const cache = JSON.parse(fs.readFileSync(here('zc_all.json'), 'utf8'))[0].results;
const distTo = (zone) => (cache.find((c) => (c.zone_a === zone && c.zone_b === 'Nadi Airport') || (c.zone_b === zone && c.zone_a === 'Nadi Airport')) || {}).distance_km;
function serverQuote({ zone, vehicle, tripType, pickupTime, seat = false, surf = false }) {
  const d = distTo(zone); if (d == null) return null;
  const rule = rules.filter((r) => r.vehicle_type === vehicle && r.active === 1 && r.distance_min_km <= d && (r.distance_max_km == null || d < r.distance_max_km)).sort((a, b) => b.distance_min_km - a.distance_min_km)[0];
  if (!rule) return null;
  const oneWay = P.computeFinalTotal(P.applyZoneMultiplier(P.computeBaseFare({ flagfallFjd: rule.flagfall_fjd, baseRateFjdPerKm: rule.base_rate_fjd_per_km, distanceKm: d }), zones[zone]));
  const sub = P.computeFinalTotal(P.applyExtras(P.applyNightSurcharge(P.applyTripTypeMultiplier(oneWay, tripType), pickupTime), { hasChildSeat: seat, hasSurfboard: surf }));
  return { distanceKm: d, oneWay, subtotal: sub, final: P.applyLoyaltyDiscount(sub, false).finalFjd };
}
function clientQuote({ destValue, vehicle, tripType, time, seat = false, surf = false }) {
  sandbox.__time = time; sandbox.state.tripType = tripType; sandbox.state.extrasTotal = (seat ? 8 : 0) + (surf ? 24 : 0);
  const pr = F.computePrices('NAN', destValue, 40); sandbox.state.prices = pr; sandbox.state.selectedVehicle = vehicle;
  const t = F.calculateTotal(vehicle); return { source: pr.source, vehiclePrice: pr.minibus && pr[vehicle], subtotal: t.subtotal, discount: t.discount, final: t.final };
}
const out = { generated_from: { client: 'live app.js ?v=20260921-mobile-ux == commit c6d62a6 nadi-airport-transfers-site/src/app.js', server: 'nadi-dispatch-api source 2125a34 (deployed 2026-09-27) + saved production pricing_rules/zones/zone_distance_cache' } };

// ---- 1. the exact itinerary
const exact = { destValue: 'MARRIOTT_MOMI', vehicle: 'minibus', tripType: 'return', time: '09:15' };
out.exact = {
  client_no_extras: clientQuote(exact), client_child_seat: clientQuote({ ...exact, seat: true }),
  server_no_extras: serverQuote({ zone: 'Momi Bay', vehicle: 'minibus', tripType: 'return', pickupTime: '09:15' }), server_child_seat: serverQuote({ zone: 'Momi Bay', vehicle: 'minibus', tripType: 'return', pickupTime: '09:15', seat: true }),
  server_child_seat_night_return_06: serverQuote({ zone: 'Momi Bay', vehicle: 'minibus', tripType: 'return', pickupTime: '06:00', seat: true }),
  boundary_06_00_is_night_client: (() => { sandbox.__time = '06:00'; return vm.runInContext('isNightPickup()', sandbox); })(),
  boundary_05_59_is_night_client: (() => { sandbox.__time = '05:59'; return vm.runInContext('isNightPickup()', sandbox); })(),
  boundary_06_00_is_night_server: P.isNightPickup('06:00'),
};
const e = out.exact; const stored = 300.45; const guest = 142;
const band = e.server_child_seat.final;
out.exact.band = { server_discounted: band, lower_0_8: Math.round(band * 0.8 * 100) / 100, upper_1_3: Math.round(band * 1.3 * 100) / 100, guest_142_outside: guest < band * 0.8 || guest > band * 1.3 };
out.exact.matches = { guest_screen_142: e.client_child_seat.final === guest, stored_and_alert_300_45: e.server_child_seat.final === stored };
// what else could produce 315 / 135?
out.compare = {};
const combos = [];
for (const v of ['sedan', 'minivan', 'minibus']) for (const t of ['one-way', 'return']) for (const time of ['09:15', '23:00']) for (const seat of [false, true]) for (const surf of [false, true]) {
  const c = clientQuote({ destValue: 'MARRIOTT_MOMI', vehicle: v, tripType: t, time, seat, surf }); const s = serverQuote({ zone: 'Momi Bay', vehicle: v, tripType: t, pickupTime: time, seat, surf });
  combos.push({ v, t, time, seat, surf, client: c.final, server: s.final });
}
out.compare.momi_combos_hitting_315 = combos.filter((x) => x.client === 315 || x.server === 315);
out.compare.momi_minibus_return_day_no_extras = combos.find((x) => x.v === 'minibus' && x.t === 'return' && x.time === '09:15' && !x.seat && !x.surf);

// ---- 2. sweep: every published route x vehicle x trip type (daytime, no extras and with child seat)
const rows = [];
for (const r of F.ROUTES_DATA) {
  const zone = F.resolveZone(r.area);
  for (const [vk, pub] of [['sedan', r.s], ['minivan', r.v], ['minibus', r.m]]) for (const t of ['one-way', 'return']) for (const seat of [false, true]) {
    if (!zone) { rows.push({ destValue: r.destValue, zone: null, vehicle: vk, trip: t, seat, class: 'NO_SERVER_ZONE' }); continue; }
    const c = clientQuote({ destValue: r.destValue, vehicle: vk, tripType: t, time: '10:00', seat }); const s = serverQuote({ zone, vehicle: vk, tripType: t, pickupTime: '10:00', seat });
    if (!s) { rows.push({ destValue: r.destValue, zone, vehicle: vk, trip: t, seat, class: 'NO_SERVER_RULE' }); continue; }
    const ratio = c.final / s.final; const cls = (c.final < s.final * 0.8 || c.final > s.final * 1.3) ? 'REPLACED_BY_SERVER' : (Math.abs(c.final - s.final) > 0.5 ? 'KEPT_DIFFERS' : 'MATCH');
    rows.push({ destValue: r.destValue, zone, vehicle: vk, trip: t, seat, client: c.final, server: s.final, ratio: Math.round(ratio * 1000) / 1000, class: cls });
  }
}
const tally = (f) => { const o = {}; for (const r of rows.filter(f)) o[r.class] = (o[r.class] || 0) + 1; return o; };
out.sweep = { rows_total: rows.length, all: tally(() => true), day_no_extras_one_way: tally((r) => r.trip === 'one-way' && !r.seat), day_no_extras_return: tally((r) => r.trip === 'return' && !r.seat) };
const replaced = rows.filter((r) => r.class === 'REPLACED_BY_SERVER' && !r.seat);
out.sweep.replaced_destinations_by_trip = { 'one-way': [...new Set(replaced.filter((r) => r.trip === 'one-way').map((r) => r.destValue))], return: [...new Set(replaced.filter((r) => r.trip === 'return').map((r) => r.destValue))] };
out.sweep.replaced_by_vehicle = { 'one-way': Object.fromEntries(['sedan', 'minivan', 'minibus'].map((v) => [v, replaced.filter((r) => r.trip === 'one-way' && r.vehicle === v).length])), return: Object.fromEntries(['sedan', 'minivan', 'minibus'].map((v) => [v, replaced.filter((r) => r.trip === 'return' && r.vehicle === v).length])) };
out.sweep.momi_rows = rows.filter((r) => r.destValue === 'MARRIOTT_MOMI' && !r.seat);
out.sweep.client_catalogue_anomaly_minibus_below_minivan = F.ROUTES_DATA.filter((r) => r.m < r.v).map((r) => ({ destValue: r.destValue, s: r.s, v: r.v, m: r.m }));
out.sweep.worst_ratios = replaced.slice().sort((a, b) => a.ratio - b.ratio).slice(0, 10);
fs.writeFileSync(here('repro_out.json'), JSON.stringify({ out, rows }, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 9000));
