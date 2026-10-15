// Verified SEO defects fixed on ceo/nat-seo-verified-fixes (no fare, booking or route-page change).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const html = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); statSync(p).isDirectory() ? walk(p) : n.endsWith('.html') && html.push(p); } };
walk(SRC);
const redirectSources = readFileSync(path.join(SRC, '_redirects'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split(/\s+/)[0].replace(/\/$/, ''));

test('A: no internal link points at a URL that _redirects sends elsewhere (crawlers and guests reach the final page directly)', () => {
  assert.ok(redirectSources.includes('/transfer/outrigger-fiji-beach-resort'));
  for (const p of html) {
    const s = readFileSync(p, 'utf8');
    for (const [, href] of s.matchAll(/<a\b[^>]*href="(?:https:\/\/nadiairporttransfers\.com)?(\/[^"#?]*)"/g)) {
      if (href === '/') continue;
      assert.ok(!redirectSources.includes(href.replace(/\/$/, '')), `${path.relative(SRC, p)} links to redirecting ${href}`);
    }
  }
  assert.ok(readFileSync(path.join(SRC, 'index.html'), 'utf8').includes('<a href="/transfer/coral-coast-outrigger">Nadi Airport → Outrigger Fiji</a>'));
});
