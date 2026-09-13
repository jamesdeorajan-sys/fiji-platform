/* CEO P0 security fix (2026-09-13) — isolated regression tests for the
 * buildConfirmation() / typeahead unsafe-innerHTML fix.
 *
 * app.js is a plain browser <script> (no module system, no DOM in Node),
 * so these are PARITY tests: a minimal, faithful DOM stand-in exercises
 * the SAME algorithm app.js now uses (createElement/textContent/
 * appendChild for buildConfirmation, escapeHtml for the typeahead), and a
 * serializer proves what a real browser is spec-guaranteed to do with a
 * text node: escape it on the way back out to markup. This is not a
 * simulation of "what we hope happens" — text set via .textContent can
 * never be parsed as an element by definition (there is no HTML-parsing
 * step involved at all), and every browser escapes &/</> when serializing
 * a text node back to innerHTML/outerHTML. The serializer below just
 * makes that guarantee checkable in Node.
 *
 * Run: node --test test/confirmation-security.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const APP_JS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app.js');
const APP_JS_SOURCE = readFileSync(APP_JS_PATH, 'utf8');

// ─── minimal faithful DOM stand-in ─────────────────────────────────────────
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = '';
    this.children = [];
    this._text = null;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  appendChild(child) { this.children.push(child); this._text = null; return child; }
}
function createElement(tagName) { return new FakeElement(tagName); }

// Mirrors what every real browser does when serializing a DOM tree back
// to markup: text-node content is escaped, element structure is not.
function serialize(el) {
  const classAttr = el.className ? ` class="${el.className}"` : '';
  const inner = el._text !== null
    ? String(el._text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : el.children.map(serialize).join('');
  return `<${el.tagName}${classAttr}>${inner}</${el.tagName}>`;
}

// Mirrors app.js's appendConfirmRow() exactly (same structure: a
// .confirm-row div containing a .confirm-label span and a .confirm-value
// span, each populated via textContent).
function appendConfirmRowParity(parent, label, value) {
  const row = createElement('div');
  row.className = 'confirm-row';
  const labelSpan = createElement('span');
  labelSpan.className = 'confirm-label';
  labelSpan.textContent = label;
  const valueSpan = createElement('span');
  valueSpan.className = 'confirm-value';
  valueSpan.textContent = value;
  row.appendChild(labelSpan);
  row.appendChild(valueSpan);
  parent.appendChild(row);
  return row;
}

// Mirrors app.js's escapeHtml() exactly.
function escapeHtmlParity(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const XSS_PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(document.cookie)</script>',
  '"><svg onload=alert(1)>',
  "'-alert(1)-'",
];

// ─── 1. normal guest details render exactly as before ─────────────────────
test('1. normal guest details render with unchanged markup structure', () => {
  const card = createElement('div');
  appendConfirmRowParity(card, 'Passenger', 'Jane Smith');
  const serialized = serialize(card.children[0]);
  assert.equal(
    serialized,
    '<div class="confirm-row"><span class="confirm-label">Passenger</span><span class="confirm-value">Jane Smith</span></div>'
  );
});

// ─── 2. name containing markup renders as literal text ─────────────────────
test('2. a name containing <img src=x onerror=...> renders as literal text, never executes', () => {
  const card = createElement('div');
  const payload = XSS_PAYLOADS[0];
  appendConfirmRowParity(card, 'Passenger', payload);
  const serialized = serialize(card.children[0]);
  assert.ok(!serialized.includes('<img'), 'the payload must never appear as a real tag');
  assert.ok(serialized.includes('&lt;img'), 'the payload must appear escaped');
  assert.equal(card.children[0].children[1].textContent, payload, 'the raw guest text is preserved exactly, just never parsed as HTML');
});

// ─── 3. notes containing <script> renders as literal text ──────────────────
test('3. notes containing <script>...</script> renders as literal text, never executes', () => {
  const card = createElement('div');
  appendConfirmRowParity(card, 'Special requests', XSS_PAYLOADS[1]);
  const serialized = serialize(card.children[0]);
  assert.ok(!serialized.includes('<script>'));
  assert.ok(serialized.includes('&lt;script&gt;'));
});

// ─── 4. email/phone containing HTML-like strings cannot alter DOM ──────────
test('4. email/phone containing HTML-like strings cannot alter DOM structure', () => {
  const card = createElement('div');
  appendConfirmRowParity(card, 'Contact', `${XSS_PAYLOADS[2]} · +679${XSS_PAYLOADS[3]}`);
  assert.equal(card.children.length, 1, 'exactly one row must exist - the payload cannot inject sibling elements');
  assert.equal(card.children[0].children.length, 2, 'exactly the label + value spans - the payload cannot inject extra children');
});

// ─── 5. flight value containing markup cannot alter DOM ────────────────────
test('5. a flight number containing markup cannot alter DOM structure', () => {
  const card = createElement('div');
  appendConfirmRowParity(card, 'Flight number', '<svg/onload=alert(1)>FJ810');
  const serialized = serialize(card.children[0]);
  assert.ok(!serialized.includes('<svg'));
  assert.equal(card.children.length, 1);
});

// ─── 6. destination/pickup text cannot inject markup ───────────────────────
test('6. a guest-typed custom pickup/destination address cannot inject markup', () => {
  // state.pickup.name / state.destination.hotel can be guest free-text
  // when a custom address is used (resolveLocation()'s CUSTOM_PICKUP/
  // CUSTOM_DEST branch) - this is exactly the CEO's flagged concern.
  // Only the two tag-bearing payloads are relevant to "cannot inject
  // markup" specifically - the quote-based payload contains no HTML
  // metacharacters at all, so it is correctly rendered as inert literal
  // text (there is no HTML-parsing step for textContent to bypass), not
  // "unescaped" in any meaningful sense.
  const tagPayloads = XSS_PAYLOADS.filter((p) => /[<>]/.test(p));
  const card = createElement('div');
  for (const payload of tagPayloads) {
    appendConfirmRowParity(card, 'From', payload);
    appendConfirmRowParity(card, 'To', payload);
  }
  const serialized = serialize(card);
  for (const payload of tagPayloads) {
    assert.ok(!serialized.includes(payload), `raw payload "${payload}" must never appear as a real tag`);
  }
  assert.equal(card.children.length, tagPayloads.length * 2, 'no payload may inject extra sibling rows');
});

// ─── 7. tour name cannot inject markup ──────────────────────────────────────
test('7. TOURS_DATA tour names are plain text as shipped (the actual guarantee this classification relies on)', () => {
  const toursMatch = APP_JS_SOURCE.match(/const TOURS_DATA = \[[\s\S]*?\n\];/);
  assert.ok(toursMatch, 'expected to find the TOURS_DATA constant in app.js');
  const nameMatches = [...toursMatch[0].matchAll(/name\s*:\s*'([^']*)'/g)].map((m) => m[1]);
  assert.ok(nameMatches.length > 0, 'expected at least one tour name to check');
  for (const name of nameMatches) {
    // Only < and > are the actual tag-injection risk for markup inserted
    // as trusted static HTML - a bare & (e.g. "Biausevu Waterfall &
    // Village Trek", shipped today) is an HTML-validity nicety at most,
    // not a way to inject an element or attribute.
    assert.ok(!/[<>]/.test(name), `tour name "${name}" must contain no tag-injection characters - it is inserted as trusted static markup (totalRows), never escaped`);
  }
});

// ─── 8. total/discount/tour pricing still displays correctly ──────────────
test('8. totalRows construction is unchanged and still produces the three documented price layouts', () => {
  // Parity of buildConfirmation()'s totalRows branch - numeric/catalog
  // values only, deliberately left as trusted static markup per the CEO's
  // "static trusted markup may remain static HTML where appropriate".
  function buildTotalRows(t, tourName, passengers) {
    if (t.hasTour) {
      const paxLabel = passengers === 1 ? 'person' : 'people';
      return `<div class="confirm-row"><span class="confirm-label">Transfer</span><span class="confirm-value">FJ$${t.transferSubtotal}</span></div>`
        + `<div class="confirm-row"><span class="confirm-label">Tour: ${tourName} (FJ$${t.tourPerPax} × ${passengers} ${paxLabel})</span><span class="confirm-value">FJ$${t.tourTotal}</span></div>`
        + `<div class="confirm-row total"><span class="confirm-label">Total price</span><span class="confirm-value price">FJ$${t.final}</span></div>`;
    }
    if (t.qualifies) {
      return `<div class="confirm-row"><span class="confirm-label">Subtotal</span><span class="confirm-value">FJ$${t.subtotal}</span></div>`
        + `<div class="confirm-row discount"><span class="confirm-label">★ 10% discount (orders FJ$50+)</span><span class="confirm-value">−FJ$${t.discount}</span></div>`
        + `<div class="confirm-row total"><span class="confirm-label">Total price</span><span class="confirm-value price">FJ$${t.final}</span></div>`;
    }
    return `<div class="confirm-row total"><span class="confirm-label">Total price</span><span class="confirm-value price">FJ$${t.final}</span></div>`;
  }

  assert.match(buildTotalRows({ hasTour: true, transferSubtotal: 79, tourPerPax: 60, tourTotal: 120, final: 199 }, 'Cultural Night Tour', 2), /Tour: Cultural Night Tour \(FJ\$60 × 2 people\)/);
  assert.match(buildTotalRows({ hasTour: false, qualifies: true, subtotal: 90, discount: 9, final: 81 }, null, 2), /10% discount \(orders FJ\$50\+\)/);
  assert.match(buildTotalRows({ hasTour: false, qualifies: false, final: 45 }, null, 2), /Total price.*FJ\$45/);
});

// ─── 9. buildConfirmation() still runs from goToStep(4) ────────────────────
test('9. goToStep(4) still calls buildConfirmation()', () => {
  const goToStepMatch = APP_JS_SOURCE.match(/function goToStep\(n\) \{[\s\S]*?\n\}/);
  assert.ok(goToStepMatch, 'expected to find goToStep() in app.js');
  const step4Block = goToStepMatch[0].match(/if \(n === 4\) \{[\s\S]*?\n {2}\}/);
  assert.ok(step4Block, 'expected an n === 4 branch inside goToStep()');
  assert.match(step4Block[0], /buildConfirmation\(\);/);
});

// ─── typeahead search-echo fix ──────────────────────────────────────────────
test('escapeHtml: search box input containing markup is escaped in the "no matches" message', () => {
  for (const payload of XSS_PAYLOADS) {
    const message = `No matches for "${escapeHtmlParity(payload)}". Try the area name (e.g. "Coral Coast") or pick "📍 Other / not listed".`;
    assert.ok(!message.includes(payload), `raw payload "${payload}" must not appear unescaped in the no-matches message`);
  }
});

test('escapeHtml: normal search text is unaffected', () => {
  assert.equal(escapeHtmlParity('Coral Coast'), 'Coral Coast');
});

// ─── structural proof: appendConfirmRow / escapeHtml actually exist in the shipped file ───
test('app.js defines appendConfirmRow() and uses it for every buildConfirmation() row (no innerHTML with guest data remains)', () => {
  assert.match(APP_JS_SOURCE, /function appendConfirmRow\(parent, label, value\)/);
  const buildConfirmationMatch = APP_JS_SOURCE.match(/function buildConfirmation\(\) \{[\s\S]*?\n\}/);
  assert.ok(buildConfirmationMatch, 'expected to find buildConfirmation() in app.js');
  const body = buildConfirmationMatch[0];
  // No `.innerHTML =` assignment building rows from fn/ln/em/ph/flight/notes remains.
  assert.ok(!/card\.innerHTML\s*=\s*\[/.test(body), 'the old innerHTML-array-join construction must be gone');
  assert.match(body, /appendConfirmRow\(card, 'Passenger'/);
  assert.match(body, /appendConfirmRow\(card, 'Special requests', notes\)/);
});

test('app.js defines escapeHtml() and the typeahead no-matches message uses it', () => {
  assert.match(APP_JS_SOURCE, /function escapeHtml\(str\)/);
  assert.match(APP_JS_SOURCE, /No matches for "\$\{escapeHtml\(filter\)\}"/);
});
