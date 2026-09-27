// One-off Playwright script to rasterize Marau's SVG brand-mark icon into
// exact-pixel PNGs at the sizes real installability needs — no other
// image library is available in this environment (see memory:
// environment-no-libreoffice.md). NOT part of the Worker, its tests, or
// its deployment; the OUTPUT (the PNG bytes) is what gets embedded.
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT_DIR = process.argv[2] || '.';
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="40" fill="#0F5E63"/>
  <rect x="20" y="120" width="152" height="18" rx="9" fill="#F3C33C" transform="rotate(-8 96 129)"/>
</svg>`;
// Apple touch icons must NOT rely on alpha transparency (iOS composites
// them opaquely) and should not have external corner-rounding baked in
// (the OS applies its own mask) — so the 180 variant is the same mark on
// a full-bleed square background, no rx.
const SVG_SQUARE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" fill="#0F5E63"/>
  <rect x="20" y="120" width="152" height="18" rx="9" fill="#F3C33C" transform="rotate(-8 96 129)"/>
</svg>`;

const browser = await chromium.launch({ executablePath: 'C:\\Users\\James\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe' });

async function render(svg, size, outFile) {
  const context = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;padding:0;width:${size}px;height:${size}px;}svg{display:block;width:${size}px;height:${size}px;}</style></head><body>${svg}</body></html>`);
  await page.waitForTimeout(50);
  await page.screenshot({ path: `${OUT_DIR}/${outFile}`, clip: { x: 0, y: 0, width: size, height: size } });
  await context.close();
}

await render(SVG, 192, 'icon-192.png');
await render(SVG, 512, 'icon-512.png');
await render(SVG_SQUARE, 180, 'icon-180.png');

await browser.close();
console.log('done');
