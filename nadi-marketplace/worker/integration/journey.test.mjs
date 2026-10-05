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

const FOUR = [['none', {}, 175.92], ['child seat', { seat: true }, 183.92], ['surfboard', { surf: true }, 199.92], ['both', { seat: true, surf: true }, 207.92]];
const SUPERSEDED = [157.92, 165.92, 179.92, 186.92];

test('NEW pages + NEW Worker: each of the FOUR approved daytime totals (175.92 / 183.92 / 199.92 / 207.92) is shown at selection AND review, submitted, saved, returned and alerted exactly, on NAT and FijiDash (no double discount); return 297 and return + child seat 304 preserved', { skip }, async () => {
  const S = srcs();
  for (const [site, src] of [['nat', S.natNew], ['fd', S.fdNew]]) {
    for (const [label, o, want] of FOUR) {
      const w = await worker(NEW_DIR); const j = await journey({ site, src, w, o });
      assert.deepEqual([j.selection, j.review], [want, want], `${site} ${label} selection/review`);
      if (site === 'fd') assert.equal(j.referenceFare, 175.92, 'the legacy pre-discount reference fare (no extras) is 175.92; the second discount is prevented by the approved-final-fare branch, not by this equality');
      assert.equal(j.submitted, want, `${site} ${label} submitted`); assert.equal(j.approvedId, 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY'); assert.equal(j.status, 201);
      assert.equal(w.saved().quoted_amount, want); assert.equal(w.saved().settlement_amount_fjd, want); assert.equal(w.decision().outcome, 'matched'); assert.equal(w.decision().reason, 'approved_final_fare'); assert.equal(w.decision().calculated_amount_fjd, want);
      assert.equal(j.responseAmount, want, 'the Worker response carries the saved amount');
      if (site === 'nat') assert.equal(j.result.savedAmount, want, 'NAT shows the saved amount from the response');
      const alerts = w.alertTexts().join(' | '); assert.match(alerts, new RegExp(String(want).replace('.', '\\.'))); assert.doesNotMatch(alerts, /FARE CHECK/);
      for (const old of SUPERSEDED) assert.doesNotMatch(alerts, new RegExp(String(old).replace('.', '\\.')), `${site} ${label}: no alert carries the superseded ${old}`);
    }
    for (const [name, want] of [['return', 297], ['returnSeat', 304]]) {
      const w2 = await worker(NEW_DIR); const r = await journey({ site, src, w: w2, o: CASES[name].o });
      assert.equal(r.submitted, want, `${site} ${name} submitted`); assert.equal(w2.saved().quoted_amount, want, `${site} ${name} saved`); assert.equal(r.approvedId, undefined);
    }
  }
});

test('MIXED VERSIONS / OLD TABS with extras: new pages + OLD Worker save the approved total anyway (kept in band, 0.8x-1.3x); OLD pages / tabs (NAT c5ee3b1, FijiDash 8c6f920) + NEW Worker keep recording the superseded 157.92 / 165.92 / 179.92 / 186.92 - nothing is repriced silently in either direction, and the old-tab shortfall (18.00 / 18.00 / 20.00 / 21.00) is NOT fixed', { skip }, async () => {
  const S = srcs();
  for (const [site, src] of [['nat', S.natNew], ['fd', S.fdNew]]) for (const [label, o, want] of FOUR) {      // page first, Worker not yet updated
    const w = await worker(process.env.WORKER_OLD_DIR); const j = await journey({ site, src, w, o });
    assert.equal(j.submitted, want, `${site} ${label}`); assert.equal(w.saved().quoted_amount, want); assert.equal(w.decision().outcome, 'kept_in_band');
  }
  for (const [site, src] of [['nat', S.natOld], ['fd', S.fdOld]]) for (const [i, [label, o, want]] of FOUR.entries()) {   // Worker first, old page/tab still open
    const w = await worker(NEW_DIR); const j = await journey({ site, src, w, o });
    assert.equal(j.review, SUPERSEDED[i], `${site} released page review ${label}`); assert.equal(j.submitted, SUPERSEDED[i]); assert.equal(j.approvedId, undefined); assert.equal(w.saved().quoted_amount, SUPERSEDED[i]); assert.equal(w.decision().outcome, 'matched');
    assert.equal(Math.round((want - w.saved().quoted_amount) * 100) / 100, [18, 18, 20, 21][i], 'old-tab shortfall vs the approved total (exposure not fixed)');
  }
  const wn = await worker(NEW_DIR); const jn = await journey({ site: 'nat', src: S.natOld, w: wn });
  assert.equal(jn.selection, 157.92, 'NAT released selection'); const wf = await worker(NEW_DIR); const jf = await journey({ site: 'fd', src: S.fdOld, w: wf }); assert.equal(jf.selection, 71, 'FijiDash released selection (catalogue 79 less 10%)');
});

test('NIGHT ON HOLD - existing behaviour reported, nothing extended (24 night totals are NOT the proposed 211.10 / 219.10 / 235.10 / 243.10): NAT night one-way 193 / 201 / 215 / 222; FijiDash selection 193 but review and saved 157.92 / 165.92 / 179.92 / 186.92 (below the approved daytime totals - UNRESOLVED)', { skip }, async () => {
  const S = srcs(); const rec = {};
  for (const [site, src] of [['nat', S.natNew], ['fd', S.fdNew]]) for (const [label, o] of FOUR) {
    const w = await worker(NEW_DIR); const j = await journey({ site, src, w, o: { ...o, time: '23:00' } }); rec[site + ':' + label] = [j.selection, j.review, j.submitted, w.saved().quoted_amount]; assert.equal(j.approvedId, undefined, 'no approved id at night');
  }
  assert.deepEqual(['none', 'child seat', 'surfboard', 'both'].map((l) => rec['nat:' + l][3]), [193, 201, 215, 222]);
  assert.deepEqual(['none', 'child seat', 'surfboard', 'both'].map((l) => rec['fd:' + l][3]), [157.92, 165.92, 179.92, 186.92]);
  assert.deepEqual(rec['fd:none'], [193, 157.92, 157.92, 157.92], 'FijiDash: static selection 193, the live-fare review drops the night modifier (existing behaviour, B1 in the pricing review)');
  assert.ok(rec['fd:none'][3] < 175.92);
  for (const l of ['none', 'child seat', 'surfboard', 'both']) for (const v of [211.1, 219.1, 235.1, 243.1]) assert.notEqual(rec['nat:' + l][3], v);
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
