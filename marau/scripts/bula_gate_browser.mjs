/* Release-gate browser journey, phone size 390x844. The REAL Worker over an in-memory D1, SYNTHETIC data, NAT simulated by a read-only double. Run from marau/: node scripts/bula_gate_browser.mjs <outdir> */
import http from 'node:http';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import worker from '../worker/worker.js';
import { setup, poll, add, boot } from '../bula/disc_helpers.mjs';
import { offer, staff, call, tokenFor, ADMIN, count } from '../bula/m3_helpers.mjs';
import { collectHealth } from '../bula/health.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || '/tmp/gate-shots'; const results = []; const rec = (name, ok, note = '') => { results.push({ name, ok: !!ok, note }); console.log(ok ? 'PASS' : 'FAIL', name, note); };

const t = setup({ BULA_SYNTHETIC_TEST: 'on', BULA_EMAIL_CAPTURE: 'on' }); await boot(t);
add(t.store, 3, { flight_number: null }); add(t.store, 4, { guest_email: null }); add(t.store, 5, {}); await poll(t.env);
const opsTok = await staff(t.env, 'ops1', 'ops'); await staff(t.env, 'ceo1', 'ceo');
await offer(t.env, { offer_id: 'ISLAND' }); await offer(t.env, { offer_id: 'REEF', title: 'Demonstration: Reef Snorkel' });
const tok3 = await tokenFor(t.env, 3), tok5 = await tokenFor(t.env, 5);
const reserve = (tok, o, k) => call(t.env, 'POST', '/preview/bula/reserve', { tok, admin: false, body: { offer_id: o, version: 1, qty: 1, idem_key: k } });
const r1 = await reserve(tok3, 'ISLAND', 'k-confirm'); const r2 = await reserve(tok5, 'REEF', 'k-decline'); const r3 = await reserve(tok5, 'ISLAND', 'k-withdraw');
rec('guests can request (API)', [r1, r2, r3].every((r) => r.status === 200 || r.status === 201), [r1.status, r2.status, r3.status].join('/'));

const server = http.createServer(async (nreq, nres) => { const ch = []; for await (const c of nreq) ch.push(c);
  const req = new Request('http://127.0.0.1:8899' + nreq.url, { method: nreq.method, headers: nreq.headers, body: ['GET', 'HEAD'].includes(nreq.method) ? undefined : Buffer.concat(ch) });
  const r = await worker.fetch(req, t.env); nres.writeHead(r.status, Object.fromEntries(r.headers.entries())); nres.end(Buffer.from(await r.arrayBuffer())); });
await new Promise((ok) => server.listen(8899, '127.0.0.1', ok));
const browser = await chromium.launch(); const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true }); const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const text = () => page.evaluate(() => document.body.innerText);

