// SYNTHETIC. M2: authenticated identities, roles, ownership, CSRF, contract resolution — through the real Worker routes. Run from marau/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestD1 } from '../test/d1_sqlite_shim.mjs';
import { synthGuest } from '../test/fixtures.mjs';
import worker from '../worker/worker.js';
import path from 'node:path';
import { fijiYmd, ymdString } from './edition.js';
const DIRS = [path.join(process.cwd(), '..', 'smart-return-trigger-fill', 'migrations'), path.join(process.cwd(), 'migrations'), path.join(process.cwd(), 'bula', 'migrations')];
const ADMIN = 'test-admin-token-do-not-use-in-production';
const mk = () => ({ DB: createTestD1({ migrationsDirs: DIRS }), MARAU_ADMIN_TEST_TOKEN: ADMIN, BULA_SYNTHETIC_TEST: 'on', BULA_CHECKOUT_ENABLED: 'on', BULA_CREDITS_ENABLED: 'on', BULA_POLICY_VERSION: 'synthetic-v1' });
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
const reserveBody = (extra = {}) => ({ offer_id: 'O1', version: 1, qty: 1, idem_key: 'k1', ...extra });

test('forged identity: no staff token / unknown token / body-supplied staff_id and role grant nothing', async () => {
  const env = mk(); await staff(env, 'ana', 'ops');
  assert.equal((await call(env, 'GET', '/preview/admin/bula/me')).status, 401);                                   // admin credential alone is not a person
  assert.equal((await call(env, 'GET', '/preview/admin/bula/me', { staff: 'stf_nobody' })).status, 401);
  assert.equal((await call(env, 'GET', '/preview/admin/bula/me', { staff: 'stf_ana', admin: false })).status, 401);  // staff token alone is not enough
  const r = await call(env, 'POST', '/preview/admin/bula/offers/O9/approve', { staff: 'stf_ana', body: { staff_id: 'james', role: 'ceo', verified_by: 'james' } });
  assert.notEqual(r.status, 200); const me = await (await call(env, 'GET', '/preview/admin/bula/me', { staff: 'stf_ana' })).json(); assert.deepEqual(me, { staffId: 'ana', role: 'ops' });
  assert.equal((await call(env, 'POST', '/preview/admin/bula/staff', { admin: false, tok: 'x', body: { token: 't', staff_id: 'me', display_name: 'me', role: 'ceo' } })).status, 401);  // cannot self-enrol as CEO
});
test('roles are enforced: ops cannot approve or record contracts; editor cannot confirm; approver cannot import', async () => {
  const env = mk(); const ops = await staff(env, 'ana', 'ops'), ed = await staff(env, 'ed', 'editor'), ap = await staff(env, 'ap', 'approver'), ceo = await staff(env, 'james', 'ceo');
  await offer(env, { status: 'draft' });
  assert.equal((await call(env, 'POST', '/preview/admin/bula/offers/O1/approve', { staff: ops, body: {} })).status, 403);
  assert.equal((await call(env, 'POST', '/preview/admin/bula/contracts', { staff: ops, body: { contract_id: 'C', operator_id: 'op_x', valid_from: 1, valid_to: 2 } })).status, 403);
  assert.equal((await call(env, 'GET', '/preview/admin/bula/queue', { staff: ed })).status, 403);
  assert.equal((await call(env, 'POST', '/preview/admin/bula/offers/import', { staff: ap, body: { csv: 'x' } })).status, 403);
  const apr = await call(env, 'POST', '/preview/admin/bula/offers/O1/approve', { staff: ap, body: {} }); assert.equal(apr.status, 200, JSON.stringify(await apr.clone().json()));   // named approver may
  assert.equal((await env.DB.prepare("SELECT actor FROM bula_audit WHERE action='offer_approved'").first()).actor, 'ap(approver)');
  void ceo;
});
test('guest routes: bearer only (no cookie), JSON content-type required, party comes from the session, other party cannot touch a hold', async () => {
  const env = mk(); await offer(env); const A = await guest(env), B = await guest(env, { guest_email: 'b@example.test', guest_phone: '+15005550102' });
  const viaCookie = await worker.fetch(new Request('http://marau.test/preview/bula/offers', { headers: { cookie: `marau_tok=${A}` } }), env); assert.equal(viaCookie.status, 401);
  assert.equal((await call(env, 'POST', '/preview/bula/reserve', { tok: A, body: 'offer_id=O1', ct: 'text/plain' })).status, 415);
  const r = await call(env, 'POST', '/preview/bula/reserve', { tok: A, body: reserveBody({ party_key: 'trip:SOMEONE-ELSE' }) }); assert.equal(r.status, 201); const h = (await r.json()).hold;
  assert.equal((await env.DB.prepare('SELECT party_key FROM bula_holds WHERE hold_id=?').bind(h.holdId).first()).party_key.startsWith('trip:MARAU-'), true);
  const steal = await call(env, 'POST', `/preview/bula/holds/${h.holdId}/cancel`, { tok: B, body: {} }); assert.notEqual(steal.status, 200);
  assert.equal((await env.DB.prepare('SELECT state FROM bula_holds WHERE hold_id=?').bind(h.holdId).first()).state, 'held');
  assert.equal(((await (await call(env, 'GET', '/preview/bula/holds', { tok: B })).json()).holds).length, 0);
});
test('forged confirm/cancel evidence: a guest cannot confirm; request body kind/ref/verified_by/contract_id are ignored; request offers stay held until a staff session confirms', async () => {
  const env = mk(); await offer(env); const A = await guest(env); const ops = await staff(env, 'ana', 'ops');
  const h = (await (await call(env, 'POST', '/preview/bula/reserve', { tok: A, body: reserveBody({ kind: 'operator_acceptance_contract', ref: 'C1', verified_by: 'contract:C1', contract_id: 'C1', instant_confirm: true }) })).json()).hold;
  assert.equal(h.state, 'held');                                                                                   // not confirmed by anything the browser said
  assert.notEqual((await call(env, 'POST', `/preview/admin/bula/holds/${h.holdId}/confirm`, { tok: A, body: {} })).status, 200);     // guest bearer is not staff
  assert.equal((await env.DB.prepare('SELECT state FROM bula_holds WHERE hold_id=?').bind(h.holdId).first()).state, 'held');
  const ok = await call(env, 'POST', `/preview/admin/bula/holds/${h.holdId}/confirm`, { staff: ops, body: { evidence_note: 'op ref 77', verified_by: 'someone-else' } }); assert.equal(ok.status, 200);
  const row = await env.DB.prepare('SELECT confirmed_by_kind, confirmed_by_ref FROM bula_holds WHERE hold_id=?').bind(h.holdId).first(); assert.match(JSON.stringify(row), /ana/); assert.doesNotMatch(JSON.stringify(row), /someone-else/);
});
test('contract resolution: instant confirmation needs an ACTIVE, in-date contract for the SAME operator and in-scope offer', async () => {
  const env = mk(); const ceo = await staff(env, 'james', 'ceo'); const A = await guest(env);
  const mkc = (b) => call(env, 'POST', '/preview/admin/bula/contracts', { staff: ceo, body: { contract_id: 'C1', operator_id: 'op_x', valid_from: NOW - H, valid_to: NOW + 90 * H, ...b } });
  assert.equal((await mkc({})).status, 201);
  await offer(env, { offer_id: 'OK', instant_confirm: 1, operator_contract_id: 'C1' }); await offer(env, { offer_id: 'WRONGOP', operator_id: 'op_y', instant_confirm: 1, operator_contract_id: 'C1' });
  await offer(env, { offer_id: 'NOCONTRACT', instant_confirm: 1, operator_contract_id: 'C404' });
  const st = async (id, k) => (await (await call(env, 'POST', '/preview/bula/reserve', { tok: A, body: { offer_id: id, version: 1, qty: 1, idem_key: k } })).json()).hold?.state;
  assert.equal(await st('OK', 'a'), 'confirmed'); assert.equal(await st('WRONGOP', 'b'), 'held'); assert.equal(await st('NOCONTRACT', 'c'), 'held');
  await env.DB.prepare("UPDATE bula_operator_contracts SET status='suspended'").run(); await offer(env, { offer_id: 'OK2', instant_confirm: 1, operator_contract_id: 'C1' });
  assert.equal(await st('OK2', 'd'), 'held');
});
test('party/vehicle pricing cannot consume one seat regardless of passenger count (qty must be 1; capacity unit must match basis)', async () => {
  const env = mk(); const A = await guest(env);
  await offer(env, { offer_id: 'PARTY', pricing_basis: 'party', capacity_unit: 'party', capacity_total: 3, remaining: 3 });
  const r = await call(env, 'POST', '/preview/bula/reserve', { tok: A, body: { offer_id: 'PARTY', version: 1, qty: 4, idem_key: 'p' } }); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'qty_must_be_1');
  assert.equal((await call(env, 'POST', '/preview/bula/reserve', { tok: A, body: { offer_id: 'PARTY', version: 1, qty: 1, idem_key: 'p2' } })).status, 201);
});
test('GUEST_UI/STAFF_UI pages serve, are no-cache, and use no external hosts', async () => {
  const env = mk();
  for (const p of ['/bula', '/bula/staff']) { const r = await call(env, 'GET', p, { admin: false }); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-cache'); const t = await r.text(); assert.doesNotMatch(t, /https?:\/\//); assert.doesNotMatch(t, /innerHTML/); }
});

test('REPEATED staff bootstrap: identical repeat is idempotent (no writes, no audit row); same token under a NEW staff_id is a 409 (never 500, never re-assigned) and reveals the bound identity only to the admin credential; roles, ids and tokens preserved; authorisation intact', async () => {
  const env = mk(); const tok = await staff(env, 'ceo-run1', 'ceo'); const seed = (b, o = {}) => call(env, 'POST', '/preview/admin/bula/staff', { body: { token: tok, staff_id: 'ceo-run1', display_name: 'ceo-run1', role: 'ceo', ...b }, ...o });
  const audits = async () => (await env.DB.prepare("SELECT COUNT(*) n FROM bula_audit WHERE action='staff_role_set'").first()).n; const before = await audits();
  const again = await seed({}); assert.equal(again.status, 200); assert.equal((await again.json()).unchanged, true); assert.equal(await audits(), before, 'no new audit row for an identical repeat');
  const clash = await seed({ staff_id: 'ceo-run2' }); assert.equal(clash.status, 409); const cj = await clash.json(); assert.equal(cj.staff_id, 'ceo-run1'); assert.equal(cj.role, 'ceo'); assert.equal(cj.active, 1);
  const rows = (await env.DB.prepare('SELECT staff_id, token, role, active FROM bula_staff_roles').all()).results; assert.equal(JSON.stringify(rows), JSON.stringify([{ staff_id: 'ceo-run1', token: tok, role: 'ceo', active: 1 }]));
  const me = await call(env, 'GET', '/preview/admin/bula/me', { staff: tok }); assert.equal((await me.json()).staffId, 'ceo-run1'); assert.equal(await audits(), before);
  assert.equal((await seed({ staff_id: 'ceo-run2' }, { admin: false, tok: 'x' })).status, 401, 'non-admin gets 401, learns nothing');
  assert.equal((await seed({}, { admin: false, staff: tok, tok: 'wrong' })).status, 401);
  assert.equal((await call(env, 'POST', '/preview/admin/bula/staff', { admin: false, staff: tok, body: { token: 't2', staff_id: 'x2', display_name: 'x2', role: 'ceo' } })).status, 401, 'a staff token alone cannot enrol staff');
  const rr = await seed({ role: 'ops' }); assert.equal(rr.status, 200); assert.equal((await env.DB.prepare('SELECT role FROM bula_staff_roles WHERE staff_id=?').bind('ceo-run1').first()).role, 'ops', 'an explicit admin role change still works and is audited'); assert.equal(await audits(), before + 1);
  for (const tk of ['t_a', 't_b']) await staff(env, 'id_' + tk, 'ops');   // three bootstraps in a row, different tokens: unaffected
  const par = await Promise.all([1, 2, 3, 4].map(() => call(env, 'POST', '/preview/admin/bula/staff', { body: { token: 'stf_race', staff_id: 'race-1', display_name: 'race-1', role: 'ops' } }))); assert.ok(par.every((x) => [200, 409].includes(x.status)), 'concurrent identical bootstraps never 500'); assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM bula_staff_roles WHERE token='stf_race'").first()).n, 1);
});
