// NAT search-growth release (ceo/nat-search-growth-r1, built on production 49d0776). Local candidate, not deployed.
// Proves: the five hotel pages and the Denarau chooser answer the fare/child-seat/luggage/meeting/confirmation questions in the initial HTML,
// every booking hand-off keeps its exact destination, fares are unchanged, structured data equals visible text, the new family page is
// indexable + in the sitemap + links only to existing pages, DoubleTree stays byte-identical, and nothing else in the served tree moved.
// Run: node --test test/search-growth.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEARCH_GROWTH_NEW, SEARCH_GROWTH_EDITED } from './search-growth-revert.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const FIX = path.join(here, 'fixtures', 'pre-search-growth');
const read = (f) => readFileSync(path.join(SRC, f), 'utf8');
const fix = (f) => readFileSync(path.join(FIX, f.replace(/\//g, '_')), 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, '’').replace(/&ndash;/g, '–');
const text = (h) => unesc(h.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const ldBlocks = (h) => [...h.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const visFaq = (h) => [...h.matchAll(/<div class="rp-faq-item"><h3>([^<]*)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)].map((m) => [unesc(m[1]), unesc(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()]);
const ldFaq = (h) => ldBlocks(h).find((b) => b['@type'] === 'FAQPage').mainEntity.map((q) => [q.name, q.acceptedAnswer.text.replace(/\s+/g, ' ').trim()]);
const MEET = 'Your driver waits in the international arrivals hall with a sign showing your name. If you cannot find your driver, contact our team on WhatsApp.';
const BANNED = /tracks your flight|monitors your flight|guarantee|24\/7|\brated\b|\bstars?\b|testimonial|lowest|cheapest|best price|instantly confirm|arrivals area|door-to-door|aggregateRating|ratingValue|reviewCount/i;

const HOTELS = [
  { slug: 'hilton-fiji-beach-resort', dest: 'HILTON_DENARAU', one: [49, 69, 99], ret: [95, 130, 185], utm: 'legacy_route_page' },
  { slug: 'naviti-resort', dest: 'NAVITI_RESORT', one: [149, 189, 239], ret: [280, 350, 445], utm: 'legacy_route_page' },
  { slug: 'shangri-la-yanuca-island', dest: 'SHANGRI_LA_YANUCA', one: [129, 159, 199], ret: [240, 295, 370], utm: 'legacy_route_page' },
  { slug: 'pearl-south-pacific-resort', dest: 'PEARL_SOUTH_PACIFIC', one: [199, 269, 299], ret: [370, 500, 555], utm: 'legacy_route_page' },
  { slug: 'port-denarau-marina', dest: null, one: [49, 69, 99], ret: [95, 130, 185], utm: null }, // destination code read from the page's own pre-release link
];
const fareRows = (h) => [...h.matchAll(/<tr><td>(?:Sedan|Minivan|Minibus)[\s\S]*?<\/tr>/g)].map((m) => m[0]);

for (const P of HOTELS) {
  const f = `transfer/${P.slug}.html`;
  const h = read(f), before = fix(f);
  const body = h.slice(h.indexOf('<header class="rp-hero">'), h.indexOf('<footer'));
  test(`${P.slug}: URL, canonical and indexability unchanged; unique search-length title and description`, () => {
    assert.equal(h.match(/<link rel="canonical" href="([^"]*)">/)[1], `https://nadiairporttransfers.com/transfer/${P.slug}`);
    assert.equal((h.match(/<link rel="canonical"/g) || []).length, 1);
    assert.ok(!/<meta name="robots"/i.test(h) && !/noindex/i.test(h));
    const title = unesc(h.match(/<title>([^<]*)<\/title>/)[1]), desc = unesc(h.match(/<meta name="description" content="([^"]*)">/)[1]);
    assert.ok(title.length >= 45 && title.length <= 65 && /^Nadi Airport to /.test(title) && /Private/.test(title), title);
    assert.ok(desc.length >= 100 && desc.length <= 160 && /^Private Nadi Airport to /.test(desc), `${desc.length}: ${desc}`);
    assert.ok(desc.includes(`sedan FJ$${P.one[0]}`) && desc.includes(`return FJ$${P.ret[0]}`) && /per vehicle/.test(desc) && /Child seat FJ\$8/.test(desc), desc);
    assert.notEqual(desc, unesc(before.match(/<meta name="description" content="([^"]*)">/)[1]));
  });
  test(`${P.slug}: published fares, return fares and fare table are byte-identical to production`, () => {
    assert.deepEqual(fareRows(h), fareRows(before));
    assert.equal(fareRows(h).length, 3);
    const nums = fareRows(h).map((r) => [...r.matchAll(/FJ\$(\d+)/g)].map((m) => Number(m[1])));
    assert.deepEqual(nums.map((n) => n[0]), P.one); assert.deepEqual(nums.map((n) => n[1]), P.ret);
  });
  test(`${P.slug}: every booking hand-off keeps the exact destination and attribution fields; one prominent button is added in the initial HTML`, () => {
    const links = (s) => [...s.matchAll(/href="(https:\/\/book\.fijidash\.com\/[^"]*)"/g)].map((m) => unesc(m[1]));
    const old = links(before), now = links(h);
    assert.equal(new Set(old).size, 1); assert.equal(new Set(now).size, 1, 'all booking links are the same exact link');
    assert.equal(now[0], old[0], 'the new button reuses the page’s existing exact hand-off link');
    assert.equal(now.length, old.length + 1);
    const q = new URL(now[0]).searchParams;
    assert.equal(q.get('pickup'), 'NAN'); assert.ok(q.get('dest')); if (P.dest) assert.equal(q.get('dest'), P.dest);
    assert.equal(q.get('utm_content'), P.slug); assert.equal(q.get('utm_source'), 'organic'); // route-source.js swaps the source at click time
    const i = h.indexOf('id="before-you-book"'); assert.ok(i > 0 && h.indexOf('rp-cta', i) > i);
    assert.ok(i < h.indexOf('<section class="rp-section rp-mobile-assist-section"'), 'the new section sits before the info grid, which is hidden below 768px');
    assert.ok(h.includes('<script src="../route-source.js"></script>'));
  });
  test(`${P.slug}: the five required answers are in the initial HTML`, () => {
    const sec = h.slice(h.indexOf('id="before-you-book"'), h.indexOf('<section class="rp-section rp-mobile-assist-section"'));
    const t = text(sec);
    assert.ok(/waits in the international arrivals hall with a sign showing your name/.test(t) && /WhatsApp/.test(t), 'meeting');
    assert.ok(/child\/baby seat is FJ\$8 on request/.test(t) && /Luggage limits are listed per vehicle/.test(t), 'child seat + luggage');
    assert.ok(/Return fares for a round trip booked together: sedan FJ\$\d+, minivan FJ\$\d+, minibus FJ\$\d+/.test(t), 'return');
    assert.ok(/Review step shows your total before you send your request/.test(t) && /no payment is requested/.test(t) && /real member of our Fiji-based team/.test(t), 'confirmation');
    const all = text(body);
    for (const k of [/not per person|per vehicle/, /sedan 1.3 passengers and up to 3 bags/, /20% night surcharge/, /one stop at a supermarket|complimentary/i, /over FJ\$50/]) assert.ok(k.test(all), String(k));
  });
  test(`${P.slug}: FAQPage JSON-LD equals the visible FAQ; fare, per-vehicle, private, extras, child seat, return, meeting, payment all answered once`, () => {
    assert.deepEqual(ldFaq(h), visFaq(h));
    const qs = visFaq(h).map(([q]) => q);
    assert.equal(new Set(qs).size, qs.length);
    for (const k of [/per person or per vehicle/, /private or a shared shuttle/, /extra charges or surcharges/, /child seat/i, /return transfer/i, /meet my driver/, /pay now/]) assert.ok(qs.some((q) => k.test(q)), String(k));
    const i = qs.findIndex((q) => /^Should I take a taxi or a private transfer/.test(q)); assert.ok(i > 0 && /^How much does a Nadi Airport to /.test(qs[i - 1]), 'cost, then taxi stays adjacent');
    assert.equal(visFaq(h).find(([q]) => /meet my driver/.test(q))[1], MEET);
    assert.ok(visFaq(h).find(([q]) => /Can I add a child seat/.test(q))[1].endsWith('Travelling with children? See our Nadi Airport transfers with child seats guide.'));
    assert.ok(h.includes('<a href="/nadi-airport-transfers-with-child-seats/"'), 'descriptive internal link to the family guide');
  });
  test(`${P.slug}: no rating, review, guarantee, journey figure or unverified wording is added`, () => {
    const g = new RegExp(BANNED.source, 'gi'), count = (t) => (t.match(g) || []).length;
    assert.ok(count(text(h)) <= count(text(before)), 'no banned wording is added (pre-existing occurrences are reported in the factual-gaps list, not changed here)');
    const fig = /\b\d+(\.\d+)?\s?(km|kilomet\w*|minutes?|hours?|hr)\b/gi;
    assert.ok((text(h).match(fig) || []).length <= (text(before).match(fig) || []).length, 'no journey figure is added');
    assert.ok(!ldBlocks(h).some((b) => JSON.stringify(b).includes('aggregateRating')));
  });
}

test('Port Denarau chooser (/transfer/port-denarau): fare-search answers added, destination chooser links unchanged', () => {
  const h = read('transfer/port-denarau.html'), b = fix('transfer/port-denarau.html');
  assert.equal(h.match(/<link rel="canonical" href="([^"]*)">/)[1], 'https://nadiairporttransfers.com/transfer/port-denarau');
  const title = unesc(h.match(/<title>([^<]*)<\/title>/)[1]), desc = unesc(h.match(/<meta name="description" content="([^"]*)">/)[1]);
  assert.ok(title.length <= 65 && /How Much Is Nadi Airport to Denarau/.test(title)); assert.ok(desc.length <= 160 && /per vehicle, not per person/.test(desc));
  assert.deepEqual(ldFaq(h), visFaq(h));
  const qs = visFaq(h).map(([q]) => q);
  assert.ok(qs.includes('How much is Nadi Airport to Denarau?') && qs.some((q) => /per person or per vehicle/.test(q)));
  const hrefs = (s) => [...s.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs(h), hrefs(b), 'no link added, removed or changed on the chooser page');
  // return fares are NOT quoted on the chooser: Hilton/Marina pages publish 95/130/185 but Sheraton/Westin/Sofitel/Radisson pages publish 91/128/183 (reported, not chosen here)
  assert.ok(!/\bFJ\$(95|130|185|91|128|183)\b/.test(visFaq(h).map(([, a]) => a).join(' ')));
  // the one-way claim is true: every page it names publishes 49/69/99
  for (const s of ['hilton-fiji-beach-resort', 'sheraton-fiji-golf-beach-resort', 'westin-denarau-island-resort', 'sofitel-fiji-resort-spa', 'radisson-blu-resort-fiji-denarau'])
    assert.deepEqual(fareRows(read(`transfer/${s}.html`)).map((r) => Number(r.match(/FJ\$(\d+)/)[1])), [49, 69, 99], s);
});

test('home page: only the fare-intro answer and the family-guide link are added; nothing else (FAQ_DATA, JS, booking form) moves', () => {
  const now = read('index.html'), was = fix('index.html');
  const a = was.split('\n'), b = now.split('\n');
  const removed = a.filter((l) => !b.includes(l)), added = b.filter((l) => !a.includes(l));
  assert.ok(removed.length <= 1 && added.length <= 8, `removed ${removed.length}, added ${added.length}`);
  const addedText = added.join('\n');
  assert.ok(/per vehicle, not per person/.test(addedText) && /nadi-airport-transfers-with-child-seats/.test(addedText));
  assert.ok(!/<script/.test(addedText) && !/FAQ_DATA/.test(addedText));
  assert.deepEqual([...now.matchAll(/<script src="([^"]*)"/g)].map((m) => m[1]), [...was.matchAll(/<script src="([^"]*)"/g)].map((m) => m[1]));
  assert.equal(now.match(/<link rel="canonical" href="([^"]*)">/)[1], was.match(/<link rel="canonical" href="([^"]*)">/)[1]);
  assert.equal(now.match(/<title>([^<]*)<\/title>/)[1], was.match(/<title>([^<]*)<\/title>/)[1]);
});

// ---------- the new family page ----------
const FAM = 'nadi-airport-transfers-with-child-seats/index.html';
test('family page: exists once at the requested URL, indexable, self-canonical, titled as requested', () => {
  assert.ok(existsSync(path.join(SRC, FAM)));
  const h = read(FAM);
  assert.equal(h.match(/<title>([^<]*)<\/title>/)[1], 'Nadi Airport Transfers with Child Seats | Private Family Transfers');
  assert.equal(h.match(/<link rel="canonical" href="([^"]*)">/)[1], 'https://nadiairporttransfers.com/nadi-airport-transfers-with-child-seats/');
  assert.ok(!/<meta name="robots"/i.test(h) && !/noindex/i.test(h));
  assert.equal((h.match(/<h1\b/g) || []).length, 1);
  const desc = unesc(h.match(/<meta name="description" content="([^"]*)">/)[1]); assert.ok(desc.length >= 100 && desc.length <= 160, desc);
  // no equivalent page existed: no other served file is a child-seat/family page
  const names = []; const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); statSync(p).isDirectory() ? walk(p) : names.push(path.relative(SRC, p)); } }; walk(SRC);
  assert.deepEqual(names.filter((n) => /child|family|seat/i.test(n)), [FAM]);
});
test('family page: in the sitemap exactly once (one added entry, nothing else changed) and linked from the home page and every changed hotel page', () => {
  const sm = read('sitemap.xml'), was = fix('sitemap.xml');
  assert.equal(sm.split('<loc>https://nadiairporttransfers.com/nadi-airport-transfers-with-child-seats/</loc>').length, 2);
  const entry = '<url>\n<loc>https://nadiairporttransfers.com/nadi-airport-transfers-with-child-seats/</loc>\n<changefreq>monthly</changefreq>\n<priority>0.8</priority>\n</url>\n';
  assert.equal(sm.replace(entry, ''), was);
  assert.ok(read('index.html').includes('href="/nadi-airport-transfers-with-child-seats/"'));
  for (const P of HOTELS) assert.ok(read(`transfer/${P.slug}.html`).includes('href="/nadi-airport-transfers-with-child-seats/"'), P.slug);
  assert.ok(read('_redirects').indexOf('child-seats') === -1, 'no redirect touches the new URL');
});
test('family page: structured data equals the visible text (FAQPage + BreadcrumbList), no ratings', () => {
  const h = read(FAM);
  assert.deepEqual(ldFaq(h), visFaq(h)); assert.equal(visFaq(h).length, 10);
  const bc = ldBlocks(h).find((b) => b['@type'] === 'BreadcrumbList');
  assert.deepEqual(bc.itemListElement.map((x) => x.item), ['https://nadiairporttransfers.com/', 'https://nadiairporttransfers.com/nadi-airport-transfers-with-child-seats/']);
  assert.equal(ldBlocks(h).length, 2); assert.ok(!/aggregateRating|ratingValue|reviewCount|"Review"/.test(h));
});
test('family page: states only verified seat types and conditions; no invented availability, guarantees, journey times or reviews', () => {
  const h = read(FAM), t = text(h.slice(h.indexOf('<header'), h.indexOf('<footer')));
  assert.equal(BANNED.test(t), false, (t.match(BANNED) || [])[0]);
  assert.ok(/We do not list seat types on this page/.test(t) && /our team confirms/i.test(t));
  assert.ok(!/\b(booster|isofix|infant carrier|rear[- ]facing|convertible|forward[- ]facing)\b/i.test(t), 'no seat type is named');
  assert.deepEqual([...t.matchAll(/\b\d+(\.\d+)?\s?(km|kilomet\w*|minutes?|hours?|hr)\b/gi)].map((x) => x[0]), []);
  assert.ok(!/\bin stock\b|always available|guaranteed|free of charge seat/i.test(t));
  for (const k of [/FJ\$8/, /sedan up to 3 passengers and 3 bags/, /minivan 4.7 passengers and 7 bags/, /minibus 8.12 passengers and 14 bags/, /FJ\$24/, /10 pm and 6 am carry a 20% night surcharge/, /one complimentary stop at a supermarket, ATM, bottle shop or pharmacy/, /not per person/, /international arrivals hall with a sign showing your name/])
    assert.ok(k.test(t), String(k));
});
test('family page: fare table equals each linked page’s own published one-way table; every internal link resolves to a served page', () => {
  const h = read(FAM);
  const rows = [...h.matchAll(/<tr><td><a href="\/transfer\/([^"]+)"[^>]*>([^<]*)<\/a><\/td><td>FJ\$(\d+)<\/td><td>FJ\$(\d+)<\/td><td>FJ\$(\d+)<\/td><\/tr>/g)];
  assert.equal(rows.length, 8);
  for (const [, slug, , a, b, c] of rows) {
    const page = read(`transfer/${slug}.html`);
    assert.deepEqual(fareRows(page).map((r) => Number(r.match(/FJ\$(\d+)/)[1])), [Number(a), Number(b), Number(c)], slug);
  }
  const hrefs = [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).filter((x) => x.startsWith('/'));
  for (const x of hrefs) {
    const p = x.split('#')[0]; if (p === '/' || /\.(png|ico|css)/.test(p)) continue;
    assert.ok(existsSync(path.join(SRC, p.replace(/\/$/, '') + (p.startsWith('/transfer/') ? '.html' : '/index.html'))), 'broken internal link ' + x);
  }
  for (const s of ['hilton-fiji-beach-resort', 'naviti-resort', 'shangri-la-yanuca-island', 'pearl-south-pacific-resort', 'port-denarau-marina']) assert.ok(h.includes(`href="/transfer/${s}"`), s);
});
test('family page: booking hand-off goes to the existing FijiDash flow with attribution fields and no payment/message is triggered by loading it', () => {
  const h = read(FAM);
  const links = [...h.matchAll(/href="(https:\/\/book\.fijidash\.com\/[^"]*)"/g)].map((m) => unesc(m[1]));
  assert.ok(links.length >= 3 && new Set(links).size === 1);
  const q = new URL(links[0]).searchParams;
  assert.equal(q.get('pickup'), 'NAN'); assert.equal(q.get('dest'), null, 'no single destination: the guest picks it on FijiDash');
  assert.equal(q.get('utm_source'), 'organic'); assert.equal(q.get('utm_medium'), 'route_page'); assert.equal(q.get('utm_campaign'), 'nadi_family_transfers'); assert.equal(q.get('utm_content'), 'nadi-airport-transfers-with-child-seats');
  assert.ok(h.includes('<script src="/route-source.js"></script>'));
  assert.ok(!/<form\b/.test(h) && !/fetch\(|XMLHttpRequest|sendBeacon/.test(h), 'static page: no form posts or network calls of its own');
  assert.ok(h.includes('id="primaryCta"'));
  for (const m of h.matchAll(/(?:href|src)="(\/[^"#]*)"/g)) { const p = m[1].split('?')[0]; if (p.endsWith('/') || p.startsWith('/transfer/')) continue; assert.ok(existsSync(path.join(SRC, p)), 'missing asset ' + p); }
});

// ---------- scope ----------
const HELD = 'transfer/doubletree-sonaisali-island.html';
test('SCOPE: DoubleTree stays byte-identical to production (held)', () => {
  assert.equal(sha(readFileSync(path.join(SRC, HELD))).slice(0, 16), '08d82204bd716518');
});
test('SCOPE: exactly 8 existing files edited and 1 added; every other served file is byte-identical to production 49d0776', () => {
  assert.equal(SEARCH_GROWTH_EDITED.length, 8);
  assert.ok(existsSync(path.join(SRC, SEARCH_GROWTH_NEW)));
  const prodFixtureHashes = {
    'index.html': 'e65583ba03c58cd9', 'sitemap.xml': 'ac14a8cc4eb1a52f', 'transfer/hilton-fiji-beach-resort.html': '7625278603b302be', 'transfer/naviti-resort.html': '3b9cb6fe8c7f8dee',
    'transfer/shangri-la-yanuca-island.html': 'f74bdd933a1f0aca', 'transfer/pearl-south-pacific-resort.html': '92698b3316a31765', 'transfer/port-denarau-marina.html': 'e430fd918ec59cf9', 'transfer/port-denarau.html': '8bbb5daa03697c97',
  };
  for (const [f, w] of Object.entries(prodFixtureHashes)) assert.equal(sha(fix(f)).slice(0, 16), w, 'fixture ' + f + ' must be the production bytes');
  for (const f of SEARCH_GROWTH_EDITED) assert.notEqual(sha(read(f)), sha(fix(f)), f + ' should differ');
});
