// SYNTHETIC. Real Marau Worker + real schema/migrations (+ proposed Bula migrations) on SQLite. Capture sender only.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createTestD1 } from '../test/d1_sqlite_shim.mjs';
import { synthGuest } from '../test/fixtures.mjs';
import { installNetworkGuard } from '../test/network_guard.mjs';
import worker from '../worker/worker.js';
import { createCaptureSender, staffQueue, recordDelivery, humanAcknowledge, dispatch, recoverInterrupted, reconcileAmbiguous, enqueueSavedBooking, reconcileMissing, liveSenderDisabled } from './outbox_d1.js';
import { loadConfig } from './config.js';

installNetworkGuard();
const root = path.resolve(import.meta.dirname, '..');
const mkEnv = (over = {}) => ({ DB: createTestD1({ migrationsDirs: [path.join(root, '..', 'smart-return-trigger-fill', 'migrations'), path.join(root, 'migrations'), path.join(root, 'bula', 'migrations')] }),
  MARAU_ADMIN_TEST_TOKEN: 'test-admin-token-do-not-use-in-production', BULA_OUTBOX_ENABLED: 'on', BULA_SYNTHETIC_TEST: 'on', BULA_STAFF_INBOX: 'team@example.invalid',
  BULA_GUEST_ORIGIN: 'https://guest.example.invalid', BULA_CAPTURE_SENDER: createCaptureSender(), ...over });
