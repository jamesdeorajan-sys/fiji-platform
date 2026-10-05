// PRICE INVERSIONS in the Momi minibus candidate (release blockers, found by the 16-cell grid): a total that goes DOWN when it should not.
//   I1  adding a child seat / surfboard LOWERS the one-way daytime total (175.92 -> 165.92 / 179.92 is fine but 165.92 < 175.92): the approved final fare is exempt from the standard discount, extras are not.
//   I2  the FijiDash night one-way review (157.92) is BELOW the approved daytime fare (175.92): the live-fare review drops the night modifier and the normal discount applies.
// Each is pinned twice: a PASSING characterisation of today's (candidate) behaviour, and a visible TODO invariant that will start passing only when James decides the extras and night rules
// (decision table: MOMI-DECISION-TABLE.md). Invariants that already hold (returns, extras on returns, night on returns) are real, passing tests. Nothing is implemented for the TODOs.
// Environment as journey.test.mjs. Isolated; outbound blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_DIR, skip, worker, journey, srcs } from './harness.mjs';
console.warn = () => {};
const PENDING = 'RELEASE BLOCKER - owner decision pending (extras / night rules for the approved Momi minibus final fare); will pass once the decision is implemented';
const saved = async (site, src, o) => { const w = await worker(NEW_DIR); await journey({ site, src, w, o }); return w.saved().quoted_amount; };
const calc = async (o) => { const w = await worker(NEW_DIR); const r = await w.post({ guest_name: 'Zed Testperson', guest_phone: '+61411222333', client_booking_ref: 'INV-' + Math.random().toString(36).slice(2, 8), pickup_zone: 'Nadi Airport', destination_zone: 'Momi Bay', vehicle_type: 'minibus', quoted_currency: 'FJD', quoted_amount: 5, fx_rate_at_booking: 1, distance_km: 38.623, payment_method: 'cash', pickup_date: '2026-10-20', pickup_time: o.time || '10:00', trip_type: o.trip || 'one-way', has_child_seat: !!o.seat, has_surfboard: !!o.surf, has_tour: false, is_custom_address: false, require_quote_match: true, approved_final_fare_id: 'MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY', ...(o.trip === 'return' ? { return_date: '2026-10-27', return_time: '10:00', return_pickup_location: 'Hotel' } : {}) }); return r.body.reference_fare_fjd; };
const SITES = (S) => [['NAT candidate', 'nat', S.natNew], ['FijiDash candidate', 'fd', S.fdNew]];

test('CHARACTERISATION I1 (today, candidate): child seat / surfboard / both on the daytime one-way give 165.92 / 179.92 / 186.92 on NAT, FijiDash and the Worker - the seat total is LOWER than the approved 175.92', { skip }, async () => {
  const S = srcs();
  for (const [, site, src] of SITES(S)) { assert.equal(await saved(site, src, {}), 175.92); assert.equal(await saved(site, src, { seat: true }), 165.92); assert.equal(await saved(site, src, { surf: true }), 179.92); assert.equal(await saved(site, src, { seat: true, surf: true }), 186.92); }
  assert.deepEqual([await calc({}), await calc({ seat: true }), await calc({ surf: true }), await calc({ seat: true, surf: true })], [175.92, 165.92, 179.92, 186.92]);
});
test('CHARACTERISATION I2 (today, candidate): FijiDash night one-way is quoted 193 at selection but reviewed and saved 157.92 - below the approved daytime 175.92; NAT quotes 193, the Worker formula 190.10', { skip }, async () => {
  const S = srcs(); const wf = await worker(NEW_DIR); const j = await journey({ site: 'fd', src: S.fdNew, w: wf, o: { time: '23:00' } });
  assert.deepEqual([j.selection, j.review, wf.saved().quoted_amount], [193, 157.92, 157.92]);
  assert.equal(await saved('nat', S.natNew, { time: '23:00' }), 193); assert.equal(await calc({ time: '23:00' }), 190.1);
});

test('INVARIANT I1: extras never lower the daytime one-way total (NAT, FijiDash, Worker)', { skip, todo: PENDING }, async () => {
  const S = srcs();
  for (const [name, site, src] of SITES(S)) { const base = await saved(site, src, {}); for (const o of [{ seat: true }, { surf: true }, { seat: true, surf: true }]) assert.ok((await saved(site, src, o)) >= base, `${name} ${JSON.stringify(o)}`); }
  const base = await calc({}); for (const o of [{ seat: true }, { surf: true }, { seat: true, surf: true }]) assert.ok((await calc(o)) >= base, `Worker ${JSON.stringify(o)}`);
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
