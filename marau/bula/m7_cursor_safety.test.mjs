// Release-gate critical test: the poller must never silently lose a valid booking. SYNTHETIC only; NAT is a double of the patched read-only routes. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, poll, pollAt, state, add, sessions, refusals, boot, mirroredRefs, range } from './disc_helpers.mjs';
import { count } from './m3_helpers.mjs';
import { collectHealth } from './health.js';

const T0 = Date.now(), MIN = 60e3;
const invariants = async (env) => { // nothing duplicated, nothing orphaned
  assert.equal(await count(env, 'marau_test_bookings', 'parent_booking_id IS NULL'), await sessions(env));
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM (SELECT source_booking_ref FROM marau_real_booking_links GROUP BY 1 HAVING COUNT(*) > 1)').first()).n, 0);
};

test('RESTART / DEPLOYMENT: the cursor lives in D1 - a brand-new Worker instance continues from it; nothing is re-mirrored or skipped', async () => {
  const t = setup(); await boot(t); for (const i of range(3, 6)) add(t.store, i); await poll(t.env);
  const fresh = { ...t.env }; for (const i of range(7, 9)) add(t.store, i); await poll(fresh);
  assert.deepEqual(await mirroredRefs(t.env), range(3, 9)); assert.equal((await state(t.env)).watermark, 9); await invariants(t.env);
});
test('CRASH BEFORE THE CURSOR IS SAVED: bookings were mirrored but the watermark write failed -> next poll re-reads them, creates no duplicate, and then advances', async () => {
  const t = setup(); await boot(t); for (const i of range(3, 8)) add(t.store, i);
  const real = t.env.DB; let armed = true;
  t.env.DB = new Proxy(real, { get(o, k) { if (k !== 'prepare') return o[k].bind ? o[k].bind(o) : o[k]; return (sql) => { if (armed && /UPDATE bula_source_discovery_state SET watermark/.test(sql)) throw new Error('simulated crash'); return o.prepare(sql); }; } });
  await poll(t.env); assert.equal((await state(t.env)).watermark, 2, 'cursor NOT advanced'); assert.deepEqual(await mirroredRefs(t.env), range(3, 8));
  armed = false; await poll(t.env); assert.equal((await state(t.env)).watermark, 8); assert.deepEqual(await mirroredRefs(t.env), range(3, 8)); assert.equal(await count(t.env, 'bula_credit_ledger', "type = 'granted'"), 6); await invariants(t.env);
});
test('SAME-TIME bookings (30 with one timestamp): none lost, none duplicated', async () => {
  const t = setup(); await boot(t); for (const i of range(3, 32)) add(t.store, i, { created_at: '2026-11-01T01:00:00Z' }); await poll(t.env);
  assert.deepEqual(await mirroredRefs(t.env), range(3, 32)); await invariants(t.env);
});
test('MORE THAN 50 new bookings (120) are all mirrored once, in one run', async () => {
  const t = setup(); await boot(t); for (const i of range(3, 122)) add(t.store, i); await poll(t.env);
  assert.deepEqual(await mirroredRefs(t.env), range(3, 122)); assert.equal((await state(t.env)).watermark, 122); await invariants(t.env);
});
test('MORE THAN 200 accumulated (450) are caught up over successive runs: monotonic watermark, no gap, no duplicate, ≤200 handled per run', async () => {
  const t = setup(); await boot(t); for (const i of range(3, 452)) add(t.store, i); const marks = [];
  for (let r = 0; r < 4; r++) { await pollAt(t.env, T0 + r * 5 * MIN); marks.push((await state(t.env)).watermark); }
  assert.ok(marks.every((m, i) => i === 0 || m >= marks[i - 1]), String(marks)); assert.equal(marks[0], 202, 'first run stops at exactly 4 pages of 50'); assert.equal(marks.at(-1), 452);
  assert.deepEqual(await mirroredRefs(t.env), range(3, 452)); await invariants(t.env);
});
test('BULA OUTAGE longer than a poll interval (12 missed polls, bookings keep arriving) -> everything is mirrored on recovery', async () => {
  const t = setup(); await boot(t); add(t.store, 3); await pollAt(t.env, T0);
  for (let k = 1; k <= 12; k++) add(t.store, 3 + k);   // no polls at all for an hour; Bula "down"
  add(t.store, 16); await pollAt(t.env, T0 + 61 * MIN); assert.deepEqual(await mirroredRefs(t.env), range(3, 16)); await invariants(t.env);
});
test('NAT OUTAGE across many polls then recovery: all mirrored, watermark held while down', async () => {
  const t = setup(); await boot(t); add(t.store, 3); await pollAt(t.env, T0); t.ctl.down = true; for (const i of range(4, 20)) add(t.store, i);
  for (let k = 1; k <= 14; k++) await pollAt(t.env, T0 + k * 5 * MIN); assert.equal((await state(t.env)).watermark, 3); assert.ok((await state(t.env)).consecutive_failures >= 14);
  t.ctl.down = false; await pollAt(t.env, T0 + 90 * MIN); assert.deepEqual(await mirroredRefs(t.env), range(3, 20)); assert.equal((await state(t.env)).consecutive_failures, 0);
});
test('REPEATED TRANSIENT single-booking failures (5 bookings, 4 polls in a row) -> all eventually mirrored, none abandoned', async () => {
  const t = setup({}, { failRead: new Set([4, 6, 8, 10, 12]) }); await boot(t); for (const i of range(3, 14)) add(t.store, i);
  for (let k = 0; k < 4; k++) await pollAt(t.env, T0 + k * 5 * MIN); assert.deepEqual(await mirroredRefs(t.env), [3, 5, 7, 9, 11, 13, 14]); assert.ok((await state(t.env)).watermark <= 3, 'cursor held behind the first failure');
  t.ctl.failRead.clear(); await pollAt(t.env, T0 + 25 * MIN); assert.deepEqual(await mirroredRefs(t.env), range(3, 14)); assert.equal((await state(t.env)).watermark, 14); assert.equal(await refusals(t.env, "state = 'open'"), 0); await invariants(t.env);
});
test('POISON RECORD: one permanently malformed booking between 60 valid ones - every valid booking is mirrored, the poison one stays OPEN, visible, retried, and never blocks', async () => {
  const t = setup(); await boot(t); for (const i of range(3, 62)) add(t.store, i); add(t.store, 30, { quoted_amount: 'not-a-number' });   // id 30 can never be read
  for (let k = 0; k < 16; k++) await pollAt(t.env, T0 + k * 5 * MIN);   // well past the 10-attempt cap
  assert.deepEqual(await mirroredRefs(t.env), range(3, 62).filter((i) => i !== 30), 'all valid bookings behind AND ahead of the poison one');
  const s = await state(t.env); assert.equal(s.watermark, 62, 'the cursor moved past the poison record'); await invariants(t.env);
  const r = await t.env.DB.prepare("SELECT * FROM bula_source_refusals WHERE source_booking_ref = '30'").first();
  assert.deepEqual([r.state, r.reason, r.detail], ['open', 'SOURCE_READ_FAILED', 'SOURCE_MALFORMED_FIELD_quoted_amount']); assert.ok(r.attempts >= 10);
  assert.equal(await count(t.env, 'marau_real_booking_links', "source_booking_ref = '30'"), 0, 'no guest journey for it');
  assert.ok((await collectHealth(t.env.DB, Date.now())).alerts.some((a) => a.code === 'SOURCE_BOOKING_PARKED_RETRYING'));
  assert.ok((await collectHealth(t.env.DB, Date.now())).alerts.some((a) => a.code === 'SOURCE_BOOKING_REFUSED_NEEDS_STAFF'));
  // if NAT ever corrects the record, the sweep mirrors it without staff action
  const before = r.attempts; t.store.set(30, { ...t.store.get(30), quoted_amount: 85 }); await pollAt(t.env, T0 + 200 * MIN);
  assert.ok((await mirroredRefs(t.env)).includes(30)); assert.equal((await t.env.DB.prepare("SELECT state, resolved_by FROM bula_source_refusals WHERE source_booking_ref = '30'").first()).resolved_by, 'auto:mirrored'); assert.ok(before >= 10);
});
test('PARKED VALID BOOKING: a valid booking whose read failed for MORE than 10 polls (outside the overlap window) is still recovered by the sweep - the 10-attempt cap never abandons it', async () => {
  const t = setup({}, { failRead: new Set([3]) }); await boot(t); add(t.store, 3);
  for (let k = 0; k < 12; k++) await pollAt(t.env, T0 + k * 5 * MIN);                     // 12 failing polls: attempts now ≥ 10
  for (const i of range(4, 60)) add(t.store, i); await pollAt(t.env, T0 + 70 * MIN);       // many later bookings push 3 far outside the 20-id overlap
  assert.equal(await count(t.env, 'marau_real_booking_links', "source_booking_ref = '3'"), 0); assert.equal(await refusals(t.env, "source_booking_ref = '3' AND state = 'open' AND attempts >= 10"), 1);
  assert.deepEqual((await mirroredRefs(t.env)), range(4, 60), 'every later valid booking is present');
  t.ctl.failRead.clear(); await pollAt(t.env, T0 + 100 * MIN); assert.deepEqual(await mirroredRefs(t.env), range(3, 60)); assert.equal(await refusals(t.env, "state = 'open'"), 0); await invariants(t.env);
});
test('PERMANENT refusals (missing email / phone) are never re-activated by the sweep and never block later bookings', async () => {
  const t = setup(); await boot(t); add(t.store, 3, { guest_email: null }); add(t.store, 4, { guest_phone: null }); for (const i of range(5, 30)) add(t.store, i);
  for (let k = 0; k < 14; k++) await pollAt(t.env, T0 + k * 20 * MIN);
  assert.deepEqual(await mirroredRefs(t.env), range(5, 30)); assert.equal(await refusals(t.env, "state = 'open' AND reason = 'MISSING_GUEST_CONTACT'"), 2); assert.equal(await count(t.env, 'guest_sessions', "1=1"), 26);
});
