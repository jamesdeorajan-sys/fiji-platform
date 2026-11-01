// SYNTHETIC. Scheduler-test isolation: a cron-only operator's offer is never published by guest reads (open pages, background refreshes) or manual publish; only a cron:* run publishes it and its audit row names that offer. Run from marau/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestD1 } from '../test/d1_sqlite_shim.mjs';
import { synthGuest } from '../test/fixtures.mjs';
import worker from '../worker/worker.js';
import path from 'node:path';
import { runPublisher } from './offers_d1.js';
import { loadConfig } from './config.js';
import { fijiYmd, ymdString } from './edition.js';
const DIRS = [path.join(process.cwd(), '..', 'smart-return-trigger-fill', 'migrations'), path.join(process.cwd(), 'migrations'), path.join(process.cwd(), 'bula', 'migrations')];
const ADMIN = 'test-admin-token-do-not-use-in-production';
const mk = () => ({ DB: createTestD1({ migrationsDirs: DIRS }), MARAU_ADMIN_TEST_TOKEN: ADMIN, BULA_SYNTHETIC_TEST: 'on', BULA_CHECKOUT_ENABLED: 'on', BULA_CREDITS_ENABLED: 'on', BULA_POLICY_VERSION: 'synthetic-v1', BULA_EDITION_PUBLISH_ENABLED: 'on', BULA_CRON_ONLY_OPERATORS: 'op_sched' });
const call = (env, method, p, { tok, staff, admin = true, body, ct = 'application/json' } = {}) => worker.fetch(new Request('http://marau.test' + p, { method,
  headers: { ...(tok ? { authorization: `Bearer ${tok}` } : admin ? { authorization: `Bearer ${ADMIN}` } : {}), ...(staff ? { 'x-marau-staff-token': staff } : {}), ...(body !== undefined ? { 'content-type': ct } : {}) }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }), env);
async function guest(env, over = {}) { const r = await call(env, 'POST', '/preview/bookings', { admin: false, body: synthGuest({ leg_type: 'arrival', ...over }) }); return (await r.json()).access_token; }
async function staff(env, id, role) { const r = await call(env, 'POST', '/preview/admin/bula/staff', { body: { token: `stf_${id}`, staff_id: id, display_name: id, role } }); assert.equal(r.status, 200); return `stf_${id}`; }
const NOW = Date.now(), H = 3600e3;
async function offer(env, o = {}) {
  const d = { offer_id: 'O1', version: 1, status: 'published', title: 'SYNTHETIC Cruise', operator_id: 'op_x', service_date: ymdString(fijiYmd(NOW + 3 * H)), service_start_utc: NOW + 3 * H, pickup_zones: 'Denarau', pricing_basis: 'person', price_cents: 15000, max_credit_cents: 2500, capacity_unit: 'seat', capacity_total: 10, remaining: 10,
    booking_cutoff_utc: NOW + 2 * H, inclusions: 'Lunch', exclusions: '', min_spend_cents: 0, cancellation_terms: 'Free cancel 24h before', credit_restore_hours_before: 12, inventory_restore_hours_before: 12, funding_party: 'vakaviti', operator_payout_cents: 12000,
    instant_confirm: 0, operator_contract_id: null, approved_by: 'james', approved_at: NOW - 1000, created_by: 'james', created_at: NOW - 5000, updated_at: NOW - 5000, ...o };
  const k = Object.keys(d); await env.DB.prepare(`INSERT INTO bula_offers (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).bind(...k.map((x) => d[x])).run(); return d;
}

const audit = async (env) => (await env.DB.prepare("SELECT actor, action, detail FROM bula_audit WHERE action = 'edition_published' ORDER BY seq").all()).results.map((r) => ({ ...r }));
const st = async (env, id) => (await env.DB.prepare('SELECT status FROM bula_offers WHERE offer_id=?').bind(id).first()).status;
test('cron-only operator: repeated guest reads (open pages / background refresh) and manual publish never publish it; a cron run does, and its audit row names exactly that offer', async () => {
  const env = mk(); await offer(env, { offer_id: 'SCHED', operator_id: 'op_sched', status: 'approved', approved_by: 'james' }); await offer(env, { offer_id: 'NORMAL', operator_id: 'op_x', status: 'approved', approved_by: 'james' });
  const A = await guest(env); const ceo = await staff(env, 'c1', 'ceo');
  for (let i = 0; i < 6; i++) assert.equal((await call(env, 'GET', '/preview/bula/offers', { tok: A, admin: false })).status, 200);       // a phone left open: visibilitychange + timer refreshes
  assert.equal(await st(env, 'NORMAL'), 'published', 'ordinary offers still publish lazily'); assert.equal(await st(env, 'SCHED'), 'approved', 'cron-only offer untouched by guest reads');
  assert.equal((await call(env, 'POST', '/preview/admin/bula/publish', { staff: ceo, body: {} })).status, 200); assert.equal(await st(env, 'SCHED'), 'approved', 'untouched by manual publish too');
  const a1 = await audit(env); assert.ok(a1.every((r) => !String(r.detail).split(',').includes('SCHED')), 'no non-cron audit row names the cron-only offer');
  const cfg = loadConfig(env); const r = await runPublisher(env.DB, cfg, Date.now(), 'cron:1700000000000'); assert.equal(r.published, 1); assert.equal(await st(env, 'SCHED'), 'published');
  const row = (await audit(env)).find((x) => x.actor === 'cron:1700000000000'); assert.ok(row); assert.deepEqual(row.detail.split(','), ['SCHED'], 'the cron audit row names exactly the cron-only offer');
  assert.equal((await call(env, 'GET', '/preview/bula/offers', { tok: A, admin: false })).status, 200); assert.equal((await audit(env)).length, a1.length + 1, 'no further publication rows');
});
test('control: without the cron-only setting a guest read DOES publish an approved offer (so the isolation above is the setting, not an accident)', async () => {
  const env = { ...mk(), BULA_CRON_ONLY_OPERATORS: '' }; await offer(env, { offer_id: 'SCHED', operator_id: 'op_sched', status: 'approved', approved_by: 'james' }); const A = await guest(env);
  await call(env, 'GET', '/preview/bula/offers', { tok: A, admin: false }); assert.equal(await st(env, 'SCHED'), 'published'); assert.equal((await audit(env))[0].actor, 'lazy-guest');
});
