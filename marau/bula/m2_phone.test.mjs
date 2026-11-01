// SYNTHETIC. Phone-test findings: request/My-bookings consistency, once-only promotional grant, 150/25/125/475 cancellation restore, fixture hiding, badge. Real Worker routes. Run from marau/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestD1 } from '../test/d1_sqlite_shim.mjs';
import { synthGuest } from '../test/fixtures.mjs';
import worker from '../worker/worker.js';
import path from 'node:path';
import { fijiYmd, ymdString } from './edition.js';
const DIRS = [path.join(process.cwd(), '..', 'smart-return-trigger-fill', 'migrations'), path.join(process.cwd(), 'migrations'), path.join(process.cwd(), 'bula', 'migrations')];
const ADMIN = 'test-admin-token-do-not-use-in-production';
const mk = () => ({ DB: createTestD1({ migrationsDirs: DIRS }), MARAU_ADMIN_TEST_TOKEN: ADMIN, BULA_SYNTHETIC_TEST: 'on', BULA_CHECKOUT_ENABLED: 'on', BULA_CREDITS_ENABLED: 'on', BULA_POLICY_VERSION: 'synthetic-v1', BULA_CATALOGUE_HIDDEN_OPERATORS: 'op_acc' });
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
const mine = async (env, tok) => (await (await call(env, 'GET', '/preview/bula/holds', { tok, admin: false })).json()).holds;
const wal = async (env, tok) => (await (await call(env, 'GET', '/preview/bula/offers', { tok, admin: false })).json()).wallet;
const grant = (env, st, r, b = {}) => call(env, 'POST', '/preview/admin/bula/credits/grant', { staff: st, body: { booking_ref: r, ...b } });
const remaining = async (env, id = 'ISLAND') => (await env.DB.prepare('SELECT remaining n FROM bula_offers WHERE offer_id=?').bind(id).first()).n;
const island = (env, o = {}) => offer(env, { offer_id: 'ISLAND', title: 'Demonstration: Island Day Cruise with Lunch', operator_id: 'op_demo', capacity_total: 8, remaining: 8, credit_restore_hours_before: 2, inventory_restore_hours_before: 2, ...o });
const post = (env, p, tok, b) => call(env, 'POST', p, { tok, admin: false, body: b });
const rb = (idem, extra = {}) => ({ offer_id: 'ISLAND', version: 1, qty: 1, idem_key: idem, ...extra });

