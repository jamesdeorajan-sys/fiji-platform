// Isolated browser test server with a REAL (in-memory SQLite) database: serves a candidate page directory and answers api.nadiairporttransfers.com from the REAL worker.js
// plus the full migration chain (including milestone38). Every outbound call the Worker attempts (WhatsApp etc.) is recorded and BLOCKED; the page guard blocks every
// other cross-origin request. No network, no production data, synthetic only.
//   node integration/ef-browser-server.mjs <siteSrcDir> <port>      GET /api/state -> tables + blocked outbound log      POST /api/reset -> fresh database
//   POST /api/__lose-next-booking-response   the next POST /bookings is committed by the Worker but its response is dropped (simulates a lost response)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const here = path.dirname(fileURLToPath(import.meta.url)); const WDIR = path.join(here, '..');
const SITE = path.resolve(process.argv[2]); const PORT = Number(process.argv[3] || 8980);
const { default: worker } = await import('file:///' + path.join(WDIR, 'worker.js').replace(/\\/g, '/'));
console.warn = () => {};
const SCHEMA = fs.readFileSync(path.join(WDIR, '..', 'schema.sql'), 'utf8');
const MIG = ['milestone34-booking-idempotency-and-contact-fields.sql', 'milestone35-revenue-attribution.sql', 'milestone36-admin-notification-retry-state.sql', 'milestone38-email-followups.sql'].map((f) => fs.readFileSync(path.join(WDIR, '..', 'migrations', f), 'utf8'));
const d1 = (db) => ({ prepare(sql) { let a = []; const api = { bind(...x) { a = x; return api; }, async first() { const r = db.prepare(sql).get(...a); return r === undefined ? null : r; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { const i = db.prepare(sql).run(...a); return { meta: { changes: i.changes, last_row_id: i.lastInsertRowid } }; } }; return api; } });
let db, env, blocked, apiLog, loseNext = false;
const reset = () => { db = new DatabaseSync(':memory:'); db.exec(SCHEMA); for (const m of MIG) db.exec(m); db.prepare(`UPDATE platform_settings SET value = '+6799999999' WHERE key = 'admin_alert_phone'`).run(); env = { DB: d1(db), ADMIN_TOKEN: 'browser-test-admin', WHATSAPP_TOKEN: 'TEST', WHATSAPP_PHONE_ID: 'TEST' }; blocked = []; apiLog = []; loseNext = false; }; reset();
const GUARD = `<script>(function(){var API=['https://api.nadiairporttransfers.com','https://api.fijidash.com'];var f=window.fetch.bind(window);window.__blocked=[];
window.fetch=function(u,o){u=String(u&&u.url||u);for(var i=0;i<API.length;i++){if(u.indexOf(API[i])===0){return f('/api'+u.slice(API[i].length),o);}}if(u.indexOf('/')===0||u.indexOf(location.origin)===0){return f(u,o);}window.__blocked.push('fetch '+u);return Promise.reject(new TypeError('blocked by the test harness'));};
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){u=String(u);if(u.indexOf(location.origin)!==0&&u.indexOf('/')!==0){window.__blocked.push('xhr '+u);u='/__blocked';}return xo.apply(this,[m,u].concat([].slice.call(arguments,2)));};
navigator.sendBeacon=function(u){window.__blocked.push('beacon '+u);return true;};window.open=function(u){window.__blocked.push('window.open '+u);return null;};})();</script>`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' };
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
async function callWorker(url, method, text, extraHeaders = {}) {
  const real = globalThis.fetch; globalThis.fetch = async (u, init = {}) => { blocked.push({ url: String(u), body: String(init.body || '').slice(0, 400) }); return new Response(JSON.stringify({ messages: [{ id: 'wamid.TEST' }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const pending = [];
  try { const res = await worker.fetch(new Request('https://api.test' + url, { method, headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...extraHeaders }, body: method === 'GET' ? undefined : text }), env, { waitUntil: (p) => pending.push(p) }); const body = await res.json().catch(() => null); await Promise.allSettled(pending); return { status: res.status, body }; } finally { globalThis.fetch = real; }
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/reset') { reset(); return send(res, 200, { ok: true }); }
  if (u.pathname === '/api/__lose-next-booking-response') { loseNext = true; return send(res, 200, { ok: true }); }
  if (u.pathname === '/api/state') return send(res, 200, { bookings: db.prepare('SELECT id, client_booking_ref, guest_email, guest_phone, pickup_zone, destination_zone, quoted_amount FROM bookings').all(), followups: db.prepare('SELECT * FROM email_followups').all(), escalations: db.prepare('SELECT id, context, booking_id, resolved FROM escalations').all(), outbound_blocked: blocked, api_log: apiLog });
  if (u.pathname === '/__driver.js' && process.env.DRIVER) return send(res, 200, fs.readFileSync(process.env.DRIVER, 'utf8'), 'text/javascript');
  if (u.pathname.startsWith('/api/')) {
    const text = req.method === 'GET' ? '' : await readBody(req); const p = u.pathname.slice(4) + u.search;
    if (/^\/reference-fare/.test(p)) { apiLog.push({ path: p, outcome: 'reference-fare answered by the stub (not exercised here)' }); return send(res, 404, { ok: false }); }
    const r = await callWorker(p, req.method, text); let bodyIn = {}; try { bodyIn = JSON.parse(text || '{}'); } catch { /* none */ }
    apiLog.push({ path: u.pathname, status: r.status, ref: bodyIn.client_booking_ref || bodyIn.client_ref, code: r.body && r.body.code, idempotent: r.body && r.body.idempotent, created: r.body && r.body.created, kind: r.body && r.body.kind, token_returned: !!(r.body && (r.body.followup_token || r.body.token)) });
    if (u.pathname === '/api/bookings' && req.method === 'POST' && loseNext) { loseNext = false; apiLog.push({ note: 'response DROPPED after the Worker committed' }); return req.socket.destroy(); }
    return send(res, r.status, r.body);
  }
  let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html'; let file = path.resolve(path.join(SITE, p)); if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  if (path.extname(file) === '.html') return send(res, 200, fs.readFileSync(file, 'utf8').replace(/<head[^>]*>/i, (m) => m + GUARD), MIME['.html']);
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, '127.0.0.1', () => console.log(`isolated sqlite server http://127.0.0.1:${PORT} site=${SITE}`));
