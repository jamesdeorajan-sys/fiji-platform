// NAT route-page taxi FAQ candidate (ceo/nat-route-taxi-faq) on live production ba32f80 (Pages 19ce27ac-2fa7-4a53-a259-dd4887469650).
// Search data (Bing, 12 months to 22 Oct 2026) shows guests asking "taxi fare / taxi cost Nadi Airport to <hotel>". Each route page gains
// ONE question directly after its cost question, in the visible FAQ and the FAQPage JSON-LD. The answer uses only facts the page
// already states. No taxi fare, distance, journey time, price, booking or link change. DoubleTree is HELD and untouched.
// Run: node --test test/taxi-faq.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { undoTaxiFaq, TAXI_A_HTML } from './taxi-faq-revert.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const rd = (f) => readFileSync(path.join(SRC, f), 'utf8');
const PROD = { // production ba32f80 = Pages 19ce27ac (verified against the live site 23 Oct 2026: 43/43 servable files)
  '404.html': '69ed052c491633f8d3138ba68f90aeda1dbb0c37a76120ab2836358ef53e21c5',
  '_redirects': '578cd6f94e366cbeeba342ec4a34d912dc309e33f000953b8a3a8c3c38189de3',
  'app.js': '5e572d85357a324cedb5548f8052b69e5079d8b47bf0c50431b01f8fc6fa921e',
  'apple-touch-icon.png': '780145070380ed48ffcc66e5c34cc67041949de6b07556f364486f2a91169ace',
  'booking-extras.css': '5da6759b2dc795ade7d5bd67dd98bb689fba7300d04be3749ee1fc657c162e76',
  'booking-extras.js': 'e8aef0ce78f8cb1f7eb9ad925d52ad190aa1a4a1ae5329f48493add334276739',
  'chat-widget.js': 'e8a3891fe69c51664d6c2ef6dd2a2d11a9e7b3d6a024f257ce262809503c4836',
  'favicon-16x16.png': '92def666e261ca856a5f1d5db80ad5a4daae9e8f4ff5a93f671c526e64b2c676',
  'favicon-32x32.png': '523682e3a30054edbf039aca4476e74a1357ca5a506fe4df21ddf6f9d7f2e238',
  'favicon.ico': '7cfcab8fe31cb23a26dfe685132bf093ec111ae293041a907095f651a38168ac',
  'fiji-pickup.js': '9ac0ea0e887dbfdd1e9032e465faab27c51f407a5202d013090a3456cbbfafdb',
  'funnel-nat.js': '33884363eff3376b4da950376069818fbca7705308d34663e7f7910a88ded7ca',
  'icon-192.png': '402dfd7303095c39b676b0aa4fca30567aefca01630881b7677d516660de460a',
  'icon-512.png': '8b15f5b4402c7f2962606a7bd70a5f630de11c9c44b4a012116c4f772d5580e8',
  'index.html': '132e3e4aa8b587a3ee99a38cb2ffa86a635a4600def5783b24a7db8af909d2b3',
  'nadi-airport-car-rentals/index.html': '0577b96cd284b27efcd47f8eb514041402ebc79af7dc5842997d4acf86ffff44',
  'rental-assets/rental-core.js': '33fde3f58467fcac13052f8015701e4b6b0a3bffb4310a6c9c76b2e76df8f698',
  'rental-assets/rental.js': '92a59db500e22881fa23c71491a75c39cf30d8842ac044dc3a11efdc088ebde3',
  'robots.txt': '2b6dbb0871547ca5e283f9679be2eac10d0a81ce56d86daffa2a6fcb4f9c10de',
  'route-handoff.js': '8d7f90cc9682aaa1baf91bb4384f6ea12025b5728de8242c7f5e4c9d856147ee',
  'sitemap.xml': 'ac14a8cc4eb1a52f558d96f896e2352e2ea86d4db6f97402a92ab93c8c8230db',
  'styles.css': '2df99123e96d9a2d71112d306db816ad3bcc069b26eab832ff9c85c93b363bba',
  'transfer/coral-coast-outrigger.html': '27c154c07242fdd4d2804b2acf47bc4019690142ea33f3b247200bedddcc5fb0',
  'transfer/crowne-plaza-fiji-nadi-bay.html': '8d730719313df9880372c3c7056fd9bd3a5a2c71e98f071610bd609b781c0fc6',
  'transfer/doubletree-sonaisali-island.html': '08d82204bd716518d92ae318456d611f6ebd01fb89e6782d95769da8f4fa2cff',
  'transfer/fiji-marriott-resort-momi-bay.html': '1d75c4bbe363d0ebb8059838fb69ccb909065f76ddcd962c10c81fd6cf364eb0',
  'transfer/first-landing-beach-resort.html': '798b0bfe68ed0abce5bc67ff91928980d4504f32d9794d502750ad7230a2cd61',
  'transfer/grand-pacific-hotel-suva.html': '238ac42865d9568fca17c8027876681b6efd9ff47a13cf6238268dfa2ae699ac',
  'transfer/hilton-fiji-beach-resort.html': '4157f750d7d6bfbe65e16d0e0941ab8d132fe5e4d9be20853ec4f4175d4aa037',
  'transfer/intercontinental-fiji-natadola.html': '30b2a8b594dfa404eef8aa1b1adb220f9b56290db6bfff54c1731fe97fe8fce3',
  'transfer/natadola-intercontinental.html': '326cbcdd234d5f3fd405c315069bd404d9ee2cab395a81ea5b9917a835aba451',
  'transfer/naviti-resort.html': 'ca80b694c9e756af80c45df182e724562136d5f4e3ddf34a5865cd5695f43b0e',
  'transfer/pacific-harbour.html': 'b26fdc158a33e4e6a76ca5b3e8cbea041c6b3d385bd04858197f8c6d7e7a7258',
  'transfer/pearl-south-pacific-resort.html': '55ffe9b7f19472ce0d0899adacecd6d28b8ccef4ea37fc8e56184ca16c232393',
  'transfer/port-denarau-marina.html': '54a6474161c433d6492687cbd67bca0681654c49a9aae165358fce55c69e64cb',
  'transfer/port-denarau.html': '4fd247403468a910529813d531925e2889d660b84fe6fe6b52453d8f0dfc029d',
  'transfer/radisson-blu-resort-fiji-denarau.html': 'fae715785805560ea7562d1c6d29f64a7b6763c936d0bff01d39a931b8771982',
  'transfer/shangri-la-yanuca-island.html': '3121de4e6250d17a6b6128764d1444e626c9d115a17fd9d405b15cf49b0ee055',
  'transfer/sheraton-fiji-golf-beach-resort.html': 'dfd0f1aa55dbdfb478acb95eb15b180ba86b544b3a26e4d4352564f42ee7d3c3',
  'transfer/sofitel-fiji-resort-spa.html': 'c8e7e19e085fad3c494e1e3895fb6d339121d0a25d58397fdb4d2e8dbaae2f52',
  'transfer/suva.html': '06f80048aafb3cb8fa9fcfbcd57d0d2f254f638d9079b7a062f85724d9f8fbaf',
  'transfer/tanoa-international-hotel.html': '8f007ab5600d0264b40502954ba63bb0278a625132398a18a1398f5fcbedad62',
  'transfer/tokatoka-resort-hotel.html': '1991e551ebe5e832ac5e714ba9b3a89d6cd71dd69a20cb5a3a005648464f37ff',
  'transfer/warwick-fiji.html': '22476f9f6de544b330a55a9987d76cb386e5b4d6538073ca94e2a8c3fa9e3832',
  'transfer/westin-denarau-island-resort.html': '59d3189fae0a2d9b0b7b84eea9fc32c898a19536545a679322381cdff84fbe5e',
};
const ROUTES = Object.keys(PROD).filter((f) => f.startsWith('transfer/')).sort();
const HELD = ['transfer/doubletree-sonaisali-island.html'];
const CHANGED = ROUTES.filter((f) => !HELD.includes(f));
const faqLd = (s) => {
  for (const [, b] of s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const j = JSON.parse(b); const items = Array.isArray(j) ? j : (j['@graph'] || [j]);
    const f = items.find((x) => x['@type'] === 'FAQPage'); if (f) return f.mainEntity;
  }
  return null;
};
const visibleQs = (s) => [...s.matchAll(/<div class="rp-faq-item"><h3>([^<]*)<\/h3>/g)].map((m) => m[1].replace(/&amp;/g, '&'));

