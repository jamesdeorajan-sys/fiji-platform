// NAT route-page title/description candidate (ceo/nat-route-titles) on live production a50f436 (Pages 035d4603-e578-4dde-94f5-0209c67907dd).
// 13 route pages had titles of 68-102 characters and descriptions of 164-207, so search results cut them off; their titles also ended
// "— Fixed Whole-Vehicle Price", wording the round-2 tests list as unverified. They now follow the pattern of the already-optimised pages.
// Only <title> and <meta name="description"> change. No fare, link, booking, visible-text, og/twitter or JSON-LD change. DoubleTree HELD.
// Run: node --test test/route-titles.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TITLES, undoRouteTitles } from './route-titles-revert.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const rd = (f) => readFileSync(path.join(SRC, f), 'utf8');
const PROD = { // production a50f436 = Pages 035d4603 (verified live 23 Oct 2026: 43/43 servable files)
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
  'transfer/coral-coast-outrigger.html': 'd0c8813cf67b2bdc24e7cdbc1fc260b8ce9161069cbe57b80f0b089ff002b57c',
  'transfer/crowne-plaza-fiji-nadi-bay.html': 'd58585f52f86daaf7f67451499bed8769e95795b94b2392019d21c7995aca997',
  'transfer/doubletree-sonaisali-island.html': '08d82204bd716518d92ae318456d611f6ebd01fb89e6782d95769da8f4fa2cff',
  'transfer/fiji-marriott-resort-momi-bay.html': '123203cd076cb17426b548eea911bda70882c603986d9610a0c12adf137ecf5b',
  'transfer/first-landing-beach-resort.html': '623c2cda7428f93fd689f5e21a4e5652d237b3f12760d28421c0cf80a5505e72',
  'transfer/grand-pacific-hotel-suva.html': '9af41048dfb49fb89b5cb99d73387d62669eb9b727903e39ce1ea7e9999f53ca',
  'transfer/hilton-fiji-beach-resort.html': 'b7f8a810435bce30c2de2eaa988d9e85ea7a9d05baf586386b1b8efaf1020648',
  'transfer/intercontinental-fiji-natadola.html': '45cc6ae822c0cd3cce43abd52500dfce02834ec020dc841a8049d9bf702ae1da',
  'transfer/natadola-intercontinental.html': '511f8c67d3035e93bbc603fdb540ad30dfe3248cb695f66f7812098cc2e01beb',
  'transfer/naviti-resort.html': '544f166159460406aade312147e37f6cdcbee21fb7b1af91a2e3c88e706e4dd2',
  'transfer/pacific-harbour.html': 'ad8da96f6a20a2ddf32567bbed66ebd434ca8f582bd76e62902644e8bf6c660b',
  'transfer/pearl-south-pacific-resort.html': 'd63a327308044d322c5c597aa271ccd5cb227f8180c54d04bf7b2a09a366b0fa',
  'transfer/port-denarau-marina.html': '3911f37fe97205937fc7c525b118ded8e3db3c2644c7dbe6b71c83830c5ce8d0',
  'transfer/port-denarau.html': '43fec4ba247f6c07091f612eb4fbb92fcf424a3e6069be38c6b2166863818b3f',
  'transfer/radisson-blu-resort-fiji-denarau.html': '18c2654a58bb229aa035c61d2e1eacada38ba5b2fc5edf5e34fd009e2c03f947',
  'transfer/shangri-la-yanuca-island.html': '230da6e49eaf0080211e7e9975a2b9bdccc32c23d63de0295b5386e01d66e9ac',
  'transfer/sheraton-fiji-golf-beach-resort.html': '7f3526d98bedff22736872879a71de957a06723c0b02fa2135befafe818e26bc',
  'transfer/sofitel-fiji-resort-spa.html': 'cbb8e54872a844144ad9ad3f80fd86425d88943812ee8b22c29973cb6317f6b0',
  'transfer/suva.html': 'f181c4342688eb9f8bacd58ccad28e38137229a0b5644217b39a1cc8082b944e',
  'transfer/tanoa-international-hotel.html': '22f7ba51ef2ac1e991a891655efbc1cce5e1288c05e204c20c9077ccb4769d48',
  'transfer/tokatoka-resort-hotel.html': '2600ff8e39c01975c2550e1f3d22d4625b9f941f66309f57e176af5d78199723',
  'transfer/warwick-fiji.html': '146df89bde693ce69e7fd1cb49bf06fe461dd7b87be903264c96ba010ed55277',
  'transfer/westin-denarau-island-resort.html': 'cbfff2a543130f198145184f3aac3e0f17552daf687a85ae80c35aaa03c060cb',
};
const title = (s) => s.match(/<title>([^<]*)<\/title>/)[1];
const desc = (s) => s.match(/<meta name="description" content="([^"]*)">/)[1];

test('13 route pages: title 40-60 characters in the "Nadi Airport to …" pattern; description 70-160 characters; no unverified wording or journey figure', () => {
  assert.equal(Object.keys(TITLES).length, 13);
  for (const f of Object.keys(TITLES)) {
    const s = rd(f), t = title(s), d = desc(s);
    assert.ok(t.length >= 40 && t.length <= 60 && /^Nadi Airport to .+Transfer$/.test(t), f + ': ' + t);
    assert.ok(d.length >= 70 && d.length <= 160 && d.startsWith('Private Nadi Airport to '), f + ': ' + d.length);
    assert.equal(/Fixed|guarantee|instant|cheapest|best|lowest|\d+\s?(km|min|hour|hr)\b/i.test(t + ' ' + d), false, f);
  }
});

test('each description states the same sedan fare as the page\'s own cost answer, and only facts the page already states', () => {
  for (const f of Object.keys(TITLES)) {
    const s = rd(f); const d = desc(s);
    const cost = s.match(/<h3>How much does a Nadi Airport to [^<]*cost\?<\/h3><p>([^<]*)<\/p>/)[1];
    assert.equal(d.match(/FJ\$\d+/)[0], cost.match(/FJ\$\d+/)[0], f);
    assert.ok(/whole[- ]vehicle/i.test(cost) && /no payment/i.test(s), f);
  }
});

test('every route page title is now within 65 characters except DoubleTree (HELD); titles stay unique', () => {
  const all = Object.keys(PROD).filter((f) => f.startsWith('transfer/'));
  const titles = all.map((f) => title(rd(f)).replace(/&amp;/g, '&'));
  assert.equal(new Set(titles).size, titles.length);
  for (const f of all) if (f !== 'transfer/doubletree-sonaisali-island.html') assert.ok(title(rd(f)).replace(/&amp;/g, '&').length <= 65, f);
});

test('SCOPE: undoing the title/description edit reproduces every production file byte for byte (og, twitter, JSON-LD, body unchanged)', () => {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(path.relative(SRC, p).split(path.sep).join('/')); } };
  walk(SRC);
  assert.deepEqual(files.sort(), Object.keys(PROD).sort());
  for (const f of files) {
    const b = readFileSync(path.join(SRC, f));
    assert.equal(sha(TITLES[f] ? undoRouteTitles(f, b.toString('utf8')) : b), PROD[f], f);
  }
});
