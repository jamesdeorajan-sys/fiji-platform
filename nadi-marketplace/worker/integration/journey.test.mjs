// Cross-component journey: catalogue -> selection -> reference fare -> review -> submitted amount -> saved amount -> response -> admin/driver alerts, for the approved Momi minibus FINAL-fare
// change. Required environment (paths to the exact source files under review): NAT_NEW_APP_JS, FD_NEW_APP_JS, NAT_OLD_APP_JS, FD_OLD_APP_JS (released c5ee3b1 / 8c6f920), WORKER_OLD_DIR (0b961a4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_DIR, skip, worker, journey, srcs } from './harness.mjs';
console.warn = () => {};
const CASES = {
  exact: { o: {} }, return: { o: { trip: 'return' } }, returnSeat: { o: { trip: 'return', seat: true } },
  oneWaySeat: { o: { seat: true } }, night: { o: { time: '23:00' } },
};

test('NEW pages + NEW Worker: the exact journey shows, submits, saves, responds and alerts FJ$175.92 end to end (no double discount); return 297 and return + child seat 304 preserved', { skip }, async () => {
  const S = srcs();
  for (const [site, src] of [['nat', S.natNew], ['fd', S.fdNew]]) {
    const w = await worker(NEW_DIR); const j = await journey({ site, src, w });
    assert.deepEqual([j.selection, j.review], [175.92, 175.92], `${site} selection/review`);
    if (site === 'fd') assert.equal(j.referenceFare, 175.92, 'the LEGACY pre-discount reference fare happens to equal 175.92 for this journey; the second discount is prevented by the approved-final-fare branch (calculateTotal), not by this equality');
    assert.equal(j.submitted, 175.92); assert.equal(j.approvedId, 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY'); assert.equal(j.status, 201);
    assert.equal(w.saved().quoted_amount, 175.92); assert.equal(w.saved().settlement_amount_fjd, 175.92); assert.equal(w.decision().outcome, 'matched'); assert.equal(w.decision().reason, 'approved_final_fare');
    assert.equal(j.responseAmount, 175.92, 'the Worker response carries the saved amount');
    if (site === 'nat') assert.equal(j.result.savedAmount, 175.92, 'NAT shows the saved amount from the response (FijiDash production does not display it; that is in the held candidate)');
    const alerts = w.alertTexts().join(' | '); assert.match(alerts, /175\.92/); assert.doesNotMatch(alerts, /157\.92/); assert.doesNotMatch(alerts, /FARE CHECK/);
    for (const [name, want] of [['return', 297], ['returnSeat', 304]]) {
      const w2 = await worker(NEW_DIR); const r = await journey({ site, src, w: w2, o: CASES[name].o });
      assert.equal(r.submitted, want, `${site} ${name} submitted`); assert.equal(w2.saved().quoted_amount, want, `${site} ${name} saved`); assert.equal(r.approvedId, undefined);
    }
  }
});

test('DEPLOYMENT-ORDER MATRIX: new pages with the OLD Worker still save 175.92 (kept in band); old pages (NAT c5ee3b1, FijiDash 8c6f920) with the NEW Worker keep recording the superseded 157.92 - nothing is repriced silently in either direction', { skip }, async () => {
  const S = srcs();
  for (const [site, src] of [['nat', S.natNew], ['fd', S.fdNew]]) {            // page first, Worker not yet updated
    const w = await worker(process.env.WORKER_OLD_DIR); const j = await journey({ site, src, w });
    assert.equal(j.submitted, 175.92); assert.equal(w.saved().quoted_amount, 175.92); assert.equal(w.decision().outcome, 'kept_in_band');
  }
  for (const [site, src, expectSelection] of [['nat', S.natOld, 157.92], ['fd', S.fdOld, 71]]) {   // Worker first, old page/tab still open
    const w = await worker(NEW_DIR); const j = await journey({ site, src, w });
    assert.equal(j.selection, expectSelection, `${site} released page selection`); assert.equal(j.review, 157.92, `${site} released page review`);
    assert.equal(j.submitted, 157.92); assert.equal(j.approvedId, undefined); assert.equal(w.saved().quoted_amount, 157.92); assert.equal(w.decision().outcome, 'matched');
  }
});

test('NOT NEWLY APPROVED - interactions reported, nothing extended: one-way + child seat and the FijiDash night review are LOWER than the approved daytime 175.92; NAT night / seat follow the existing arithmetic', { skip }, async () => {
  const S = srcs(); const rec = {};
  for (const [site, src] of [['nat', S.natNew], ['fd', S.fdNew]]) for (const name of ['oneWaySeat', 'night']) {
    const w = await worker(NEW_DIR); const j = await journey({ site, src, w, o: CASES[name].o }); rec[`${site}:${name}`] = [j.selection, j.review, j.submitted, w.saved() && w.saved().quoted_amount];
  }
  assert.deepEqual(rec['nat:oneWaySeat'], [165.92, 165.92, 165.92, 165.92]); assert.deepEqual(rec['fd:oneWaySeat'], [165.92, 165.92, 165.92, 165.92]);
  assert.deepEqual(rec['nat:night'], [193, 193, 193, 193]);
  assert.deepEqual(rec['fd:night'], [193, 157.92, 157.92, 157.92], 'FijiDash: static selection 193, the live-fare review drops the night modifier -> 157.92 (existing behaviour, release blocker B1 in the pricing review)');
  assert.ok(rec['fd:night'][3] < 175.92 && rec['nat:oneWaySeat'][3] < 175.92);
});

test('SAME-REFERENCE RETRY and OLD-CALLER PROTECTIONS against the new Worker: a replay returns the same booking (no second booking, no second short alert), and a legacy caller far from the fare is still replaced with the FARE CHECK marker', { skip }, async () => {
  const w = await worker(NEW_DIR); const S = srcs();
  const j = await journey({ site: 'nat', src: S.natNew, w }); assert.equal(j.status, 201); const first = w.h.inserted.length;
  const replay = await w.post({ ...w.h.inserted[0], client_booking_ref: j.ref, guest_name: 'Zed Testperson', guest_phone: '+61411222333', pickup_zone: 'Nadi Airport', destination_zone: 'Momi Bay', vehicle_type: 'minibus', quoted_currency: 'FJD', quoted_amount: 157.92, fx_rate_at_booking: 1, payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: '10:00', trip_type: 'one-way', has_child_seat: false, has_surfboard: false, has_tour: false, is_custom_address: false });
  assert.equal(replay.body.idempotent, true); assert.equal(w.h.inserted.length, first); assert.equal(replay.body.booking.quoted_amount, 175.92, 'a stale amount cannot change the saved fare');
  assert.equal(w.alertTexts().filter((t) => /^New booking/.test(t)).length, 1, 'one short staff alert for the booking');
  const legacy = await worker(NEW_DIR);
  const lr = await legacy.post({ guest_name: 'Zed Testperson', guest_phone: '+61411222333', client_booking_ref: 'LEGACY-1', pickup_zone: 'Nadi Airport', destination_zone: 'Momi Bay', vehicle_type: 'minibus', quoted_currency: 'FJD', quoted_amount: 40, fx_rate_at_booking: 1, payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: '10:00', trip_type: 'one-way', has_child_seat: false, has_surfboard: false, has_tour: false, is_custom_address: false });
  assert.equal(lr.status, 201); assert.equal(legacy.saved().quoted_amount, 157.92, 'a legacy caller without the id is repriced to the unchanged formula figure'); assert.match(legacy.alertTexts().join(' | '), /FARE CHECK/);
});