const call = async (env, p, { method = 'GET', body, headers = {} } = {}) => { const r = await worker.fetch(new Request('http://marau.test' + p, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { status: r.status, data: d }; };
const admin = (env) => ({ authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}` });
const save = (env, over = {}) => call(env, '/preview/bookings', { method: 'POST', body: synthGuest({ leg_type: 'arrival', client_booking_ref: `SYN-${Math.random().toString(36).slice(2, 8)}`, ...over }) });
const jobs = async (env) => (await env.DB.prepare('SELECT * FROM bula_outbox ORDER BY job_key').all()).results;
const run = (env) => call(env, '/preview/bula/outbox/run', { method: 'POST', headers: admin(env) });
const tokenFrom = (msg) => /#tok=(\S+)/.exec(msg.text)[1];

test('MILESTONE: saved booking -> 2 persisted jobs -> 2 captured emails -> authorised private trip shows the SAME booking', async () => {
  const env = mkEnv(); const r = await save(env, { client_booking_ref: 'SYN-M1' }); assert.equal(r.status, 201);
  const js = await jobs(env); assert.deepEqual(js.map((j) => j.recipient_kind).sort(), ['guest', 'staff']); assert.ok(js.every((j) => j.state === 'queued'));
  assert.equal((await run(env)).data.accepted, 2);
  const sent = env.BULA_CAPTURE_SENDER.sent; assert.equal(sent.length, 2);
  const g = sent.find((m) => m.to.includes('preview.guest')); const s = sent.find((m) => m.to === 'team@example.invalid');
  assert.match(g.text, /received your booking request/); assert.match(g.text, /NOT confirmed yet/); assert.match(g.text, /Quoted total: FJD 45\.00/); assert.match(g.text, /Fiji time/); assert.doesNotMatch(g.text, /undefined|null/);
  assert.doesNotMatch(s.text, /#tok=/); assert.match(s.text, /ACTION: confirm or decline/);
  const trip = await call(env, '/preview/trip', { headers: { authorization: `Bearer ${tokenFrom(g)}` } });
  assert.equal(trip.status, 200); assert.deepEqual(trip.data.bookings.map((b) => b.client_booking_ref), ['SYN-M1']);
  assert.ok((await jobs(env)).every((j) => j.state === 'accepted' && j.provider_accepted_at && j.delivered_at === null && j.human_ack_at === null));
  const row = await env.DB.prepare('SELECT status FROM marau_test_bookings').first(); assert.equal(row.status, 'pending'); // sending never confirms
});
test('replayed save and a changed delivery-event id create NO second job; re-running dispatch sends nothing more', async () => {
  const env = mkEnv(); const body = synthGuest({ leg_type: 'arrival', client_booking_ref: 'SYN-R1' });
  await call(env, '/preview/bookings', { method: 'POST', body }); await call(env, '/preview/bookings', { method: 'POST', body });
  const b = await env.DB.prepare("SELECT * FROM marau_test_bookings WHERE client_booking_ref = 'SYN-R1'").first();
  await enqueueSavedBooking(env.DB, loadConfig(env), b, Date.now()); await enqueueSavedBooking(env.DB, loadConfig(env), b, Date.now() + 1);
  assert.equal((await jobs(env)).length, 2); await run(env); await run(env); assert.equal(env.BULA_CAPTURE_SENDER.sent.length, 2);
});
test('flag OFF: saving a booking creates no jobs and runs nothing', async () => {
  const env = mkEnv({ BULA_OUTBOX_ENABLED: 'off' }); assert.equal((await save(env)).status, 201); assert.equal((await jobs(env)).length, 0); assert.equal((await run(env)).data.skipped, 'outbox_disabled');
});
test('sender failure cannot lose or fail the booking; job retries; live sender (absent) fails closed', async () => {
  const env = mkEnv({ BULA_CAPTURE_SENDER: undefined }); const r = await save(env, { client_booking_ref: 'SYN-F1' }); assert.equal(r.status, 201);
  const a = await run(env); assert.equal(a.data.failed, 2); assert.ok((await jobs(env)).every((j) => j.state === 'failed' && /LIVE_SENDER_DISABLED/.test(j.last_error)));
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM marau_test_bookings').first()).n, 1);
  env.BULA_CAPTURE_SENDER = createCaptureSender({ failTimes: 1 }); await run(env); await run(env);
  const js = await jobs(env); assert.ok(js.every((j) => j.state === 'accepted')); assert.equal(env.BULA_CAPTURE_SENDER.sent.length, 2);
});
test('enqueue crash right after the save: booking intact, reconciliation sweep creates the jobs; pre-cutover bookings are NOT replayed', async () => {
  const env = mkEnv(); await save(env, { client_booking_ref: 'SYN-OLD' });                      // before cutover (saved with jobs, but delete them to model "old, never emailed")
  await env.DB.exec("DELETE FROM bula_outbox"); const cutover = new Date(Date.now() + 1000).toISOString();
  await env.DB.prepare("INSERT INTO bula_settings (key,value,updated_at) VALUES ('outbox_cutover_iso', ?, 1)").bind(cutover).run();
  const realFirst = env.DB.prepare.bind(env.DB); env.DB.prepare = (sql) => { if (/INSERT OR IGNORE INTO bula_outbox/.test(sql)) throw new Error('crash'); return realFirst(sql); };
  await new Promise((r) => setTimeout(r, 1100)); const r = await save(env, { client_booking_ref: 'SYN-NEW' }); assert.equal(r.status, 201); env.DB.prepare = realFirst;   // enqueue crashed, booking survived
  assert.equal((await jobs(env)).length, 0);
  const n = await reconcileMissing(env.DB, loadConfig(env), Date.now()); assert.equal(n, 1);
  assert.deepEqual([...new Set((await jobs(env)).map((j) => j.booking_ref))], ['SYN-NEW']);
});
test('interrupted send (lease expired) becomes AMBIGUOUS, is never blind-resent; reconcile by provider lookup', async () => {
  const env = mkEnv(); await save(env, { client_booking_ref: 'SYN-A1' }); const cfg = loadConfig(env);
  await env.DB.exec("UPDATE bula_outbox SET state='sending', lease_owner='dead-worker', lease_until=100, attempts=1");
  const s = createCaptureSender(); assert.equal(await recoverInterrupted(env.DB, 5000), 2);
  assert.deepEqual(await dispatch(env.DB, cfg, s, { nowMs: 6000 }), { accepted: 0, failed: 0, ambiguous: 0, blocked: 0, skipped: 0 }); assert.equal(s.sent.length, 0);
  s.sent.push({ idempotencyKey: (await jobs(env))[0].job_key, to: 'x' });          // provider DID get the first one, not the second
  assert.equal(await reconcileAmbiguous(env.DB, s, 7000), 2);
  const js = await jobs(env); assert.equal(js.filter((j) => j.state === 'accepted').length, 1); assert.equal(js.filter((j) => j.state === 'queued').length, 1);
  await dispatch(env.DB, cfg, s, { nowMs: 8000 }); assert.equal(s.sent.length, 2); assert.ok((await jobs(env)).every((j) => j.state === 'accepted'));
});
test('two workers racing: each job is claimed once (lease), one email per job', async () => {
  const env = mkEnv(); await save(env); const cfg = loadConfig(env); const s = createCaptureSender();
  const [a, b] = await Promise.all([dispatch(env.DB, cfg, s, { workerId: 'A', nowMs: 1 }), dispatch(env.DB, cfg, s, { workerId: 'B', nowMs: 1 })]);
  assert.equal(s.sent.length, 2); assert.equal(a.accepted + b.accepted, 2);
});
test('private link: revoked session fails closed (no email with a dead link); other guest tokens cannot read this booking; no token in outbox rows or events', async () => {
  const env = mkEnv(); const r1 = await save(env, { client_booking_ref: 'SYN-P1' }); const r2 = await save(env, { client_booking_ref: 'SYN-P2' });
  await call(env, '/preview/trip/revoke', { method: 'POST', headers: { authorization: `Bearer ${r1.data.access_token}` } });
  await run(env); const js = await jobs(env);
  assert.ok(js.filter((j) => j.booking_ref === 'SYN-P1' && j.recipient_kind === 'guest').every((j) => j.state === 'blocked' && j.blocked_reason === 'session_revoked'));
  const g2 = env.BULA_CAPTURE_SENDER.sent.find((m) => m.subject.includes('SYN-P2') && m.to.includes('preview.guest'));
  const t2 = await call(env, '/preview/trip', { headers: { authorization: `Bearer ${tokenFrom(g2)}` } }); assert.deepEqual(t2.data.bookings.map((b) => b.client_booking_ref), ['SYN-P2']);
  const dump = JSON.stringify([(await env.DB.prepare('SELECT * FROM bula_outbox').all()).results, (await env.DB.prepare('SELECT * FROM bula_outbox_events').all()).results]);
  assert.doesNotMatch(dump, /tok_/);
});
test('production-mode guards: unverified support contact / non-https origin / missing staff inbox are blocked, never rendered with placeholders', async () => {
  const env = mkEnv({ BULA_SYNTHETIC_TEST: 'off' }); await save(env);
  await run(env); const js = await jobs(env); assert.ok(js.filter((j) => j.recipient_kind === 'guest').every((j) => j.blocked_reason === 'support_contact_unverified'));
  const envH = mkEnv({ BULA_SYNTHETIC_TEST: 'off', BULA_GUEST_ORIGIN: 'http://insecure.example.invalid', BULA_SUPPORT_WHATSAPP: '+679000', BULA_SUPPORT_VERIFIED: 'on' }); await save(envH); await run(envH);
  assert.ok((await jobs(envH)).filter((j) => j.recipient_kind === 'guest').every((j) => j.blocked_reason === 'guest_origin_not_https'));
  const env2 = mkEnv({ BULA_SYNTHETIC_TEST: 'off', BULA_STAFF_INBOX: '' }); await save(env2); await run(env2);
  assert.ok((await jobs(env2)).filter((j) => j.recipient_kind === 'staff').every((j) => j.state === 'blocked' && j.blocked_reason === 'staff_inbox_not_configured'));
  const env3 = mkEnv({ BULA_SYNTHETIC_TEST: 'off' }); await save(env3); await run(env3); assert.equal(env3.BULA_CAPTURE_SENDER.sent.filter((m) => /support/i.test(m.text)).length, 0);
  const env4 = mkEnv({ BULA_SYNTHETIC_TEST: 'off', BULA_SUPPORT_WHATSAPP: '+679000', BULA_SUPPORT_VERIFIED: 'on' }); await save(env4); await run(env4);   // fully configured -> sends, with the verified number
  const ok = env4.BULA_CAPTURE_SENDER.sent.find((m) => m.to.includes('preview.guest')); assert.match(ok.text, /support: \+679000/); assert.doesNotMatch(ok.text, /synthetic test/);
});
test('status-appropriate copy: confirmed booking says confirmed; welcome credit line only when credit+checkout are enabled and a grant exists', async () => {
  const env = mkEnv({ BULA_CREDITS_ENABLED: 'on', BULA_CHECKOUT_ENABLED: 'on' }); const r = await save(env, { client_booking_ref: 'SYN-C1' });
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM bula_credit_accounts WHERE party_key = 'trip:SYN-C1'").first()).n, 1);
  await env.DB.exec("UPDATE marau_test_bookings SET status='confirmed'"); await run(env);
  const g = env.BULA_CAPTURE_SENDER.sent.find((m) => m.to.includes('preview.guest'));
  assert.match(g.text, /Your transfer is confirmed/); assert.match(g.text, /FJ\$500\.00 toward eligible offers \(no cash value/); assert.match(g.text, /View your trip/);
  const off = mkEnv(); await save(off, { client_booking_ref: 'SYN-C2' }); await run(off); assert.doesNotMatch(off.BULA_CAPTURE_SENDER.sent.find((m) => m.to.includes('preview.guest')).text, /credit/i);
  assert.equal((await off.DB.prepare('SELECT COUNT(*) n FROM bula_credit_accounts').first()).n, 0);
});
test('welcome grant: replayed save never grants twice', async () => {
  const env = mkEnv({ BULA_CREDITS_ENABLED: 'on' }); const body = synthGuest({ leg_type: 'arrival', client_booking_ref: 'SYN-G1' });
  for (let i = 0; i < 3; i++) await call(env, '/preview/bookings', { method: 'POST', body });
  assert.equal((await env.DB.prepare('SELECT granted_cents g FROM bula_credit_accounts').first()).g, 50000); assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM bula_credit_ledger WHERE type='granted'").first()).n, 1);
});
test('staff queue shows failed / ambiguous / blocked; delivery, bounce and human-ack are separate evidence', async () => {
  const env = mkEnv({ BULA_CAPTURE_SENDER: createCaptureSender({ failTimes: 1, ambiguousTimes: 1 }) }); await save(env); await run(env);
  const q = await staffQueue(env.DB); assert.deepEqual(q.map((x) => x.state).sort(), ['ambiguous', 'failed']);
  await run(env); const js = await jobs(env); const acc = js.find((j) => j.state === 'accepted') || js[0];
  await recordDelivery(env.DB, acc.job_key, 'bounced', 9); await humanAcknowledge(env.DB, acc.job_key, 'staff:james', 10);
  const row = (await jobs(env)).find((j) => j.job_key === acc.job_key); assert.ok(row.bounced_at === 9 && row.human_ack_by === 'staff:james' && row.delivered_at === null);
  assert.ok((await staffQueue(env.DB)).some((x) => x.job_key === acc.job_key));   // bounce surfaces to staff
});
