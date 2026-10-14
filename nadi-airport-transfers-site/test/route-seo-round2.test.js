// NAT SEO round 2 (2026-10-14 candidate on 5144a7f): five existing resort pages. Local candidate, not deployed.
// Pins: exact FijiDash destination codes through the handoff, unchanged fares and fare tables, FAQ schema = visible FAQ, no unverified operational/geography/journey claims,
// the DoubleTree road-transfer endpoint vs the resort boat, and byte-identical booking/indexing assets.
// Run: node --test test/route-seo-round2.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const read = (f) => readFileSync(path.join(SRC, f), 'utf8').replace(/\r/g, '');
const sha = (f) => createHash('sha256').update(readFileSync(path.join(SRC, f))).digest('hex');
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const text = (h) => unesc(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const ldBlocks = (h) => [...h.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

const PAGES = [
  { slug: 'naviti-resort', dest: 'NAVITI_RESORT', sedan: 149, one: [149, 189, 239], ret: [280, 350, 445] },
  { slug: 'shangri-la-yanuca-island', dest: 'SHANGRI_LA_YANUCA', sedan: 129, one: [129, 159, 199], ret: [240, 295, 370] },
  { slug: 'hilton-fiji-beach-resort', dest: 'HILTON_DENARAU', sedan: 49, one: [49, 69, 99], ret: [95, 130, 185] },
  { slug: 'doubletree-sonaisali-island', dest: 'DOUBLETREE_SONAISALI', sedan: 69, one: [69, 89, 119], ret: null },
  { slug: 'pearl-south-pacific-resort', dest: 'PEARL_SOUTH_PACIFIC', sedan: 199, one: [199, 269, 299], ret: [370, 500, 555] },
];
const UNVERIFIED = /door-to-door|tracks your flight|monitors your flight|Flight-monitored|dedicated taxi|porte-coch|buggy|three beaches|fixed rate|Fixed Whole-Vehicle|adjusts pickup timing|southern tip|one of the largest|further east|family pool complex|western anchor|arrivals area|Sand Dunes|Sonaisali turnoff|lowest|cheapest|best price|\bwe guarantee|guaranteed (price|fare|time)|price guarantee|instantly confirm|\breviews\b|\brated\b|five-star/i;

for (const P of PAGES) {
  const h = read(`transfer/${P.slug}.html`);
  const visible = text(h.slice(h.indexOf('<header class="rp-hero">'), h.indexOf('<footer')));
  test(`${P.slug}: canonical and indexing unchanged; title and description specific to the airport-to-resort intent`, () => {
    assert.equal(h.match(/<link rel="canonical" href="([^"]*)">/)[1], `https://nadiairporttransfers.com/transfer/${P.slug}`);
    assert.equal((h.match(/<link rel="canonical"/g) || []).length, 1);
    assert.ok(!/<meta name="robots"/i.test(h) && !/noindex/i.test(h));
    const title = unesc(h.match(/<title>([^<]*)<\/title>/)[1]), desc = unesc(h.match(/<meta name="description" content="([^"]*)">/)[1]);
    assert.ok(title.length >= 45 && title.length <= 65 && /^Nadi Airport to /.test(title) && /(Private)/.test(title), title);
    assert.ok(desc.length >= 100 && desc.length <= 165, `description ${desc.length}: ${desc}`);
    assert.ok(desc.includes(`FJ$${P.sedan}`) && /no payment to request/i.test(desc) && /private/i.test(desc), desc);
    assert.ok(!/\d+\s?(km|min|hour|hr)\b/i.test(title + desc), 'no journey figure in the title or description');
  });
  test(`${P.slug}: every booking link goes to FijiDash with pickup NAN and the exact destination ${P.dest}; the set of links is unchanged in number`, () => {
    const hrefs = [...h.matchAll(/href="(https:\/\/book\.fijidash\.com\/[^"]*)"/g)].map((m) => unesc(m[1]));
    assert.ok(hrefs.length >= 3, 'resort-specific CTAs present: ' + hrefs.length);
    for (const u of hrefs) {
      const q = new URL(u).searchParams;
      assert.equal(q.get('pickup'), 'NAN'); assert.equal(q.get('dest'), P.dest); assert.equal(q.get('utm_content'), P.slug);
      assert.equal(q.get('utm_source'), 'organic');
    }
    assert.equal(new Set(hrefs).size, 1, 'all CTAs are the same exact link');
    assert.equal(hrefs.length, { 'naviti-resort': 5, 'shangri-la-yanuca-island': 5, 'hilton-fiji-beach-resort': 5, 'doubletree-sonaisali-island': 5, 'pearl-south-pacific-resort': 5 }[P.slug]);
  });
  test(`${P.slug}: published fares unchanged and consistent (hero, table, schema); returns are below two one-ways`, () => {
    assert.ok(h.includes(`<div class="rp-fare-amount">FJ$${P.sedan}</div>`)); assert.ok(/<div class="rp-fare-note">Published sedan fare · 1–3 passengers/.test(h));
    const rows = [...h.matchAll(/<tr><td>(Sedan|Minivan|Minibus)[\s\S]*?<\/td><td>FJ\$(\d+)<\/td>(?:<td>FJ\$(\d+)<\/td>)?<\/tr>/g)];
    assert.deepEqual(rows.map((r) => Number(r[2])), P.one);
    if (P.ret) { assert.deepEqual(rows.map((r) => Number(r[3])), P.ret); P.ret.forEach((r, i) => assert.ok(r < 2 * P.one[i])); } else assert.ok(rows.every((r) => !r[3]));
    const svc = ldBlocks(h).find((b) => b['@type'] === 'Service'); if (svc.offers) assert.equal(Number(svc.offers.price), P.sedan);
  });
  test(`${P.slug}: FAQPage schema equals the visible FAQ exactly and covers fare vs final total, capacity, child seat, return, meeting and payment`, () => {
    const faq = ldBlocks(h).find((b) => b['@type'] === 'FAQPage');
    const vis = [...h.matchAll(/<div class="rp-faq-item"><h3>([^<]*)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)].map((m) => [unesc(m[1]), unesc(m[2]).replace(/\s+/g, ' ').trim()]);
    const ld = faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text.replace(/\s+/g, ' ').trim()]);
    assert.deepEqual(ld, vis); assert.ok(ld.length >= 9);
    for (const k of [/same as the fare shown/, /group and luggage/, /child seat/, /return transfer/, /meet my driver/, /pay now/, /confirms my booking/]) assert.ok(ld.some(([q]) => k.test(q)), String(k));
    const a = (re) => ld.find(([q]) => re.test(q))[1];
    assert.ok(a(/same as the fare shown/).includes('published fares') && a(/same as the fare shown/).includes('can be higher or lower') && a(/same as the fare shown/).includes('eligible standard transfer bookings') && a(/same as the fare shown/).includes('over FJ$50') && a(/same as the fare shown/).includes('Review step') && a(/same as the fare shown/).includes('Child seats are FJ$8'));
    assert.equal(a(/meet my driver/), 'Follow the meeting instructions in your transfer confirmation. If you cannot find your driver, contact our team on WhatsApp.');
    assert.ok(a(/pay now/).startsWith('No.') && !/arranged directly with your driver/.test(a(/pay now/)));
  });
  test(`${P.slug}: no unverified geography, operational promise or journey figure is stated`, () => {
    const m = visible.match(UNVERIFIED); assert.equal(m, null, 'unverified wording: ' + (m && m[0]));
    if (P.slug !== 'doubletree-sonaisali-island') assert.ok(!/24\/7/.test(visible), '24/7 is only permitted where Hilton is the stated source (DoubleTree)');
    const fig = [...visible.matchAll(/\b\d+(\.\d+)?\s?(km|kilomet\w*|minutes?|hours?|hr)\b/gi)].map((x) => x[0]);
    if (P.slug === 'doubletree-sonaisali-island') {
      assert.ok(fig.every((x) => /^25 minutes$/.test(x)), 'only Hilton\u2019s own 25 minutes: ' + fig);
      const sentences = visible.split(/(?<=[.!?])\s+/).filter((x) => /\b25 minutes\b/.test(x));
      assert.ok(sentences.length >= 1 && sentences.every((x) => /Hilton\u2019s website/.test(x)), 'the figure must be attributed to Hilton: ' + sentences);
    } else assert.deepEqual(fig, [], 'journey figures: ' + fig);
  });
  test(`${P.slug}: related links point at existing pages without duplicates`, () => {
    const list = h.slice(h.lastIndexOf('<div class="rp-links">'), h.indexOf('</div>', h.lastIndexOf('<div class="rp-links">')));
    const hrefs = [...list.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(hrefs).size, hrefs.length);
    for (const x of hrefs.filter((u) => u.startsWith('/transfer/'))) assert.ok(existsSync(path.join(SRC, x.replace(/^\//, '') + '.html')), x);
  });
}

test('Shangri-La: NO numerical journey time anywhere (visible copy, FAQ, JSON-LD, description) while the resort-published 50 minutes and the booking tool\u2019s 70 minutes disagree; the FAQ gives the same neutral answer as the other pages', () => {
  const h = read('transfer/shangri-la-yanuca-island.html'); const v = text(h);
  assert.ok(!/\b\d+\s?(minutes?|mins?|hours?|hrs?|km|kilomet\w*)\b/i.test(v), 'no figure');
  assert.ok(!/50\s?minutes|approximately 50|shangri-la\.com|resort\u2019s own directions/i.test(h), 'the resort-published figure and its citation are gone from the page source (visible text and JSON-LD)');
  const faq = ldBlocks(h).find((b) => b['@type'] === 'FAQPage').mainEntity.find((q) => /How long does the drive to Shangri-La Yanuca take\?/.test(q.name));
  assert.ok(faq && faq.acceptedAnswer.text.startsWith('Journey time depends on traffic, road conditions and your exact pickup and drop-off point.') && /do not publish a fixed journey time/.test(faq.acceptedAnswer.text));
  assert.ok(!/How far is Shangri-La/.test(h), 'old distance question removed');
});
test('Naviti: the Warwick relationship is stated as a shared brand, not a geography or ranking claim', () => {
  const h = read('transfer/naviti-resort.html'); const v = text(h);
  assert.ok(v.includes('separate properties under the same Warwick Hotels & Resorts brand'));
  assert.ok(v.includes('Kids Club and a children’s playground') && !/family pool|slightly further|sister property/i.test(v));
});
test('DoubleTree: our fare is the road leg to the mainland jetty; the resort boat is described only as Hilton describes it (complimentary, 24/7 on demand, contact the resort), always attributed; no separate boat purchase is implied; no invented drop-off point', () => {
  const h = read('transfer/doubletree-sonaisali-island.html'); const v = text(h);
  assert.ok(v.includes('Our fare covers the road transfer only: it ends at the jetty on the mainland.'));
  assert.ok(v.includes('Our road transfer starts and ends at the Sonaisali jetty'));
  assert.ok(v.includes('The boat is the resort\u2019s service, not ours.'));
  assert.ok(v.includes('travel to the island requires a complimentary short boat ride from the mainland that runs 24/7 on demand'), 'Hilton\u2019s own wording (hilton.com, read 14 Oct 2026)');
  assert.ok(v.includes('contact the resort directly for boarding details'));
  // every sentence that makes a boat/service claim names Hilton as the source
  const claim = /complimentary|24\/7|on demand|three minutes|25 minutes|boarding/i;
  const sentences = v.split(/(?<=[.!?])\s+/).filter((x) => claim.test(x));
  assert.ok(sentences.length >= 5, 'claims present: ' + sentences.length);
  for (const x of sentences) assert.ok(/Hilton\u2019s website|According to Hilton|Hilton describes/.test(x) || /boarding details, transfers or mobility assistance/.test(x), 'unattributed resort claim: ' + x);
  // no implication that the guest must buy a separate boat transfer from us, and no price/hour claim of our own
  assert.ok(!/(extra|additional|separate)\s+(boat\s+)?(charge|cost|fee|fare|ticket|transfer fee)|boat (transfer )?(costs|fare|fee|price)|pay (for )?the boat|book(ing)? the boat (with|through) us|purchase/i.test(v), 'no implied separate boat purchase');
  assert.ok(!/not part of our fare|is not included/i.test(v), 'old "not included/not part of our fare" wording removed (it implied an extra charge)');
  assert.ok(!/(meeting|drop-?off|pick-?up) (bay|spot|area|building|gate|desk)|car park|parking|jetty (name|address|road)|Jetty Road|wharf|marina/i.test(v.replace(/Sonaisali jetty/g, '')), 'no invented drop-off or meeting point');
  assert.ok(/<title>Nadi Airport to DoubleTree Sonaisali Jetty: Private Transfer<\/title>/.test(h));
});
test('MUTATION: the unsupported-claims detector really fires (a guarantee, lowest-price, review, rating or door-to-door sentence added to a real page fails it)', () => {
  const real = text(read('transfer/naviti-resort.html'));
  assert.equal(real.match(UNVERIFIED), null, 'baseline page is clean');
  for (const injected of ['We guarantee your transfer.', 'Lowest price in Fiji.', 'Rated by customer reviews.', 'We guarantee a 24/7 service.', 'Our five-star service.', 'Private door-to-door transfer.', 'Your driver tracks your flight.', 'Best price guaranteed.', 'The cheapest transfer.']) {
    assert.ok(UNVERIFIED.test(real + ' ' + injected), 'detector missed: ' + injected);
  }
  // the repaired boundaries behave as word boundaries: ordinary words that merely contain the letters do not trigger it
  assert.equal('Your final total is shown at the Review step.'.match(UNVERIFIED), null);
  assert.equal('Children preview the pool.'.match(UNVERIFIED), null);
  assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(UNVERIFIED.source), 'the detector contains no control characters');
  assert.ok(UNVERIFIED.source.includes('\\bwe guarantee') && UNVERIFIED.source.includes('\\breviews\\b') && UNVERIFIED.source.includes('\\brated\\b'), 'real \\b boundaries present');
});
test('HYGIENE: the round-1 and round-2 SEO test files and the five pages contain no unintended control characters', () => {
  const files = [path.join(here, 'route-seo.test.js'), path.join(here, 'route-seo-round2.test.js')].concat(PAGES.map((x) => path.join(SRC, 'transfer', x.slug + '.html')));
  for (const f of files) {
    const bytes = readFileSync(f);
    const bad = [...bytes].map((c, i) => [c, i]).filter(([c]) => c < 32 && c !== 9 && c !== 10 && c !== 13);
    assert.equal(bad.length, 0, f + ' has control characters at byte offsets ' + bad.slice(0, 5).map((x) => x[1]));
  }
});
test('Pearl: Pacific Harbour wording is promotional attribution only (promoted as the adventure capital), no distance or time', () => {
  const v = text(read('transfer/pearl-south-pacific-resort.html'));
  assert.ok(v.includes('promoted as the adventure capital of Fiji') && v.includes('one of the longer main-island transfers'));
});
test('Hilton: no unverified bay/porte-cochere/position claims; the other Denarau pages publish the same sedan fare as stated', () => {
  const v = text(read('transfer/hilton-fiji-beach-resort.html'));
  assert.ok(v.includes('Sheraton, Westin, Sofitel and Radisson Blu Denarau pages currently publish the same sedan fare (FJ$49)'));
  for (const f of ['sheraton-fiji-golf-beach-resort', 'westin-denarau-island-resort', 'sofitel-fiji-resort-spa', 'radisson-blu-resort-fiji-denarau']) assert.ok(read(`transfer/${f}.html`).includes('Current sedan fare FJ$49'), f);
});
test('SCOPE: booking JavaScript, styles, handoff builder, chat widget, extras, home page, sitemap, robots and redirects are byte-identical to the approved production commit 5144a7f', () => {
  const PINS = {
    'app.js': '77f9d10d26d9c009f6734d0d21d2fd16c14781ab266e7e21a82bb988de824191', 'styles.css': 'ddfccf65c777f2781ce4f4877625749fa4377edda4c2879d0ee49c94b78dd0ff',
    'route-handoff.js': '8d7f90cc9682aaa1baf91bb4384f6ea12025b5728de8242c7f5e4c9d856147ee', 'chat-widget.js': 'e8a3891fe69c51664d6c2ef6dd2a2d11a9e7b3d6a024f257ce262809503c4836',
    'booking-extras.js': 'e8aef0ce78f8cb1f7eb9ad925d52ad190aa1a4a1ae5329f48493add334276739', 'booking-extras.css': '5da6759b2dc795ade7d5bd67dd98bb689fba7300d04be3749ee1fc657c162e76',
    'fiji-pickup.js': '9ac0ea0e887dbfdd1e9032e465faab27c51f407a5202d013090a3456cbbfafdb', 'index.html': 'c7974bfbea6e1320f3e89b9478ab2eb4ae32072f5feccb4eada7fa2d80b9cb70',
    'sitemap.xml': 'ca1c6463ae929fb0dffea916aa635c108f5b8385cd89bc903f064e0dd57e1400', 'robots.txt': '2b6dbb0871547ca5e283f9679be2eac10d0a81ce56d86daffa2a6fcb4f9c10de',
    '_redirects': '578cd6f94e366cbeeba342ec4a34d912dc309e33f000953b8a3a8c3c38189de3',
  };
  for (const [f, want] of Object.entries(PINS)) assert.equal(sha(f), want, f + ' changed');
});
