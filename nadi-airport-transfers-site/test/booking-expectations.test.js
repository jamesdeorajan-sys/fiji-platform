// NAT booking-expectations copy candidate (ceo/nat-booking-expectations) on live production 0de39c3 (Pages ffe9ea6e).
// The home page explains the real process: choose journey -> review total -> send request -> human confirmation on WhatsApp.
// Copy only: undoing the five listed edits must reproduce the production home page byte for byte, and every other served
// file must be unchanged. No fare, discount, destination code, booking logic, notification, rental or analytics change.
// Run: node --test test/booking-expectations.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTATIONS_COPY, undoExpectationsCopy } from './a11y-p0-revert.js';
import { undoRouteSource, ROUTE_SOURCE_FILE } from './route-source-revert.js';
import { SEARCH_GROWTH_NEW, undoSearchGrowth, undoSearchGrowthBuf } from './search-growth-revert.js';
import { undoTaxiFaq } from './taxi-faq-revert.js';
import { undoAttribution } from './attribution-revert.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const rd = (f) => readFileSync(path.join(SRC, f), 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const html = rd('index.html');
const visible = (t) => t.replace(/<head\b[\s\S]*?<\/head>/i, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Production 0de39c3 = Pages deployment ffe9ea6e-4a37-4f3e-b75f-c9cffdc6c4d0 (MANIFEST-0de39c3.txt, re-verified against the
// live site on 2026-10-23 after removing only Cloudflare's injected analytics tag).
const PROD_INDEX = '1e23ea1763c8554d2631ff519ad7b48d7ff461c0d001587c1f5dcb953b77a8dd';
const PROD_FILES = {
  '404.html': '69ed052c491633f8d3138ba68f90aeda1dbb0c37a76120ab2836358ef53e21c5', '_redirects': '578cd6f94e366cbeeba342ec4a34d912dc309e33f000953b8a3a8c3c38189de3',
  'app.js': '5e572d85357a324cedb5548f8052b69e5079d8b47bf0c50431b01f8fc6fa921e', 'booking-extras.js': 'e8aef0ce78f8cb1f7eb9ad925d52ad190aa1a4a1ae5329f48493add334276739',
  'booking-extras.css': '5da6759b2dc795ade7d5bd67dd98bb689fba7300d04be3749ee1fc657c162e76', 'chat-widget.js': 'e8a3891fe69c51664d6c2ef6dd2a2d11a9e7b3d6a024f257ce262809503c4836',
  'fiji-pickup.js': '9ac0ea0e887dbfdd1e9032e465faab27c51f407a5202d013090a3456cbbfafdb', 'funnel-nat.js': '33884363eff3376b4da950376069818fbca7705308d34663e7f7910a88ded7ca',
  'route-handoff.js': '8d7f90cc9682aaa1baf91bb4384f6ea12025b5728de8242c7f5e4c9d856147ee', 'styles.css': '2df99123e96d9a2d71112d306db816ad3bcc069b26eab832ff9c85c93b363bba',
  'sitemap.xml': 'ac14a8cc4eb1a52f558d96f896e2352e2ea86d4db6f97402a92ab93c8c8230db', 'robots.txt': '2b6dbb0871547ca5e283f9679be2eac10d0a81ce56d86daffa2a6fcb4f9c10de',
  'rental-assets/rental-core.js': '33fde3f58467fcac13052f8015701e4b6b0a3bffb4310a6c9c76b2e76df8f698', 'rental-assets/rental.js': '92a59db500e22881fa23c71491a75c39cf30d8842ac044dc3a11efdc088ebde3',
  'nadi-airport-car-rentals/index.html': '0577b96cd284b27efcd47f8eb514041402ebc79af7dc5842997d4acf86ffff44',
  'transfer/hilton-fiji-beach-resort.html': '4157f750d7d6bfbe65e16d0e0941ab8d132fe5e4d9be20853ec4f4175d4aa037',
  'transfer/port-denarau-marina.html': '54a6474161c433d6492687cbd67bca0681654c49a9aae165358fce55c69e64cb',
  'transfer/naviti-resort.html': 'ca80b694c9e756af80c45df182e724562136d5f4e3ddf34a5865cd5695f43b0e',
  'transfer/shangri-la-yanuca-island.html': '3121de4e6250d17a6b6128764d1444e626c9d115a17fd9d405b15cf49b0ee055',
};

test('the home page explains the four steps in order: choose journey, review the total, send the request, human confirmation on WhatsApp', () => {
  const t = visible(html);
  const hero = 'Choose your airport or hotel transfer, review the total and send your request. Our Fiji team confirms the arrangements with you on WhatsApp.';
  assert.ok(t.includes(hero), 'hero explains the process');
  const order = ['Choose your airport or hotel transfer', 'review the total', 'send your request', 'confirms the arrangements with you on WhatsApp'].map((s) => t.indexOf(s));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), 'steps appear in order');
  assert.ok(t.includes('Review the total before requesting') && t.includes('Human confirmation on WhatsApp'), 'trust bar states the process');
  assert.ok(t.includes('Choose your journey and vehicle, then review the total before sending your request.'), 'form introduction');
  assert.match(html, /<div class="booking-trust-bar" aria-label="How your request works">/);
});

test('the replaced promises are gone from the home page (Uber comparison, live distance pricing, flight-delay guarantee, no-surge)', () => {
  for (const [before] of EXPECTATIONS_COPY) assert.equal(html.includes(before), false, 'old copy still present: ' + before.slice(0, 60));
});

test('SCOPE: undoing exactly the five copy edits reproduces the production home page byte for byte', () => {
  assert.equal(EXPECTATIONS_COPY.length, 5);
  assert.equal(sha(undoExpectationsCopy(undoAttribution('index.html', undoSearchGrowth('index.html', html)))), PROD_INDEX); // undoAttribution: the later attribution release
});

test('SCOPE: every other served file is byte-identical to production 0de39c3 (fares, booking logic, hand-off, funnel, rentals, route pages)', () => {
  // route pages pass through undoTaxiFaq (the later taxi-FAQ candidate): nothing else in them may differ
  for (const [f, want] of Object.entries(PROD_FILES)) assert.equal(sha(f.startsWith('transfer/') ? undoTaxiFaq(undoRouteSource(f, readFileSync(path.join(SRC, f), 'utf8'))) : (f === 'app.js' ? undoAttribution(f, readFileSync(path.join(SRC, f), 'utf8')) : undoSearchGrowthBuf(f, readFileSync(path.join(SRC, f))))), want, f + ' changed');
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(path.relative(SRC, p).split(path.sep).join('/')); } };
  walk(SRC); files.splice(0, files.length, ...files.filter((x) => x !== ROUTE_SOURCE_FILE && x !== SEARCH_GROWTH_NEW)); // route-source release: its one new file; search-growth release: its one new page
  assert.equal(files.length, 45, 'same 45-file upload tree as production');
});

test('no new claim: the new copy adds no price, time, rating, guarantee, availability or affiliation wording', () => {
  const added = EXPECTATIONS_COPY.map(([, after]) => after).join(' ');
  assert.equal(/FJ\$|\d+\s*(min|minutes|hours?)|guarantee|instant|24\/7|rated|review score|stars?\b|available now|partner of|official/i.test(added), false);
});
