// James's clarified commercial decision (2026-10-05): Nadi Airport -> Fiji Marriott Resort Momi Bay, MINIBUS, daytime ONE-WAY, no extras: FJ$175.92 is the FINAL fare
// (the standard 10% discount is already included - do not deduct another 10%; FJ$157.92 is not the intended final fare).
// The Worker previously computed the formula fare 175.92 and then applied the 10% loyalty discount (157.92). This file pins the explicit, route/vehicle/journey-scoped
// final-fare treatment: the caller names the approved fare (approved_final_fare_id) and the Worker recognises it ONLY when every condition of that approval holds.
// Nothing else changes: other vehicles, routes, returns (297 / 304), extras, night, legacy callers and the 409 / FARE CHECK behaviour are characterised below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRig } from './test-fixtures/rig.mjs';
import { bookingPayload } from './test-fixtures/worker-harness.mjs';
import { installNetworkGuard } from './network_guard.mjs';
installNetworkGuard();
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const ID = 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY';
const GUEST = { guest_name: 'Zed Testperson', guest_phone: '+61411222333', guest_email: 'zed.testperson@example.invalid' };
const pay = (o = {}) => { const { amount = 175.92, zone = 'Momi Bay', vehicle = 'minibus', tripType = 'one-way', time = '10:00', seat = false, surf = false, ...extra } = o; return { ...bookingPayload({ zone, vehicle, tripType, time, seat, surf, amount }), ...GUEST, ...(tripType === 'return' ? { return_date: '2026-10-19', return_time: '10:00', return_pickup_location: 'Fiji Marriott Resort Momi Bay' } : {}), ...extra }; };
const alertTexts = (fetches) => fetches.flatMap((f) => { const comps = f.body && f.body.template && f.body.template.components; return (comps || []).flatMap((c) => c.parameters || []).filter((p) => p.type === 'text').map((p) => p.text); });
const decision = (r) => r.events.find((e) => e.event_type === 'created').metadata.pricing_decision;
const fresh = () => createRig({ dir: DIR });

