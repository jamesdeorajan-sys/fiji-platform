// RELEASE-CANDIDATE checks for the P0 #237 repair, run against the BUNDLE a real `wrangler deploy --dry-run` produces (what would ship), over an
// in-memory database seeded from the production pricing snapshot. Every outbound call (WhatsApp/Meta, anything) is recorded and BLOCKED: nothing leaves
// the process. Requirements covered here: 1 (no booking/alert/broadcast on PRICE_MISMATCH), 4 (server side of repeats/retries), 5 (amount + currency agree
// across stored row, response and both admin alerts), 6 (what is recorded, without PII), 8 (what legacy callers still get).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRig, bundleCandidate } from './test-fixtures/rig.mjs';
import { bookingPayload } from './test-fixtures/worker-harness.mjs';
import { installNetworkGuard } from './network_guard.mjs';
installNetworkGuard();

const bundle = bundleCandidate();
const GUEST = { guest_name: 'Zed Testperson', guest_phone: '+61411222333', guest_email: 'zed.testperson@example.invalid' };
const exact = (amount, extra = {}) => ({ ...bookingPayload({ zone: 'Momi Bay', vehicle: 'minibus', tripType: 'return', time: '09:15', seat: true, surf: false, amount }), ...GUEST,
  notes: 'Destination: Fiji Marriott Resort Momi Bay | Trip: Return | Passengers: 7 | Luggage: 7', return_date: '2026-10-19', return_time: '06:00', return_pickup_location: 'Fiji Marriott Resort Momi Bay', ...extra });
const BOOKING_SIDE_EFFECT_TABLES = /(bookings|booking_events|admin_notification_state|driver_broadcast_attempts|escalations|wallet)/i;
const alertTexts = (fetches) => fetches.flatMap((f) => { const comps = f.body && f.body.template && f.body.template.components; return (comps || []).flatMap((c) => c.parameters || []).filter((p) => p.type === 'text').map((p) => p.text); });

test('1. PRICE_MISMATCH creates NO booking, NO admin alert, NO driver broadcast, NO escalation and writes nothing booking-related - for the exact itinerary and every affected route', async () => {
  const cases = [
    exact(142, { require_quote_match: true }),
    bookingPayload({ zone: 'Momi Bay', vehicle: 'minibus', tripType: 'one-way', time: '10:00', seat: false, surf: false, amount: 71 }),
    bookingPayload({ zone: 'Nadi', vehicle: 'sedan', tripType: 'one-way', time: '10:00', seat: false, surf: false, amount: 19 }),
    bookingPayload({ zone: 'Wailoaloa', vehicle: 'sedan', tripType: 'return', time: '10:00', seat: false, surf: false, amount: 67 }),
  ];
  for (const c of cases) {
    const rig = await createRig({ bundle });
    const r = await rig.post({ ...GUEST, ...c, require_quote_match: true });
    assert.equal(r.status, 409, JSON.stringify(c)); assert.equal(r.body.code, 'PRICE_MISMATCH');
    assert.equal(r.totalBookings, 0); assert.equal(r.fetches.length, 0, 'nothing left the process: no alert, no broadcast, no template send');
    assert.equal(r.writes.filter((w) => BOOKING_SIDE_EFFECT_TABLES.test(w)).length, 0, 'no booking-related write: ' + r.writes.join(' ; '));
    assert.equal(rig.all.escalations.length, 0); assert.equal(rig.all.events.length, 0);
    assert.equal(JSON.stringify(r.body).includes(GUEST.guest_phone), false);
  }
});

test('4a. REPEATED mismatches (the guest changes nothing, or the Worker number moves): each is a clean 409, still nothing created; the eventual acceptance creates exactly ONE booking', async () => {
  const rig = await createRig({ bundle });
  const ref = 'FTT-REPEAT1';
  for (const amount of [142, 150, 199]) {
    const r = await rig.post(exact(amount, { require_quote_match: true, client_booking_ref: ref }));
    assert.equal(r.status, 409); assert.equal(r.totalBookings, 0); assert.equal(r.fetches.length, 0);
  }
  const ok = await rig.post(exact(300.45, { require_quote_match: true, revised_from_amount: 199, client_booking_ref: ref }));
  assert.equal(ok.status, 201); assert.equal(ok.totalBookings, 1); assert.equal(ok.saved.quoted_amount, 300.45);
});

test('4b. SAME-REFERENCE RETRY (lost response / timeout): the retry returns the SAME booking - never a second one, never a second alert, never a 409 - even if the retry carries a stale amount', async () => {
  const rig = await createRig({ bundle });
  const ref = 'FTT-RETRY01';
  const first = await rig.post(exact(300.45, { require_quote_match: true, revised_from_amount: 142, client_booking_ref: ref }));
  assert.equal(first.status, 201); const alertsAfterFirst = rig.all.fetches.length; assert.ok(alertsAfterFirst >= 1);
  const same = await rig.post(exact(300.45, { require_quote_match: true, revised_from_amount: 142, client_booking_ref: ref }));
  assert.equal(same.status, 200); assert.equal(same.body.idempotent, true); assert.equal(same.body.booking_id, first.body.booking_id); assert.equal(same.totalBookings, 1);
  const stale = await rig.post(exact(142, { require_quote_match: true, client_booking_ref: ref }));   // a tab that never saw the revision
  assert.equal(stale.status, 200); assert.equal(stale.body.idempotent, true); assert.equal(stale.totalBookings, 1);
  assert.equal(stale.body.booking.quoted_amount, 300.45, 'the saved amount is not changed by a replay');
  assert.equal(rig.all.fetches.filter((f) => alertTexts([f]).some((t) => /New booking/.test(t))).length, 1, 'the short alert was sent once');
});