test('22 route pages answer "taxi or private transfer?" once, directly after the cost question, in the visible FAQ and the FAQPage JSON-LD (they match)', () => {
  assert.equal(ROUTES.length, 23); assert.equal(CHANGED.length, 22);
  for (const f of CHANGED) {
    const s = rd(f); const v = visibleQs(s); const ld = faqLd(s).map((q) => q.name);
    assert.deepEqual(v, ld, f + ': visible FAQ and JSON-LD differ');
    const i = v.findIndex((q) => q.startsWith('Should I take a taxi or a private transfer from Nadi Airport to '));
    assert.ok(i > 0 && /^How much does a Nadi Airport to .+ transfer cost\?$/.test(v[i - 1]), f + ': taxi question not directly after the cost question');
    assert.equal(v.filter((q) => /taxi/i.test(q)).length, 1, f);
    assert.equal(v[i], 'Should I take a taxi or a private transfer from Nadi Airport to ' + v[i - 1].replace(/^How much does a Nadi Airport to (.+) transfer cost\?$/, '$1') + '?');
    assert.equal(faqLd(s)[i].acceptedAnswer.text, TAXI_A_HTML);
    assert.ok(s.includes('<p>' + TAXI_A_HTML + '</p>'), f);
  }
});

test('SCOPE: removing the taxi question reproduces every production route page byte for byte; DoubleTree (HELD) is untouched', () => {
  for (const f of ROUTES) assert.equal(sha(undoTaxiFaq(rd(f))), PROD[f], f + ' differs beyond the taxi FAQ');
  for (const f of HELD) assert.equal(sha(readFileSync(path.join(SRC, f))), PROD[f], f + ' must stay byte-identical');
});