// 1. guest with NO flight / passengers / luggage / add-ons / discount
await page.goto(`http://127.0.0.1:8899/bula#tok=${tok3}`); await page.click('#t-trip'); await page.waitForSelector('text=Your transfer', { timeout: 10000 });
let tx = await text(); await shot('t1-trip-missing-fields');
rec('missing fields are shown as missing (5 rows)', (tx.match(/Not available from your booking record/g) || []).length >= 5, String((tx.match(/Not available from your booking record/g) || []).length));
rec('no invented flight/passengers values', !/FJ391/.test(tx) && !/Passengers\s*\n?\s*[0-9]/.test(tx));
rec('quoted total shows source currency', /FJD 85\.00/.test(tx));
// 2. guest with flight present
await page.goto('about:blank'); await page.goto(`http://127.0.0.1:8899/bula#tok=${tok5}`); await page.click('#t-trip'); await page.waitForSelector('text=Your transfer'); tx = await text(); await shot('t2-trip-with-flight');
rec('a supplied flight IS shown', /FJ391/.test(tx));
// 3. staff: refusal queue
const staffPage = await ctx.newPage(); staffPage.on('pageerror', (e) => errors.push('staff pageerror: ' + e.message));
await staffPage.goto('http://127.0.0.1:8899/bula/staff'); await staffPage.fill('#adm', ADMIN); await staffPage.fill('#stf', opsTok); await staffPage.click('#go');
await staffPage.waitForSelector('text=Bookings needing staff attention', { timeout: 10000 }); let st = await staffPage.evaluate(() => document.body.innerText); await staffPage.screenshot({ path: `${out}/t3-staff-queue-with-refusal.png`, fullPage: true });
rec('staff queue shows the no-email booking (count 1)', /Bookings needing staff attention \(1\)/i.test(st) && /NAT booking 4/i.test(st) && /Nothing was sent/i.test(st), st.slice(0, 300).replace(/\n/g, ' | '));
rec('no contact details in staff queue', !/@example\.test|\+1555/.test(st));
// 4. confirm one request, decline another
const holds = async () => (await t.env.DB.prepare('SELECT hold_id, state FROM bula_holds ORDER BY created_at').all()).results;
async function act(label) { await staffPage.getByRole('button', { name: label }).first().click(); await staffPage.waitForTimeout(400); }
await act('Claim this request'); await act('Confirm'); await staffPage.waitForTimeout(500); await staffPage.screenshot({ path: `${out}/t4-staff-confirmed.png`, fullPage: true });
let hs = await holds(); rec('staff confirmation: one hold confirmed', hs.filter((h) => h.state === 'confirmed').length === 1);
await staffPage.reload(); await staffPage.waitForSelector('text=Requests awaiting confirmation'); await act('Claim this request'); await act('Decline'); await staffPage.waitForTimeout(500);
hs = await holds(); rec('staff decline: one hold released', hs.filter((h) => h.state === 'released').length === 1);
// 5. Mark handled with a note
await staffPage.reload(); await staffPage.waitForSelector('text=Bookings needing staff attention'); await staffPage.getByRole('button', { name: 'Mark handled' }).click(); await staffPage.waitForTimeout(300);
rec('Mark handled requires a note (nothing happens without one)', (await t.env.DB.prepare("SELECT state FROM bula_source_refusals WHERE source_booking_ref = '4'").first()).state === 'open');
await staffPage.fill('input[aria-label="resolution note"]', 'Phoned guest; manual follow-up'); await staffPage.getByRole('button', { name: 'Mark handled' }).click(); await staffPage.waitForTimeout(600);
rec('Mark handled with a note resolves + audits', (await t.env.DB.prepare("SELECT state FROM bula_source_refusals WHERE source_booking_ref = '4'").first()).state === 'resolved' && (await count(t.env, 'bula_audit', "action = 'source_refusal_resolved'")) === 1);
await staffPage.reload(); await staffPage.waitForSelector('text=Requests awaiting confirmation'); await staffPage.screenshot({ path: `${out}/t5-staff-after-handled.png`, fullPage: true });
rec('refusal section gone after handling', !/Bookings needing staff attention/.test(await staffPage.evaluate(() => document.body.innerText)));
// 6. guest withdraws the remaining request (UI)
await page.goto('about:blank'); await page.goto(`http://127.0.0.1:8899/bula#tok=${tok5}`); await page.click('#t-mine'); await page.waitForTimeout(600);
const wd = page.getByRole('button', { name: 'Withdraw request' }); if (await wd.count()) { await wd.first().click(); await page.getByRole('button', { name: 'Yes, withdraw' }).click(); await page.waitForTimeout(700); }
await shot('t6-guest-withdrawn'); hs = await holds(); rec('guest withdrawal released the hold', hs.filter((h) => h.state === 'released').length === 2, JSON.stringify(hs.map((h) => h.state)));
// 7. invariants + isolation
const h = await collectHealth(t.env.DB, Date.now()); rec('wallet/capacity invariants clean', !h.alerts.some((a) => /^(WALLET|CAPACITY|DUPLICATE)/.test(a.code)), JSON.stringify(h.alerts.map((a) => a.code)));
const iso = await call(t.env, 'GET', '/preview/bula/trip', { tok: tok3, admin: false }); const j = await iso.json(); rec('guest isolation: guest 3 sees only its own trip', j.trips.length === 1 && j.trips[0].reference === '3');
rec('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
rec('no email sent / nothing outbound', (await count(t.env, 'bula_audit', "action LIKE 'email_sent%'")) === 0 && t.f.calls.every((c) => c.method === 'GET'));
await browser.close(); server.close();
writeFileSync(`${out}/browser-results.json`, JSON.stringify({ viewport: '390x844', results }, null, 2)); const bad = results.filter((r) => !r.ok); console.log(`\n${results.length - bad.length}/${results.length} passed`); process.exit(bad.length ? 1 : 0);
