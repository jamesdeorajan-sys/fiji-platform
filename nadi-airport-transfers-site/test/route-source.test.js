// Route pages send the visitor's real source to FijiDash instead of utm_source=organic; nothing else in the link changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { ROUTE_SOURCE_TAG, ROUTE_SOURCE_HELD, undoRouteSource } from './route-source-revert.js';
import { SEARCH_GROWTH_NEW, undoSearchGrowthBuf } from './search-growth-revert.js';

const SRC = new URL('../src/', import.meta.url);
const CODE = readFileSync(new URL('route-source.js', SRC), 'utf8');
const sha = (b) => createHash('sha256').update(b).digest('hex');

// A minimal page: links and forms as plain objects the script can read and change.
function page({ search = '', referrer = '', session = {}, local = {}, sessionBlocked = false, links = [], form = null } = {}) {
  const anchors = links.map((href) => { const a = { tagName: 'A', nodeType: 1, attrs: { href }, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = String(v); }, parentNode: null }; return a; });
  const input = form ? { value: form.utm_source } : null;
  const forms = form ? [{ getAttribute: (k) => (k === 'action' ? form.action : null), querySelector: () => input }] : [];
  const listeners = {};
  const ss = sessionBlocked ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } : { getItem: (k) => session[k] ?? null, setItem: (k, v) => { session[k] = String(v); } };
  const window = { location: { search, href: 'https://nadiairporttransfers.com/transfer/hilton-fiji-beach-resort' + search }, sessionStorage: ss, localStorage: { getItem: (k) => local[k] ?? null } };
  const document = { referrer, querySelectorAll: (sel) => (sel.startsWith('a[') ? anchors.filter((a) => a.attrs.href.includes('book.fijidash.com')) : forms), addEventListener: (t, fn) => { listeners[t] = fn; } };
  const sb = { window, document, URL, URLSearchParams, JSON, String };
  vm.createContext(sb); vm.runInContext(CODE, sb);
  return { anchors, input, session, listeners, source: () => window.NadiRouteSource.source(), nameForHost: (h) => window.NadiRouteSource.nameForHost(h) };
}
const FD = 'https://book.fijidash.com/?pickup=NAN&dest=HILTON_DENARAU&utm_source=organic&utm_medium=legacy_route_page&utm_campaign=nadi_legacy_rescue&utm_content=hilton-fiji-beach-resort';
const params = (href) => Object.fromEntries(new URL(href).searchParams);

test('search engines, AI assistants and social sites become a short source name; nothing from their page or search is kept', () => {
  const cases = [
    ['https://www.google.com/search?q=nadi+airport+transfer', 'google'], ['https://www.google.com.au/', 'google'], ['https://gemini.google.com/app/x', 'gemini'],
    ['https://www.bing.com/search?q=x', 'bing'], ['https://copilot.microsoft.com/', 'copilot'], ['https://chatgpt.com/c/123', 'chatgpt'], ['https://chat.openai.com/', 'chatgpt'],
    ['https://www.perplexity.ai/search/x', 'perplexity'], ['https://claude.ai/chat/x', 'claude'], ['https://duckduckgo.com/', 'duckduckgo'],
    ['https://l.facebook.com/l.php?u=x', 'facebook'], ['https://m.facebook.com/', 'facebook'], ['https://www.instagram.com/', 'instagram'],
    ['https://www.tripadvisor.com.au/ShowTopic', 'tripadvisor'], ['https://vakaviti.ai/nadi-airport-transfers-guide', 'vakaviti.ai'], ['https://tourfiji.tours/x?y=1', 'tourfiji.tours'],
  ];
  for (const [referrer, want] of cases) {
    const p = page({ referrer, links: [FD] });
    assert.equal(p.source(), want, referrer);
    const got = params(p.anchors[0].attrs.href);
    assert.equal(got.utm_source, want, referrer);
    assert.ok(!p.anchors[0].attrs.href.includes('q=') && !p.anchors[0].attrs.href.includes('search'), 'no referrer page or query carried: ' + referrer);
  }
});

test('only utm_source changes: destination, medium, campaign and page tag are exactly as in the HTML', () => {
  const p = page({ referrer: 'https://www.bing.com/', links: [FD] });
  const before = params(FD), after = params(p.anchors[0].attrs.href);
  assert.equal(after.utm_source, 'bing');
  delete before.utm_source; delete after.utm_source;
  assert.deepEqual(after, before);
});

test('a utm_source the visitor arrived with (partner or campaign link) is passed on; "organic" or odd values are not', () => {
  assert.equal(page({ search: '?utm_source=p-fiji-beachouse&utm_medium=referral', referrer: 'https://www.google.com/', links: [FD] }).source(), 'p-fiji-beachouse');
  assert.equal(page({ search: '?utm_source=organic', referrer: 'https://www.bing.com/' }).source(), 'bing');
  assert.equal(page({ search: '?utm_source=%3Cscript%3E', referrer: '' }).source(), 'direct');
  assert.equal(page({ search: '?utm_source=' + 'x'.repeat(41) }).source(), 'direct');
});

