// Shared helpers for the saved-booking / My trip / staff-queue tests. Real Worker, real route code, in-memory D1 shim, synthetic data only.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createTestD1 } from '../test/d1_sqlite_shim.mjs';
import worker from '../worker/worker.js';
import { fijiYmd, ymdString } from './edition.js';
import { natBooking, natFetch, NAT_ORIGIN } from './source_fixtures.mjs';
export { natBooking, natFetch };
const DIRS = [path.join(process.cwd(), '..', 'smart-return-trigger-fill', 'migrations'), path.join(process.cwd(), 'migrations'), path.join(process.cwd(), 'bula', 'migrations')];
export const ADMIN = 'test-admin-token-do-not-use-in-production';
export const NOW = Date.now(), H = 3600e3;
export function mkEnv(over = {}) {
  const store = new Map(); const fetchImpl = natFetch(store, over.__ctl || {});
  const { __ctl, ...rest } = over;
  const env = { DB: createTestD1({ migrationsDirs: DIRS }), MARAU_ADMIN_TEST_TOKEN: ADMIN, BULA_SYNTHETIC_TEST: 'on', BULA_CHECKOUT_ENABLED: 'on', BULA_CREDITS_ENABLED: 'on', BULA_OUTBOX_ENABLED: 'on', BULA_SOURCE_SYNC: 'on',
    BULA_POLICY_VERSION: 'synthetic-v1', BULA_STAFF_INBOX: 'team@example.test', BULA_GUEST_ORIGIN: 'https://guest.synthetic.test', NADI_SOURCE_BASE_URL: NAT_ORIGIN, NADI_SOURCE_ADMIN_TOKEN: 'synthetic-source-token', NADI_SOURCE_FETCH: fetchImpl, ...rest };
  env.__store = store; env.__fetch = fetchImpl; return env;
}
export const call = (env, method, p, { tok, staff, admin = true, body } = {}) => worker.fetch(new Request('http://marau.test' + p, { method,
  headers: { ...(tok ? { authorization: `Bearer ${tok}` } : admin ? { authorization: `Bearer ${ADMIN}` } : {}), ...(staff ? { 'x-marau-staff-token': staff } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
export const one = async (r) => ({ status: r.status, data: await r.json() });
let ev = 100;
/** Send the source's "created" event for a synthetic NAT booking through the REAL admin sync route. */
export async function syncCreated(env, id, over = {}) {
  env.__store.set(id, natBooking(id, over));
  return one(await call(env, 'POST', `/preview/admin/synthetic-source/${id}/sync-event`, { body: { event_type: 'created', new_status: 'pending', source_event_id: ++ev, booking_id: id } }));
}
export async function syncStatus(env, id, status, type = 'accepted') {
  env.__store.set(id, { ...env.__store.get(id), status });
  return one(await call(env, 'POST', `/preview/admin/synthetic-source/${id}/sync-event`, { body: { event_type: type, new_status: status, source_event_id: ++ev, booking_id: id } }));
}
export const count = async (env, t, where = '1=1') => (await env.DB.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${where}`).first()).n;
export const tokenFor = async (env, id) => (await env.DB.prepare('SELECT g.access_token t FROM marau_real_booking_links l JOIN guest_sessions g ON g.session_id = l.guest_session_id WHERE l.source_booking_ref = ?').bind(String(id)).first()).t;
export async function staff(env, id, role) { const r = await call(env, 'POST', '/preview/admin/bula/staff', { body: { token: `stf_${id}`, staff_id: id, display_name: id, role } }); assert.equal(r.status, 200); return `stf_${id}`; }
export async function offer(env, o = {}) {
  const d = { offer_id: 'ISLAND', version: 1, status: 'published', title: 'Demonstration: Island Day Cruise with Lunch', operator_id: 'op_demo', service_date: ymdString(fijiYmd(NOW + 3 * H)), service_start_utc: NOW + 3 * H, pickup_zones: 'Denarau', pricing_basis: 'person', price_cents: 15000, max_credit_cents: 2500, capacity_unit: 'seat', capacity_total: 8, remaining: 8,
    booking_cutoff_utc: NOW + 2 * H, inclusions: 'Lunch', exclusions: '', min_spend_cents: 0, cancellation_terms: 'Free cancel 24h before', credit_restore_hours_before: 2, inventory_restore_hours_before: 2, funding_party: 'vakaviti', operator_payout_cents: 12000,
    instant_confirm: 0, operator_contract_id: null, approved_by: 'james', approved_at: NOW - 1000, created_by: 'james', created_at: NOW - 5000, updated_at: NOW - 5000, ...o };
  const k = Object.keys(d); await env.DB.prepare(`INSERT INTO bula_offers (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).bind(...k.map((x) => d[x])).run(); return d;
}
export const reserve = (env, tok, idem, extra = {}) => call(env, 'POST', '/preview/bula/reserve', { tok, admin: false, body: { offer_id: 'ISLAND', version: 1, qty: 1, idem_key: idem, ...extra } });
export const cutover = (env) => env.DB.prepare("INSERT OR REPLACE INTO bula_settings (key, value, updated_at) VALUES ('outbox_cutover_iso', '2000-01-01T00:00:00.000Z', 1)").run();
