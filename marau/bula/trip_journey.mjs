// LOCAL phone-browser walkthrough (Playwright, 390x844) against bula/trip_demo_server.mjs. Guest: My trip -> request an activity -> (staff in a second browser: claim -> confirm) -> guest sees the update.
// Run on a FRESH demo server. Not a physical device. Synthetic data; nothing is sent anywhere.
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/'); const { chromium, devices } = require('playwright');
const [link, staffUrl, outDir, admin, stfTok] = process.argv.slice(2); const b = await chromium.launch(); const errs = []; const out = [];
const ok = (name, pass, d = '') => { out.push({ name, pass }); console.log(pass ? 'PASS' : 'FAIL', name, d); };
const gctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }); const g = await gctx.newPage(); g.on('pageerror', (e) => errs.push(String(e)));
await g.goto(link); await g.waitForSelector('#wallet:not([hidden])');
await g.getByRole('tab', { name: 'My trip' }).click(); await g.waitForSelector('#v-trip .card');
let t = await g.locator('#v-trip').innerText(); await g.screenshot({ path: `${outDir}/t1-my-trip.png`, fullPage: true });
ok('My trip shows the saved transfer, route and Fiji pickup time', /Reference 3001/.test(t) && /Nadi Airport → Denarau/.test(t) && /2:30 PM \(Fiji time\)/.test(t), '');
ok('My trip shows the transfer as NOT yet confirmed', /our team has not confirmed it yet/.test(t));
ok('available source details shown (total, flight)', /FJD 85\.00/.test(t) && /FJ391/.test(t));
ok('missing details say so plainly', (t.match(/Not available from your booking record/g) || []).length === 4, String((t.match(/Not available from your booking record/g) || []).length));
ok('support contact is the configured, verified one', /WhatsApp: \+679 000 0000/.test(t));
await g.getByRole('tab', { name: 'Offers' }).click(); await g.waitForSelector('#v-offers .card');
await g.locator('.card', { hasText: 'Island Day Cruise' }).getByRole('button', { name: /details/i }).click(); await g.waitForSelector('.panel .row.total'); await g.getByRole('button', { name: 'Send request' }).click(); await g.waitForSelector('text=Request sent');
await g.getByRole('button', { name: /View my bookings/ }).click(); await g.waitForSelector('#v-mine .card');
ok('My bookings: chip says Requested', (await g.locator('#v-mine .chip').first().textContent()) === 'Requested');
// staff, second browser
const sctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }); const s = await sctx.newPage(); s.on('pageerror', (e) => errs.push(String(e)));
await s.goto(staffUrl); await s.fill('#adm', admin); await s.fill('#stf', stfTok); await s.click('#go'); await s.waitForSelector('text=Requests awaiting confirmation'); await s.waitForSelector('#main .card');
let q = await s.locator('#main').innerText(); await s.screenshot({ path: `${outDir}/t2-staff-queue.png`, fullPage: true });
ok('staff queue shows the request with the guest transfer and "Unclaimed"', /Island Day Cruise/.test(q) && /Guest transfer 3001: Nadi Airport → Denarau/.test(q) && /Unclaimed/.test(q) && !/example\.test|\+1555/.test(q));
await s.getByRole('button', { name: 'Claim this request' }).click(); await s.waitForSelector('text=You are handling this');
await g.getByRole('tab', { name: 'My trip' }).click(); await g.waitForSelector('#v-trip .card'); await g.waitForFunction(() => /reviewing this request/.test(document.getElementById('v-trip').innerText));
ok('guest sees "being reviewed" (and no staff name) after the claim', !/ana/i.test(await g.locator('#v-trip').innerText()));
await s.fill('input[aria-label="evidence note"]', 'operator ref OP-77'); await s.getByRole('button', { name: 'Confirm', exact: true }).click(); await s.waitForSelector('text=None waiting.');
await g.getByRole('tab', { name: 'My bookings' }).click(); await g.waitForFunction(() => /Confirmed/.test(document.getElementById('v-mine').innerText));
await g.getByRole('tab', { name: 'My trip' }).click(); await g.waitForFunction(() => /Confirmed\./.test(document.getElementById('v-trip').innerText)); await g.screenshot({ path: `${outDir}/t3-confirmed.png`, fullPage: true });
t = await g.locator('#v-trip').innerText(); ok('guest sees the activity Confirmed, while the transfer stays "not confirmed" (separate facts)', /Confirmed\./.test(t) && /our team has not confirmed it yet/.test(t));
// withdraw wording
await g.getByRole('tab', { name: 'Offers' }).click(); await g.waitForSelector('#v-offers .card'); await g.locator('.card', { hasText: 'Garden Tour' }).getByRole('button', { name: /details/i }).click(); await g.waitForSelector('.panel .row.total'); await g.getByRole('button', { name: 'Send request' }).click(); await g.waitForSelector('text=Request sent');
await g.getByRole('button', { name: /View my bookings/ }).click(); await g.waitForSelector('#v-mine .card'); await g.getByRole('button', { name: 'Withdraw request' }).click(); await g.getByRole('button', { name: 'Yes, withdraw' }).click(); await g.waitForFunction(() => /Withdrawn/.test(document.getElementById('v-mine').innerText));
const m = await g.locator('#v-mine').innerText(); await g.screenshot({ path: `${outDir}/t4-withdrawn.png`, fullPage: true });
ok('withdrawn request reads "Withdrawn", never "Released", and credit-returned is shown only with proof', /Withdrawn/.test(m) && !/Released/.test(m) && /credit returned\./.test(m), m.replace(/\n/g, ' | ').slice(0, 300));
ok('no page errors', errs.length === 0, JSON.stringify(errs)); await b.close(); process.exit(out.every((x) => x.pass) ? 0 : 1);
