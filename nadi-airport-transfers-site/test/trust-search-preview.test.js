const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const index = read('index.html');
const appJs = read('app.js');
const routeFiles = fs.readdirSync(path.join(SRC, 'transfer')).filter((f) => f.endsWith('.html'));

test('homepage structured data carries no unsourced aggregateRating', () => {
  assert.doesNotMatch(index, /aggregateRating|"ratingValue"|"reviewCount"/);
  for (const blk of index.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []) {
    JSON.parse(blk.replace(/<\/?script[^>]*>/g, ''));
  }
});

test('no unsourced review count/score or "Verified" label remains (static HTML and JS-rendered cards)', () => {
  const visible = index.replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(visible, /500\+|4\.9 \/ 5|4\.9 Google|review · Verified|Verified reviews/);
  assert.doesNotMatch(appJs, /review · Verified/);
});

test('WhatsApp support claim matches the staffed-hours wording used on FijiDash', () => {
  assert.doesNotMatch(index, /24\/7 WhatsApp support/);
  assert.match(index, /WhatsApp support \(replies in staffed hours\)/);
});

test('child seat wording is consistent: FJ$8 in the FAQ, the extras list and the comparison table', () => {
  assert.match(index, /small charge of FJ\$8/);
  assert.match(index, /<td>Child seats \(request\)<\/td><td class="featured-col chk">FJ\$8<\/td>/);
  assert.doesNotMatch(index, /Child seats \(request\)<\/td><td class="featured-col chk">✓ Free/);
});

test('homepage links canonical route pages, not the legacy Outrigger URL, and reaches the two formerly orphaned pages', () => {
  assert.doesNotMatch(index, /href="\/transfer\/outrigger-fiji-beach-resort"/);
  assert.match(index, /href="\/transfer\/coral-coast-outrigger"/);
  assert.match(index, /href="\/transfer\/first-landing-beach-resort"/);
  assert.match(index, /href="\/transfer\/warwick-fiji"/);
});

test('every sitemap /transfer/ page is linked from the homepage or another route page', () => {
  const sitemap = read('sitemap.xml');
  const paths = [...sitemap.matchAll(/<loc>https:\/\/nadiairporttransfers\.com(\/transfer\/[^<]+)<\/loc>/g)].map((m) => m[1]);
  const corpus = index + routeFiles.map((f) => read('transfer/' + f)).join('\n');
  const unlinked = paths.filter((p) => !corpus.includes(`href="${p}"`));
  assert.deepEqual(unlinked, []);
});

test('every route page states that the booking continues on Fiji Dash', () => {
  assert.equal(routeFiles.length, 23);
  for (const f of routeFiles) {
    assert.match(read('transfer/' + f), /class="rp-handoff-note"[^>]*>You'll complete your booking on our booking site, Fiji Dash \(book\.fijidash\.com\)\./, f);
  }
});

test('no fare, price or destination code changed: route-page prices and handoff hrefs are untouched by this change', () => {
  const { execFileSync } = require('child_process');
  const repoRoot = path.join(__dirname, '..', '..');
  for (const f of routeFiles) {
    const rel = 'nadi-airport-transfers-site/src/transfer/' + f;
    const base = execFileSync('git', ['show', `c6d62a6:${rel}`], { cwd: repoRoot, maxBuffer: 1e7 }).toString('utf8').replace(/\r\n/g, '\n');
    const now = read('transfer/' + f).replace(/\r\n/g, '\n');
    const strip = (s) => s.replace(/    <p class="rp-handoff-note"[^>]*>[^<]*<\/p>\n/, '');
    assert.equal(strip(now), base, `${f}: only the handoff note may differ from c6d62a6`);
  }
});
