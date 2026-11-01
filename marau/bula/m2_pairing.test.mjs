// SYNTHETIC. Installed-app (Home Screen) connection: one-time pairing code -> revocable device key for the SAME guest. Real Worker routes. Run from marau/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestD1 } from '../test/d1_sqlite_shim.mjs';
import { synthGuest } from '../test/fixtures.mjs';
import worker from '../worker/worker.js';
import path from 'node:path';
import { fijiYmd, ymdString } from './edition.js';
const DIRS = [path.join(process.cwd(), '..', 'smart-return-trigger-fill', 'migrations'), path.join(process.cwd(), 'migrations'), path.join(process.cwd(), 'bula', 'migrations')];
const ADMIN = 'test-admin-token-do-not-use-in-production';
const mk = () => ({ DB: createTestD1({ migrationsDirs: DIRS }), MARAU_ADMIN_TEST_TOKEN: ADMIN, BULA_SYNTHETIC_TEST: 'on', BULA_CHECKOUT_ENABLED: 'on', BULA_CREDITS_ENABLED: 'on', BULA_POLICY_VERSION: 'synthetic-v1', BULA_DEVICE_PAIRING: 'on' });
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

const ref = async (env, tok) => (await env.DB.prepare('SELECT b.client_booking_ref r FROM marau_test_bookings b JOIN guest_sessions g ON g.session_id = b.guest_session_id WHERE g.access_token = ? AND b.parent_booking_id IS NULL').bind(tok).first()).r;
const gcall = (env, method, p, tok, body, h = {}) => worker.fetch(new Request('http://marau.test' + p, { method, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...h }, body: body !== undefined ? JSON.stringify(body) : undefined }), env);
const issue = async (env, tok) => { const r = await gcall(env, 'POST', '/preview/bula/pair', tok, {}); assert.equal(r.status, 201); return (await r.json()).code; };
const redeem = (env, code, h = {}) => gcall(env, 'POST', '/preview/bula/pair/redeem', null, { code, label: 'Home Screen app' }, h);
const connect = async (env, tok) => { const r = await redeem(env, await issue(env, tok)); assert.equal(r.status, 201); return (await r.json()).deviceToken; };
const wal = async (env, tok) => (await (await gcall(env, 'GET', '/preview/bula/offers', tok)).json()).wallet;
const count = async (env, t) => (await env.DB.prepare(`SELECT COUNT(*) n FROM ${t}`).first()).n;
async function setup(env) { await offer(env, { offer_id: 'ISLAND', operator_id: 'op_demo', credit_restore_hours_before: 2, inventory_restore_hours_before: 2 }); const A = await guest(env); const ceo = await staff(env, 'c1', 'ceo'); await call(env, 'POST', '/preview/admin/bula/credits/grant', { staff: ceo, body: { booking_ref: await ref(env, A) } }); return { A, ceo }; }

