import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const src = new URL('../src/', import.meta.url);
const read = (p) => readFileSync(new URL(p, src), 'utf8');

test('the wrong InterContinental "Denarau" page is removed, not left broken or duplicated', () => {
  assert.ok(!existsSync(new URL('transfer/intercontinental-fiji-golf-resort.html', src)),
    'the page with the fabricated Denarau location, FJ$49 fare and dead FijiDash destination code must not exist');
});

test('the old slug 301s to the real InterContinental Fiji (Natadola) page', () => {
  const rules = read('_redirects').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const rule = rules.find((l) => l.startsWith('/transfer/intercontinental-fiji-golf-resort '));
  assert.ok(rule, 'redirect rule missing');
  const [, target, status] = rule.split(/\s+/);
  assert.equal(status, '301');
  assert.equal(target, '/transfer/intercontinental-fiji-natadola');
  assert.ok(existsSync(new URL(`.${target}.html`, src)), `redirect target ${target} has no page`);
});

test('the correct Natadola page still has real content and a working FijiDash destination code', () => {
  const html = read('transfer/intercontinental-fiji-natadola.html');
  assert.match(html, /Natadola/);
  assert.match(html, /INTERCONTINENTAL_NATADOLA/, 'Book Now must target the real FijiDash destination');
  assert.doesNotMatch(html, /INTERCONTINENTAL_DENARAU/);
});

test('no redirect source is left listed in the sitemap, and every sitemap route has a real page file (generic, covers every rule in _redirects)', () => {
  const sm = read('sitemap.xml');
  const pages = new Set(readdirSync(new URL('transfer/', src)).map((f) => f.replace(/\.html$/, '')));
  const rules = read('_redirects').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)[0]);
  for (const from of rules) {
    if (!from.startsWith('/transfer/') || from === '/transfer/') continue;
    const slug = from.replace('/transfer/', '');
    assert.ok(!sm.includes(slug), `redirected slug ${slug} must not still be listed in the sitemap`);
  }
  for (const m of sm.matchAll(/https:\/\/nadiairporttransfers\.com\/transfer\/([\w-]+)/g)) {
    assert.ok(pages.has(m[1]), `sitemap lists ${m[1]} with no page`);
  }
});

test('no other page links to the removed slug', () => {
  const dir = readdirSync(new URL('transfer/', src)).filter((f) => f.endsWith('.html'));
  for (const f of dir) {
    const html = read(`transfer/${f}`);
    assert.doesNotMatch(html, /intercontinental-fiji-golf-resort/, `${f} still references the removed page`);
  }
  assert.doesNotMatch(read('index.html'), /intercontinental-fiji-golf-resort/);
});
