// Isolated test server for the in-app browser: serves the CANDIDATE page and answers /api/* from the real wrangler dry-run BUNDLE of the Worker candidate
// over an in-memory database. Nothing leaves the process: every Meta/WhatsApp/outbound call the Worker makes is recorded and blocked by the rig.
//   GET  /api/state   -> what the Worker did (bookings, events, outbound calls, writes)
//   POST /api/mode    -> {"fail":"timeout"|"networkerror"} applies to the NEXT booking write only
//   POST /api/reset   -> fresh database
//   POST /api/bookings -> the Worker's POST /bookings
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const SCR = 'C:/Users/James/AppData/Local/Temp/claude/C--Users-James-Desktop-VAKAVITI-MASTER/a8c468c9-8b61-4c40-9acf-bf7f5a2e8175/scratchpad';
const { createRig, bundleCandidate } = await import(pathToFileURL(`${SCR}/p0-worker/nadi-marketplace/worker/test-fixtures/rig.mjs`).href);
const SITE = path.resolve(process.argv[2] || `${SCR}/p0-site/nadi-airport-transfers-site/src`);
const BUNDLE_FROM = process.argv[3]; // optional: a prebuilt worker bundle (e.g. of the DEPLOYED base) for before/after
const PORT = Number(process.argv[4] || 8931);
const bundle = BUNDLE_FROM || bundleCandidate();
let rig = await createRig({ bundle }); let fail = null; const apiLog = [];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(b)); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/bookings' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}');
    const r = await rig.post(body);
    const entry = { status: r.status, code: r.body && r.body.code, created: r.created.length, bookingId: r.body && r.body.booking_id, idempotent: r.body && r.body.idempotent, amountSubmitted: body.quoted_amount, ref: body.client_booking_ref, optIn: body.require_quote_match === true, revisedFrom: body.revised_from_amount, outbound: r.fetches.length };
    if (fail === 'networkerror') { fail = null; entry.outcome = 'NETWORK ERROR injected - the request never reached the Worker'; apiLog.push(entry); /* undo: the Worker DID run in this harness, so refuse to run it */ }
    if (fail === 'timeout') { fail = null; entry.outcome = 'RESPONSE LOST - the Worker processed the booking, the page never got the reply'; apiLog.push(entry); res.socket.destroy(); return; }
    apiLog.push(entry); return send(res, r.status, r.body);
  }
  if (u.pathname === '/api/mode' && req.method === 'POST') { fail = JSON.parse(await readBody(req) || '{}').fail || null; return send(res, 200, { fail }); }
  if (u.pathname === '/api/reset') { rig = await createRig({ bundle }); apiLog.length = 0; fail = null; return send(res, 200, { ok: true }); }
  if (u.pathname === '/api/state') {
    const texts = rig.all.fetches.flatMap((f) => { const c = f.body && f.body.template && f.body.template.components; return (c || []).flatMap((x) => x.parameters || []).filter((p) => p.type === 'text').map((p) => p.text); });
    return send(res, 200, { bookings: rig.all.inserted.map((b) => ({ id: b.id, ref: b.client_booking_ref, route: `${b.pickup_zone} -> ${b.destination_zone}`, vehicle: b.vehicle_type, currency: b.quoted_currency, amount: b.quoted_amount })), events: rig.all.events.filter((e) => e.event_type === 'created').map((e) => e.metadata), outbound_calls: rig.all.fetches.length, alert_texts: texts, api_log: apiLog, escalations: rig.all.escalations.length });
  }
  if (u.pathname === '/__helpers.js') return send(res, 200, fs.readFileSync(new URL('./helpers.js', import.meta.url), 'utf8'), 'text/javascript');
  let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html';
  const file = path.resolve(path.join(SITE, p));
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found', 'text/plain');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`candidate test server on http://127.0.0.1:${PORT} (site=${SITE}) bundle=${path.basename(path.dirname(bundle))}`));
