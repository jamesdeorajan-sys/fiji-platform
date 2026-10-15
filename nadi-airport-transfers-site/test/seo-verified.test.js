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

test('B: homepage title fits search results (<= 60), keeps the site name first and adds the "Fiji airport transfers" phrase; description <= 160; social titles match; no new claims', () => {
  const s = readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const title = s.match(/<title>([^<]*)<\/title>/)[1];
  const desc = s.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(title.length <= 60, title.length); assert.ok(title.startsWith('Nadi Airport Transfers')); assert.match(title, /Fiji Airport Transfers/);
  assert.ok(desc.length <= 160, desc.length);
  assert.ok(s.includes(`<meta property="og:title" content="${title}">`) && s.includes(`<meta name="twitter:title" content="${title}">`));
  for (const w of ['cheapest', 'best', 'lowest', '#1', 'guaranteed']) assert.ok(!(title + desc).toLowerCase().includes(w), w);
});

test('C: no unsupported superlative claims in any page text (#1, number one, cheapest); the replacement states only how WhatsApp support works', () => {
  for (const p of html) {
    const v = readFileSync(p, 'utf8').replace(/<head\b[\s\S]*?<\/head>/i, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
    for (const re of [/#1\b/, /number one/i, /\bcheapest\b/i]) assert.ok(!re.test(v), `${path.relative(SRC, p)}: ${re}`);
  }
  assert.ok(readFileSync(path.join(SRC, 'index.html'), 'utf8').includes("WhatsApp our team now —\n            it's the same team that is arranging your transfer."));
});
