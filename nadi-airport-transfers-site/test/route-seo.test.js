// NAT SEO route-page candidate (2026-10-12, on top of ac3642e): three existing pages (Port Denarau, Coral Coast/Outrigger, Natadola/InterContinental).
// Pins: specific titles/descriptions; verified answers (capacity and bags from the booking application's own vehicle table); booking links keep the destination;
// FAQ schema equals visible FAQ; URLs, canonicals and indexing untouched; no invented claims; the booking application files are untouched.
// Run: node --test test/route-seo.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { a11yRevert } from './a11y-p0-revert.js';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const read = (f) => readFileSync(path.join(SRC, f), 'utf8').replace(/\r/g, '');
const RouteHandoff = (() => { const w = {}; const c = { window: w, document: {}, URLSearchParams, Object }; vm.createContext(c); vm.runInContext(readFileSync(path.join(SRC, 'route-handoff.js'), 'utf8'), c); return w.NadiRouteHandoff; })();
const app = read('app.js');

const PAGES = [
  { file: 'transfer/port-denarau.html', slug: 'port-denarau', canonical: 'https://nadiairporttransfers.com/transfer/port-denarau', sedan: 'FJ$49', chooser: true, existing: ['12km, around 22 minutes'] },
  { file: 'transfer/coral-coast-outrigger.html', slug: 'coral-coast-outrigger', canonical: 'https://nadiairporttransfers.com/transfer/coral-coast-outrigger', sedan: 'FJ$129', dest: 'OUTRIGGER_FIJI', existing: ['98km, around 1 hour 36 minutes'] },
  { file: 'transfer/natadola-intercontinental.html', slug: 'natadola-intercontinental', canonical: 'https://nadiairporttransfers.com/transfer/natadola-intercontinental', sedan: 'FJ$99', dest: 'INTERCONTINENTAL_NATADOLA', existing: ['Your driver will confirm exact journey time when you book'] },
];
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const text = (h) => unesc(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const ldBlocks = (h) => [...h.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

for (const P of PAGES) {
  const h = read(P.file);
  test(`${P.slug}: title and description are specific to the route and booking intent, within sensible lengths`, () => {
    const title = unesc(h.match(/<title>([^<]*)<\/title>/)[1]);
    const desc = unesc(h.match(/<meta name="description" content="([^"]*)">/)[1]);
    assert.ok(title.length >= 40 && title.length <= 65, `title length ${title.length}: ${title}`);
    assert.ok(/Nadi Airport/.test(title) && /Transfer/.test(title));
    assert.ok(desc.length >= 100 && desc.length <= 165, `description length ${desc.length}`);
    assert.ok(/Private/.test(desc) && desc.includes(`sedan fare ${P.sedan}`) && /no payment now/i.test(desc) && /Fiji team/.test(desc), desc);
    const ogt = unesc(h.match(/<meta property="og:title" content="([^"]*)">/)[1]); assert.ok(ogt.length <= 70 && /Nadi Airport/.test(ogt));
  });
  test(`${P.slug}: URL, canonical and indexing directives are unchanged; the page is indexable`, () => {
    assert.equal(h.match(/<link rel="canonical" href="([^"]*)">/)[1], P.canonical);
    assert.ok(!/<meta name="robots"/i.test(h) && !/noindex/i.test(h));
    assert.equal((h.match(/<link rel="canonical"/g) || []).length, 1);
  });
  test(`${P.slug}: quick answers state only what is verified: booking-form limits, the confirmation-instructions pickup line, the human-confirmation line, and NO new distance or journey-time figure`, () => {
    const g = h.slice(h.indexOf('id="at-a-glance"'), h.indexOf('</ul>', h.indexOf('id="at-a-glance"')));
    const t = text(g);
    for (const c of ["maxPax:3,  maxBags:3", "maxPax:7,  maxBags:7", "maxPax:12, maxBags:14", "cap:'1–3 passengers'", "cap:'4–7 passengers'", "cap:'8–12 passengers'"]) assert.ok(app.includes(c), 'booking app no longer says: ' + c);
    assert.ok(t.includes('In the booking form: sedan 1–3 passengers, minivan 4–7, minibus 8–12. The fare is per vehicle, not per person.'));
    assert.ok(t.includes('In the booking form: sedan up to 3 bags, minivan up to 7, minibus up to 14.'));
    assert.ok(t.includes('Pickup: Follow the meeting instructions in your transfer confirmation.'), 'meeting location is unverified: instruction wording only');
    assert.ok(!/arrivals hall|sign showing|meets you|waits in/i.test(t), 'no meeting-location claim');
    assert.ok(!/surf|oversized/i.test(t), 'no luggage-handling promise beyond the booking-form limits');
    assert.ok(t.includes('No payment now') && t.includes('confirms your pickup directly'));
    assert.ok(t.includes('Journey time: Your driver confirms the journey time for your resort when you book'), t);
    assert.ok(!/\d+(\.\d+)?\s?(km|kilomet|min|hr|hour)/i.test(t), 'no precise distance or time in the quick answers: ' + t);
  });
  test(`${P.slug}: the page's pre-existing journey text and fares are exactly as they were (nothing replaced with another uncertain figure)`, () => {
    for (const e of P.existing) assert.ok(h.includes(e), 'pre-existing text missing: ' + e);
    for (const bad of ['10km', 'about 88', '88km', '59km', '1 hour 28', '1 hour 5 ', 'around 20 minutes', 'estimated for', 'booking tool']) assert.ok(!h.includes(bad), 'new precise figure present: ' + bad);
    const desc = unesc(h.match(/<meta name="description" content="([^"]*)">/)[1]) + ' ' + unesc(h.match(/<meta property="og:description" content="([^"]*)">/)[1]);
    assert.ok(!/\d+\s?(km|min|hr|hour)|about an? (hour|hr)/i.test(desc), 'no journey time in descriptions: ' + desc);
    assert.ok(h.includes(`${P.sedan}`));
  });
  test(`${P.slug}: nothing invented: no lowest-price, availability, review, rating, response-time or guarantee claims in the new copy or descriptions`, () => {
    const g = text(h.slice(h.indexOf('id="at-a-glance"'), h.indexOf('</ul>', h.indexOf('id="at-a-glance"'))));
    const desc = unesc(h.match(/<meta name="description" content="([^"]*)">/)[1]) + ' ' + unesc(h.match(/<meta property="og:description" content="([^"]*)">/)[1]);
    const faqNew = text([...h.matchAll(/<div class="rp-faq-item"><h3>(How many passengers[^<]*|Where do I meet[^<]*)<\/h3><p>([^<]*)<\/p>/g)].map((m) => m[1] + ' ' + m[2]).join(' '));
    const BANNED = /lowest|cheapest|best (price|rate)|guarantee|\bgarantee|rated|review|\bstars?\b|testimonial|always available|availability|instantly confirm|confirmed (within|in) |reply (within|in) |within \d+|\d+ ?(min|minute)s? response|24\/7|#1|number one/i;
    for (const [label, s] of [['quick answers', g], ['description', desc], ['new FAQ', faqNew]]) assert.ok(!BANNED.test(s), `${label}: ${s.match(BANNED)?.[0]}`);
  });
  test(`${P.slug}: FAQPage schema is valid JSON and matches the visible FAQ exactly (question and answer)`, () => {
    const faq = ldBlocks(h).find((b) => b['@type'] === 'FAQPage');
    const vis = [...h.matchAll(/<div class="rp-faq-item"><h3>([^<]*)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)].map((m) => [unesc(m[1]), unesc(m[2]).replace(/\s+/g, ' ').trim()]);
    const ld = faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text.replace(/\s+/g, ' ').trim()]);
    assert.deepEqual(ld, vis);
    assert.ok(ld.length >= 6 && ld.some(([q]) => /passengers and bags/.test(q)) && ld.some(([q, a]) => /meet my driver/.test(q) && a === 'Follow the meeting instructions in your transfer confirmation.'));
    for (const b of ldBlocks(h)) assert.ok(b['@context']);
  });
  test(`${P.slug}: a prominent in-content booking link keeps the destination (same builder; exact URL for fixed-resort pages, chooser anchor for the Denarau chooser)`, () => {
    const i = h.indexOf('<div class="rp-book-inline">'); assert.ok(i > h.indexOf('id="at-a-glance"'), 'link sits right after the quick answers');
    const link = h.slice(i, h.indexOf('</div>', i));
    if (P.chooser) {
      assert.ok(link.includes('href="#destChooser" data-route-cta') && link.includes('aria-describedby="destChooserLabel"'));
    } else {
      const want = RouteHandoff.buildHandoffUrl(P.dest, P.slug).replaceAll('&', '&amp;');
      assert.ok(link.includes(`href="${want}" data-route-cta`), link);
      assert.ok(want.includes(`pickup=NAN&amp;dest=${P.dest}&`));
    }
    assert.ok(h.includes('<script src="../route-handoff.js"></script>'));
  });
  test(`${P.slug}: internal links point at existing pages, with descriptive anchors, no duplicates in the related list`, () => {
    const list = h.slice(h.lastIndexOf('<div class="rp-links">'), h.indexOf('</div>', h.lastIndexOf('<div class="rp-links">')));
    const hrefs = [...list.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(hrefs).size, hrefs.length, 'duplicate links: ' + hrefs);
    for (const href of hrefs.filter((x) => x.startsWith('/transfer/'))) assert.ok(existsSync(path.join(SRC, href.replace(/^\//, '') + '.html')), `missing target ${href}`);
    for (const m of list.matchAll(/<a href="[^"]+">([^<]+)<\/a>/g)) assert.ok(m[1].trim().length >= 6, 'anchor text too short: ' + m[1]);
  });
}

test('Denarau cluster: Sofitel, Westin and Radisson Blu now link back to the Port Denarau hub; the hub links to all of them', () => {
  const hub = read('transfer/port-denarau.html');
  for (const f of ['sofitel-fiji-resort-spa', 'westin-denarau-island-resort', 'radisson-blu-resort-fiji-denarau']) {
    assert.ok(read(`transfer/${f}.html`).includes('<a href="/transfer/port-denarau">All Denarau resorts</a>'), f);
    assert.ok(hub.includes(`<a href="/transfer/${f}">`), 'hub -> ' + f);
  }
});
test('Coral Coast / Natadola clusters: new related links exist and are bidirectionally sensible', () => {
  assert.ok(read('transfer/coral-coast-outrigger.html').includes('<a href="/transfer/warwick-fiji">The Warwick Fiji</a>'));
  assert.ok(read('transfer/warwick-fiji.html').includes('href="/transfer/coral-coast-outrigger"'));
  assert.ok(read('transfer/natadola-intercontinental.html').includes('<a href="/transfer/intercontinental-fiji-natadola">InterContinental Fiji Golf Resort &amp; Spa</a>'));
});
test('SCOPE: the booking application, styles, route-handoff, sitemap, robots and redirects are untouched by this candidate (pinned to ac3642e)', () => {
  const sha = (f) => createHash('sha256').update(readFileSync(path.join(SRC, f))).digest('hex');
  assert.equal(createHash('sha256').update(a11yRevert('app.js', read('app.js'))).digest('hex').slice(0, 16), '77f9d10d26d9c009');
  assert.equal(createHash('sha256').update(a11yRevert('styles.css', read('styles.css'))).digest('hex').slice(0, 16), 'ddfccf65c777f278');
  for (const f of ['route-handoff.js', 'sitemap.xml', 'robots.txt', '_redirects', 'index.html']) assert.ok(existsSync(path.join(SRC, f)), f);
});
