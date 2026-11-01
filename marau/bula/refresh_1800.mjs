// LOCAL: an already-open guest screen picks up the 18:00 Fiji release by itself (timer + visibility), with no tap/reload. Run against dev_server started at 17:59:40 Fiji (simulated).
import { createRequire } from 'node:module'; const require = createRequire('/opt/npm-tools/'); const { chromium, devices } = require('playwright');
const [link, outDir] = process.argv.slice(2); const b = await chromium.launch(); const p = await (await b.newContext({ ...devices['iPhone 13'] })).newPage();
await p.goto(link); await p.waitForSelector('.card, .msg'); const before = await p.locator('h2').allTextContents(); console.log('BEFORE', JSON.stringify(before)); await p.screenshot({ path: `${outDir}/r1-before-1800.png` });
await p.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => /Tomorrow/.test(h.textContent)), null, { timeout: 60000 }); const after = await p.locator('h2').allTextContents(); console.log('AFTER', JSON.stringify(after)); await p.screenshot({ path: `${outDir}/r2-after-1800.png` });
await b.close(); process.exit(before.some((x) => /Tomorrow/.test(x)) || !after.some((x) => /Tomorrow/.test(x)) ? 1 : 0);