test('install → connect → SAME guest: existing FJ$500 and withdrawn requests visible through the device key; no second guest, no second grant; close/reopen = same key still works', async () => {
  const env = mk(); const { A } = await setup(env);
  const rr = await (await gcall(env, 'POST', '/preview/bula/reserve', A, { offer_id: 'ISLAND', version: 1, qty: 1, idem_key: 'k1' })).json(); const h = rr.hold; assert.ok(h, JSON.stringify(rr)); await gcall(env, 'POST', `/preview/bula/holds/${h.holdId}/release`, A, {});
  const sessionsBefore = await count(env, 'guest_sessions'), accountsBefore = await count(env, 'bula_credit_accounts'), grantsBefore = await count(env, "bula_credit_ledger WHERE type='granted'");
  const manifest = await (await call(env, 'GET', '/bula/manifest.webmanifest', { admin: false })).text(); assert.doesNotMatch(manifest, new RegExp(A)); assert.doesNotMatch(manifest, /tok|dev_/i); assert.match(manifest, /"start_url":"\/bula"/);
  assert.equal((await gcall(env, 'GET', '/preview/bula/offers', null)).status, 401, 'the installed app starts with no access');
  const D = await connect(env, A); assert.match(D, /^dev_[0-9a-f]{64}$/); assert.notEqual(D, A);
  assert.equal((await wal(env, D)).availableCents, 50000, 'existing FJ$500'); const mine = (await (await gcall(env, 'GET', '/preview/bula/holds', D)).json()).holds; assert.equal(mine.length, 1); assert.equal(mine[0].holdId, h.holdId); assert.equal(mine[0].state, 'released');
  for (let i = 0; i < 3; i++) assert.equal((await wal(env, D)).availableCents, 50000, 'closed and reopened: same stored key keeps working');
  assert.equal(await count(env, 'guest_sessions'), sessionsBefore); assert.equal(await count(env, 'bula_credit_accounts'), accountsBefore); assert.equal(await count(env, "bula_credit_ledger WHERE type='granted'"), grantsBefore);
  assert.equal((await wal(env, A)).availableCents, 50000, 'the Safari link still works too');
  const again = await gcall(env, 'POST', '/preview/bula/reserve', D, { offer_id: 'ISLAND', version: 1, qty: 1, idem_key: 'dev-1' }); assert.equal(again.status, 201); assert.equal((await wal(env, A)).availableCents, 47500, 'a request made in the app is the same wallet as Safari');
});
test('code security: single use, generic failure, expiry, newest code only, normalised input, hashed at rest, concurrent redemption yields one device', async () => {
  const env = mk(); const { A } = await setup(env); const code = await issue(env, A); assert.match(code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  const raw = code.replace('-', ''); assert.equal((await redeem(env, 'wrong-123')).status, 400);
  const races = await Promise.all([1, 2, 3, 4, 5].map(() => redeem(env, ` ${raw.toLowerCase().slice(0, 4)} - ${raw.slice(4).toLowerCase()} `))); assert.equal(races.filter((r) => r.status === 201).length, 1, 'exactly one redemption wins'); assert.equal(races.filter((r) => r.status === 400).length, 4); assert.equal(await count(env, 'bula_devices'), 1);
  const reuse = await redeem(env, code); assert.equal(reuse.status, 400); const rj = await reuse.json(); assert.equal(rj.error, 'invalid_or_expired_code');
  const dump = JSON.stringify([...(await env.DB.prepare('SELECT * FROM bula_pairing').all()).results, ...(await env.DB.prepare('SELECT * FROM bula_devices').all()).results]); assert.ok(!dump.includes(raw) && !dump.includes('dev_'), 'neither code nor device key is stored in clear');
  const c1 = await issue(env, A); const c2 = await issue(env, A); assert.equal((await redeem(env, c1)).status, 400, 'an older unused code is void once a newer one is issued'); const ok2 = await redeem(env, c2); assert.equal(ok2.status, 201);
  const c3 = await issue(env, A); await env.DB.prepare('UPDATE bula_pairing SET expires_at = ? WHERE used_at IS NULL').bind(Date.now() - 1000).run(); assert.equal((await redeem(env, c3)).status, 400, 'expired code');
  const aud = (await env.DB.prepare("SELECT action, COUNT(*) n FROM bula_audit WHERE action IN ('pairing_code_issued','device_connected') GROUP BY action").all()).results; assert.ok(aud.length === 2);
});
test('brute force: 10 failures from one source lock redemption for that source (even a valid code); other sources unaffected', async () => {
  const env = mk(); const { A } = await setup(env); const code = await issue(env, A); const ip = { 'cf-connecting-ip': '203.0.113.9' };
  for (let i = 0; i < 10; i++) assert.equal((await redeem(env, 'ZZZZ-ZZZ' + (i % 9 + 2), ip)).status, 400);
  assert.equal((await redeem(env, code, ip)).status, 429, 'locked even for a valid code'); assert.equal((await redeem(env, code, { 'cf-connecting-ip': '198.51.100.7' })).status, 201, 'a different source can still connect');
});
test('revocation and expiry are honoured: revoke one device; revoke the guest session; device expiry; device key is NOT staff/admin authority; staff-issued recovery code; cap of 5 devices; strict flag', async () => {
  const env = mk(); const { A, ceo } = await setup(env); const D1 = await connect(env, A), D2 = await connect(env, A);
  const list = (await (await gcall(env, 'GET', '/preview/bula/devices', D1)).json()); assert.equal(list.devices.length, 2); assert.equal(list.devices.filter((d) => d.current).length, 1); assert.ok(!JSON.stringify(list).includes('dev_'), 'list never exposes keys');
  const id2 = list.devices.find((d) => !d.current).deviceId; assert.equal((await gcall(env, 'POST', `/preview/bula/devices/${id2}/revoke`, D1, {})).status, 200); assert.equal((await wal(env, D2)) === undefined, true, 'revoked key is refused'); assert.equal((await gcall(env, 'GET', '/preview/bula/offers', D2)).status, 401); assert.equal((await gcall(env, 'GET', '/preview/bula/offers', D1)).status, 200);
  await env.DB.prepare('UPDATE bula_devices SET expires_at = ? WHERE device_id != ?').bind(Date.now() - 1, id2).run(); assert.equal((await gcall(env, 'GET', '/preview/bula/offers', D1)).status, 401, 'expired device key'); await env.DB.prepare('UPDATE bula_devices SET expires_at = ?').bind(Date.now() + 1e9).run(); await env.DB.prepare('UPDATE bula_devices SET revoked_at = NULL WHERE device_id != ?').bind(id2).run();
  assert.equal((await gcall(env, 'GET', '/preview/bula/offers', D1)).status, 200); await env.DB.prepare('UPDATE guest_sessions SET access_token_revoked = 1').run(); assert.equal((await gcall(env, 'GET', '/preview/bula/offers', D1)).status, 401, 'revoking the guest session revokes its devices'); assert.equal((await gcall(env, 'GET', '/preview/bula/offers', A)).status, 401); await env.DB.prepare('UPDATE guest_sessions SET access_token_revoked = 0').run();
  assert.equal((await call(env, 'GET', '/preview/admin/bula/me', { tok: D1, staff: ceo })).status, 401, 'a device key is not admin authority'); assert.equal((await call(env, 'POST', '/preview/admin/bula/credits/grant', { tok: D1, staff: ceo, body: { booking_ref: await ref(env, A) } })).status, 401);
  const ops = await staff(env, 'o1', 'ops'), ap = await staff(env, 'a1', 'approver'); const r0 = await ref(env, A);
  assert.equal((await call(env, 'POST', '/preview/admin/bula/pairing', { staff: ap, body: { booking_ref: r0 } })).status, 403); assert.equal((await call(env, 'POST', '/preview/admin/bula/pairing', { body: { booking_ref: r0 } })).status, 401); assert.equal((await call(env, 'POST', '/preview/admin/bula/pairing', { staff: ops, body: { booking_ref: 'nope' } })).status, 404);
  const sc = await call(env, 'POST', '/preview/admin/bula/pairing', { staff: ops, body: { booking_ref: r0 } }); assert.equal(sc.status, 201); const D3 = (await (await redeem(env, (await sc.json()).code)).json()).deviceToken; assert.equal((await wal(env, D3)).availableCents, 50000, 'staff-issued code connects the SAME guest');
  assert.equal(await count(env, 'guest_sessions'), 1);
  while ((await count(env, 'bula_devices WHERE revoked_at IS NULL AND expires_at > ' + Date.now())) < 5) await connect(env, A); assert.equal((await gcall(env, 'POST', '/preview/bula/pair', A, {})).status, 409, 'cap of five live devices');
  const off = { ...env, BULA_DEVICE_PAIRING: undefined }; assert.equal((await gcall(off, 'POST', '/preview/bula/pair', A, {})).status, 403); assert.equal((await redeem(off, 'ABCD-EFG2')).status, 403); assert.equal((await gcall(off, 'GET', '/preview/bula/offers', D1)).status, 401, 'flag off: device keys do not authenticate');
});
