// LOCAL PREVIEW ONLY (synthetic). The REAL Worker on node:sqlite with the saved-booking adapter ON, a synthetic NAT-shaped source (in-process, read-only), and the CAPTURE sender
// (nothing is ever emailed). Seeds: one saved synthetic transfer (through the real sync route), two demonstration offers. Prints the guest link and staff credentials.
// Usage (from marau/):  node bula/trip_demo_server.mjs [port]
import http from 'node:http';
import { mkEnv, syncCreated, offer, call, staff, tokenFor, ADMIN } from './m3_helpers.mjs';
import { createCaptureSender } from './outbox_d1.js';
import { fijiYmd, ymdString } from './edition.js';
const port = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 8801);
const sender = createCaptureSender();
const env = mkEnv({ BULA_CAPTURE_SENDER: sender, BULA_SUPPORT_WHATSAPP: '+679 000 0000', BULA_SUPPORT_VERIFIED: 'on', BULA_DEVICE_PAIRING: 'on' });
const { default: worker } = await import('../worker/worker.js');
const now = Date.now(), H = 3600e3;
await offer(env, { offer_id: 'ISLAND', title: 'Demonstration: Island Day Cruise with Lunch', service_start_utc: now + 5 * H, service_date: ymdString(fijiYmd(now + 5 * H)), booking_cutoff_utc: now + 3 * H });
await offer(env, { offer_id: 'GARDEN', title: 'Demonstration: Garden Tour', price_cents: 8000, max_credit_cents: 2000, service_start_utc: now + 6 * H, service_date: ymdString(fijiYmd(now + 6 * H)), booking_cutoff_utc: now + 4 * H, capacity_total: 4, remaining: 4 });
const s = await syncCreated(env, 3001, { guest_email: 'demo-guest@example.test' });
await call(env, 'POST', '/preview/bula/outbox/run', { body: {} });
const tok = await tokenFor(env, 3001);
const stf = { ana: await staff(env, 'ana', 'ops'), ben: await staff(env, 'ben', 'ops'), james: await staff(env, 'james', 'ceo') };
http.createServer(async (req, res) => { const chunks = []; for await (const c of req) chunks.push(c); const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request('http://localhost:' + port + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); })
  .listen(port, () => console.log(JSON.stringify({ ready: true, port, created: s.data.created, captured: sender.sent.map((m) => m.to), guestLink: `http://localhost:${port}/bula#tok=${tok}`, staffUrl: `http://localhost:${port}/bula/staff`, admin: ADMIN, staff: stf })));