test('5. On success the STORED amount, the response the guest page shows, and BOTH admin alerts agree on currency and final amount (FJD 300.45)', async () => {
  const rig = await createRig({ bundle });
  const r = await rig.post(exact(300.45, { require_quote_match: true, revised_from_amount: 142, client_booking_ref: 'FTT-AGREE01' }));
  assert.equal(r.status, 201);
  assert.deepEqual([r.saved.quoted_currency, r.saved.quoted_amount, r.saved.settlement_amount_fjd], ['FJD', 300.45, 300.45]);
  assert.deepEqual([r.body.booking.quoted_currency, r.body.booking.quoted_amount], ['FJD', 300.45], 'what the page is told was saved');
  const texts = alertTexts(r.fetches);
  const short = texts.find((t) => /^New booking/.test(t)); const full = texts.find((t) => /^NEW BOOKING/.test(t));
  assert.ok(short && full, 'both the short and the full admin alert were sent');
  assert.match(short, /FJD 300\.45\./); assert.match(full, /Total: FJD 300\.45/);
  for (const t of [short, full]) { assert.equal(/\b(142|135|292\.45|FJ\$)/.test(t), false, 'no other amount: ' + t); assert.equal(/\d\.\d{3,}/.test(t), false, 'no float artefact'); }
  assert.equal(/FARE CHECK/.test(short + full), false, 'a guest who accepted the revised price needs no fare-check flag');
});

test('6. What is RECORDED for each path (submitted, calculated, accepted, reason, pricing version) - and none of it is guest PII', async () => {
  const cases = [
    ['accepted_revised', exact(300.45, { require_quote_match: true, revised_from_amount: 142 }), { submitted: 300.45, calculated: 300.45, accepted: 300.45, original: 142 }],
    ['replaced_legacy', exact(142), { submitted: 142, calculated: 300.45, accepted: 300.45, original: null }],
    ['kept_in_band', bookingPayload({ zone: 'Momi Bay', vehicle: 'sedan', tripType: 'one-way', time: '10:00', seat: false, surf: false, amount: 89 }), { submitted: 89, calculated: 85.29, accepted: 89, original: null }],
    ['matched', bookingPayload({ zone: 'Momi Bay', vehicle: 'sedan', tripType: 'one-way', time: '10:00', seat: false, surf: false, amount: 85.29 }), { submitted: 85.29, calculated: 85.29, accepted: 85.29, original: null }],
  ];
  for (const [outcome, payload, want] of cases) {
    const rig = await createRig({ bundle });
    const r = await rig.post({ ...GUEST, ...payload });
    assert.equal(r.status, 201, outcome);
    const d = r.events.find((e) => e.event_type === 'created').metadata.pricing_decision;
    assert.equal(d.outcome, outcome);
    assert.deepEqual([d.submitted_amount_fjd, d.calculated_amount_fjd, d.accepted_amount_fjd, d.original_shown_amount_fjd], [want.submitted, want.calculated, want.accepted, want.original], outcome);
    assert.equal(d.currency, 'FJD'); assert.ok(d.reason); assert.match(d.pricing_version, /^nat-formula-v1\|(minibus|sedan)\|flag[\d.]+\|rate[\d.]+\|zm1\|ret1\.85\|night0\.2\|disc0\.1\|band0\.8-1\.3$/);
    const recorded = JSON.stringify(r.events.map((e) => e.metadata));
    for (const pii of [GUEST.guest_name, 'Testperson', GUEST.guest_phone, '411222333', GUEST.guest_email, 'Marriott Resort', 'Passengers: 7']) assert.equal(recorded.includes(pii), false, `${outcome}: ${pii}`);
  }
});

test('8. LEGACY callers (no opt-in: cached/open old pages, FijiDash): the booking is still saved (nothing lost) at the Worker number, the adjustment is recorded, and STAFF are told in both alerts that the guest was shown a different amount', async () => {
  const rig = await createRig({ bundle });
  const r = await rig.post({ ...GUEST, ...exact(142), client_booking_ref: 'FTT-LEGACY1' });
  assert.equal(r.status, 201); assert.equal(r.saved.quoted_amount, 300.45);
  assert.equal(r.events.find((e) => e.event_type === 'created').metadata.pricing_adjustment.submitted_amount_fjd, 142);
  const texts = alertTexts(r.fetches); const short = texts.find((t) => /^New booking/.test(t)); const full = texts.find((t) => /^NEW BOOKING/.test(t));
  assert.match(short, /FJD 300\.45\. FARE CHECK: guest was shown FJD 142\.00\./); assert.match(full, /Total: FJD 300\.45 \| FARE CHECK: guest was shown FJD 142\.00, saved 300\.45 - confirm the fare with the guest/);
  for (const t of [short, full]) assert.equal(/[\r\n\t]|\s{5,}/.test(t), false, 'still valid for a WhatsApp template parameter (no newline/tab/5 spaces)');
});

test('UNCHANGED route: a route whose page and Worker fares agree is untouched - saved = submitted, no 409, no flag, no adjustment', async () => {
  const rig = await createRig({ bundle });
  const r = await rig.post({ ...GUEST, ...bookingPayload({ zone: 'Denarau', vehicle: 'sedan', tripType: 'one-way', time: '10:00', seat: false, surf: false, amount: 49 }), require_quote_match: true });
  assert.equal(r.status, 201); assert.equal(r.saved.quoted_amount, 49);
  assert.equal(r.events.find((e) => e.event_type === 'created').metadata.pricing_adjustment, undefined);
  assert.equal(/FARE CHECK/.test(alertTexts(r.fetches).join(' ')), false);
});
