// LOCAL DEV ONLY (synthetic). Runs the REAL Worker code on node:sqlite with Bula flags ON for a mobile-browser walkthrough.
// Usage (from marau/):  node bula/dev_server.mjs [port] [--clock-fiji=YYYY-MM-DDTHH:MM]   — the clock flag SIMULATES the time so the 6 pm release can be shown; it is printed on start and is not real.
import http from 'node:http';
import path from 'node:path';
import { createTestD1 } from '../test/d1_sqlite_shim.mjs';
const args = process.argv.slice(2); const port = Number(args.find((a) => /^\d+$/.test(a)) || 8799);
const clk = (args.find((a) => a.startsWith('--clock-fiji=')) || '').slice(13);
if (clk) { const off = Date.parse(clk + ':00Z') - 12 * 3600e3 - Date.now(); const RD = Date; globalThis.Date = class extends RD { constructor(...a) { if (a.length) super(...a); else super(RD.now() + off); } static now() { return RD.now() + off; } }; console.log(`SIMULATED CLOCK: ${clk} Fiji (offset ${Math.round(off / 60000)} min). Not real time.`); }
const { default: worker } = await import('../worker/worker.js');
const { synthGuest } = await import('../test/fixtures.mjs');
const { fijiYmd, ymdString } = await import('./edition.js');
const ADMIN = 'dev-admin-token-synthetic'; const root = process.cwd();
const env = { DB: createTestD1({ migrationsDirs: [path.join(root, '..', 'smart-return-trigger-fill', 'migrations'), path.join(root, 'migrations'), path.join(root, 'bula', 'migrations')] }), MARAU_ADMIN_TEST_TOKEN: ADMIN, BULA_SYNTHETIC_TEST: 'on', BULA_CREDITS_ENABLED: 'on', BULA_CHECKOUT_ENABLED: 'on', BULA_EDITION_PUBLISH_ENABLED: 'on', BULA_OUTBOX_ENABLED: 'on', BULA_POLICY_VERSION: 'synthetic-dev', BULA_BUILD: 'dev-local', BULA_GUEST_ORIGIN: 'http://localhost:' + port };
const call = (m, p, { tok, staff, body } = {}) => worker.fetch(new Request('http://x' + p, { method: m, headers: { ...(tok ? { authorization: 'Bearer ' + tok } : { authorization: 'Bearer ' + ADMIN }), ...(staff ? { 'x-marau-staff-token': staff } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
for (const [id, role] of [['james', 'ceo'], ['ana', 'ops'], ['ap', 'approver']]) await call('POST', '/preview/admin/bula/staff', { body: { token: 'dev-staff-' + id, staff_id: id, display_name: id, role } });
const now = Date.now(); const H = 3600e3; const fj = (ms) => new Date(ms + 12 * H).toISOString().slice(0, 16).replace('T', ' ');
const todayYmd = ymdString(fijiYmd(now)); const tmrw = ymdString(fijiYmd(now + 24 * H));
const cols = 'offer_id,title,operator_id,service_date,service_time,pickup_zones,pricing_basis,offer_price_fjd,max_credit_fjd,capacity_unit,capacity_quantity,booking_cutoff,inclusions,exclusions,min_spend_fjd,cancellation_terms,credit_restore_hours_before,inventory_restore_hours_before,funding_party,operator_payout_fjd,instant_confirm,operator_contract_id';
const startToday = now + 5 * H, cutToday = now + 3 * H;
const rows = [
  ['SYN-TODAY', 'SYNTHETIC Sunset Sail (today)', 'op_syn', ymdString(fijiYmd(startToday)), fj(startToday).slice(11), 'Denarau;Nadi', 'person', '120.00', '25', 'seat', '6', fj(cutToday), 'Sail and drinks', '', '', 'Free cancel up to 2 hours before', '2', '2', 'vakaviti', '90', 'no', ''],
  ['SYN-TMRW-REQ', 'SYNTHETIC Island Day Cruise', 'op_syn', tmrw, '09:00', 'Denarau;Nadi', 'person', '150.00', '25', 'seat', '8', tmrw + ' 07:00', 'Lunch, snorkel', 'Drinks', '', 'Free cancel up to 24 hours before', '24', '24', 'vakaviti', '120', 'no', ''],
  ['SYN-TMRW-INSTANT', 'SYNTHETIC Garden Tour (instant)', 'op_syn', tmrw, '10:30', 'Nadi', 'party', '300.00', '40', 'party', '3', tmrw + ' 07:00', 'Guide, entry', '', '', 'Free cancel up to 24 hours before', '24', '24', 'vakaviti', '240', 'yes', 'C-DEV'],
];
const csvLine = (r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
await call('POST', '/preview/admin/bula/contracts', { staff: 'dev-staff-james', body: { contract_id: 'C-DEV', operator_id: 'op_syn', valid_from: now - H, valid_to: now + 90 * 24 * H } });
const imp = await (await call('POST', '/preview/admin/bula/offers/import', { staff: 'dev-staff-ana', body: { csv: [cols, ...rows.map(csvLine)].join('\n') } })).json();
if (!imp.created) { console.error('seed import failed', JSON.stringify(imp)); process.exit(1); }
for (const r of rows) { const a = await (await call('POST', `/preview/admin/bula/offers/${r[0]}/approve`, { staff: 'dev-staff-ap', body: {} })).json(); if (!a.ok) console.error('approve', r[0], JSON.stringify(a)); }
const g = await (await call('POST', '/preview/bookings', { body: synthGuest({ leg_type: 'arrival', client_booking_ref: 'SYN-DEV-1' }) })).json();
await call('POST', '/preview/bula/outbox/run');
http.createServer(async (req, res) => { const chunks = []; for await (const c of req) chunks.push(c); const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request('http://localhost:' + port + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); }).listen(port, () => console.log(JSON.stringify({ ready: true, port, guestLink: `http://localhost:${port}/bula#tok=${g.access_token}`, staffUrl: `http://localhost:${port}/bula/staff`, admin: ADMIN, staffTokens: { ceo: 'dev-staff-james', ops: 'dev-staff-ana', approver: 'dev-staff-ap' }, offersImported: imp.created, note: 'SYNTHETIC LOCAL ONLY' })));
