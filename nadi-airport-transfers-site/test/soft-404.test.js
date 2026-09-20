import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const src = new URL('../src/', import.meta.url);
const read = (p) => readFileSync(new URL(p, src), 'utf8');

test('a top-level 404.html exists so unknown paths return 404 instead of the homepage', () => {
  assert.ok(existsSync(new URL('404.html', src)));
});

test('404.html is noindex and does not depend on relative asset paths', () => {
  const html = read('404.html');
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.doesNotMatch(html, /(?:src|href)="(?!\/|https?:|#|mailto:|tel:)[^"]+"/);
});

test('legacy Outrigger alias 301s to a route page that really exists', () => {
  const rules = read('_redirects').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  const rule = rules.find((l) => l.startsWith('/transfer/outrigger-fiji-beach-resort '));
  assert.ok(rule, 'alias rule missing');
  const [, target, status] = rule.split(/\s+/);
  assert.equal(status, '301');
  assert.ok(existsSync(new URL(`.${target}.html`, src)), `redirect target ${target} has no page`);
});

test('the alias is not listed in the sitemap and every sitemap route has a page file', () => {
  const sm = read('sitemap.xml');
  assert.ok(!sm.includes('outrigger-fiji-beach-resort'));
  const pages = new Set(readdirSync(new URL('transfer/', src)).map((f) => f.replace(/\.html$/, '')));
  for (const m of sm.matchAll(/https:\/\/nadiairporttransfers\.com\/transfer\/([\w-]+)/g)) {
    assert.ok(pages.has(m[1]), `sitemap lists ${m[1]} with no page`);
  }
});

test('redirect rules never point at themselves or chain', () => {
  const rules = read('_redirects').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/));
  const froms = new Set(rules.map((r) => r[0]));
  for (const [from, to] of rules) {
    assert.notEqual(from, to);
    assert.ok(!froms.has(to), `${from} -> ${to} chains into another redirect`);
  }
});
