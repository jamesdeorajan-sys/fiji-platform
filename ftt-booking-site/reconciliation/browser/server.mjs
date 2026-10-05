// Isolated test server for the in-app browser: serves the FijiDash CANDIDATE (or any FijiDash source dir) and answers api.nadiairporttransfers.com from the real
// wrangler dry-run BUNDLE of the deployed Worker over an in-memory database. Every outbound call the Worker makes is recorded and blocked by the rig.
// A guard script injected into every HTML page routes the API host to /api/*, and blocks every other cross-origin fetch / XHR / beacon / WebSocket.
//   GET  /api/state    -> what the Worker did (bookings, events, outbound calls)
//   POST /api/mode     -> {"fail":"timeout"|"networkerror"|"referencefare"} applies to the NEXT booking write / all reference-fare lookups
//   POST /api/reset    -> fresh database
//   node reconciliation/browser/server.mjs <siteDir> [bundle.mjs = test-fixtures/worker-deployed-7a32a034.mjs] <port>
//   then, in the page: eval(await (await fetch('/__driver.js')).text()) and use window.__trip / window.__confirm (see driver.js)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const fileURLToPathSafe = (u) => fileURLToPath(u);
const { createRig } = await import(new URL('../../test-fixtures/real-worker-rig.mjs', import.meta.url).href);
const SITE = path.resolve(process.argv[2]);
const BUNDLE = path.resolve(process.argv[3] || fileURLToPathSafe(new URL('../../test-fixtures/worker-deployed-7a32a034.mjs', import.meta.url)));
const PORT = Number(process.argv[4] || 8941);
console.warn = () => {};
let rig = await createRig({ bundle: BUNDLE }); let fail = null; let refFail = false; const apiLog = [];
const GUARD = `<script>(function(){var API='https://api.nadiairporttransfers.com';var f=window.fetch.bind(window);window.__blocked=[];
window.fetch=function(u,o){u=String(u&&u.url||u);if(u.indexOf(API)===0){return f('/api'+u.slice(API.length),o);}if(u.indexOf('/')===0||u.indexOf(location.origin)===0){return f(u,o);}window.__blocked.push('fetch '+u);return Promise.reject(new TypeError('blocked by test harness'));};
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){u=String(u);if(u.indexOf(location.origin)!==0&&u.indexOf('/')!==0){window.__blocked.push('xhr '+u);u='/__blocked';}return xo.apply(this,[m,u].concat([].slice.call(arguments,2)));};
navigator.sendBeacon=function(u){window.__blocked.push('beacon '+u);return true;};window.open=function(u){window.__blocked.push('window.open '+u);return null;};})();</script>`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml' };
const send = (res, status, body, type = 'application/json', extra = {}) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/bookings' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}');
    const r = await rig.post(body);
    const entry = { status: r.status, code: r.body && r.body.code, created: r.created.length, bookingId: r.body && r.body.booking_id, idempotent: r.body && r.body.idempotent, amountSubmitted: body.quoted_amount, saved: r.saved && r.created.length ? r.saved.quoted_amount : null, ref: body.client_booking_ref, optIn: body.require_quote_match === true, revisedFrom: body.revised_from_amount, referenceFare: r.body && r.body.reference_fare_fjd, outbound: r.fetches.length };
    if (fail === 'timeout') { fail = null; entry.outcome = 'RESPONSE LOST - the Worker processed the booking, the page never got the reply'; apiLog.push(entry); res.socket.destroy(); return; }
    if (fail === 'networkerror') { fail = null; entry.outcome = 'NETWORK ERROR injected'; apiLog.push(entry); res.socket.destroy(); return; }
    apiLog.push(entry); return send(res, r.status, r.body);
  }
  if (u.pathname === '/api/reference-fare' && req.method === 'GET') {
    if (refFail) { apiLog.push({ get: 'reference-fare', outcome: 'lookup unavailable (injected)' }); return send(res, 503, { ok: false, error: 'injected' }); }
    const r = await rig.get('/reference-fare' + u.search); apiLog.push({ get: 'reference-fare', q: u.search.slice(0, 120), status: r.status, fare: r.body && r.body.reference_fare_fjd }); return send(res, r.status, r.body);
  }
  if (u.pathname.startsWith('/api/') && !['/api/mode', '/api/reset', '/api/state'].includes(u.pathname)) { apiLog.push({ path: u.pathname, method: req.method, outcome: 'not handled by the harness: answered 404' }); return send(res, 404, { ok: false }); }
  if (u.pathname === '/api/mode' && req.method === 'POST') { const b = JSON.parse(await readBody(req) || '{}'); if (b.fail === 'referencefare') refFail = true; else if (b.fail === 'clear') { refFail = false; fail = null; } else fail = b.fail || null; return send(res, 200, { fail, refFail }); }
  if (u.pathname === '/api/reset') { rig = await createRig({ bundle: BUNDLE }); apiLog.length = 0; fail = null; refFail = false; return send(res, 200, { ok: true }); }
  if (u.pathname === '/api/state') {
    const texts = rig.all.fetches.flatMap((f) => { const c = f.body && f.body.template && f.body.template.components; return (c || []).flatMap((x) => x.parameters || []).filter((p) => p.type === 'text').map((p) => p.text); });
    return send(res, 200, { bookings: rig.all.inserted.map((b) => ({ id: b.id, ref: b.client_booking_ref, route: `${b.pickup_zone} -> ${b.destination_zone}`, vehicle: b.vehicle_type, amount: b.quoted_amount })), pricing_decisions: rig.all.events.filter((e) => e.event_type === 'created').map((e) => e.metadata && e.metadata.pricing_decision), outbound_calls: rig.all.fetches.length, alert_texts: texts, api_log: apiLog });
  }
  if (u.pathname === '/__driver.js') return send(res, 200, fs.readFileSync(new URL('./driver.js', import.meta.url), 'utf8'), 'text/javascript');
  let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html';
  let file = path.resolve(path.join(SITE, p));
  if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  if (path.extname(file) === '.html') { let h = fs.readFileSync(file, 'utf8'); h = h.replace(/<head[^>]*>/i, (m) => m + GUARD); return send(res, 200, h, MIME['.html']); }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, '127.0.0.1', () => console.log(`FijiDash isolated server on http://127.0.0.1:${PORT} (site=${SITE})`));