test('SCOPE: every other served file (home page, fares, booking logic, hand-off, funnel, rentals, sitemap, redirects) is byte-identical to production', () => {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(path.relative(SRC, p).split(path.sep).join('/')); } };
  walk(SRC);
  assert.deepEqual(files.sort(), Object.keys(PROD).sort(), 'same 45-file upload tree');
  for (const f of files.filter((x) => !x.startsWith('transfer/'))) assert.equal(sha(readFileSync(path.join(SRC, f))), PROD[f], f + ' changed');
});

test('no new claim: the answer has no taxi fare, price, distance, journey time, guarantee, rating or superlative; it repeats only facts the page states', () => {
  assert.equal(/\d|FJ\$|km|minute|hour|guarantee|cheap|best|lowest|rated|review(?!\s+step)|instant|24\/7|meter|metered|always|never/i.test(TAXI_A_HTML.replace('Review step', '')), false);
  for (const f of CHANGED) {
    const s = rd(f);
    for (const fact of [/whole[- ]vehicle/i, /no payment/i, /WhatsApp/]) assert.ok(fact.test(undoTaxiFaq(s)), f + ' does not already state ' + fact);
  }
  // the review-before-request and WhatsApp-confirmation facts are the approved home-page process copy (booking-expectations release)
  const home = rd('index.html');
  assert.ok(home.includes('review the total and send your request. Our Fiji team confirms the arrangements with you on WhatsApp.'));
});
