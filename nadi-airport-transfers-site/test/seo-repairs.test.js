import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const src = new URL('../src/', import.meta.url);
const read = (p) => readFileSync(new URL(p, src), 'utf8');
const home = read('index.html');
const routes = readdirSync(new URL('transfer/', src)).filter((f) => f.endsWith('.html'));

test('the false InterContinental "Denarau" dropdown entries are gone from both location lists', () => {
  assert.doesNotMatch(home, /INTERCONTINENTAL_DENARAU/);
  assert.doesNotMatch(home, /P_INTERCON_DENARAU/);
  assert.doesNotMatch(home, />\s*InterContinental Denarau\s*</);
  // the real (Natadola) InterContinental entries are untouched
  assert.match(home, /value="INTERCONTINENTAL_NATADOLA"/);
  assert.match(home, /value="P_INTERCON_NATADOLA"/);
});

test('every homepage <img> declares width and height (no layout shift)', () => {
  const imgs = home.match(/<img\b[^>]*>/g) || [];
  assert.ok(imgs.length >= 16);
  for (const i of imgs) {
    assert.match(i, /\swidth="\d+"/, i.slice(0, 120));
    assert.match(i, /\sheight="\d+"/, i.slice(0, 120));
  }
});

test('no sitemap page is orphaned: each is linked from the homepage or another route page', () => {
  const sm = read('sitemap.xml');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://nadiairporttransfers.com', ''));
  const all = [home, ...routes.map((f) => read(`transfer/${f}`))].join('\n');
  for (const l of locs.filter((x) => x !== '/')) assert.ok(all.includes(`href="${l}"`), `${l} is not linked from any page`);
  assert.ok(!/<lastmod>/.test(sm), 'no invented lastmod dates');
});

test('the legacy Outrigger alias is no longer linked internally (the 301 remains for outside links)', () => {
  assert.doesNotMatch(home, /href="\/transfer\/outrigger-fiji-beach-resort"/);
  assert.match(read('_redirects'), /^\/transfer\/outrigger-fiji-beach-resort\s+\/transfer\/coral-coast-outrigger\s+301/m);
});

test('the www canonical-host redirect is documented as a zone rule that preserves path and query', () => {
  const doc = read('../WWW-REDIRECT-RULE.md');
  assert.match(doc, /Preserve query string: ON/);
  assert.match(doc, /http\.request\.uri\.path/);
  assert.match(doc, /301/);
});

test('unsupported rating / hours / response-time markup stays absent', () => {
  const live = home.replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(live, /aggregateRating|openingHours|24\/7|within 15 minutes|500\+/);
});
