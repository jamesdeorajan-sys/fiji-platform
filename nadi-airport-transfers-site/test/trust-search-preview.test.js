const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const SRC = path.join(__dirname, '..', 'src');
const REPO = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
const gitShow = (rev, rel) => execFileSync('git', ['show', `${rev}:nadi-airport-transfers-site/src/${rel}`], { cwd: REPO, maxBuffer: 1e8 }).toString('utf8').replace(/\r\n/g, '\n');
const index = read('index.html');
const appJs = read('app.js');
const visible = index.replace(/<!--[\s\S]*?-->/g, '');
const routeFiles = fs.readdirSync(path.join(SRC, 'transfer')).filter((f) => f.endsWith('.html'));
const PROD = 'c6d62a6'; // Nadi production source at the time of this revision

test('homepage structured data carries no unsourced aggregateRating and no openingHours', () => {
  assert.doesNotMatch(index, /aggregateRating|"ratingValue"|"reviewCount"/);
  assert.doesNotMatch(index, /openingHours/);
  for (const blk of index.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []) {
    JSON.parse(blk.replace(/<\/?script[^>]*>/g, ''));
  }
});

test('the six unsourced testimonials, their platform attributions and rating graphics are gone (no replacements invented)', () => {
  assert.doesNotMatch(visible, /review-card|reviews-section|reviewsGrid|reviews-overall|review-stars|reviews-stars|trust-stars/);
  assert.doesNotMatch(visible, /500\+|4\.9|Verified|Sarah M\.|Junior Ali|Williamson|TripAdvisor review|Google review|★★★★★/);
  const appCode = appJs.replace(/^\s*\/\/.*$/gm, ''); // ignore explanatory comments
  assert.doesNotMatch(appCode, /REVIEWS_DATA|buildReviews|review · Verified/);
  assert.doesNotMatch(index, /href="#reviews"/);
});

test('cache safety: app.js has a new cache key, and an old cached app.js cannot restore any review markup', () => {
  assert.match(index, /app\.js\?v=20260927-seo-dims/);
  assert.doesNotMatch(index, /app\.js\?v=20260921-mobile-ux/);
  // Even if a browser still ran the OLD production app.js, its buildReviews() bails out when #reviewsGrid is absent.
  const oldApp = gitShow(PROD, 'app.js');
  const start = oldApp.indexOf('function buildReviews()');
  let i = oldApp.indexOf('{', start), depth = 0, end = -1;
  for (; i < oldApp.length; i++) { if (oldApp[i] === '{') depth++; else if (oldApp[i] === '}' && --depth === 0) { end = i + 1; break; } }
  const oldReviewsData = oldApp.slice(oldApp.indexOf('const REVIEWS_DATA = ['), oldApp.indexOf('function buildReviews()'));
  const ctx = { document: { getElementById: (id) => (index.includes(`id="${id}"`) ? {} : null) }, wrote: false };
  vm.createContext(ctx);
  vm.runInContext(oldReviewsData + oldApp.slice(start, end) + '\nbuildReviews();', ctx);
  assert.equal(ctx.wrote, false);
  assert.equal(index.includes('id="reviewsGrid"'), false, 'the container the old script writes into no longer exists');
});

test('support/hours wording: online request, transfer hours and human response hours are not conflated; no unconditional 24/7 or 15-minute promise', () => {
  assert.doesNotMatch(visible, /24\/7|Always open|within 15 minutes|We contact you within|15 minutes/i);
  assert.match(index, /WhatsApp support \(replies in staffed hours\)/);
  assert.match(index, /Request online any time/);
  assert.match(index, /Our team confirms availability and payment options with you after your request\./);
  assert.match(index, /Our team confirms availability with you after your request\./);
  assert.doesNotMatch(index, /24\/7 (?:WhatsApp|Fijian)/);
});

test('comparison table no longer claims "Instant" WhatsApp support (no response-time evidence); the row states plain availability only', () => {
  assert.doesNotMatch(visible, /✓ Instant|Instant<\/td>/);
  assert.match(index, /<tr><td>WhatsApp support<\/td><td class="featured-col chk">✓<\/td>/);
});

test('child seat wording is consistent: FJ$8 in the FAQ, the extras list and the comparison table', () => {
  assert.match(index, /small charge of FJ\$8/);
  assert.match(index, /<td>Child seats \(request\)<\/td><td class="featured-col chk">FJ\$8<\/td>/);
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
  assert.deepEqual(paths.filter((p) => !corpus.includes(`href="${p}"`)), []);
});

const NOTE = 'Continue your booking request on Fiji Dash; our team confirms availability.';
test('every route page carries the exact handoff sentence, and is otherwise byte-identical to production (no fare, price or destination change)', () => {
  assert.equal(routeFiles.length, 23);
  const strip = (s) => s.replace(/    <p class="rp-handoff-note"[^>]*>[^<]*<\/p>\n/, '');
  for (const f of routeFiles) {
    const now = read('transfer/' + f);
    assert.match(now, new RegExp(`class="rp-handoff-note"[^>]*>${NOTE.replace(/[.*+?^${}()|[\]\\;]/g, '\\$&')}</p>`), f);
    assert.equal(strip(now), gitShow(PROD, 'transfer/' + f), `${f}: only the handoff note may differ from ${PROD}`);
  }
});

// ---- regional pages: hotel selection is intentional and must survive the handoff, including the native no-JS form ----
const REGIONAL = { 'pacific-harbour': ['ARTS_VILLAGE', 'PEARL_SOUTH_PACIFIC', 'UPRISING', 'NANUKU_RESORT'], 'port-denarau': ['HILTON_DENARAU', 'SOFITEL_DENARAU'], 'suva': ['GRAND_PACIFIC', 'TANOA_PLAZA_SUVA'] };
for (const [slug, codes] of Object.entries(REGIONAL)) {
  test(`regional page ${slug}: native GET form (works with JavaScript off) carries pickup + the selected hotel to Fiji Dash`, () => {
    const page = read(`transfer/${slug}.html`);
    const form = page.match(/<form id="destChooserForm"[^>]*>[\s\S]*?<\/form>/)[0];
    assert.match(form, /action="https:\/\/book\.fijidash\.com\/"/);
    assert.match(form, /method="get"/);
    assert.match(form, /<input type="hidden" name="pickup" value="NAN">/);
    const select = form.match(/<select[^>]*name="dest"[^>]*>/)[0];
    assert.match(select, /required/, 'no hotel chosen means the browser itself blocks submit, with or without JS');
    const opts = [...form.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(opts, ['', ...codes]);
    // what a native submission produces for each selectable hotel
    for (const code of codes) {
      const qs = new URLSearchParams([['pickup', 'NAN'], ['dest', code], ['utm_source', 'organic'], ['utm_medium', 'route_page'], ['utm_campaign', 'nadi_transfer_acquisition'], ['utm_content', slug]]).toString();
      const url = new URL('https://book.fijidash.com/?' + qs);
      assert.equal(url.searchParams.get('dest'), code);
      assert.equal(url.searchParams.get('pickup'), 'NAN');
    }
  });
}
test('every regional hotel code exists in FijiDash\'s destination list (production source)', () => {
  const fdOptions = new Set([...execFileSync('git', ['show', '520ca9d:ftt-booking-site/src/index.html'], { cwd: REPO, maxBuffer: 1e8 }).toString('utf8').matchAll(/<option value="([A-Z0-9_]+)"/g)].map((m) => m[1]));
  for (const code of Object.values(REGIONAL).flat()) assert.ok(fdOptions.has(code), code);
});
