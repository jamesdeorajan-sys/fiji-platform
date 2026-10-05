// RELEASE BLOCKER evidence (night pricing), actual client code + actual deployed Worker together. CHARACTERIZATION ONLY: no commercial rule is changed or approved here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, routesOf, newEnv, runCase } from './reconciliation/lib.mjs';

const env = await newEnv();
const cand = SOURCES['fd-cand'](); const prod = SOURCES['fd-prod']();
const hilton = (src) => routesOf(src).find((r) => r.destValue === 'HILTON_DENARAU');
const go = (variant, src, time, trip = 'one-way', returnTime = '10:00') => runCase(env, { variant, src, row: hilton(src), vehicle: 'sedan', trip, time, returnTime, seat: false, optIn: variant !== 'fd-prod' });

test('boundaries: client and Worker agree on what is night (22:00 and 05:59 are night; 21:59 and 06:00 are day)', async () => {
  const w = {}; for (const t of ['21:59', '22:00', '05:59', '06:00']) w[t] = (await go('fd-cand', cand, t)).worker;
  assert.equal(w['21:59'], 47.87); assert.equal(w['06:00'], 47.87);
  assert.equal(w['22:00'], 51.44); assert.equal(w['05:59'], 51.44);         // Worker: x1.2 on the transfer, then the 10% discount
});
test('REPRODUCED: on a live-fare route the amount shown at selection, shown at review, submitted and SAVED is the day fare at every one of the four times (FijiDash production and candidate alike)', async () => {
  for (const [variant, src] of [['fd-prod', prod], ['fd-cand', cand]]) for (const t of ['21:59', '22:00', '05:59', '06:00']) {
    const r = await go(variant, src, t);
    assert.equal(r.review, 47.87, `${variant} ${t} review`); assert.equal(r.submitted, 47.87); assert.equal(r.saved, 47.87, `${variant} ${t} saved`);
    if (variant === 'fd-cand') assert.equal(r.selection, 47.87, 'candidate selection mirrors review');
    if (t === '22:00' || t === '05:59') { assert.equal(r.cls, 'IN_BAND_DIFFERENCE'); assert.ok(r.worker > r.saved, 'Worker figure is higher: surcharge not applied'); }
  }
});
test('NAT (static table) does apply a night modifier of its own (49 -> 54 at 22:00) and the Worker keeps it inside the band', async () => {
  const nat = SOURCES.nat(); const day = await go('nat', nat, '21:59'); const night = await go('nat', nat, '22:00');
  assert.equal(day.saved, 49); assert.equal(night.saved, 54);
});
test('the RETURN pickup time is not used for night pricing by the client OR the Worker: only the outbound time counts, and a night outbound surcharges the whole return', async () => {
  const a = await go('fd-cand', cand, '10:00', 'return', '23:00'); const b = await go('fd-cand', cand, '10:00', 'return', '10:00');
  assert.deepEqual([a.review, a.worker, a.saved], [b.review, b.worker, b.saved], 'night return pickup changes nothing anywhere');
  const c = await go('fd-cand', cand, '23:00', 'return', '10:00'); const d = await go('fd-cand', cand, '23:00', 'return', '23:00');
  assert.deepEqual([c.worker, c.saved], [d.worker, d.saved]);
  assert.ok(c.worker > b.worker, 'a night OUTBOUND raises the Worker return fare');
  assert.equal(c.saved, b.saved, 'but the candidate (live fare) still saves the day amount');
});
test('INCONSISTENCY inside the candidate on the approved Momi route at night: one-way (live fare, no surcharge) 157.92 but return (page convention, includes the page night modifier) 355 vs 297 by day', async () => {
  const momi = routesOf(cand).find((r) => r.destValue === 'MARRIOTT_MOMI');
  const run = (trip, time) => runCase(env, { variant: 'fd-cand', src: cand, row: momi, vehicle: 'minibus', trip, time, seat: false, optIn: true });
  assert.equal((await run('one-way', '23:00')).saved, 157.92); assert.equal((await run('one-way', '10:00')).saved, 157.92);
  assert.equal((await run('return', '23:00')).saved, 355); assert.equal((await run('return', '10:00')).saved, 297);
});
