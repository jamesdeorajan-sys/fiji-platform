// Regression tests for the return-trip sanity check (Recommendation 4 guardrail) and add-ons.
// Defect (reproduced on the deployed Worker 80de8469 = revision 461fdc5): assertSanePricing compared the return TOTAL with the
// one-way TOTAL, both including the flat child-seat/surfboard add-ons. Add-ons are added once, not multiplied by the return
// multiplier, so on a cheap route a big add-on pulled the ratio under the 1.5 bound and a correctly priced return booking was
// rejected ("Could not confirm a reliable price"). Fix: compare the transfer components only (add-ons removed from both sides).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { postBooking, bookingPayload, materialise, snap } from './test-fixtures/worker-harness.mjs';
import * as P from './pricing.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here }).toString().trim();
const BASE_REV = '461fdc5';                                   // source of the deployed Worker 80de8469 (bundles byte-identical)
const FIXED = here;
const BASE = materialise({ rev: BASE_REV, repoRoot });

const ZONES = snap.zone_distance_cache.map((r) => (r.zone_a === 'Nadi Airport' ? r.zone_b : r.zone_a)).filter((z) => z !== 'Nadi Airport');
const EXTRAS = [{ label: 'none', seat: false, surf: false }, { label: 'child seat', seat: true, surf: false }, { label: 'surfboard', seat: false, surf: true }, { label: 'seat+surfboard', seat: true, surf: true }];
const TIMES = ['10:00', '06:00', '22:00', '23:00', '05:00'];
const VEHICLES = ['sedan', 'minivan', 'minibus'];

// Expected authoritative amount, computed independently from pricing.mjs and the snapshot (not through the Worker).
function expectedAuthoritative({ zone, vehicle, tripType, time, seat, surf }) {
  const km = snap.zone_distance_cache.find((r) => r.zone_a === zone || r.zone_b === zone).distance_km;
  const rule = snap.pricing_rules.filter((r) => r.vehicle_type === vehicle && r.active === 1 && r.distance_min_km <= km && (r.distance_max_km === null || km < r.distance_max_km)).sort((a, b) => b.distance_min_km - a.distance_min_km)[0];
  const mult = snap.zones.find((z) => z.name === zone).remote_multiplier;
  const oneWay = P.computeFinalTotal(P.applyZoneMultiplier(P.computeBaseFare({ flagfallFjd: rule.flagfall_fjd, baseRateFjdPerKm: rule.base_rate_fjd_per_km, distanceKm: km }), mult));
  const total = P.computeFinalTotal(P.applyExtras(P.applyNightSurcharge(P.applyTripTypeMultiplier(oneWay, tripType), time), { hasChildSeat: seat, hasSurfboard: surf }));
  return P.applyLoyaltyDiscount(total, false).finalFjd;
}

const cases = [];
for (const zone of ZONES) for (const vehicle of VEHICLES) for (const tripType of ['one-way', 'return']) for (const ex of EXTRAS) for (const time of TIMES) cases.push({ zone, vehicle, tripType, time, seat: ex.seat, surf: ex.surf, extras: ex.label });

let baseResults, fixedResults;
async function both() {
  if (baseResults) return { baseResults, fixedResults };
  baseResults = []; fixedResults = [];
  for (const c of cases) {
    const probe = (dir) => postBooking(dir, bookingPayload({ ...c, amount: 1 }));   // amount far below the band: the Worker saves its own authoritative amount
    const [b, f] = [await probe(BASE), await probe(FIXED)];
    baseResults.push({ ...c, status: b.status, saved: b.saved && b.saved.quoted_amount, esc: b.escalations.length });
    fixedResults.push({ ...c, status: f.status, saved: f.saved && f.saved.quoted_amount, esc: f.escalations.length });
  }
  return { baseResults, fixedResults };
}

test('control: the deployed revision rejects exactly the 14 known return + add-on cases; the repair rejects none', async () => {
  const { baseResults, fixedResults } = await both();
  assert.equal(cases.length, 1800);
  const rejectedBase = baseResults.filter((r) => r.status !== 201);
  assert.equal(rejectedBase.length, 14);
  for (const r of rejectedBase) { assert.equal(r.tripType, 'return'); assert.notEqual(r.extras, 'none'); assert.equal(r.status, 400); assert.equal(r.esc, 1, 'the old check also raised a manual-confirmation escalation'); }
  assert.equal(fixedResults.filter((r) => r.status !== 201).length, 0);
  assert.equal(fixedResults.reduce((n, r) => n + r.esc, 0), 0, 'the repair raises no false escalations');
});

test('the previously rejected cases now succeed with the correct amount, computed independently from pricing.mjs (extras included, night surcharge and loyalty discount unchanged)', async () => {
  const { baseResults, fixedResults } = await both();
  const previouslyRejected = fixedResults.filter((_, i) => baseResults[i].status !== 201);
  assert.equal(previouslyRejected.length, 14);
  for (const r of previouslyRejected) {
    assert.equal(r.status, 201);
    assert.equal(r.saved, expectedAuthoritative(r), JSON.stringify([r.zone, r.vehicle, r.time, r.extras]));
  }
});

