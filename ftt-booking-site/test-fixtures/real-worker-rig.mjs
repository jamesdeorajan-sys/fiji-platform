// A stateful rig around a Worker candidate: one in-memory database (idempotency works across calls), every outbound fetch recorded and BLOCKED
// (nothing leaves the process), waitUntil promises awaited so alerts/broadcasts are observed. The candidate can be the source directory or the
// bundle produced by a real `wrangler deploy --dry-run` (what would actually ship).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { makeEnv, loadWorker } from './real-worker-harness.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));

export function bundleCandidate() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  const env = { ...process.env }; delete env.CLOUDFLARE_API_TOKEN;
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'deploy', '--dry-run', '--outdir', out], { cwd: path.join(here, '..'), env, shell: process.platform === 'win32', stdio: 'pipe' });
  return path.join(out, 'worker.js');
}

export async function createRig({ dir, bundle, settings = { admin_alert_phone: '+61400000001' } } = {}) {
  const worker = bundle ? (await import(pathToFileURL(bundle).href + '?b=' + Date.now())).default : (await loadWorker(dir)).default;
  const h = makeEnv({ settings });
  const env = { ...h.env, WHATSAPP_PHONE_ID: 'TEST-PHONE-ID', WHATSAPP_TOKEN: 'TEST-TOKEN' };
  const all = { fetches: [], writes: h.writes, events: h.events, inserted: h.inserted, escalations: h.escalations };
  async function post(payload, { ip = '203.0.113.9' } = {}) {
    const calls = []; const w0 = h.writes.length; const e0 = h.events.length; const i0 = h.inserted.length;
    const realFetch = globalThis.fetch; const pending = [];
    globalThis.fetch = async (url, init = {}) => { let body = init.body; try { body = JSON.parse(init.body); } catch { /* not json */ } calls.push({ url: String(url), body }); all.fetches.push(calls.at(-1)); return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }], ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }); };
    try {
      const res = await worker.fetch(new Request('https://api.nadiairporttransfers.com/bookings', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip, origin: 'https://nadiairporttransfers.com' }, body: JSON.stringify(payload) }), env, { waitUntil: (p) => pending.push(p) });
      const body = await res.json().catch(() => null);
      await Promise.allSettled(pending);
      return { status: res.status, body, fetches: calls, writes: h.writes.slice(w0), events: h.events.slice(e0), created: h.inserted.slice(i0), saved: h.inserted.at(-1) || null, totalBookings: h.inserted.length };
    } finally { globalThis.fetch = realFetch; }
  }
  // GET against the same Worker (e.g. /reference-fare); outbound calls are blocked exactly as for post()
  let ipN = 0;
  async function get(pathAndQuery) {
    const realFetch = globalThis.fetch; const pending = [];
    globalThis.fetch = async (url, init = {}) => { all.fetches.push({ url: String(url), body: init.body }); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };
    try {
      const res = await worker.fetch(new Request('https://api.nadiairporttransfers.com' + pathAndQuery, { headers: { 'CF-Connecting-IP': `203.0.113.${(++ipN % 250) + 1}`, origin: 'https://book.fijidash.com' } }), env, { waitUntil: (p) => pending.push(p) });
      const body = await res.json().catch(() => null);
      await Promise.allSettled(pending);
      return { status: res.status, body };
    } finally { globalThis.fetch = realFetch; }
  }
  return { post, get, all, h };
}