test('APPROVED JOURNEY: 175.92 with the approved id is MATCHED against the approved final fare (calculated = 175.92, not 157.92) and is saved, returned and alerted as 175.92', async () => {
  const rig = await fresh();
  const r = await rig.post(pay({ approved_final_fare_id: ID, require_quote_match: true }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.saved.quoted_amount, 175.92); assert.equal(r.saved.settlement_amount_fjd, 175.92); assert.equal(r.body.booking.quoted_amount, 175.92);
  const d = decision(r);
  assert.deepEqual([d.outcome, d.reason, d.calculated_amount_fjd, d.accepted_amount_fjd, d.submitted_amount_fjd], ['matched', 'approved_final_fare', 175.92, 175.92, 175.92]);
  assert.match(String(d.pricing_version || ''), /approved-final-fare:MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY/);
  const texts = alertTexts(rig.all.fetches).join(' | ');
  assert.match(texts, /175\.92/); assert.doesNotMatch(texts, /157\.92/, 'no alert carries the superseded 157.92');
  assert.doesNotMatch(texts, /FARE CHECK/, 'a matched approved fare is not flagged');
});

test('NO DOUBLE DISCOUNT on the refusal path: far from the approved fare, require_quote_match is refused with reference fare 175.92 (it was 157.92)', async () => {
  const r = await (await fresh()).post(pay({ amount: 100, approved_final_fare_id: ID, require_quote_match: true }));
  assert.equal(r.status, 409); assert.equal(r.body.code, 'PRICE_MISMATCH'); assert.equal(r.body.reference_fare_fjd, 175.92); assert.equal(r.body.submitted_amount_fjd, 100);
  assert.equal(r.saved, null); assert.equal(r.fetches.length, 0, 'nothing saved, no alert');
});

test('OLD-CALLER BEHAVIOUR PRESERVED for the approved id: a legacy submit (no opt-in) far from the fare is still replaced and still carries the FARE CHECK marker - now with 175.92', async () => {
  const rig = await fresh();
  const r = await rig.post(pay({ amount: 100, approved_final_fare_id: ID }));
  assert.equal(r.status, 201); assert.equal(r.saved.quoted_amount, 175.92);
  assert.equal(decision(r).outcome, 'replaced_legacy');
  assert.match(alertTexts(rig.all.fetches).join(' | '), /FARE CHECK/);
});

test('OLD CLIENTS WITHOUT THE ID (cached pages, FijiDash production, other callers) keep today\'s behaviour exactly: the formula + 10% (157.92) is the Worker figure for this journey', async () => {
  const far = await (await fresh()).post(pay({ amount: 100, require_quote_match: true }));
  assert.equal(far.status, 409); assert.equal(far.body.reference_fare_fjd, 157.92);
  const rig = await fresh(); const old = await rig.post(pay({ amount: 157.92 }));   // what the released NAT page and FijiDash production quote today
  assert.equal(old.status, 201); assert.equal(old.saved.quoted_amount, 157.92); assert.equal(decision(old).outcome, 'matched');
  const inBand = await (await fresh()).post(pay({ amount: 175.92 }));                // a NEW page talking to a Worker that does not know the id (deployment order): kept as shown
  assert.equal(inBand.saved.quoted_amount, 175.92); assert.equal(decision(inBand).outcome, 'kept_in_band');
});

test('SCOPE: the approved id is recognised ONLY for this exact route/vehicle/journey; every other case is priced exactly as without the id', async () => {
  const cases = {
    'night pickup 22:00': { time: '22:00' }, 'night pickup 23:00': { time: '23:00' }, 'night pickup 05:59': { time: '05:59' },
    'child seat': { seat: true }, 'surfboard': { surf: true }, 'return': { tripType: 'return' }, 'minivan': { vehicle: 'minivan' }, 'sedan': { vehicle: 'sedan' },
    'another zone (Natadola)': { zone: 'Natadola' }, 'tour in the booking': { has_tour: true }, 'custom address': { is_custom_address: true },
  };
  for (const [label, o] of Object.entries(cases)) {
    const without = await (await fresh()).post(pay({ amount: 5, require_quote_match: true, ...o }));
    const withId = await (await fresh()).post(pay({ amount: 5, require_quote_match: true, approved_final_fare_id: ID, ...o }));
    assert.equal(withId.status, without.status, label);
    assert.equal(withId.body.reference_fare_fjd, without.body.reference_fare_fjd, `${label}: the id must not change the Worker fare`);
  }
  for (const bogus of ['', 'MOMI', 'momi_marriott_minibus_one_way_day', 42, null, { id: ID }]) {
    const r = await (await fresh()).post(pay({ amount: 100, require_quote_match: true, approved_final_fare_id: bogus }));
    assert.equal(r.body.reference_fare_fjd, 157.92, `unknown id ${JSON.stringify(bogus)} is ignored`);
  }
});

test('DAY BOUNDARIES with the id: 21:59 and 06:00 are day (final fare 175.92); 22:00 and 05:59 are night (formula as before: 190.10) - night fares are NOT newly approved', async () => {
  const ref = async (time) => (await (await fresh()).post(pay({ amount: 5, require_quote_match: true, approved_final_fare_id: ID, time }))).body.reference_fare_fjd;
  assert.equal(await ref('21:59'), 175.92); assert.equal(await ref('06:00'), 175.92); assert.equal(await ref('10:00'), 175.92);
  assert.equal(await ref('22:00'), 190.1); assert.equal(await ref('05:59'), 190.1);
});

test('APPROVED RETURN FIGURES PRESERVED: minibus day return 297 and return + child seat 304 are saved exactly as submitted, with or without the id (the Worker figures 292.45 / 300.45 are in band and never substituted)', async () => {
  for (const id of [undefined, ID]) {
    const extra = id ? { approved_final_fare_id: id } : {};
    const a = await (await fresh()).post(pay({ amount: 297, tripType: 'return', require_quote_match: true, ...extra }));
    assert.equal(a.status, 201, JSON.stringify(a.body)); assert.equal(a.saved.quoted_amount, 297); assert.equal(decision(a).calculated_amount_fjd, 292.45);
    const b = await (await fresh()).post(pay({ amount: 304, tripType: 'return', seat: true, require_quote_match: true, ...extra }));
    assert.equal(b.status, 201); assert.equal(b.saved.quoted_amount, 304); assert.equal(decision(b).calculated_amount_fjd, 300.45);
  }
});

test('UNAPPROVED INTERACTION (reported, not extended): one-way + child seat is NOT covered by the approval - the Worker still computes (175.92 + 8) less 10% = 165.92, i.e. LESS than the approved extras-free 175.92', async () => {
  const r = await (await fresh()).post(pay({ amount: 5, seat: true, require_quote_match: true, approved_final_fare_id: ID }));
  assert.equal(r.body.reference_fare_fjd, 165.92);
});

test('SAME-REFERENCE RETRY with the approved id: the replay returns the SAME booking and fare, creates no second booking, no second alert, and a stale amount cannot change it', async () => {
  const rig = await fresh(); const ref = 'FD-MOMI-RETRY1';
  const first = await rig.post(pay({ approved_final_fare_id: ID, require_quote_match: true, client_booking_ref: ref }));
  assert.equal(first.status, 201); const sent = rig.all.fetches.length; assert.ok(sent >= 1);
  const same = await rig.post(pay({ approved_final_fare_id: ID, require_quote_match: true, client_booking_ref: ref }));
  assert.equal(same.status, 200); assert.equal(same.body.idempotent, true); assert.equal(same.body.booking_id, first.body.booking_id); assert.equal(same.totalBookings, 1);
  const stale = await rig.post(pay({ amount: 157.92, client_booking_ref: ref }));    // an old tab replaying the superseded amount without the id
  assert.equal(stale.status, 200); assert.equal(stale.body.idempotent, true); assert.equal(stale.body.booking.quoted_amount, 175.92); assert.equal(stale.totalBookings, 1);
  // The short staff alert is sent exactly once. (The in-memory harness stubs the admin_notification_state claim as always granted, so it cannot show the production
  // suppression of the FULL admin alert on a replay; production data shows exactly one admin_notification_sent event per booking, 185 of 185 - see the review package.)
  assert.equal(rig.all.fetches.filter((f) => alertTexts([f]).some((t) => /^New booking/.test(t))).length, 1, 'the short alert was sent once');
  assert.equal(rig.all.fetches.filter((f) => f.body && f.body.template && f.body.template.name && /driver/i.test(f.body.template.name)).length, 0, 'no driver broadcast was created or repeated by the replay');
});
