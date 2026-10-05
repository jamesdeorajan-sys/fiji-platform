// James's approvals (2026-10-05): Nadi Airport -> Fiji Marriott Resort Momi Bay, MINIBUS, daytime (06:00-21:59 Fiji time) ONE-WAY: FJ$175.92 is the FINAL transfer fare (the standard discount is already
// included); extras are added at their listed price - child seat FJ$183.92, surfboard FJ$199.92, both FJ$207.92 in total - and NO further standard discount applies to the transfer or its extras.
// The Worker previously applied the 10% discount to formula + extras (157.92 / 165.92 / 179.92 / 186.92). The caller names the approved fare (approved_final_fare_id) and the Worker recognises it ONLY
// when every condition of the approval holds. NIGHT is on HOLD: nothing about night pickups, returns (297 / 304), other vehicles, routes or hotels changes (characterised below).
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


const APPROVED = [[false, false, 175.92], [true, false, 183.92], [false, true, 199.92], [true, true, 207.92]];
test('APPROVED EXTRAS: child seat 183.92, surfboard 199.92, both 207.92 (transfer 175.92 + FJ$8 / FJ$24, NO further discount) are MATCHED, saved, returned and alerted exactly; the superseded discounted totals never appear', async () => {
  for (const [seat, surf, want] of APPROVED) {
    const rig = await fresh(); const r = await rig.post(pay({ amount: want, seat, surf, approved_final_fare_id: ID, require_quote_match: true }));
    assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.saved.quoted_amount, want); assert.equal(r.saved.settlement_amount_fjd, want); assert.equal(r.body.booking.quoted_amount, want);
    const d = decision(r); assert.deepEqual([d.outcome, d.reason, d.calculated_amount_fjd, d.accepted_amount_fjd], ['matched', 'approved_final_fare', want, want], `seat=${seat} surf=${surf}`);
    const texts = alertTexts(rig.all.fetches).join(' | '); assert.match(texts, new RegExp(String(want).replace('.', '\\.'))); assert.doesNotMatch(texts, /FARE CHECK/);
    for (const old of [157.92, 165.92, 179.92, 186.92]) assert.doesNotMatch(texts, new RegExp(String(old).replace('.', '\\.')), `no alert carries the superseded ${old}`);
    const refusal = await (await fresh()).post(pay({ amount: 5, seat, surf, approved_final_fare_id: ID, require_quote_match: true }));
    assert.equal(refusal.status, 409); assert.equal(refusal.body.reference_fare_fjd, want, 'the Worker fare for the refusal path is the approved total, not the discounted formula');
  }
});
test('ADDING EXTRAS CANNOT LOWER THE FARE (passing regression): with the approved id, none <= child seat <= surfboard <= both, and each step is exactly the listed extra price', async () => {
  const ref = async (seat, surf) => (await (await fresh()).post(pay({ amount: 5, seat, surf, approved_final_fare_id: ID, require_quote_match: true }))).body.reference_fare_fjd;
  const [n, c, sb, b] = [await ref(false, false), await ref(true, false), await ref(false, true), await ref(true, true)];
  assert.ok(n <= c && c <= b && n <= sb && sb <= b); assert.deepEqual([c - n, sb - n, b - n].map((x) => Math.round(x * 100) / 100), [8, 24, 32]);
});

test('SCOPE: the approved id is recognised ONLY for this exact route/vehicle/journey (daytime one-way, with or without the two listed extras); every other case is priced exactly as without the id', async () => {
  const cases = {
    'night pickup 22:00': { time: '22:00' }, 'night pickup 23:00': { time: '23:00' }, 'night pickup 05:59': { time: '05:59' }, 'night + child seat': { time: '23:00', seat: true }, 'night + both extras': { time: '23:00', seat: true, surf: true },
    'return': { tripType: 'return' }, 'return + child seat': { tripType: 'return', seat: true }, 'minivan': { vehicle: 'minivan' }, 'sedan': { vehicle: 'sedan' }, 'minivan + child seat': { vehicle: 'minivan', seat: true },
    'another zone (Natadola)': { zone: 'Natadola' }, 'tour in the booking': { has_tour: true }, 'custom address': { is_custom_address: true },
  };
  for (const [label, o] of Object.entries(cases)) {
    const without = await (await fresh()).post(pay({ amount: 5, require_quote_match: true, ...o }));
    const withId = await (await fresh()).post(pay({ amount: 5, require_quote_match: true, approved_final_fare_id: ID, ...o }));
    assert.equal(withId.status, without.status, label); assert.equal(withId.body.reference_fare_fjd, without.body.reference_fare_fjd, `${label}: the id must not change the Worker fare`);
  }
  for (const bogus of ['', 'MOMI', 'momi_marriott_minibus_one_way_day', 42, null, { id: ID }]) {
    const r = await (await fresh()).post(pay({ amount: 100, require_quote_match: true, approved_final_fare_id: bogus }));
    assert.equal(r.body.reference_fare_fjd, 157.92, `unknown id ${JSON.stringify(bogus)} is ignored`);
  }
});

