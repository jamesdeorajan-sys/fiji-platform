// ISOLATED Driver PWA v2 Gate 1 dev server. Binds 127.0.0.1 only. In-memory SQLite, capture adapters, synthetic data.
// /__test/* are test-control endpoints that exist ONLY in this dev server (never in src/): create a synthetic booking,
// move the server clock, choose a delivery mode. There is no production hostname, binding, secret or send path here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorld } from '../test-harness/fixture.mjs';
import { handle } from '../src/http.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PWA = path.join(here, '..', 'pwa');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

class DevClock { constructor() { this.offset = 0; } now() { return Date.now() + this.offset; } advance(ms) { this.offset += ms; } }

export async function startDevServer({ port = 0, drivers = 3 } = {}) {
  const clock = new DevClock();
  let mode = 'DELIVERED';
  const w = await makeWorld({ drivers, clock, deliveryMode: () => mode });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
      if (url.pathname.startsWith('/api/')) {
        const chunks = []; for await (const c of req) chunks.push(c);
        const r = await handle(new Request(`http://isolated.test${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), { service: w.service });
        return send(r.status, await r.text());
      }
      if (url.pathname.startsWith('/__test/')) {
        const op = url.pathname.slice(8);
        if (op === 'new-booking') { const b = await w.newBooking(); await w.service.startDispatch(b); return send(200, { booking_id: b }); }
        if (op === 'advance') { clock.advance(Number(url.searchParams.get('s') || 0) * 1000); const out = []; for (const b of w.db.q(`SELECT id FROM bookings WHERE status='pending'`)) out.push(await w.service.sweep(b.id)); return send(200, { swept: out.length, server_now: new Date(clock.now()).toISOString() }); }
        if (op === 'mode') { mode = url.searchParams.get('m') || 'DELIVERED'; return send(200, { mode }); }
        if (op === 'token') return send(200, { token: w.tok(Number(url.searchParams.get('driver') || 1)) });
        if (op === 'driver-offline') { w.db.raw.prepare(`UPDATE drivers SET online=?`).run(url.searchParams.get('on') === '1' ? 1 : 0); return send(200, { ok: true }); }
        if (op === 'summary') return send(200, { bookings: w.db.q(`SELECT id,status,assigned_driver_id FROM bookings`), offers: w.db.q(`SELECT driver_id,state,dispatch_phase FROM driver_offers`), events: w.db.q(`SELECT booking_id,event_type FROM booking_events ORDER BY id`).map((e) => e.event_type), intents: w.notifier.intents.length, real_sends: w.notifier.intents.filter((i) => !i.suppressed).length });
        return send(404, { error: 'no such control' });
      }
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.normalize(path.join(PWA, rel));
      if (!file.startsWith(PWA) || !fs.existsSync(file)) return send(404, 'not found', 'text/plain');
      return send(200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
    } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, code: 'DEV_SERVER_ERROR', detail: String(e.message) })); }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, world: w, clock, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startDevServer({ port: Number(process.env.PORT || 8787) });
  console.log(`Driver v2 Gate 1 dev server (isolated, synthetic) on http://127.0.0.1:${s.port}/#token=${s.world.tok(1)}`);
}
