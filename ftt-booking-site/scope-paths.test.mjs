// Scope boundaries (candidate): departures, custom addresses, tours and boats keep their intended behaviour, and the only remaining path that can still silently
// reprice is a caller WITHOUT the opt-in. CHARACTERIZATION against the real deployed Worker bundle (isolated, outbound blocked): it decides no fare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newEnv } from './reconciliation/lib.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'src', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const env = await newEnv();
const base = (o) => ({ guest_name: 'QA Test', guest_phone: '+61400000000', guest_email: 'qa-test@example.invalid', client_booking_ref: 'SC-' + Math.random().toString(36).slice(2, 9), pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'sedan', quoted_currency: 'FJD', quoted_amount: 40, fx_rate_at_booking: 1, distance_km: 10, payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: '10:00', trip_type: 'one-way', has_child_seat: false, has_surfboard: false, has_tour: false, is_custom_address: false, require_quote_match: true, ...o });
const post = async (o) => { const r = await env.rig.post(base(o)); const ev = r.events.find((e) => e.event_type === 'created'); return { status: r.status, code: r.body && r.body.code, saved: r.created.length ? r.saved.quoted_amount : null, decision: ev && ev.metadata && ev.metadata.pricing_decision, outbound: r.fetches.length }; };

test('control: a fixed zone-pair far from the Worker fare is REFUSED (409) with the opt-in, and a figure inside the band is kept as shown', async () => {
  const far = await post({ quoted_amount: 5 }); assert.equal(far.status, 409); assert.equal(far.code, 'PRICE_MISMATCH'); assert.equal(far.saved, null); assert.equal(far.outbound, 0);
  const near = await post({ quoted_amount: 40 }); assert.equal(near.status, 201); assert.equal(near.saved, 40); assert.equal(near.decision.outcome, 'kept_in_band');
});
test('DEPARTURES and CUSTOM ADDRESSES (is_custom_address): never repriced and never refused - the amount sent is saved as sent, recorded as not_fully_server_verified (an existing trust gap, NOT silent repricing)', async () => {
  for (const o of [{ pickup_zone: 'Denarau', destination_zone: 'Nadi Airport' }, { destination_zone: 'Denarau' }]) for (const amount of [5, 40, 500]) {
    const r = await post({ ...o, is_custom_address: true, quoted_amount: amount });
    assert.equal(r.status, 201); assert.equal(r.saved, amount); assert.deepEqual([r.decision.outcome, r.decision.reason], ['not_fully_server_verified', 'custom_address']);
  }
});
test('TOURS: the tour price has no server rule; the amount is saved as sent; only an amount below the verified transfer portion is blocked (escalated to a human), never repriced', async () => {
  const ok = await post({ has_tour: true, quoted_amount: 300 }); assert.equal(ok.saved, 300); assert.equal(ok.decision.reason, 'tour_in_booking');
  const low = await post({ has_tour: true, quoted_amount: 10 }); assert.equal(low.status, 400); assert.equal(low.saved, null);
});
test('BOATS: the bundled boat fare is saved as sent; a total below its own land-leg portion is rejected; no repricing', async () => {
  const ok = await post({ vehicle_type: 'boat', destination_zone: 'Mamanuca Islands', quoted_amount: 250, commission_base_fjd: 90, distance_km: null }); assert.equal(ok.status, 201); assert.equal(ok.saved, 250);
  const bad = await post({ vehicle_type: 'boat', destination_zone: 'Mamanuca Islands', quoted_amount: 50, commission_base_fjd: 90, distance_km: null }); assert.equal(bad.status, 400);
});
test('MISSING RULE (Tanoa International, Nadi Airport -> Nadi Airport): the Worker cannot compute a reference and trusts the client amount (recorded client_trusted_authoritative_unavailable)', async () => {
  const r = await post({ destination_zone: 'Nadi Airport', quoted_amount: 15 }); assert.equal(r.saved, 15); assert.equal(r.decision.outcome, 'client_trusted_authoritative_unavailable');
});
test('THE REMAINING SILENT-REPRICING PATH: a caller WITHOUT require_quote_match (FijiDash production 8c6f920 today, any cached old page, any other client) still has an out-of-band amount silently replaced (5 -> 47.87)', async () => {
  const r = await post({ require_quote_match: undefined, quoted_amount: 5 });
  assert.equal(r.status, 201); assert.equal(r.saved, 47.87); assert.equal(r.decision.outcome, 'replaced_legacy');
});
test('candidate page: the loyalty override never applies to a tour booking, and live fares are never applied to custom addresses, boats, non-airport pickups', () => {
  const fn = (name) => { const s = src.indexOf(`function ${name}(`); let i = src.indexOf('{', s), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return src.slice(s, i + 1); } };
  const code = ['DISCOUNT_THRESHOLD', 'DISCOUNT_RATE', 'PAGE_RETURN_CONVENTION_DESTS'].map((n) => src.match(new RegExp('const ' + n + '\\s*= [^;]+;'))[0]).join('\n') + '\n' + ['bookingHasTour', 'fareOverrideKey', 'calculateTotal', 'calculateTotalFromPublishedPrices', 'pageReturnConventionApplies', 'liveFareEligible'].map(fn).join('\n');
  const mk = (st, boats = {}) => { const sb = { Math, JSON, BOAT_DESTINATION_IDS: boats, document: { getElementById: () => ({ value: '', checked: false }) }, state: { tripType: 'one-way', prices: { sedan: 100 }, extrasTotal: 0, passengers: 2, luggage: 2, selectedVehicle: 'sedan', selectedTour: null, fareOverride: null, priceSource: 'published', destZoneName: 'Denarau', ...st } }; vm.createContext(sb); vm.runInContext(code, sb); return sb; };
  const t = mk({ selectedTour: { name: 'X', price: 100 } }); t.state.fareOverride = { key: t.fareOverrideKey(), amount: 1, shown: 2, original: 2 };
  assert.equal(t.calculateTotal().serverConfirmed, undefined, 'tour: override ignored'); assert.equal(t.calculateTotal().discount, 0);
  const e = mk({}); assert.equal(e.liveFareEligible('NAN', 'HILTON_DENARAU'), true);
  assert.equal(e.liveFareEligible('CUSTOM_PICKUP', 'NAN'), false, 'departure'); assert.equal(e.liveFareEligible('NAN', 'CUSTOM_DEST'), false, 'custom destination');
  assert.equal(mk({}, { SOME_BOAT: 1 }).liveFareEligible('NAN', 'SOME_BOAT'), false, 'boat'); assert.equal(mk({ priceSource: 'quote' }).liveFareEligible('NAN', 'HILTON_DENARAU'), false, 'quote-priced');
  assert.equal(mk({ destZoneName: 'NEEDS_LOOKUP' }).liveFareEligible('NAN', 'SABETO'), false, 'unresolved zone');
});
