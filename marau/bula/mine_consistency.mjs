// LOCAL phone-browser check (Playwright, 390x844) against bula/dev_server.mjs: submit -> My bookings -> reload -> reopen -> resubmit shows ONE request; no-token My bookings explains itself. Not a physical device.
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/'); const { chromium, devices } = require('playwright');
const [link, outDir] = process.argv.slice(2); const b = await chromium.launch(); const errs = []; const out = [];
const ctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(String(e)));
const ok = (name, pass, d = '') => { out.push({ name, pass }); console.log(pass ? 'PASS' : 'FAIL', name, d); };
await p.goto(link); await p.waitForSelector('.card');
ok('badge reads "Subject to team confirmation"', (await p.locator('.chip.wait').first().textContent()) === 'Subject to team confirmation');
await p.locator('.card', { hasText: 'Island Day Cruise' }).getByRole('button', { name: /details/i }).click(); await p.waitForSelector('.panel .row.total');
await p.getByRole('button', { name: 'Send request' }).click(); await p.waitForSelector('text=Request sent'); await p.screenshot({ path: `${outDir}/p1-request-sent.png` });
await p.getByRole('button', { name: /View my bookings/ }).click(); await p.waitForSelector('#v-mine .card');
const count = async () => p.locator('#v-mine .card').count(); ok('after submit: My bookings shows exactly 1 request', (await count()) === 1);
await p.screenshot({ path: `${outDir}/p2-my-bookings.png` });
await p.reload(); await p.getByRole('tab', { name: 'My bookings' }).click(); await p.waitForSelector('#v-mine .card'); ok('after reload: still exactly 1', (await count()) === 1);
const ctx2 = await b.newContext({ ...devices['iPhone 13'] }); const p2 = await ctx2.newPage(); await p2.goto(link); await p2.getByRole('tab', { name: 'My bookings' }).click(); await p2.waitForSelector('#v-mine .card'); ok('second device/browser with the same private link: same single request', (await p2.locator('#v-mine .card').count()) === 1);
await p.getByRole('tab', { name: 'Offers' }).click(); await p.waitForSelector('#v-offers .card'); await p.locator('.card', { hasText: 'Island Day Cruise' }).getByRole('button', { name: /details/i }).click(); await p.waitForSelector('.panel .row.total');
await p.getByRole('button', { name: 'Send request' }).click(); await p.waitForSelector('text=already have a request'); ok('re-sending the same offer is refused with a clear message', true); await p.screenshot({ path: `${outDir}/p3-already-requested.png` });
await p.getByRole('button', { name: 'Close' }).click(); await p.getByRole('tab', { name: 'My bookings' }).click(); await p.waitForTimeout(500); ok('still exactly 1 after the refused re-send', (await count()) === 1);
const ctx3 = await b.newContext({ ...devices['iPhone 13'] }); const p3 = await ctx3.newPage(); await p3.goto(link.split('#')[0]); await p3.getByRole('tab', { name: 'My bookings' }).click(); await p3.waitForSelector('#v-mine .msg.bad'); ok('no private link on this device: My bookings explains why (not blank)', /no private trip link/.test(await p3.locator('#v-mine').textContent())); await p3.screenshot({ path: `${outDir}/p4-no-link.png` });
ok('no page errors', errs.length === 0, JSON.stringify(errs)); await b.close(); process.exit(out.every((x) => x.pass) ? 0 : 1);
