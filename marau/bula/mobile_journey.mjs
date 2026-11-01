// LOCAL mobile-browser journey (Playwright, Chromium emulating a 390x844 phone) against bula/dev_server.mjs. Local evidence only — not a physical device.
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/'); const { chromium, devices } = require('playwright');
const [link, staffUrl, adminTok, opsTok, outDir] = process.argv.slice(2);
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const shot = (n) => p.screenshot({ path: `${outDir}/${n}.png` }); const log = []; const step = (s) => { log.push(s); console.log('STEP', s); };
await p.goto(link); await p.waitForSelector('.card'); step('offers loaded'); await shot('01-offers');
const texts = await p.locator('h2').allTextContents(); step('groups: ' + texts.join(' | '));
await p.locator('.card', { hasText: 'Island Day Cruise' }).getByRole('button', { name: /details/i }).click(); await p.waitForSelector('.panel .row.total'); await p.getByRole('button', { name: 'more people' }).click(); step('qty 2, pay: ' + await p.locator('.row.total').innerText()); await shot('02-detail-qty2');
await p.getByRole('button', { name: 'Send request' }).click(); await p.waitForSelector('text=Request sent'); step('request sent'); await shot('03-request-sent');
await p.getByRole('button', { name: /View my bookings/ }).click(); await p.waitForSelector('.chip:text-is("Requested")'); step('my bookings shows Requested'); await shot('04-my-bookings-requested');
// staff on a second page (separate context = separate browser storage)
const sctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const s = await sctx.newPage(); await s.goto(staffUrl); await s.fill('#adm', adminTok); await s.fill('#stf', opsTok); await s.click('#go'); await s.waitForSelector('#tabs:not([hidden])'); step('staff signed in as: ' + await s.locator('#who').innerText()); await s.screenshot({ path: `${outDir}/05-staff-queue.png` });
await s.locator('input[aria-label="evidence note"]').first().fill('SYNTHETIC operator ack ref 77'); await s.getByRole('button', { name: 'Confirm', exact: true }).first().click(); await s.waitForTimeout(600); step('staff confirmed'); await s.screenshot({ path: `${outDir}/06-staff-after-confirm.png`});
await p.reload(); await p.getByRole('tab', { name: 'My bookings' }).click(); await p.waitForSelector('.chip:text-is("Confirmed")'); step('guest sees Confirmed'); await shot('07-my-bookings-confirmed');
// instant-confirm party offer
await p.getByRole('tab', { name: 'Offers' }).click(); await p.locator('.card', { hasText: 'Garden Tour' }).getByRole('button', { name: /details/i }).click(); await p.waitForSelector('.panel .row.total'); await shot('08-instant-detail');
await p.getByRole('button', { name: /Reserve — instant/ }).click(); await p.waitForSelector('text=Confirmed ✓'); step('instant booking confirmed with no staff action'); await shot('09-instant-confirmed');
await p.getByRole('button', { name: /View my bookings/ }).click(); await p.waitForTimeout(500);
// cancel the instant one
await p.locator('#v-mine .card', { hasText: 'Garden Tour' }).getByRole('button', { name: /Cancel booking/ }).click(); await shot('10-cancel-confirm'); await p.getByRole('button', { name: 'Yes, cancel' }).click(); await p.waitForTimeout(700); await shot('11-cancelled'); step('cancelled; ' + (await p.locator('#v-mine .card', { hasText: 'Garden Tour' }).innerText()).replace(/\n/g, ' / '));
// installed-app style reload keeps session (no service worker): token persisted, fragment removed
await p.goto(link.split('#')[0]); await p.waitForSelector('.card'); step('reload without fragment still authorised via stored token; url=' + p.url()); await shot('12-reload-authorised');
const nosw = await p.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length); step('service workers registered: ' + nosw);
console.log('CONSOLE_ERRORS', JSON.stringify(errs)); console.log('LOG', JSON.stringify(log)); await b.close();
