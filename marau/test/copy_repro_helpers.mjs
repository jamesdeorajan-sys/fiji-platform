/* Shared helper for the "Check and copy message" regressions: builds an ISOLATED in-memory preview (never the hosted database), publishes a
 * verified-supplier offer in an edition, makes a consenting recipient, approves the review and prepares the recipient list - the exact
 * workflow James ran - then drives the EXACT served staff-console client against the REAL worker, so the client sees the real API contract.
 */
import worker from '../worker/worker.js';
import { makeEnv } from './fixtures.mjs';

export const inDays = (d, h = 0) => new Date(Date.now() + d * 86400_000 + h * 3600_000).toISOString();
export const call = async (env, p, { method = 'GET', body, headers = {} } = {}) => {
  const res = await worker.fetch(new Request('http://marau.test' + p, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text };
};
export const admin = (env) => ({ authorization: `Bearer ${env.MARAU_ADMIN_TEST_TOKEN}` });
export const staffH = (env, t) => ({ ...admin(env), 'x-marau-staff-token': t });

export async function pilotFixture({ consent = 'granted', offerOver = {} } = {}) {
  const env = makeEnv();
  for (const [t, nm] of [['tok-a', 'Operator A (copy repro)'], ['tok-b', 'Operator B (copy repro)']]) await call(env, '/preview/admin/staff-identities', { method: 'POST', headers: admin(env), body: { token: t, operator_name: nm } });
  const A = staffH(env, 'tok-a'); const B = staffH(env, 'tok-b');
  const sup = await call(env, '/preview/admin/suppliers', { method: 'POST', headers: A, body: { name: 'Synthetic Reef Tours (copy repro)', fulfilment_owner: 'Operator A (copy repro)' } });
  await call(env, `/preview/admin/suppliers/${sup.data.supplier_id}/verify`, { method: 'POST', headers: A });
  const offer = await call(env, '/preview/admin/offers', { method: 'POST', headers: A, body: { supplier_id: sup.data.supplier_id, title: 'Synthetic snorkel (copy repro)', location: 'Reef (synthetic)', inclusions: ['boat'], starts_at: inDays(6), book_by: inDays(5), expires_at: inDays(5, 12), capacity: 2, price_per_place_fjd: 120, cost_per_place_fjd: 80, ...offerOver } });
  await call(env, `/preview/admin/offers/${offer.data.offer_id}/publish`, { method: 'POST', headers: A });
  const edDate = inDays(3).slice(0, 10); const edId = `${edDate}:afternoon`; const E = encodeURIComponent(edId);
  await call(env, '/preview/admin/editions', { method: 'POST', headers: A, body: { fiji_date: edDate, slot: 'afternoon', offer_ids: [offer.data.offer_id] } });
  await call(env, `/preview/admin/editions/${E}/publish`, { method: 'POST', headers: A });
  const g = await call(env, '/preview/bookings', { method: 'POST', body: { guest_email: 'copy.repro@example.test', guest_phone: '+15005619999', whatsapp_available: true, pickup_zone: 'Nadi Airport', destination_zone: 'Denarau', vehicle_type: 'Sedan', quoted_amount: 80, pickup_datetime: inDays(2).slice(0, 16) } });
  if (consent) await call(env, '/preview/trip/contact', { method: 'POST', headers: { authorization: `Bearer ${g.data.access_token}` }, body: { marketing_consent: consent } });
  await call(env, `/preview/admin/editions/${E}/review`, { method: 'POST', headers: B, body: { decision: 'approved_for_manual_send', note: 'checked' } });
  const prep = await call(env, `/preview/admin/editions/${E}/sends/prepare`, { method: 'POST', headers: A, body: {} });
  const review = (await call(env, `/preview/admin/editions/${E}/review`, { headers: A })).data;
  const mine = review.recipients.find((r) => r.contact.email === 'copy.repro@example.test');
  return { env, A, B, offerId: offer.data.offer_id, edId, E, sessionId: mine && mine.session_id, guestToken: g.data.access_token, prep };
}

/** The EXACT console client from the served /staff page, wired to the real worker, with a recording DOM / prompt / clipboard. */
export async function servedConsoleOn(env, { prompt = () => null, clipboard = undefined, checkNode = null, fetchOverride = null, execCommand = () => false } = {}) {
  const page = await call(env, '/staff');
  const start = page.text.indexOf('function createStaffConsole(deps)');
  const end = page.text.indexOf('\n}\n', start) + 3;
  const create = new Function(`${page.text.slice(start, end)}\nreturn createStaffConsole;`)();
  const store = new Map(); const log = { prompts: [], toasts: [], clipboard: [], nodes: [], html: {} };
  const makeNode = (id) => ({ id, style: {}, textContent: '', value: '', hidden: false, classList: { add() {}, remove() {} }, set innerHTML(v) { log.html[id] = v; }, get innerHTML() { return log.html[id] || ''; }, setAttribute() {}, focus() {}, select() {}, addEventListener() {}, onclick: null });
  const nodes = new Map();
  const doc = {
    getElementById: (id) => { if (!nodes.has(id)) nodes.set(id, makeNode(id)); const n = nodes.get(id); if (id === 'toast') { Object.defineProperty(n, 'textContent', { set(v) { log.toasts.push(v); }, get() { return log.toasts.at(-1) || ''; }, configurable: true }); } return n; },
    querySelectorAll: (sel) => (sel === '[data-pilot-check]' && checkNode ? [checkNode] : []), createElement: () => makeNode('created'), body: makeNode('body'), execCommand,
  };
  const c = create({ document: doc, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    prompt: (m, d) => { log.prompts.push({ message: m, defaultValue: d }); return prompt(m, d); },
    fetchImpl: async (path, init) => { if (fetchOverride) { const o = await fetchOverride(path, init); if (o) return o; } const r = await worker.fetch(new Request('http://marau.test' + path, init), env); const text = await r.text(); return { ok: r.ok, status: r.status, json: async () => JSON.parse(text) }; },
    ...(clipboard ? { clipboard } : {}) });
  return { c, log, nodes, doc };
}

/** Fake pilot button + helpers: sign in through the real client, click "Check and copy message", wait for the async chain to settle. */
export const fakeCheckNode = (edId, sessionId) => ({ onclick: null, getAttribute: (k) => (k === 'data-pilot-check' ? `${edId}|${sessionId}` : null) });
export const settle = async (ms = 250) => { await new Promise((r) => setTimeout(r, ms)); };
