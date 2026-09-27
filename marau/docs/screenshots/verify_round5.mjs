// Round 5 verification: confirm the change-form prompt's default value is
// the ACTUAL Fiji wall-clock time, not a mislabelled UTC slice. NOT part
// of the Worker, its tests, or its deployment.
import { chromium } from 'playwright';

const TOKEN = process.argv[2];
const OUT_DIR = process.argv[3] || '.';

const browser = await chromium.launch({ executablePath: 'C:\\Users\\James\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe' });
const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await context.newPage();

let promptDefault = null;
page.on('dialog', async (dialog) => {
  promptDefault = dialog.defaultValue();
  await dialog.dismiss();
});

await page.goto(`http://127.0.0.1:8899/#tok=${TOKEN}`);
await page.waitForTimeout(600);

// The seeded demo booking's pickup_datetime — read it directly from the
// page's own rendered data via a fetch, for an honest before/after
// comparison in the same evidence run.
const tripRaw = await page.evaluate(async () => {
  const tok = location.hash.match(/tok=([^&]+)/)[1];
  const res = await fetch('/preview/trip', { headers: { authorization: 'Bearer ' + tok } });
  return res.json();
});
const activeBooking = tripRaw.bookings.find((b) => b.status === 'pending' || b.status === 'confirmed');
console.log('stored pickup_datetime (UTC):', activeBooking.pickup_datetime);
console.log('OLD buggy default would have been (raw slice):', activeBooking.pickup_datetime.slice(0, 16));

await page.click('#changeBtn');
await page.waitForTimeout(300);
console.log('ACTUAL prompt default shown to the guest:', promptDefault);

await page.screenshot({ path: `${OUT_DIR}/09-change-form-fiji-default-fixed.png` });

await browser.close();
console.log('done');
