// Fiji Dash - issue #59 focused SEO + trust repairs (preview candidate).
// Static checks on the deployable folder (src/); zero network, zero side effects.
// Run: node --test ftt-booking-site/seo-trust-404.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const routes = fs.readdirSync(path.join(SRC, 'transfer')).filter((f) => f.endsWith('.html'));
const pages = ['index.html', ...routes.map((f) => `transfer/${f}`)];

test('a real 404 page exists, is noindex, and no rule turns unknown paths into a 200 homepage', () => {
  const html = read('404.html');
  assert.match(html, /<title>Page not found/);
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, /href="\/"/, 'must give the visitor a way home');
  const rules = read('_redirects').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const l of rules) assert.doesNotMatch(l, /^\/\*\s/, `catch-all rule would hide the 404: ${l}`);
});

test('valid routes and legacy rewrites are preserved', () => {
  const r = read('_redirects');
  for (const p of ['/transfers', '/tours', '/book', '/faq', '/nadi-to-denarau', '/nadi-to-coral-coast', '/nadi-to-pacific-harbour', '/airport-transfer']) {
    assert.ok(new RegExp('^' + p + '\\s+/index.html\\s+200', 'm').test(r), `${p} rewrite must stay`);
  }
  assert.match(r, /^\/transfer\/intercontinental-fiji-golf-resort\s+\/transfer\/intercontinental-fiji-natadola\s+301/m);
  assert.equal(routes.length, 21);
});

test('booking deep links (?pickup= / ?dest=) are still read by the widget and survive on the homepage', () => {
  const app = read('app.js');
  assert.match(app, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(app, /params\.get\(['"]pickup['"]\)/);
  assert.match(app, /params\.get\(['"]dest['"]\)/);
});

test('the dead stub worker.js and wrangler.toml are no longer served from the public folder', () => {
  assert.ok(!fs.existsSync(path.join(SRC, 'worker.js')));
  assert.ok(!fs.existsSync(path.join(SRC, 'wrangler.toml')));
});

test('every page carries complete Open Graph + Twitter card metadata with a real 1200x630 image', () => {
  const img = path.join(SRC, 'assets', 'og-fijidash-1200x630.jpg');
  const b = fs.readFileSync(img);
  assert.equal(b[0], 0xff); assert.equal(b[1], 0xd8);
  let w = 0, h = 0;
  for (let i = 2; i < b.length - 9;) { // walk JPEG markers to the SOF segment
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; }
    i += 2 + b.readUInt16BE(i + 2);
  }
  assert.deepEqual([w, h], [1200, 630]);
  assert.ok(b.length < 200 * 1024, 'social image should stay small');
  for (const p of pages) {
    const t = read(p);
    for (const re of [/og:image" content="https:\/\/book\.fijidash\.com\/assets\/og-fijidash-1200x630\.jpg"/, /og:image:width" content="1200"/, /og:image:height" content="630"/, /og:image:alt" content="[^"]+"/,
      /name="twitter:card" content="summary_large_image"/, /name="twitter:title" content="[^"]+"/, /name="twitter:description" content="[^"]+"/, /name="twitter:image" content="https:/]) {
      assert.match(t, re, `${p} missing ${re}`);
    }
  }
});

test('every sitemap URL has a file and is linked from at least one page (no orphans)', () => {
  const sm = read('sitemap.xml');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://book.fijidash.com', ''));
  const all = pages.map(read).join('\n');
  for (const l of locs) {
    if (l === '/') continue;
    assert.ok(fs.existsSync(path.join(SRC, l.slice(1) + '.html')), `${l} has no file`);
    assert.ok(all.includes(`href="${l}"`), `${l} is not linked from any page`);
    if (['/transfer/first-landing-beach-resort', '/transfer/doubletree-sonaisali-island', '/transfer/volivoli-beach-resort', '/transfer/port-denarau-marina'].includes(l)) assert.ok(read('index.html').includes(`href="${l}"`), `${l} (former orphan) must be linked from the homepage`);
  }
  assert.ok(!/<lastmod>/.test(sm), 'no invented lastmod dates');
});

test('unsupported hours / response-time promises are gone; no rating markup is present', () => {
  const home = read('index.html');
  const live = home.replace(/<!--[\s\S]*?-->/g, ''); // explanatory comments may mention the removed markup
  assert.doesNotMatch(live, /openingHours/);
  assert.doesNotMatch(live, /aggregateRating|ratingValue|reviewCount/);
  assert.doesNotMatch(home, /within 15 minutes/i);
  assert.doesNotMatch(home, /24\/7|24 hours a day/i);
  for (const p of pages) assert.doesNotMatch(read(p), /"openingHours"/, p);
  assert.match(home, /"priceRange": "FJ\$15 - FJ\$549"/, 'priceRange is derived from the published fare table (min sedan 15, max minibus 549) and stays');
});
