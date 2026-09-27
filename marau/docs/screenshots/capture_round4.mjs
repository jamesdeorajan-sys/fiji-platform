// Round 4 persistent mobile screenshots — against the real worker.js +
// the real SQLite-backed shim (test/local_preview_server.mjs). NOT part
// of the Worker, its tests, or its deployment.
import { chromium } from 'playwright';

const TOKEN = process.argv[2];
const OUT_DIR = process.argv[3] || '.';

const browser = await chromium.launch({ executablePath: 'C:\\Users\\James\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe' });

// 1. Trip view: pickup card must show the UPCOMING active booking, not the
// older cancelled one — and the switcher must still let history be
// selected. Also proves the install banner + real PNG icon reference.
const context1 = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page1 = await context1.newPage();
await page1.goto(`http://127.0.0.1:8899/#tok=${TOKEN}`);
await page1.waitForTimeout(700);
await page1.screenshot({ path: `${OUT_DIR}/06-pickup-accuracy-fixed.png` });

// 2. Prove install -> close -> reopen: simulate the installed-PWA
// relaunch by navigating to start_url "/" with NO #tok= fragment in a
// FRESH context that still carries the SAME origin's localStorage (this
// is exactly what survives a real install/close/reopen; sessionStorage
// does NOT survive it, which is the point of the fix). We reuse context1
// (same localStorage) but a brand-new page, and clear sessionStorage
// first to prove it isn't what's carrying the recovery.
const page1b = await context1.newPage();
await page1b.goto('http://127.0.0.1:8899/');
await page1b.evaluate(() => { try { sessionStorage.clear(); } catch (e) {} });
await page1b.reload();
await page1b.waitForTimeout(700);
await page1b.screenshot({ path: `${OUT_DIR}/07-installed-reopen-recovers-trip.png` });
const recoveredUrl = page1b.url();
console.log('reopen-at-/ landed on:', recoveredUrl, '(should still show the trip, not the start/welcome screen)');

await context1.close();

// 3. A genuinely fresh context (no localStorage, no sessionStorage, no
// hash) must show the synthetic-entry "start" screen — proving the
// recovery in (2) came from real persisted state, not from the app
// simply always showing the trip.
const context2 = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page2 = await context2.newPage();
await page2.goto('http://127.0.0.1:8899/');
await page2.waitForTimeout(500);
await page2.screenshot({ path: `${OUT_DIR}/08-fresh-no-token-shows-start.png` });
await context2.close();

await browser.close();
console.log('done');