test('DAY / NIGHT BOUNDARIES with the id, with and without extras: 21:59 and 06:00 are day (approved totals); 22:00 and 05:59 are night and keep the EXISTING formula (night is on HOLD and is not extended)', async () => {
  const ref = async (time, seat, surf) => (await (await fresh()).post(pay({ amount: 5, require_quote_match: true, approved_final_fare_id: ID, time, seat, surf }))).body.reference_fare_fjd;
  for (const time of ['21:59', '06:00', '10:00']) for (const [seat, surf, want] of APPROVED) assert.equal(await ref(time, seat, surf), want, `${time} seat=${seat} surf=${surf}`);
  const night = { '22:00': [190.1, 197.1, 211.1, 219.1], '05:59': [190.1, 197.1, 211.1, 219.1], '23:00': [190.1, 197.1, 211.1, 219.1] };   // the Worker's existing night arithmetic (formula x1.2, extras, 10% discount) - unchanged, NOT approved
  for (const [time, vals] of Object.entries(night)) for (let i = 0; i < 4; i++) assert.equal(await ref(time, APPROVED[i][0], APPROVED[i][1]), vals[i], `night ${time} #${i}`);
  assert.notDeepEqual([await ref('22:00', false, false)], [211.1], 'the held proposed night totals 211.10 / 219.10 / 235.10 / 243.10 are NOT implemented');
});

test('APPROVED RETURN FIGURES PRESERVED: minibus day return 297 and return + child seat 304 are saved exactly as submitted, with or without the id (the Worker figures 292.45 / 300.45 are in band and never substituted); other return cells unchanged', async () => {
  for (const id of [undefined, ID]) {
    const extra = id ? { approved_final_fare_id: id } : {};
    const a = await (await fresh()).post(pay({ amount: 297, tripType: 'return', require_quote_match: true, ...extra }));
    assert.equal(a.status, 201, JSON.stringify(a.body)); assert.equal(a.saved.quoted_amount, 297); assert.equal(decision(a).calculated_amount_fjd, 292.45);
    const b = await (await fresh()).post(pay({ amount: 304, tripType: 'return', seat: true, require_quote_match: true, ...extra }));
    assert.equal(b.status, 201); assert.equal(b.saved.quoted_amount, 304); assert.equal(decision(b).calculated_amount_fjd, 300.45);
  }
});

test('OLD CALLERS WITHOUT THE ID keep today\'s behaviour exactly: formula + 10% (157.92 / 165.92 / 179.92 / 186.92) is the Worker figure; a legacy submit far from the fare is replaced with the FARE CHECK marker; an old tab quoting the superseded totals is recorded as quoted (NOT repriced - the old-tab exposure is not fixed)', async () => {
  for (const [seat, surf, old] of [[false, false, 157.92], [true, false, 165.92], [false, true, 179.92], [true, true, 186.92]]) {
    const far = await (await fresh()).post(pay({ amount: 5, seat, surf, require_quote_match: true })); assert.equal(far.status, 409); assert.equal(far.body.reference_fare_fjd, old);
    const rig = await fresh(); const tab = await rig.post(pay({ amount: old, seat, surf })); assert.equal(tab.status, 201); assert.equal(tab.saved.quoted_amount, old); assert.equal(decision(tab).outcome, 'matched');
  }
  const rig = await fresh(); const legacy = await rig.post(pay({ amount: 100 })); assert.equal(legacy.saved.quoted_amount, 157.92); assert.equal(decision(legacy).outcome, 'replaced_legacy'); assert.match(alertTexts(rig.all.fetches).join(' | '), /FARE CHECK/);
  const newPageOldWorkerStyle = await (await fresh()).post(pay({ amount: 183.92, seat: true }));   // a NEW page talking to a Worker that does not know the id (deployment order): inside the band, kept as shown
  assert.equal(newPageOldWorkerStyle.saved.quoted_amount, 183.92); assert.equal(decision(newPageOldWorkerStyle).outcome, 'kept_in_band');
});

test('SAME-REFERENCE RETRY with the approved id (with and without extras): the replay returns the SAME booking and fare, creates no second booking, no second short alert, and a stale / superseded amount cannot change it', async () => {
  for (const [seat, surf, want, stale] of [[false, false, 175.92, 157.92], [true, false, 183.92, 165.92], [true, true, 207.92, 186.92]]) {
    const rig = await fresh(); const ref = `FD-MOMI-RETRY-${want}`;
    const first = await rig.post(pay({ amount: want, seat, surf, approved_final_fare_id: ID, require_quote_match: true, client_booking_ref: ref })); assert.equal(first.status, 201);
    const same = await rig.post(pay({ amount: want, seat, surf, approved_final_fare_id: ID, require_quote_match: true, client_booking_ref: ref }));
    assert.equal(same.status, 200); assert.equal(same.body.idempotent, true); assert.equal(same.body.booking_id, first.body.booking_id); assert.equal(same.totalBookings, 1);
    const old = await rig.post(pay({ amount: stale, seat, surf, client_booking_ref: ref })); assert.equal(old.status, 200); assert.equal(old.body.idempotent, true); assert.equal(old.body.booking.quoted_amount, want); assert.equal(old.totalBookings, 1);
    assert.equal(rig.all.fetches.filter((f) => alertTexts([f]).some((t) => /^New booking/.test(t))).length, 1, 'the short alert was sent once');
  }
});
