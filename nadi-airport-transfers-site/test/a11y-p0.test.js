// NAT P0 accessibility candidate (on production 67d0075 = Pages 6af90ee3): labels, accessible names, keyboard operation, focus visibility.
// No text, price, route, persistence, API, WhatsApp or booking-state change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { a11yRevert } from './a11y-p0-revert.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const rd = (f) => readFileSync(path.join(SRC, f), 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const PROD = { // production 67d0075 (Pages 6af90ee3-9ff8-4531-a421-d8494f09068a)
  'index.html': '163245f58bb66b6244235cc8bf8e999280b1eb65c003be7dc62f8d6b4de1da65',
  'app.js': '77f9d10d26d9c009f6734d0d21d2fd16c14781ab266e7e21a82bb988de824191',
  'styles.css': 'ddfccf65c777f2781ce4f4877625749fa4377edda4c2879d0ee49c94b78dd0ff',
};
const OTHERS_PROD = 'e6a3022f3861980e1ed26d5ae9f698cbd6a5e1eac2fb03ceac42792f3a041792'; // the other 41 served files, combined
const html = rd('index.html'), app = rd('app.js'), css = rd('styles.css');
const visible = (t) => t.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('SCOPE: undoing exactly the accessibility edits reproduces production index.html, app.js and styles.css byte for byte', () => {
  for (const f of Object.keys(PROD)) assert.equal(sha(a11yRevert(f, rd(f))), PROD[f], f + ' differs from production beyond the accessibility edits');
});

test('SCOPE: every other served file (route pages incl. DoubleTree, rental page, booking extras, handoff, chat, sitemap, robots, redirects) is byte-identical to production', () => {
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(path.relative(SRC, p).split(path.sep).join('/')); } };
  walk(SRC);
  const others = files.filter((f) => !(f in PROD)).sort();
  assert.equal(others.length, 41);
  assert.equal(sha(others.map((f) => `${f}\0${sha(readFileSync(path.join(SRC, f)))}\n`).join('')), OTHERS_PROD);
});

test('SCOPE: the home page shows exactly the same text as production (only attributes and one heading level change)', () => {
  assert.equal(visible(html), visible(a11yRevert('index.html', html)));
  for (const h of ['Popular routes', 'Tours', 'Information']) assert.match(html, new RegExp(`<div class="footer-col">\\s*<h3>${h}</h3>`));
});

test('labels: every booking field label is programmatically tied to its control (17 fields)', () => {
  const want = ['pickup', 'destination', 'customPickupAddress', 'customPickupZone', 'customDestAddress', 'customDestZone', 'travelDate', 'travelTime',
    'returnDate', 'returnTime', 'returnPickupLocation', 'flightNum', 'firstName', 'lastName', 'email', 'phone', 'notes'];
  const fors = [...html.matchAll(/<label class="field-label"(?: id="\w+")? for="(\w+)">/g)].map((m) => m[1]);
  assert.deepEqual([...fors].sort(), [...want].sort());
  for (const id of want) assert.equal((html.match(new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bid="${id}"`, 'g')) || []).length, 1, id + ' control exists once');
  assert.ok(html.includes('id="flightNum" class="field-input" aria-describedby="flightError"') && html.includes('<p id="flightError" role="alert" hidden>'));
});

test('names: counters, swap, every Book button and the typeahead parts have specific accessible names', () => {
  for (const n of ['Fewer passengers', 'More passengers', 'Fewer bags', 'More bags', 'Swap pickup and destination']) assert.equal(html.split(`aria-label="${n}"`).length, 2, n);
  assert.match(html, /<div class="pax-counter" role="group" aria-labelledby="paxLabel">/);
  const route = [...html.matchAll(/onclick="bookRoute\(\d+\)" aria-label="([^"]+)"/g)].map((m) => m[1]);
  const tour = [...html.matchAll(/onclick="selectTour\(\d+\)" aria-label="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(route.length, 35); assert.equal(new Set(route).size, 35, 'route Book names are unique');
  assert.equal(tour.length, 16); assert.equal(new Set(tour).size, 16, 'tour Book names are unique');
  assert.ok(route.includes('Book Fiji Marriott Resort Momi Bay transfer') && tour.every((t) => t.startsWith('Book tour: ')));
  assert.ok(app.includes('aria-label="Book ${escapeHtml(r.dest)} transfer"') && app.includes('aria-label="Book tour: ${escapeHtml(t.name)}"'), 'the JS re-render keeps the same names');
  assert.ok(app.includes('aria-labelledby="${selectId}Label ${selectId}_ta_text"') && html.includes('id="pickupLabel" for="pickup"') && html.includes('id="destinationLabel" for="destination"'));
  assert.ok(app.includes("searchLabel: 'Search pickup locations', listLabel: 'Pickup locations'") && app.includes("searchLabel: 'Search destinations', listLabel: 'Destinations'"));
});

test('FAQ: questions are keyboard-operable disclosure buttons that report their state', () => {
  assert.equal((html.match(/<div class="faq-q" role="button" tabindex="0" aria-expanded="false" aria-controls="faq-a-\d+"/g) || []).length, 11);
  const grab = (n) => { const a = app.indexOf(`function ${n}(`); return app.slice(a, app.indexOf('\n}\n', a) + 3); };
  const el = (id) => { const cls = new Set(); const at = {}; return { id, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) }, setAttribute: (k, v) => { at[k] = v; }, at }; };
  const qs = [el('q0'), el('q1')], as = [el('faq-a-0'), el('faq-a-1')];
  const c = { document: { getElementById: (id) => as.find((a) => a.id === id), querySelectorAll: (s) => (s === '.faq-a' ? as : qs) } };
  vm.createContext(c); vm.runInContext(grab('toggleFaq') + grab('faqKey'), c);
  let prevented = 0; const key = (k) => ({ key: k, preventDefault: () => { prevented++; } });
  c.faqKey(key('Enter'), 0, qs[0]);
  assert.ok(as[0].classList.contains('open')); assert.equal(qs[0].at['aria-expanded'], 'true');
  c.faqKey(key(' '), 1, qs[1]);
  assert.ok(!as[0].classList.contains('open') && as[1].classList.contains('open')); assert.equal(qs[0].at['aria-expanded'], 'false'); assert.equal(qs[1].at['aria-expanded'], 'true');
  c.faqKey(key('Tab'), 1, qs[1]);
  assert.ok(as[1].classList.contains('open'), 'other keys do nothing'); assert.equal(prevented, 2);
});

test('typeahead: arrow keys, Enter and Escape are handled; selection still goes through the existing option click path', () => {
  assert.ok(app.includes("if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveActive(e.key === 'ArrowDown' ? 1 : -1); }"));
  assert.ok(app.includes("if (e.key === 'Escape') { closePanel(); trigger.focus(); }"));
  assert.ok(app.includes("const first = active || list.querySelector('.ta-opt:not(.ta-opt-sentinel)') || list.querySelector('.ta-opt');"), 'without arrow keys, Enter still picks the first match as before');
  assert.equal((app.match(/role="option" aria-selected="false" data-val=/g) || []).length, 3);
  assert.ok(css.includes('.ta-opt:hover,.ta-opt.ta-active{') && css.includes('box-shadow:0 0 0 3px rgba(0,102,204,.35)'));
});
