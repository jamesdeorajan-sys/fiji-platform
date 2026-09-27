// One-off Playwright script to capture persistent, committable mobile
// screenshots of the running local demo server (test/local_preview_server.mjs).
// NOT part of the Worker, its tests, or its deployment.
import { chromium } from 'playwright';

const TOKEN = process.argv[2];
const OUT_DIR = process.argv[3] || '.';

const browser = await chromium.launch({ executablePath: 'C:\\Users\\James\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe' });
const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await context.newPage();

await page.goto(`http://127.0.0.1:8899/#tok=${TOKEN}`);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT_DIR}/01-trip.png` });

// Deals
await page.click('button[data-view="deals"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT_DIR}/02-deals.png` });

// Offer requested + mocked WhatsApp handoff
const requestBtn = await page.$('[data-offer]');
if (requestBtn) {
  await requestBtn.click();
  await page.waitForTimeout(500);
}
await page.screenshot({ path: `${OUT_DIR}/03-offer-detail-and-whatsapp.png`, fullPage: true });

// Welcome / test harness screen (fresh, no token) — a NEW page, since this
// SPA only reads location.hash once at load and doesn't listen for
// hashchange, so re-using `page` with just a hash change would leave the
// previous view's client-side state on screen instead of reloading.
const page2 = await context.newPage();
await page2.goto('http://127.0.0.1:8899/');
await page2.waitForTimeout(400);
await page2.screenshot({ path: `${OUT_DIR}/04-welcome-harness.png` });

await browser.close();
console.log('done');
