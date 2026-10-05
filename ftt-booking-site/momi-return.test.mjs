// James-approved existing Nadi convention for Momi (2026-10-05): one-way 157.92, return 297, return + child seat 304 (minibus, day, no other extras).
// The Worker's own return figures (292.45 / 300.45) must NOT be silently substituted. Real FijiDash candidate page code + the real deployed Worker bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, routesOf, newEnv, runCase } from './reconciliation/lib.mjs';

const env = await newEnv();
const srcCand = SOURCES['fd-cand'](); const srcProd = SOURCES['fd-prod']();
const momi = (src) => routesOf(src).find((r) => r.destValue === 'MARRIOTT_MOMI');
const run = (variant, src, trip, seat) => runCase(env, { variant, src, row: momi(src), vehicle: 'minibus', trip, time: '10:00', seat, optIn: variant !== 'fd-prod' });

const CASES = [['one-way', false, 157.92, 157.92], ['return', false, 297, 292.45], ['return', true, 304, 300.45]];
for (const [trip, seat, approved, worker] of CASES) {
  test(`candidate Momi minibus ${trip}${seat ? ' + child seat' : ''}: selection = review = submitted = saved = ${approved}; the Worker's own figure (${worker}) is reported, not substituted`, async () => {
    const r = await run('fd-cand', srcCand, trip, seat);
    assert.equal(r.selection, approved, 'selection'); assert.equal(r.review, approved, 'review'); assert.equal(r.submitted, approved, 'submitted');
    assert.equal(r.worker, worker, 'Worker-calculated (informational)');
    assert.equal(r.saved, approved, 'saved');
    assert.equal(r.cls, trip === 'one-way' ? 'MATCH' : 'IN_BAND_DIFFERENCE');
    assert.notEqual(r.saved, worker === approved ? -1 : worker, 'the Worker return total was not substituted');
  });
}
test('candidate keeps the convention for the other Momi vehicles on return (sedan 166, minivan 252, the page figures), and applies it to Momi only', async () => {
  const row = momi(srcCand);
  assert.equal((await runCase(env, { variant: 'fd-cand', src: srcCand, row, vehicle: 'sedan', trip: 'return', time: '10:00', seat: false, optIn: true })).saved, 166);
  assert.equal((await runCase(env, { variant: 'fd-cand', src: srcCand, row, vehicle: 'minivan', trip: 'return', time: '10:00', seat: false, optIn: true })).saved, 252);
  // a different route still shows the live Worker return fare (unchanged behaviour)
  const hilton = routesOf(srcCand).find((r) => r.destValue === 'HILTON_DENARAU');
  const h = await runCase(env, { variant: 'fd-cand', src: srcCand, row: hilton, vehicle: 'minibus', trip: 'return', time: '10:00', seat: false, optIn: true });
  assert.equal(h.selection, h.worker); assert.equal(h.saved, h.worker);
});
test('FijiDash PRODUCTION for comparison (not changed): return review used the Worker figure, so the approved 297 / 304 were not what production charged', async () => {
  const a = await run('fd-prod', srcProd, 'return', false); const b = await run('fd-prod', srcProd, 'return', true);
  assert.deepEqual([a.selection, a.review, a.saved], [135, 292.45, 292.45]);   // selection 135 (79 minibus), review/saved the Worker figure
  assert.deepEqual([b.review, b.saved], [300.45, 300.45]);
});