test('the source carries across pages in the same visit, and from the homepage record; otherwise "direct"', () => {
  const session = {};
  page({ referrer: 'https://chatgpt.com/', session });
  assert.equal(page({ referrer: 'https://nadiairporttransfers.com/', session }).source(), 'chatgpt', 'internal navigation keeps the entry source');
  assert.equal(page({ referrer: '' }).source(), 'direct');
  assert.equal(page({ referrer: 'https://nadiairporttransfers.com/', local: { nat_attribution_v1: JSON.stringify({ first: { referrer: 'www.google.com' }, last: { referrer: 'www.google.com' } }) } }).source(), 'google');
  assert.equal(page({ referrer: 'https://nadiairporttransfers.com/', local: { nat_attribution_v1: JSON.stringify({ last: { referrer: 'nadiairporttransfers.com/transfer/x' } }) } }).source(), 'direct', 'an internal path is never used as a source');
  assert.equal(page({ referrer: 'https://www.google.com/', sessionBlocked: true, links: [FD] }).source(), 'google', 'storage blocked: still works for the page');
});

test('links not going to FijiDash, or already carrying another source, are left alone', () => {
  const other = ['https://wa.me/6790000000', 'https://book.fijidash.com/?pickup=NAN&utm_source=p-partner', 'https://nadiairporttransfers.com/', 'https://evil.example/?u=book.fijidash.com&utm_source=organic'];
  const p = page({ referrer: 'https://www.google.com/', links: other });
  assert.deepEqual(p.anchors.map((a) => a.attrs.href), other);
});

test('chooser forms: the hidden utm_source field changes on submit; a form to another site is untouched', () => {
  const p = page({ referrer: 'https://www.bing.com/', form: { action: 'https://book.fijidash.com/', utm_source: 'organic' } });
  assert.equal(p.input.value, 'bing');
  const q = page({ referrer: 'https://www.bing.com/', form: { action: 'https://example.com/', utm_source: 'organic' } });
  assert.equal(q.input.value, 'organic');
});

test('links set later by the destination chooser are fixed at the moment they are used (click, middle-click, keyboard)', () => {
  const p = page({ referrer: 'https://www.google.com/' });
  const late = { tagName: 'A', nodeType: 1, attrs: { href: FD }, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = String(v); }, parentNode: null };
  const child = { tagName: 'SPAN', nodeType: 1, parentNode: late };
  for (const t of ['pointerdown', 'click', 'auxclick', 'contextmenu', 'keydown', 'submit', 'change']) assert.equal(typeof p.listeners[t], 'function', t);
  p.listeners.click({ target: child });
  assert.equal(params(late.attrs.href).utm_source, 'google');
});

test('never throws: broken referrer, missing storage or odd DOM leave the page working', () => {
  assert.doesNotThrow(() => page({ referrer: 'not a url', links: ['::bad::', FD] }));
  assert.equal(page({ referrer: 'not a url' }).source(), 'direct');
});

test('22 route pages load the script once, just before </body>; DoubleTree (HELD) does not; the HTML links keep "organic" as the no-script fallback', () => {
  const pages = readdirSync(new URL('transfer/', SRC)).filter((f) => f.endsWith('.html'));
  assert.equal(pages.length, 23);
  for (const f of pages) {
    const s = readFileSync(new URL('transfer/' + f, SRC), 'utf8');
    const n = s.split('route-source.js').length - 1;
    if ('transfer/' + f === ROUTE_SOURCE_HELD) { assert.equal(n, 0, f); continue; }
    assert.equal(n, 1, f);
    assert.ok(s.includes(ROUTE_SOURCE_TAG + '</body>'), f);
  }
});

test('SCOPE: removing the script line reproduces every live route page byte for byte; every other served file is unchanged; route-source.js is the only new file', () => {
  const base = '9233350'; // live code before this release (2ed37c4 changed only app.js and index.html)
  const prodFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', base, '--', 'src'], { cwd: new URL('..', SRC) }).toString().trim().split('\n').map((p) => p.replace(/^src\//, ''));
  const now = [];
  const walk = (d, pre = '') => { for (const e of readdirSync(new URL(d, SRC), { withFileTypes: true })) e.isDirectory() ? walk(d + e.name + '/', pre + e.name + '/') : now.push(pre + e.name); };
  walk('');
  assert.deepEqual(now.filter((f) => f !== 'route-source.js' && f !== SEARCH_GROWTH_NEW).sort(), prodFiles.sort());
  for (const f of prodFiles) {
    if (f === 'app.js' || f === 'index.html') continue; // changed by the attribution release (2ed37c4); pinned in booking-attribution tests
    const live = execFileSync('git', ['show', `${base}:./src/${f}`], { cwd: new URL('..', SRC) });
    const cur = readFileSync(new URL(f, SRC));
    assert.equal(sha(f.startsWith('transfer/') ? undoRouteSource(f, cur.toString('utf8')) : undoSearchGrowthBuf(f, cur)), sha(live), f);
  }
});
