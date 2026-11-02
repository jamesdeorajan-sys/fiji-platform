// Stage 1 (prepared, NOT wired): production email sender, delivery evidence, and the minimal health check. SYNTHETIC only; no network (fetch is injected); no real address.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpEmailSender, verifyWebhook, applyDeliveryEvent, validAddress, tag } from './email_provider.js';
import { collectHealth } from './health.js';
import { mkEnv, syncCreated, call, one, count, cutover, tokenFor, staff, offer, reserve } from './m3_helpers.mjs';
import { dispatch, reconcileAmbiguous } from './outbox_d1.js';
import { loadConfig } from './config.js';
import { createHmac } from 'node:crypto';

const CEO = 'ceo-test@example.test', KEY = 'sk_test_synthetic_key_000000';
const prov = (script = []) => { const calls = []; const f = async (url, init) => { calls.push({ url: String(url), init }); const s = script.shift(); if (s instanceof Error) throw s; return new Response(JSON.stringify(s?.body ?? { id: `msg_${calls.length}` }), { status: s?.status ?? 200 }); }; f.calls = calls; return f; };
const mk = (o = {}) => createHttpEmailSender({ endpoint: 'https://mail.provider.test/v1/send', apiKey: KEY, from: 'Bula <noreply@example.test>', mode: 'test', allowRecipients: [CEO], ...o });
const msg = (o = {}) => ({ idempotencyKey: 'job-1', to: CEO, subject: 'Booking pending 1', text: 'hello https://guest.example.test/bula#tok=SECRETTOKEN', ...o });