test('fare rules are untouched: every case the deployed revision accepted saves exactly the same amount after the repair, and every amount matches the independent calculation', async () => {
  const { baseResults, fixedResults } = await both();
  let compared = 0;
  fixedResults.forEach((f, i) => {
    assert.equal(f.saved, expectedAuthoritative(f), JSON.stringify([f.zone, f.vehicle, f.tripType, f.time, f.extras]));
    if (baseResults[i].status === 201) { assert.equal(f.saved, baseResults[i].saved); compared++; }
  });
  assert.equal(compared, 1786);
});

test('approved extras are preserved: child seat FJ$8 and surfboard FJ$24 are in the pre-discount total, once per booking, for returns too', async () => {
  const c = { zone: 'Nadi', vehicle: 'sedan', tripType: 'return', time: '10:00' };
  const none = expectedAuthoritative({ ...c, seat: false, surf: false });
  const both2 = expectedAuthoritative({ ...c, seat: true, surf: true });
  const fixedBoth = (await postBooking(FIXED, bookingPayload({ ...c, seat: true, surf: true, extras: 'x', amount: 1 }))).saved.quoted_amount;
  const fixedNone = (await postBooking(FIXED, bookingPayload({ ...c, seat: false, surf: false, amount: 1 }))).saved.quoted_amount;
  assert.equal(fixedBoth, both2);
  assert.equal(fixedNone, none);
  const preDiscountGap = P.computeFinalTotal(P.applyExtras(P.applyTripTypeMultiplier(30.15, 'return'), { hasChildSeat: true, hasSurfboard: true })) - P.computeFinalTotal(P.applyTripTypeMultiplier(30.15, 'return'));
  assert.equal(preDiscountGap, 32);
});

// ---- the guard is still a guard: genuinely invalid return prices are still blocked, with and without add-ons ----
const invalid = [
  ['return multiplier collapsed to 1.0 (the Milestone 17 failure mode)', 'export const RETURN_MULTIPLIER = 1.85;', 'export const RETURN_MULTIPLIER = 1.0;'],
  ['return multiplier below the 1.5 bound (1.4)', 'export const RETURN_MULTIPLIER = 1.85;', 'export const RETURN_MULTIPLIER = 1.4;'],
  ['return multiplier implausibly high (3.0)', 'export const RETURN_MULTIPLIER = 1.85;', 'export const RETURN_MULTIPLIER = 3.0;'],
];
for (const [label, a, b] of invalid) {
  test(`guard intact: ${label} is still rejected and escalated, with no add-ons and with add-ons`, async () => {
    const dir = materialise({ repoRoot, replacePricing: [a, b] });          // the REPAIRED worker.js with a broken pricing.mjs
    for (const ex of EXTRAS) {
      for (const [zone, vehicle] of [['Coral Coast', 'minibus'], ['Nadi', 'sedan'], ['Denarau', 'minivan']]) {
        const r = await postBooking(dir, bookingPayload({ zone, vehicle, tripType: 'return', time: '10:00', seat: ex.seat, surf: ex.surf, amount: 1 }));
        assert.equal(r.status, 400, `${label} ${zone} ${vehicle} ${ex.label}`);
        assert.match(JSON.stringify(r.body), /Could not confirm a reliable price/);
        assert.equal(r.escalations.length, 1);
        assert.match(r.escalations[0].context, /Pricing sanity check failed for a return-trip booking/);
        assert.match(r.escalations[0].context, /add-ons FJD/);
      }
    }
    const oneWay = await postBooking(dir, bookingPayload({ zone: 'Nadi', vehicle: 'sedan', tripType: 'one-way', time: '10:00', seat: true, surf: true, amount: 1 }));
    assert.equal(oneWay.status, 201, 'the check only ever applies to return trips');
  });
}

test('boundary: a multiplier just inside the bound (1.55) is accepted with add-ons; just outside (1.45) is rejected', async () => {
  const inside = materialise({ repoRoot, replacePricing: ['export const RETURN_MULTIPLIER = 1.85;', 'export const RETURN_MULTIPLIER = 1.55;'] });
  const outside = materialise({ repoRoot, replacePricing: ['export const RETURN_MULTIPLIER = 1.85;', 'export const RETURN_MULTIPLIER = 1.45;'] });
  const p = bookingPayload({ zone: 'Nadi', vehicle: 'sedan', tripType: 'return', time: '10:00', seat: true, surf: true, amount: 1 });
  assert.equal((await postBooking(inside, p)).status, 201);
  assert.equal((await postBooking(outside, p)).status, 400);
});

test('the repair never rejects anything the deployed revision accepted (it only ever removes false rejections)', async () => {
  const { baseResults, fixedResults } = await both();
  fixedResults.forEach((f, i) => { if (f.status !== 201) assert.notEqual(baseResults[i].status, 201); });
});