test('submit → My bookings → refresh → reopen → resubmit: ONE request, same hold id, one seat taken, never a duplicate', async () => {
  const env = mk(); await island(env); const A = await guest(env); const B = await guest(env);
  const first = await post(env, '/preview/bula/reserve', A, rb('tap-1')); assert.equal(first.status, 201); const h1 = (await first.json()).hold;
  const list1 = await mine(env, A); assert.equal(list1.length, 1); assert.equal(list1[0].holdId, h1.holdId); assert.equal(list1[0].state, 'held');
  for (let i = 0; i < 3; i++) { const again = await mine(env, A); assert.equal(again.length, 1, 'refresh / reopen shows the same single request'); assert.equal(again[0].holdId, h1.holdId); }          // second device / reopened app = same token → same list
  const replay = await post(env, '/preview/bula/reserve', A, rb('tap-1')); assert.equal(replay.status, 200); assert.equal((await replay.json()).hold.holdId, h1.holdId, 'double tap / lost response retry = replay');
  const reopen = await post(env, '/preview/bula/reserve', A, rb('tap-2-after-reopen')); assert.equal(reopen.status, 409); const rj = await reopen.json(); assert.equal(rj.code, 'already_requested'); assert.equal(rj.holdId, h1.holdId);
  assert.equal((await mine(env, A)).length, 1); assert.equal(await remaining(env), 7, 'exactly one place taken'); assert.equal((await mine(env, B)).length, 0, 'another guest never sees it');
  assert.equal((await post(env, '/preview/bula/reserve', B, rb('b-1'))).status, 201, 'a different guest can still request the same offer'); assert.equal(await remaining(env), 6);
  const par = await Promise.all([1, 2, 3, 4, 5].map((i) => post(env, '/preview/bula/reserve', B, rb('race-' + i)))); assert.ok(par.every((x) => [200, 409].includes(x.status))); assert.equal((await mine(env, B)).length, 1, 'concurrent taps with different keys cannot create two'); assert.equal(await remaining(env), 6);
  assert.equal((await call(env, 'GET', '/preview/bula/holds', { admin: false })).status, 401, 'no token → 401 (the app now says so instead of showing nothing)');
});
test('FJ$500 promotional grant: CEO only, once only, configured amount (body cannot change it), audited once; 150/25/125/475', async () => {
  const env = mk(); await island(env); const A = await guest(env); const r = await ref(env, A);
  const ops = await staff(env, 'o1', 'ops'), ap = await staff(env, 'a1', 'approver'), ceo = await staff(env, 'c1', 'ceo');
  assert.equal((await grant(env, ops, r)).status, 403); assert.equal((await grant(env, ap, r)).status, 403); assert.equal((await call(env, 'POST', '/preview/admin/bula/credits/grant', { body: { booking_ref: r } })).status, 401, 'admin credential alone is not a person');
  assert.equal((await call(env, 'POST', '/preview/admin/bula/credits/grant', { admin: false, tok: A, staff: ceo, body: { booking_ref: r } })).status, 401, 'a guest bearer cannot grant');
  assert.equal((await grant(env, ceo, 'no-such-booking')).status, 404); assert.equal((await wal(env, A)).availableCents, 0, 'nothing granted yet');
  const g1 = await grant(env, ceo, r, { cents: 1, grant_cents: 99999000, party_key: 'trip:other' }); assert.equal(g1.status, 201); const j1 = await g1.json(); assert.equal(j1.grantedCents, 50000); assert.equal(j1.availableCents, 50000);
  const g2 = await grant(env, ceo, r); assert.equal(g2.status, 200); assert.equal((await g2.json()).alreadyGranted, true); await Promise.all([grant(env, ceo, r), grant(env, ceo, r)]);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM bula_credit_ledger WHERE type='granted'").first()).n, 1); assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM bula_audit WHERE action='credit_granted'").first()).n, 1);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM bula_credit_accounts").first()).n, 1, 'no account for any other party');
  const cards = (await (await call(env, 'GET', '/preview/bula/offers', { tok: A, admin: false })).json()).cards; const c = cards.find((x) => x.offerId === 'ISLAND'); assert.deepEqual([c.unitPriceCents, c.creditCents, c.netPayableCents], [15000, 2500, 12500]);
  const h = (await (await post(env, '/preview/bula/reserve', A, rb('k1', { expected_net_cents: 12500 }))).json()).hold; assert.deepEqual([h.offerPriceCents, h.creditCents, h.netPayableCents], [15000, 2500, 12500]);
  const w = await wal(env, A); assert.equal(w.availableCents, 47500, 'FJ$475 remaining'); assert.equal(w.reservedCents, 2500);
});
test('cancellation restores credit AND capacity exactly once: withdraw a request, and cancel a confirmed booking, inside the test terms; replays and a second guest change nothing', async () => {
  const env = mk(); await island(env); const A = await guest(env); const ceo = await staff(env, 'c1', 'ceo'); await grant(env, ceo, await ref(env, A));
  const h = (await (await post(env, '/preview/bula/reserve', A, rb('k1'))).json()).hold; assert.equal((await wal(env, A)).availableCents, 47500); assert.equal(await remaining(env), 7);
  for (let i = 0; i < 3; i++) await post(env, `/preview/bula/holds/${h.holdId}/release`, A, {});                         // withdraw request (+ repeats)
  let w = await wal(env, A); assert.equal(w.availableCents, 50000); assert.equal(w.reservedCents, 0); assert.equal(await remaining(env), 8); const m1 = (await mine(env, A))[0]; assert.equal(m1.state, 'released'); assert.equal((await mine(env, A)).length, 1);
  const h2 = (await (await post(env, '/preview/bula/reserve', A, rb('k2'))).json()).hold; assert.notEqual(h2.holdId, h.holdId, 'after a withdrawal a fresh request is allowed'); assert.equal((await wal(env, A)).availableCents, 47500);
  assert.equal((await call(env, 'POST', `/preview/admin/bula/holds/${h2.holdId}/confirm`, { staff: ceo, body: {} })).status, 200); w = await wal(env, A); assert.equal(w.availableCents, 47500); assert.equal(await remaining(env), 7);
  const c1 = await post(env, `/preview/bula/holds/${h2.holdId}/cancel`, A, {}); assert.equal(c1.status, 200); const cj = await c1.json(); assert.equal(cj.creditRestored, true); assert.equal(cj.inventoryRestored, true);
  for (let i = 0; i < 3; i++) await post(env, `/preview/bula/holds/${h2.holdId}/cancel`, A, {}); w = await wal(env, A);
  assert.equal(w.availableCents, 50000, 'FJ$500 again — never FJ$525'); assert.equal(w.reservedCents, 0); assert.equal(await remaining(env), 8, 'capacity back to 8 — never 9');
  const acct = await env.DB.prepare('SELECT granted_cents g, available_cents a, reserved_cents r, redeemed_cents d FROM bula_credit_accounts').first(); assert.equal(acct.g, 50000); assert.equal(acct.a + acct.r + acct.d, 50000, 'ledger invariant');
});
test('fixtures stay out of the guest catalogue (operator op_acc) yet remain bookable by id; demonstration offers are shown; badge reads “Subject to team confirmation”', async () => {
  const env = mk(); await island(env); await offer(env, { offer_id: 'ACCFIX', title: 'ACC synthetic fixture', operator_id: 'op_acc' });
  const A = await guest(env); const cards = (await (await call(env, 'GET', '/preview/bula/offers', { tok: A, admin: false })).json()).cards;
  assert.deepEqual(cards.map((c) => c.offerId), ['ISLAND']); assert.match(cards[0].title, /^Demonstration:/);
  assert.equal((await post(env, '/preview/bula/reserve', A, { offer_id: 'ACCFIX', version: 1, qty: 1, idem_key: 'fx' })).status, 201, 'automated tests can still book a hidden fixture by id');
  const ui = await (await call(env, 'GET', '/bula', { admin: false })).text(); assert.match(ui, /Subject to team confirmation/); assert.doesNotMatch(ui, /Request — confirmed by our team/);
});
