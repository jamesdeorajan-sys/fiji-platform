// SYNTHETIC. SQL-LEVEL fault injection through the real Worker routes: at EVERY statement position of each multi-statement batch, a real SQL error aborts the
// batch and the database must roll back completely (no hold without stock decrement, no credit without hold, no audit without mutation).
// Lost response is tested separately: the commit stands and a retry replays rather than duplicating. Also: effective flag behaviour with the EXACT acceptance config.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createTestD1 } from '../test/d1_sqlite_shim.mjs';
import { synthGuest } from '../test/fixtures.mjs';
import worker from '../worker/worker.js';
import { bulaScheduled } from './hook.js';
const DIRS = [path.join(process.cwd(), '..', 'smart-return-trigger-fill', 'migrations'), path.join(process.cwd(), 'migrations'), path.join(process.cwd(), 'bula', 'migrations')];
const ADMIN = 'harness-admin-secret-synthetic';
const BASEF = { BULA_SYNTHETIC_TEST: 'on', BULA_POLICY_VERSION: 'synthetic-v1' };
const ON = { ...BASEF, BULA_CHECKOUT_ENABLED: 'on', BULA_CREDITS_ENABLED: 'on', BULA_EDITION_PUBLISH_ENABLED: 'on', BULA_FAULT_HARNESS: 'on' };
const mk = (flags = ON) => ({ DB: createTestD1({ migrationsDirs: DIRS }), MARAU_ADMIN_TEST_TOKEN: ADMIN, ...flags });
const NOW = Date.now(), H = 3600e3;
const call = (env, method, p, { tok, staff, body, h = {} } = {}) => worker.fetch(new Request('http://marau.test' + p, { method, headers: { authorization: `Bearer ${tok || ADMIN}`, ...(staff ? { 'x-marau-staff-token': staff } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...h }, body: body ? JSON.stringify(body) : undefined }), env);
async function boot(env) {
  await call(env, 'POST', '/preview/admin/bula/staff', { body: { token: 'stf_ops', staff_id: 'ops1', display_name: 'ops1', role: 'ops' } });
  const g = await (await worker.fetch(new Request('http://marau.test/preview/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(synthGuest({ leg_type: 'arrival' })) }), env)).json();
  const sd = new Date(NOW + 3 * H + 12 * H).toISOString().slice(0, 10);
  const d = { offer_id: 'O1', version: 1, status: 'published', title: 'SYNTHETIC', operator_id: 'op_x', service_date: sd, service_start_utc: NOW + 3 * H, pickup_zones: 'D', pricing_basis: 'person', price_cents: 15000, max_credit_cents: 2500, capacity_unit: 'seat', capacity_total: 5, remaining: 5, booking_cutoff_utc: NOW + 2 * H, inclusions: 'x', exclusions: '', min_spend_cents: 0, cancellation_terms: 't', credit_restore_hours_before: 1, inventory_restore_hours_before: 1, funding_party: 'vakaviti', operator_payout_cents: 12000, instant_confirm: 0, operator_contract_id: null, approved_by: 'james', approved_at: NOW - 1000, created_by: 'james', created_at: NOW - 5000, updated_at: NOW - 5000 };
  const k = Object.keys(d); await env.DB.prepare(`INSERT INTO bula_offers (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).bind(...k.map((x) => d[x])).run();
  const t = g.access_token; await call(env, 'GET', '/preview/bula/offers', { tok: t });          // grants/publishes lazily where enabled
  return t;
}
const state = async (db) => JSON.stringify({ remaining: (await db.prepare('SELECT remaining FROM bula_offers').first()).remaining, holds: (await db.prepare('SELECT hold_id,state,qty,credit_cents FROM bula_holds ORDER BY hold_id').all()).results,
  credit: (await db.prepare('SELECT available_cents, reserved_cents FROM bula_credit_accounts').all()).results, ledger: (await db.prepare('SELECT COUNT(*) n FROM bula_credit_ledger').first()).n, audit: (await db.prepare('SELECT COUNT(*) n FROM bula_audit').first()).n });
const reserveReq = (t, key, h) => ({ tok: t, body: { offer_id: 'O1', version: 1, qty: 2, idem_key: key }, h });
const INJ = { 'x-bula-harness-key': ADMIN };

test('RESERVE: a real SQL error at EVERY statement position of the batch rolls everything back; the same idempotency key then succeeds exactly once', async () => {
  const env = mk(); const t = await boot(env); const before = await state(env.DB); let positions = 0;
  for (let k = 0; k < 40; k++) {
    const r = await call(env, 'POST', '/preview/bula/reserve', reserveReq(t, 'fk', { ...INJ, 'x-bula-fault-statement': String(k) }));
    if (r.headers.get('x-bula-fault-injected') !== 'yes') break;                // position beyond the batch length: all positions covered
    positions++; assert.ok(r.status >= 400, `k=${k} must fail`); assert.equal(await state(env.DB), before, `k=${k}: database must be exactly as before`);
  }
  assert.ok(positions >= 3, `expected a multi-statement batch, injected at ${positions} positions`);
  // the loop's final (un-injected) call committed it; the same key must now replay, not duplicate
  const again = await call(env, 'POST', '/preview/bula/reserve', reserveReq(t, 'fk')); assert.equal(again.status, 200); assert.equal((await again.json()).replay, true);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM bula_holds').first()).n, 1); assert.equal((await env.DB.prepare('SELECT remaining FROM bula_offers').first()).remaining, 3);
});
test('CONFIRM / CANCEL / OFFER APPROVE: SQL error at every statement position rolls back; nothing half-applies', async () => {
  for (const [name, setup, req] of [
    ['confirm', async (env, t) => (await (await call(env, 'POST', '/preview/bula/reserve', reserveReq(t, 'c1'))).json()).hold.holdId, (id) => [`/preview/admin/bula/holds/${id}/confirm`, { staff: 'stf_ops', body: { evidence_note: 'n' } }]],
    ['cancel', async (env, t) => { const id = (await (await call(env, 'POST', '/preview/bula/reserve', reserveReq(t, 'c2'))).json()).hold.holdId; await call(env, 'POST', `/preview/admin/bula/holds/${id}/confirm`, { staff: 'stf_ops', body: {} }); return id; }, (id) => [`/preview/admin/bula/holds/${id}/cancel`, { staff: 'stf_ops', body: { evidence_note: 'guest asked' } }]],
    ['release', async (env, t) => (await (await call(env, 'POST', '/preview/bula/reserve', reserveReq(t, 'c3'))).json()).hold.holdId, (id, t) => [`/preview/bula/holds/${id}/release`, { tok: t, body: {} }]],
  ]) {
    const env = mk(); const t = await boot(env); const id = await setup(env, t); const before = await state(env.DB); let n = 0;
    for (let k = 0; k < 40; k++) { const [p, o] = req(id, t); const r = await call(env, 'POST', p, { ...o, h: { ...INJ, 'x-bula-fault-statement': String(k) } }); if (r.headers.get('x-bula-fault-injected') !== 'yes') break; n++; assert.equal(await state(env.DB), before, `${name} k=${k}`); }
    assert.ok(n >= 2, `${name}: positions injected ${n}`); assert.notEqual(await state(env.DB), before, `${name}: the un-injected call applied it`);
  }
  const env = mk(); await boot(env); await env.DB.prepare("UPDATE bula_offers SET status='draft', approved_by=NULL, approved_at=NULL").run(); await call(env, 'POST', '/preview/admin/bula/staff', { body: { token: 'stf_ap', staff_id: 'ap', display_name: 'ap', role: 'approver' } });
  const before = await state(env.DB); let n = 0; for (let k = 0; k < 10; k++) { const r = await call(env, 'POST', '/preview/admin/bula/offers/O1/approve', { staff: 'stf_ap', body: {}, h: { ...INJ, 'x-bula-fault-statement': String(k) } }); if (r.headers.get('x-bula-fault-injected') !== 'yes') break; n++; assert.equal(await state(env.DB), before); assert.equal((await env.DB.prepare('SELECT status FROM bula_offers').first()).status, 'draft'); }
  assert.ok(n >= 2); assert.equal((await env.DB.prepare('SELECT status FROM bula_offers').first()).status, 'approved');
});
test('LOST RESPONSE: the commit stands (state unchanged by the lost reply) and a retry replays the same hold; a lost confirm reply does not double-confirm', async () => {
  const env = mk(); const t = await boot(env);
  const lost = await call(env, 'POST', '/preview/bula/reserve', reserveReq(t, 'lr', { ...INJ, 'x-bula-drop-response': 'on' })); assert.equal(lost.status, 504);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM bula_holds').first()).n, 1);                      // committed although the client saw nothing
  const retry = await call(env, 'POST', '/preview/bula/reserve', reserveReq(t, 'lr')); const j = await retry.json(); assert.equal(j.replay, true); assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM bula_holds').first()).n, 1);
  const c1 = await call(env, 'POST', `/preview/admin/bula/holds/${j.hold.holdId}/confirm`, { staff: 'stf_ops', body: {}, h: { ...INJ, 'x-bula-drop-response': 'on' } }); assert.equal(c1.status, 504);
  const c2 = await call(env, 'POST', `/preview/admin/bula/holds/${j.hold.holdId}/confirm`, { staff: 'stf_ops', body: {} }); assert.equal((await c2.json()).replay, true);
});
test('harness is unreachable without BULA_FAULT_HARNESS=on AND the harness key', async () => {
  const off = mk({ ...ON, BULA_FAULT_HARNESS: 'off' }); const t = await boot(off); const before = await state(off.DB);
  const r = await call(off, 'POST', '/preview/bula/reserve', reserveReq(t, 'x', { ...INJ, 'x-bula-fault-statement': '0' })); assert.equal(r.status, 201); assert.notEqual(before, await state(off.DB));
  const on = mk(); const t2 = await boot(on); const r2 = await call(on, 'POST', '/preview/bula/reserve', reserveReq(t2, 'y', { 'x-bula-harness-key': 'wrong', 'x-bula-fault-statement': '0' })); assert.equal(r2.status, 201);
});
test('EXACT ACCEPTANCE CONFIG (BULA_SYNTHETIC_TEST=on, every feature flag off) is inert: scheduled() does nothing, guest offers do not publish, reserve/credits/outbox are refused', async () => {
  const env = mk(BASEF); const t = await boot(env);
  await env.DB.prepare("UPDATE bula_offers SET status='approved'").run();
  assert.deepEqual(await bulaScheduled(env, NOW), {}); assert.equal((await env.DB.prepare('SELECT status FROM bula_offers').first()).status, 'approved');
  const o = await (await call(env, 'GET', '/preview/bula/offers', { tok: t })).json(); assert.equal(o.checkoutEnabled, false); assert.equal(o.wallet, null); assert.equal((await env.DB.prepare('SELECT status FROM bula_offers').first()).status, 'approved');
  assert.equal((await call(env, 'POST', '/preview/bula/reserve', reserveReq(t, 'z'))).status, 403);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM bula_credit_accounts').first()).n, 0); assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM bula_outbox').first()).n, 0);
  assert.equal((await call(env, 'POST', '/preview/bula/outbox/run', {})).status, 200);   // runner endpoint answers but, with the outbox flag off, does nothing
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM bula_outbox').first()).n, 0);
});
