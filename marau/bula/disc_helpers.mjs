// Shared helpers for the discovery tests: a faithful double of the patched NAT read-only routes (the real routes are tested in the NAT worker suite), env builder, poll driver.
import worker from '../worker/worker.js';
import { mkEnv, count } from './m3_helpers.mjs';
import { natBooking } from './source_fixtures.mjs';
export { natBooking };
export const TOKEN = 'synthetic-source-token';
export function nat(store, ctl = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(String(url)); calls.push({ method: init.method || 'GET', path: u.pathname + u.search, redirect: init.redirect, hasBody: init.body != null });
    if ((init.method || 'GET') !== 'GET') throw new Error('SYNTHETIC NAT IS READ-ONLY');
    if (ctl.down) return new Response('down', { status: 503 });
    const auth = (init.headers || {}).authorization; if (auth !== `Bearer ${ctl.token ?? TOKEN}`) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    if (u.pathname === '/admin/bookings/recent') {
      const ids = [...store.keys()].sort((a, b) => a - b); const maxId = ids.length ? ids[ids.length - 1] : 0;
      const afterQ = u.searchParams.get('after'); const limit = Number(u.searchParams.get('limit') || 50);
      if (ctl.malformed) return new Response(JSON.stringify({ ok: true, items: 'nope' }), { status: 200 });
      if (afterQ === null) return new Response(JSON.stringify({ ok: true, items: [], next_after: maxId, max_id: maxId, has_more: false, server_time: 'x' }), { status: 200 });
      const after = Number(afterQ); const rows = ids.filter((i) => i > after); const page = rows.slice(0, limit);
      let items = page.map((i) => ({ id: i, created_at: store.get(i).created_at, status: store.get(i).status }));
      if (ctl.dupes) items = [...items, ...items];
      return new Response(JSON.stringify({ ok: true, items, next_after: page.length ? page[page.length - 1] : after, max_id: maxId, has_more: rows.length > page.length, server_time: 'x' }), { status: 200 });
    }
    const id = Number(u.pathname.split('/').pop()); if (ctl.failRead && ctl.failRead.has(id)) return new Response('x', { status: 503 });
    const row = store.get(id); return row ? new Response(JSON.stringify({ ok: true, booking: row }), { status: 200 }) : new Response(JSON.stringify({ ok: false }), { status: 404 });
  };
  f.calls = calls; return f;
}
export function setup(over = {}, ctl = {}) {
  const store = new Map(); const f = nat(store, ctl);
  const env = mkEnv({ BULA_SOURCE_DISCOVERY: 'on', NADI_SOURCE_FETCH: f, NADI_SOURCE_ADMIN_TOKEN: ctl.envToken ?? TOKEN, ...over });
  env.__store = store; env.__ctl = ctl; env.__f = f; return { env, store, f, ctl };
}
export const poll = async (env) => { let p; await worker.scheduled({}, env, { waitUntil: (x) => { p = x; } }); await p; };
export const state = (env) => env.DB.prepare('SELECT * FROM bula_source_discovery_state WHERE id = 1').first();
export const add = (store, id, over = {}) => store.set(id, natBooking(id, over));
export const sessions = (env) => count(env, 'marau_real_booking_links');
export const refusals = (env, w = '1=1') => count(env, 'bula_source_refusals', w);
export async function boot(t) { add(t.store, 1); add(t.store, 2); await poll(t.env); return state(t.env); }   // bootstrap at max_id 2 (history is not mirrored)

/** Run one scheduled poll with the clock pinned to `ms` (Date.now only). */
export const pollAt = async (env, ms) => { const real = Date.now; Date.now = () => ms; try { await poll(env); } finally { Date.now = real; } };
export const mirroredRefs = async (env) => (await env.DB.prepare('SELECT source_booking_ref r FROM marau_real_booking_links ORDER BY CAST(source_booking_ref AS INTEGER)').all()).results.map((x) => Number(x.r));
export const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