test('CONSTRUCTION fails closed: bad endpoint / http / short key / bad From / bad mode / TEST mode without an allow-list', () => {
  const base = { endpoint: 'https://mail.provider.test/x', apiKey: KEY, from: 'a@example.test', mode: 'test', allowRecipients: [CEO] };
  for (const bad of [{ endpoint: 'nope' }, { endpoint: 'http://mail.provider.test/x' }, { apiKey: 'short' }, { apiKey: undefined }, { from: 'not an address' }, { mode: 'prod' }, { mode: 'test', allowRecipients: [] }, { mode: 'test', allowRecipients: ['bad'] }]) assert.throws(() => createHttpEmailSender({ ...base, ...bad }), /EMAIL_CONFIG/, JSON.stringify(bad));
  assert.doesNotThrow(() => createHttpEmailSender({ ...base, mode: 'live', allowRecipients: [] }));
});
test('TEST MODE reaches ONLY the allow-list (case-insensitive); any other address is refused BEFORE any network call', async () => {
  const f = prov(); const s = mk({ fetchImpl: f }); assert.equal((await s.send(msg({ to: 'CEO-Test@Example.Test' }))).id, 'msg_1');
  for (const to of ['guest@example.test', 'ceo-test@example.test.evil.test', `${CEO},guest@example.test`, 'x@y', 'a\r\nbcc:b@example.test']) await assert.rejects(() => s.send(msg({ to })), /RECIPIENT_NOT_ALLOWED|EMAIL_BAD_RECIPIENT/, to);
  assert.equal(f.calls.length, 1, 'exactly one provider call in total');
});
test('REQUEST SHAPE: https only, Idempotency-Key = outbox job key, one recipient, no redirect following, bearer key only in the Authorization header', async () => {
  const f = prov(); await mk({ fetchImpl: f }).send(msg()); const c = f.calls[0]; assert.equal(c.init.method, 'POST'); assert.equal(c.init.redirect, 'manual'); assert.equal(c.init.headers['idempotency-key'], 'job-1');
  const b = JSON.parse(c.init.body); assert.deepEqual(b.to, [CEO]); assert.equal(b.headers['X-Bula-Ref'], 'job-1'); assert.ok(!c.init.body.includes(KEY));
});
test('OUTCOMES: 2xx accepted; 429 failed(retry); 4xx failed(permanent code); 5xx and no-response are AMBIGUOUS (never auto-resent); redirect refused', async () => {
  const run = async (step) => { const s = mk({ fetchImpl: prov([step]) }); try { return { ok: await s.send(msg()) }; } catch (e) { return { err: e.message, amb: !!e.ambiguous }; } };
  assert.equal((await run({ status: 200 })).ok.id, 'msg_1'); assert.equal((await run({ status: 202, body: {} })).ok.id.startsWith('accepted-'), true);
  assert.deepEqual(await run({ status: 429 }), { err: 'PROVIDER_RATE_LIMITED', amb: false }); assert.deepEqual(await run({ status: 422 }), { err: 'PROVIDER_REJECTED_422', amb: false });
  assert.deepEqual(await run({ status: 401 }), { err: 'PROVIDER_REJECTED_401', amb: false }); assert.deepEqual(await run({ status: 503 }), { err: 'PROVIDER_5XX_AMBIGUOUS', amb: true });
  assert.deepEqual(await run(new Error('socket hang up')), { err: 'PROVIDER_NO_RESPONSE_AMBIGUOUS', amb: true }); assert.deepEqual(await run({ status: 302 }), { err: 'PROVIDER_REDIRECT_REFUSED', amb: false });
});
test('NO LEAKS: errors and log events contain codes only - never the address, subject, link/token body or API key', async () => {
  const logs = []; const s = mk({ fetchImpl: prov([new Error(`boom ${KEY} ${CEO}`), { status: 500 }, { status: 400 }, { status: 200 }]), log: (e) => logs.push(JSON.stringify(e)) });
  const errs = []; for (let i = 0; i < 3; i++) { try { await s.send(msg()); } catch (e) { errs.push(e.message); } } await s.send(msg()); await assert.rejects(() => s.send(msg({ to: 'guest@example.test' })));
  const blob = [...errs, ...logs].join('\n'); for (const bad of [KEY, CEO, 'guest@example.test', 'SECRETTOKEN', 'Booking pending', 'boom']) assert.ok(!blob.includes(bad), `leaked ${bad}`); assert.ok(logs.length >= 4);
});
test('INTEGRATION with the REAL dispatcher + outbox: sync a synthetic booking -> 2 jobs -> run twice + sweep -> exactly one provider call per job, accepted once, provider id recorded for correlation', async () => {
  const f = prov(); const sender = mk({ fetchImpl: f, allowRecipients: [CEO, 'team@example.test'] }); const env = mkEnv(); await cutover(env);
  await syncCreated(env, 5001, { guest_email: CEO }); const cfg = loadConfig(env);
  for (let i = 0; i < 3; i++) await dispatch(env.DB, cfg, sender, { workerId: 'w', nowMs: Date.now() + i });
  assert.equal(f.calls.length, 2); assert.deepEqual(JSON.parse(JSON.stringify((await env.DB.prepare('SELECT state, COUNT(*) n FROM bula_outbox GROUP BY state').all()).results)), [{ state: 'accepted', n: 2 }]);
  const row = await env.DB.prepare("SELECT job_key, provider_id, booking_ref FROM bula_outbox WHERE recipient_kind='guest'").first(); assert.ok(row.provider_id && row.job_key.length && row.booking_ref, 'booking/reference correlation + provider id stored');
  assert.deepEqual(f.calls.map((c) => c.init.headers['idempotency-key']).sort(), (await env.DB.prepare('SELECT job_key FROM bula_outbox').all()).results.map((r) => r.job_key).sort());
});
test('INTEGRATION: guest not on the allow-list is FAILED visibly (bounded attempts), never sent; no provider call; staff queue shows it', async () => {
  const f = prov(); const sender = mk({ fetchImpl: f, allowRecipients: ['team@example.test'] }); const env = mkEnv(); await cutover(env); await syncCreated(env, 5002); const cfg = loadConfig(env);
  for (let i = 0; i < 8; i++) await dispatch(env.DB, cfg, sender, { workerId: 'w', nowMs: Date.now() + i });
  const st = (await env.DB.prepare('SELECT recipient_kind k, state, attempts, last_error e FROM bula_outbox ORDER BY k').all()).results;
  assert.deepEqual(JSON.parse(JSON.stringify(st.find((x) => x.k === 'guest'))), { k: 'guest', state: 'failed', attempts: cfg.outboxMaxAttempts, e: 'RECIPIENT_NOT_ALLOWED' }); assert.equal(f.calls.length, 1, 'only the staff copy (allow-listed) was sent');
  const h = await collectHealth(env.DB, Date.now()); assert.ok(h.alerts.some((a) => a.code === 'EMAIL_FAILED_OR_DEAD' && a.count === 1));
});
test('NO DUPLICATES under uncertainty: 503 -> ambiguous; a repeat dispatch and reconcile WITHOUT a provider lookup never resend; with a lookup that proves acceptance the job is marked accepted without resending; a proven-absent key is requeued exactly once', async () => {
  const f = prov([{ status: 503 }, { status: 503 }]); const s1 = mk({ fetchImpl: f, allowRecipients: [CEO, 'team@example.test'] }); const env = mkEnv(); await cutover(env); await syncCreated(env, 5003, { guest_email: CEO }); const cfg = loadConfig(env);
  await dispatch(env.DB, cfg, s1, { workerId: 'w', nowMs: Date.now() }); const calls1 = f.calls.length; assert.equal(calls1, 2);
  await dispatch(env.DB, cfg, s1, { workerId: 'w', nowMs: Date.now() + 1 }); await reconcileAmbiguous(env.DB, s1, Date.now() + 2); await dispatch(env.DB, cfg, s1, { workerId: 'w', nowMs: Date.now() + 3 });
  assert.equal(f.calls.length, calls1, 'ambiguous jobs are never resent'); assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM bula_outbox WHERE state='ambiguous'").first()).n, 2);
  const keys = (await env.DB.prepare('SELECT job_key FROM bula_outbox ORDER BY recipient_kind').all()).results.map((r) => r.job_key);
  const s2 = mk({ fetchImpl: f, allowRecipients: [CEO, 'team@example.test'], lookupImpl: async (k) => (k === keys[0] ? { id: 'prov-found' } : null) });
  await reconcileAmbiguous(env.DB, s2, Date.now() + 4); const st = (await env.DB.prepare('SELECT job_key, state, provider_id FROM bula_outbox').all()).results;
  assert.equal(st.find((r) => r.job_key === keys[0]).state, 'accepted'); assert.equal(st.find((r) => r.job_key === keys[1]).state, 'queued');
  assert.equal(f.calls.length, calls1, 'reconcile itself sends nothing');
});
test('DELIVERY STATUS: HMAC-verified webhook -> delivered/bounced evidence on the right job; wrong signature / unknown id / repeat are no-ops; acceptance is never reported as delivery', async () => {
  const body = JSON.stringify({ type: 'delivered', id: 'msg_1' }), secret = 'whsec_synthetic'; const sig = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(await verifyWebhook({ rawBody: body, signature: sig, secret }), true); assert.equal(await verifyWebhook({ rawBody: body, signature: sig.replace(/.$/, '0'), secret }), false); assert.equal(await verifyWebhook({ rawBody: body + ' ', signature: sig, secret }), false); assert.equal(await verifyWebhook({ rawBody: body, signature: sig, secret: '' }), false);
  const f = prov(); const env = mkEnv(); await cutover(env); await syncCreated(env, 5004, { guest_email: CEO }); await dispatch(env.DB, loadConfig(env), mk({ fetchImpl: f, allowRecipients: [CEO, 'team@example.test'] }), { workerId: 'w', nowMs: 1000 });
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM bula_outbox WHERE delivered_at IS NOT NULL').first()).n, 0, 'accepted != delivered');
  assert.equal((await applyDeliveryEvent(env.DB, { type: 'delivered', id: 'msg_1' }, 5000)).applied, true); assert.equal((await applyDeliveryEvent(env.DB, { type: 'delivered', id: 'msg_1' }, 9000)).applied, true);
  assert.equal((await env.DB.prepare('SELECT delivered_at d FROM bula_outbox WHERE provider_id = ?').bind('msg_1').first()).d, 5000, 'first evidence kept');
  assert.equal((await applyDeliveryEvent(env.DB, { type: 'delivered', id: 'nope' }, 1)).applied, false); assert.equal((await applyDeliveryEvent(env.DB, { type: 'weird', id: 'msg_1' }, 1)).applied, false);
  await applyDeliveryEvent(env.DB, { type: 'bounced', id: 'msg_2' }, 6000); assert.ok((await collectHealth(env.DB, Date.now())).alerts.some((a) => a.code === 'EMAIL_BOUNCED'));
});
test('HEALTH CHECK is clean after a normal lifecycle (request, claim, decline, replay) and RAISES each invariant alert when the data is corrupted on purpose', async () => {
  const env = mkEnv(); await offer(env); await cutover(env); await syncCreated(env, 5005); const A = await tokenFor(env, 5005), ana = await staff(env, 'ana', 'ops');
  const h = (await one(await reserve(env, A, 'k1', { expected_net_cents: 12500 }))).data.hold.holdId; await call(env, 'POST', `/preview/admin/bula/holds/${h}/claim`, { staff: ana, body: {} }); await call(env, 'POST', `/preview/admin/bula/holds/${h}/decline`, { staff: ana, body: {} });
  const far = Date.now() + 3600e3; const clean = await collectHealth(env.DB, far); assert.deepEqual(clean.alerts.filter((a) => !/^EMAIL_(STUCK|BLOCKED)/.test(a.code)), [], JSON.stringify(clean.alerts));
  const raise = async (sql, code) => { const e2 = mkEnv(); await offer(e2); await syncCreated(e2, 5006); const t = await tokenFor(e2, 5006); await reserve(e2, t, 'z', { expected_net_cents: 12500 }); const db = e2.DB;
    db.exec ? db.exec('PRAGMA ignore_check_constraints = ON') : null; await db.prepare(sql).run(); const r = await collectHealth(db, Date.now() + 3600e3); assert.ok(r.alerts.some((a) => a.code === code), `${code} :: ${JSON.stringify(r.alerts.map((a) => a.code))}`); };
  await raise("UPDATE bula_offers SET remaining = remaining + 1", 'CAPACITY_MISMATCH');
  await raise("UPDATE bula_credit_accounts SET reserved_cents = reserved_cents + 100, available_cents = available_cents - 100", 'WALLET_RESERVED_NOT_LIVE_REQUESTS');
  await raise("UPDATE bula_credit_accounts SET granted_cents = granted_cents + 100, available_cents = available_cents + 100", 'WALLET_GRANT_LEDGER_MISMATCH');
  await raise("DELETE FROM bula_booking_snapshots", 'SOURCE_ROWS_WITHOUT_SNAPSHOT');
  await raise("DELETE FROM bula_outbox", 'MIRROR_WITHOUT_JOBS_OR_GRANT');
});
test('tag() is stable, short and non-reversible; validAddress rejects header-injection shapes', async () => {
  assert.equal(await tag('a'), await tag('a')); assert.notEqual(await tag('a'), await tag('b')); assert.equal((await tag('x')).length, 12);
  for (const bad of ['a@b', 'a b@c.d', 'a@b.c\nbcc:x@y.z', '<a@b.c>', 'a@b.c,d@e.f', '']) assert.equal(validAddress(bad), false, bad); assert.equal(validAddress('a.b+c@example.test'), true);
});
