// P0 booking #237 (FTT-UKAZTE): the guest saw FJ$142 and the saved/notified amount was FJ$300.45.
// Cause (reproduced below against the DEPLOYED Worker 2125a34 with the real production pricing snapshot): the page quoted the published table
// (minibus FJ$79 -> return 150 + child seat 8 - 10% = 142); the Worker's own formula says 300.45 (175.92 x 1.85 + 8 - 33). 142 is outside the
// 0.8x-1.3x band (240.36-390.59), so the Worker SILENTLY replaced it with 300.45 and saved/notified that. The guest was never told.
// Repair: a client that sends require_quote_match:true is NEVER silently repriced - it gets a 409 PRICE_MISMATCH carrying the Worker's number,
// nothing is saved or sent, and the guest must accept that number. Server-side validation is unchanged (the same band, the same formula).
// Clients that do not send the flag (cached old pages, FijiDash) keep today's behaviour, but the adjustment is now RECORDED on the created event.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postBooking, bookingPayload } from './test-fixtures/worker-harness.mjs';
import { installNetworkGuard } from './network_guard.mjs';
installNetworkGuard();
const DIR = path.dirname(fileURLToPath(import.meta.url));

// the exact itinerary: NAN -> Momi Bay, minibus, return, outbound 09:15, child seat
const EXACT = { zone: 'Momi Bay', vehicle: 'minibus', tripType: 'return', time: '09:15', seat: true, surf: false };
const exactPayload = (amount, extra = {}) => ({ ...bookingPayload({ ...EXACT, amount }), return_date: '2026-10-19', return_time: '06:00', return_pickup_location: 'Fiji Marriott Resort Momi Bay', ...extra });

test('CONTROL (deployed behaviour, reproduces #237): FJ$142 submitted -> the Worker silently saves FJ$300.45, with no flag that the guest amount was changed', async () => {
  const r = await postBooking(DIR, exactPayload(142));
  assert.equal(r.status, 201);
  assert.equal(r.saved.quoted_amount, 300.45);
  assert.equal(r.saved.settlement_amount_fjd, 300.45);
  assert.equal(r.body.booking.quoted_amount, 300.45, 'the response carries the saved row, but nothing flags that it differs from what was submitted');
  assert.equal(r.body.code, undefined); assert.equal(r.body.pricing_adjusted, undefined);
});

test('REPAIR: with require_quote_match the same submission is NOT repriced - 409 PRICE_MISMATCH with the Worker number, nothing saved, no alert, no escalation', async () => {
  const r = await postBooking(DIR, exactPayload(142, { require_quote_match: true }));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.ok, false); assert.equal(r.body.code, 'PRICE_MISMATCH');
  assert.equal(r.body.reference_fare_fjd, 300.45); assert.equal(r.body.submitted_amount_fjd, 142);
  assert.ok(Array.isArray(r.body.errors) && r.body.errors.length > 0, 'a plain sentence for clients that only read errors[]');
  assert.equal(r.saved, null, 'no booking row, so no driver broadcast and no staff alert');
  assert.equal(r.escalations.length, 0);
  assert.equal(r.events.length, 0);
});

test('REPAIR: accepting the Worker number succeeds and saves exactly what the guest accepted', async () => {
  const r = await postBooking(DIR, exactPayload(300.45, { require_quote_match: true }));
  assert.equal(r.status, 201); assert.equal(r.saved.quoted_amount, 300.45);
  assert.ok(!(r.events[0].metadata && r.events[0].metadata.pricing_adjustment), 'nothing was adjusted');
});

test('REPAIR: an in-band difference is unchanged (the guest number is kept) and what is saved equals what was submitted', async () => {
  const p = (extra) => ({ ...bookingPayload({ zone: 'Momi Bay', vehicle: 'sedan', tripType: 'one-way', time: '10:00', seat: false, surf: false, amount: 89 }), ...extra });
  const flagged = await postBooking(DIR, p({ require_quote_match: true }));
  assert.equal(flagged.status, 201); assert.equal(flagged.saved.quoted_amount, 89);
});

test('VALIDATION PRESERVED: with the flag a tampered amount (too low or too high) is refused with the Worker number; it can never be saved as submitted', async () => {
  for (const amount of [1, 100, 239, 391, 5000]) {
    const r = await postBooking(DIR, exactPayload(amount, { require_quote_match: true }));
    assert.equal(r.status, 409, String(amount)); assert.equal(r.body.reference_fare_fjd, 300.45); assert.equal(r.saved, null);
  }
  const absurd = await postBooking(DIR, exactPayload(99999, { require_quote_match: true }));
  assert.equal(absurd.saved, null, 'an absurd amount is refused by the existing bounds check');
  for (const amount of [240.37, 300.45, 390.58]) {
    const r = await postBooking(DIR, exactPayload(amount, { require_quote_match: true }));
    assert.equal(r.status, 201, String(amount)); assert.equal(r.saved.quoted_amount, amount, 'in-band: saved = submitted');
  }
});

test('LEGACY clients (no flag: cached old pages, FijiDash) keep the current save - but the silent change is now RECORDED on the created event', async () => {
  const r = await postBooking(DIR, exactPayload(142));
  assert.equal(r.status, 201); assert.equal(r.saved.quoted_amount, 300.45);
  const adj = r.events[0].metadata && r.events[0].metadata.pricing_adjustment;
  assert.ok(adj, 'the adjustment is retained');
  assert.deepEqual([adj.submitted_amount_fjd, adj.saved_amount_fjd], [142, 300.45]);
  assert.deepEqual([adj.band_low_fjd, adj.band_high_fjd], [240.36, 390.585]); assert.ok(142 < adj.band_low_fjd, 'the submitted amount was below the band');
  const ok = await postBooking(DIR, exactPayload(300.45));
  assert.ok(!(ok.events[0].metadata && ok.events[0].metadata.pricing_adjustment));
});

test('EVERY published route the page can currently misquote outside the band is caught: with the flag the guest is told, never silently repriced', async () => {
  // from the offline sweep of the live page against this Worker: Nadi sedan one-way (19 vs 30.15), Wailoaloa sedan return (67 vs 50.17), Marriott Momi minibus
  const cases = [
    ['Nadi', 'sedan', 'one-way', 19, 30.15], ['Wailoaloa', 'sedan', 'return', 67, 50.17], ['Momi Bay', 'minibus', 'one-way', 71, 157.92], ['Momi Bay', 'minibus', 'return', 135, 292.45],
  ];
  for (const [zone, vehicle, tripType, shown, reference] of cases) {
    const base = bookingPayload({ zone, vehicle, tripType, time: '10:00', seat: false, surf: false, amount: shown });
    const legacy = await postBooking(DIR, base);
    assert.equal(legacy.status, 201); assert.equal(legacy.saved.quoted_amount, reference, `${zone} ${vehicle} ${tripType} is silently repriced today`);
    const flagged = await postBooking(DIR, { ...base, require_quote_match: true });
    assert.equal(flagged.status, 409, `${zone} ${vehicle} ${tripType}`); assert.equal(flagged.body.reference_fare_fjd, reference); assert.equal(flagged.saved, null);
    const accepted = await postBooking(DIR, { ...base, quoted_amount: reference, require_quote_match: true });
    assert.equal(accepted.status, 201); assert.equal(accepted.saved.quoted_amount, reference);
  }
});
