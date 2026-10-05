// PRICE INVERSIONS in the Momi minibus candidate, updated for James's extras approval (2026-10-05: daytime one-way extras FJ$183.92 / 199.92 / 207.92, NO further discount).
//   I1  adding a child seat / surfboard used to LOWER the one-way daytime total (165.92 < 175.92). Now a PASSING regression (day and night, every component).
//   I2  the FijiDash night one-way review (157.92) is BELOW the approved daytime fare. NIGHT IS ON HOLD: no night policy is approved, so this stays characterised + a visible TODO invariant.
// Invariants that already hold (returns, extras on returns, night on returns) remain real, passing tests. Environment as journey.test.mjs. Isolated; outbound blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_DIR, skip, worker, journey, srcs } from './harness.mjs';
console.warn = () => {};
const PENDING = 'night policy ON HOLD (James, 2026-10-05) - not approved, not implemented; will pass only when a night policy is approved and implemented';
const saved = async (site, src, o) => { const w = await worker(NEW_DIR); await journey({ site, src, w, o }); return w.saved().quoted_amount; };
const calc = async (o) => { const w = await worker(NEW_DIR); const r = await w.post({ guest_name: 'Zed Testperson', guest_phone: '+61411222333', client_booking_ref: 'INV-' + Math.random().toString(36).slice(2, 8), pickup_zone: 'Nadi Airport', destination_zone: 'Momi Bay', vehicle_type: 'minibus', quoted_currency: 'FJD', quoted_amount: 5, fx_rate_at_booking: 1, distance_km: 38.623, payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: o.time || '10:00', trip_type: o.trip || 'one-way', has_child_seat: !!o.seat, has_surfboard: !!o.surf, has_tour: false, is_custom_address: false, require_quote_match: true, approved_final_fare_id: 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY', ...(o.trip === 'return' ? { return_date: '2026-10-27', return_time: '10:00', return_pickup_location: 'Hotel' } : {}) }); return r.body.reference_fare_fjd; };
const SITES = (S) => [['NAT candidate', 'nat', S.natNew], ['FijiDash candidate', 'fd', S.fdNew]];
const X = [{}, { seat: true }, { surf: true }, { seat: true, surf: true }];

test('INVARIANT I1 (PASSING REGRESSION, was the release blocker): adding extras never lowers the one-way total - day AND night, NAT (saved), FijiDash (saved, i.e. after review) and the Worker; and the daytime totals are exactly 175.92 / 183.92 / 199.92 / 207.92 everywhere', { skip }, async () => {
  const S = srcs();
  for (const [name, site, src] of SITES(S)) {
    for (const time of ['10:00', '21:59', '06:00', '22:00', '23:00', '05:59']) { const v = []; for (const x of X) v.push(await saved(site, src, { ...x, time })); assert.ok(v[0] <= v[1] && v[1] <= v[3] && v[0] <= v[2] && v[2] <= v[3], `${name} ${time}: ${v}`); }
    for (const time of ['10:00', '21:59', '06:00']) { const v = []; for (const x of X) v.push(await saved(site, src, { ...x, time })); assert.deepEqual(v, [175.92, 183.92, 199.92, 207.92], `${name} ${time}`); }
  }
  for (const time of ['10:00', '21:59', '06:00', '22:00', '23:00', '05:59']) { const v = []; for (const x of X) v.push(await calc({ ...x, time })); assert.ok(v[0] <= v[1] && v[1] <= v[3] && v[0] <= v[2] && v[2] <= v[3], `Worker ${time}: ${v}`); }
  for (const time of ['10:00', '21:59', '06:00']) assert.deepEqual([await calc({ time }), await calc({ time, seat: true }), await calc({ time, surf: true }), await calc({ time, seat: true, surf: true })], [175.92, 183.92, 199.92, 207.92], `Worker ${time}`);
});
test('CHARACTERISATION I2 (night on HOLD, UNRESOLVED): FijiDash night one-way is quoted 193 at selection but reviewed and saved 157.92 (165.92 / 179.92 / 186.92 with extras) - below the approved daytime totals; NAT quotes 193 / 201 / 215 / 222; the Worker formula says 190.10 / 197.10 / 211.10 / 219.10. Existing behaviour, not changed', { skip }, async () => {
  const S = srcs(); const wf = await worker(NEW_DIR); const j = await journey({ site: 'fd', src: S.fdNew, w: wf, o: { time: '23:00' } });
  assert.deepEqual([j.selection, j.review, wf.saved().quoted_amount], [193, 157.92, 157.92]);
  assert.deepEqual([await saved('fd', S.fdNew, { time: '23:00', seat: true }), await saved('fd', S.fdNew, { time: '23:00', surf: true }), await saved('fd', S.fdNew, { time: '23:00', seat: true, surf: true })], [165.92, 179.92, 186.92]);
  assert.deepEqual([await saved('nat', S.natNew, { time: '23:00' }), await saved('nat', S.natNew, { time: '23:00', seat: true }), await saved('nat', S.natNew, { time: '23:00', surf: true }), await saved('nat', S.natNew, { time: '23:00', seat: true, surf: true })], [193, 201, 215, 222]);
  assert.deepEqual([await calc({ time: '23:00' }), await calc({ time: '23:00', seat: true }), await calc({ time: '23:00', surf: true }), await calc({ time: '23:00', seat: true, surf: true })], [190.1, 197.1, 211.1, 219.1]);
});
test('INVARIANT I2: night is never below day for the approved one-way (NAT, FijiDash review, Worker)', { skip, todo: PENDING }, async () => {
  const S = srcs();
  for (const [name, site, src] of SITES(S)) assert.ok((await saved(site, src, { time: '23:00' })) >= (await saved(site, src, {})), name);
  assert.ok((await calc({ time: '23:00' })) >= (await calc({})), 'Worker');
});

test('INVARIANTS that hold today (real tests): returns are never below one-way, extras never lower a RETURN total, night is never below day for RETURNS - on NAT, FijiDash and the Worker (day and night, all extras)', { skip }, async () => {
  const S = srcs(); const X = [{}, { seat: true }, { surf: true }, { seat: true, surf: true }];
  for (const [name, site, src] of SITES(S)) {
    for (const time of ['10:00', '23:00']) for (const x of X) assert.ok((await saved(site, src, { ...x, time, trip: 'return' })) >= (await saved(site, src, { ...x, time })), `${name} return >= one-way ${time} ${JSON.stringify(x)}`);
    for (const time of ['10:00', '23:00']) { const b = await saved(site, src, { time, trip: 'return' }); for (const x of X.slice(1)) assert.ok((await saved(site, src, { ...x, time, trip: 'return' })) >= b, `${name} return extras ${time}`); }
    for (const x of X) assert.ok((await saved(site, src, { ...x, time: '23:00', trip: 'return' })) >= (await saved(site, src, { ...x, trip: 'return' })), `${name} return night >= day ${JSON.stringify(x)}`);
  }
  assert.equal(await saved('nat', S.natNew, { trip: 'return' }), 297); assert.equal(await saved('fd', S.fdNew, { trip: 'return' }), 297); assert.equal(await saved('nat', S.natNew, { trip: 'return', seat: true }), 304); assert.equal(await saved('fd', S.fdNew, { trip: 'return', seat: true }), 304);
});
