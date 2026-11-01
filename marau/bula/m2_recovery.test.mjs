// SYNTHETIC. Partial-failure matrix: a crash/failure after the booking save, after each job insert, or at the welcome grant never loses the booking
// and never duplicates jobs or grants; a retry/restart repairs exactly once; the email never promises credit that does not exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createTestD1 } from '../test/d1_sqlite_shim.mjs';
import { synthGuest } from '../test/fixtures.mjs';
import { installNetworkGuard } from '../test/network_guard.mjs';
import worker from '../worker/worker.js';
import { createCaptureSender } from './outbox_d1.js';
import { bulaRunOutbox } from './hook.js';
installNetworkGuard();
const root = path.resolve(import.meta.dirname, '..');
const FLAGS = { BULA_OUTBOX_ENABLED: 'on', BULA_SYNTHETIC_TEST: 'on', BULA_CREDITS_ENABLED: 'on', BULA_CHECKOUT_ENABLED: 'on', BULA_POLICY_VERSION: 'synthetic-v1', BULA_STAFF_INBOX: 'team@example.invalid', BULA_GUEST_ORIGIN: 'https://guest.example.invalid' };
function mk(over = {}, { failOn } = {}) {
  const real = createTestD1({ migrationsDirs: [path.join(root, '..', 'smart-return-trigger-fill', 'migrations'), path.join(root, 'migrations'), path.join(root, 'bula', 'migrations')] });
  let hits = 0; const DB = new Proxy(real, { get(t, k) { if (k === 'prepare') return (sql) => { if (failOn && failOn.re.test(sql) && failOn.when(++hits)) throw new Error('INJECTED_FAULT'); return t.prepare(sql); }; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });
  return { real, env: { DB, MARAU_ADMIN_TEST_TOKEN: 'test-admin-token-do-not-use-in-production', BULA_CAPTURE_SENDER: createCaptureSender(), ...FLAGS, ...over } };
}
const save = (env, ref) => worker.fetch(new Request('http://marau.test/preview/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(synthGuest({ leg_type: 'arrival', client_booking_ref: ref })) }), env);
const n = async (db, sql) => (await db.prepare(sql).first()).n;
const cutover = (db) => db.prepare("INSERT OR REPLACE INTO bula_settings (key, value, updated_at) VALUES ('outbox_cutover_iso', ?, 0)").bind('2000-01-01T00:00:00.000Z').run();
const counts = async (db) => ({ bookings: await n(db, 'SELECT COUNT(*) n FROM marau_test_bookings'), jobs: await n(db, 'SELECT COUNT(*) n FROM bula_outbox'), grants: await n(db, 'SELECT COUNT(*) n FROM bula_credit_ledger'), snaps: await n(db, 'SELECT COUNT(*) n FROM bula_booking_snapshots') });

test('crash right after the booking save (nothing else ran): restart sweep creates 2 jobs, 1 grant, 1 snapshot, once', async () => {
  const { real, env } = mk({ BULA_OUTBOX_ENABLED: 'off' }); await cutover(real);
  assert.equal((await save(env, 'SYN-C1')).status, 201); assert.deepEqual(await counts(real), { bookings: 1, jobs: 0, grants: 0, snaps: 0 });
  const live = { ...env, BULA_OUTBOX_ENABLED: 'on' };
  await bulaRunOutbox(live); await bulaRunOutbox(live); await bulaRunOutbox(live);                      // repeated restarts
  assert.deepEqual(await counts(real), { bookings: 1, jobs: 2, grants: 1, snaps: 1 });
  assert.equal(live.BULA_CAPTURE_SENDER.sent.length, 2);
});
for (const k of [1, 2]) test(`failure at job insert #${k}: booking saved; sweep repairs without duplicating the job that did land`, async () => {
  const { real, env } = mk({}, { failOn: { re: /INSERT (OR IGNORE )?INTO bula_outbox\b/i, when: (h) => h === k } }); await cutover(real);
  assert.equal((await save(env, `SYN-J${k}`)).status, 201);
  assert.equal((await counts(real)).bookings, 1); assert.ok((await counts(real)).jobs < 2);
  const clean = { ...env, DB: real };
  await bulaRunOutbox(clean); await bulaRunOutbox(clean);
  const c = await counts(real); assert.deepEqual([c.bookings, c.jobs, c.grants], [1, 2, 1]);
  assert.equal(new Set(env.BULA_CAPTURE_SENDER.sent.map((m) => m.to)).size, 2); assert.equal(env.BULA_CAPTURE_SENDER.sent.length, 2);
});
test('welcome-grant failure: booking, jobs and the booking RECEIPT are immediate (no promise of missing credit); once repaired the grant exists exactly once and NO second email is sent', async () => {
  const { real, env } = mk({}, { failOn: { re: /bula_credit_(accounts|ledger)/i, when: () => true } }); await cutover(real);
  assert.equal((await save(env, 'SYN-G1')).status, 201); const c0 = await counts(real); assert.deepEqual([c0.bookings, c0.jobs, c0.grants], [1, 2, 0]);
  await bulaRunOutbox(env);
  const guestMsgs = () => env.BULA_CAPTURE_SENDER.sent.filter((m) => /preview\.guest/.test(m.to));
  assert.equal(guestMsgs().length, 1, 'receipt must not wait for the promotion'); assert.doesNotMatch(guestMsgs()[0].text, /Welcome promotional credit/);
  const clean = { ...env, DB: real }; await bulaRunOutbox(clean); await bulaRunOutbox(clean);
  assert.equal(await n(real, 'SELECT COUNT(*) n FROM bula_credit_ledger'), 1); assert.equal(guestMsgs().length, 1, 'no duplicate / contradicting later email');
});
test('credits not live: the guest email carries no credit line', async () => {
  const { real, env } = mk({ BULA_CHECKOUT_ENABLED: 'off' }); await cutover(real);                              // credits shown in email only when checkout+credits are both live
  assert.equal((await save(env, 'SYN-G2')).status, 201); await bulaRunOutbox(env);
  const g = env.BULA_CAPTURE_SENDER.sent.find((m) => /preview\.guest/.test(m.to)); assert.ok(g); assert.doesNotMatch(g.text, /credit/i);
});
test('replay protection: bookings saved BEFORE the cutover are never enqueued or granted by the sweep', async () => {
  const { real, env } = mk({ BULA_OUTBOX_ENABLED: 'off' }); await save(env, 'SYN-OLD');
  await real.prepare("INSERT OR REPLACE INTO bula_settings (key, value, updated_at) VALUES ('outbox_cutover_iso', ?, 0)").bind(new Date(Date.now() + 60000).toISOString()).run();
  await bulaRunOutbox({ ...env, BULA_OUTBOX_ENABLED: 'on' }); assert.deepEqual(await counts(real), { bookings: 1, jobs: 0, grants: 0, snaps: 0 });
});
