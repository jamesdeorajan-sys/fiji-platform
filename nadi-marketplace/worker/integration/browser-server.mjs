// Isolated browser test server: serves a candidate page directory and answers api.nadiairporttransfers.com from the REAL Worker source in <workerDir> over an in-memory database.
// Every outbound call the Worker attempts (WhatsApp etc.) is recorded and BLOCKED. A guard script injected into every HTML page routes the API host to /api/* and blocks every other
// cross-origin fetch / XHR / beacon / window.open. No network, no production data.
//   node integration/browser-server.mjs <siteSrcDir> <port> [workerDir]     (workerDir defaults to this Worker)
//   GET /api/state -> bookings, pricing decisions, alert texts, API log      POST /api/reset -> fresh database
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(process.argv[2]); const PORT = Number(process.argv[3] || 8960); const DIR = path.resolve(process.argv[4] || path.join(here, '..'));
const { loadWorker, makeEnv } = await import(pathToFileURL(path.join(DIR, 'test-fixtures', 'worker-harness.mjs')).href);
const worker = (await loadWorker(DIR)).default; console.warn = () => {};
let h, env, blocked, apiLog, ip = 0;
const reset = () => { h = makeEnv({ settings: { admin_alert_phone: '+61400000001' } }); env = { ...h.env, WHATSAPP_PHONE_ID: 'TEST-PHONE-ID', WHATSAPP_TOKEN: 'TEST-TOKEN' }; blocked = []; apiLog = []; }; reset();
const GUARD = `<script>(function(){var API='https://api.nadiairporttransfers.com';var f=window.fetch.bind(window);window.__blocked=[];
window.fetch=function(u,o){u=String(u&&u.url||u);if(u.indexOf(API)===0){return f('/api'+u.slice(API.length),o);}if(u.indexOf('/')===0||u.indexOf(location.origin)===0){return f(u,o);}window.__blocked.push('fetch '+u);return Promise.reject(new TypeError('blocked by test harness'));};
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){u=String(u);if(u.indexOf(location.origin)!==0&&u.indexOf('/')!==0){window.__blocked.push('xhr '+u);u='/__blocked';}return xo.apply(this,[m,u].concat([].slice.call(arguments,2)));};
navigator.sendBeacon=function(u){window.__blocked.push('beacon '+u);return true;};window.open=function(u){window.__blocked.push('window.open '+u);return null;};})();</script>`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' };
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
async function callWorker(req) {
  const real = globalThis.fetch; globalThis.fetch = async (url, init = {}) => { let body = init.body; try { body = JSON.parse(init.body); } catch { /* not json */ } blocked.push({ url: String(url), body }); return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const pending = [];
  try { const res = await worker.fetch(req, env, { waitUntil: (p) => pending.push(p) }); const body = await res.json().catch(() => null); await Promise.allSettled(pending); return { status: res.status, body }; } finally { globalThis.fetch = real; }
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/bookings' && req.method === 'POST') {
    const text = await readBody(req); const body = JSON.parse(text || '{}'); const before = h.inserted.length;
    const r = await callWorker(new Request('https://api.nadiairporttransfers.com/bookings', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' }, body: text }));
    apiLog.push({ status: r.status, code: r.body && r.body.code, amountSubmitted: body.quoted_amount, saved: h.inserted.length > before ? h.inserted.at(-1).quoted_amount : null, ref: body.client_booking_ref, approvedId: body.approved_final_fare_id, idempotent: r.body && r.body.idempotent });
    return send(res, r.status, r.body);
  }
  if (u.pathname === '/api/reference-fare') { const r = await callWorker(new Request('https://api.nadiairporttransfers.com/reference-fare' + u.search, { headers: { 'CF-Connecting-IP': `203.0.113.${(++ip % 250) + 1}` } })); apiLog.push({ get: 'reference-fare', status: r.status, fare: r.body && r.body.reference_fare_fjd }); return send(res, r.status, r.body); }
  if (u.pathname.startsWith('/api/') && !['/api/reset', '/api/state'].includes(u.pathname)) { apiLog.push({ path: u.pathname, outcome: 'not handled: 404' }); return send(res, 404, { ok: false }); }
  if (u.pathname === '/api/reset') { reset(); return send(res, 200, { ok: true }); }
  if (u.pathname === '/__driver.js' && process.env.DRIVER) return send(res, 200, fs.readFileSync(process.env.DRIVER, 'utf8'), 'text/javascript');   // optional page-driver script (test tooling only)
  if (u.pathname === '/api/state') return send(res, 200, { bookings: h.inserted.map((b) => ({ id: b.id, ref: b.client_booking_ref, route: `${b.pickup_zone} -> ${b.destination_zone}`, vehicle: b.vehicle_type, amount: b.quoted_amount })), decisions: h.events.filter((e) => e.event_type === 'created').map((e) => e.metadata && e.metadata.pricing_decision), outbound_blocked: blocked.length, alert_texts: blocked.flatMap((f) => { const c = f.body && f.body.template && f.body.template.components; return (c || []).flatMap((x) => x.parameters || []).filter((p) => p.type === 'text').map((p) => p.text); }), api_log: apiLog });
  let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html'; let file = path.resolve(path.join(SITE, p)); if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  if (path.extname(file) === '.html') return send(res, 200, fs.readFileSync(file, 'utf8').replace(/<head[^>]*>/i, (m) => m + GUARD), MIME['.html']);
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, '127.0.0.1', () => console.log(`isolated server http://127.0.0.1:${PORT} site=${SITE} worker=${DIR}`));
