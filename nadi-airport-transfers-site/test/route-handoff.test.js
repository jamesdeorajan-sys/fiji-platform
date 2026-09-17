/* CEO P0 Nadi route-handoff repair (2026-09-15) — regression tests.
 *
 * Root incident: port-denarau.html, pacific-harbour.html and suva.html each
 * had the same book.fijidash.com URL hand-typed into 5 CTA locations with
 * no dest= parameter — FijiDash's destination field loaded blank and
 * "Continue to vehicle selection" stayed disabled for every real visitor.
 * GSC (2026-09-10 through 2026-09-12): pacific-harbour had a real click
 * into this exact broken handoff.
 *
 * Part 1 loads the REAL route-handoff.js (not a mirror). Pure URL behavior
 * and the real chooser/CTA state transitions both run in Node against a
 * deliberately small DOM test double.
 *
 * Part 2 reads the REAL five route-page HTML files directly and asserts
 * their static structure - this is what actually shipped, not a
 * description of intent.
 *
 * Run: node --test test/route-handoff.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '..', 'src');
const TRANSFER_DIR = path.join(SRC_DIR, 'transfer');

// ─── Part 1: load the real route-handoff.js into a minimal stub DOM ────

function loadRouteHandoffModule(documentStub = {}) {
  const source = readFileSync(path.join(SRC_DIR, 'route-handoff.js'), 'utf8');
  const stubWindow = {};
  const context = {
    window: stubWindow,
    document: documentStub,
    URLSearchParams,
    Object,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return stubWindow.NadiRouteHandoff;
}

const RouteHandoff = loadRouteHandoffModule();

test('module loads and exposes the expected API', () => {
  assert.ok(RouteHandoff, 'window.NadiRouteHandoff must be set');
  assert.equal(typeof RouteHandoff.buildHandoffUrl, 'function');
  assert.equal(typeof RouteHandoff.applyDestToAllCtas, 'function');
  assert.equal(typeof RouteHandoff.wireDestChooser, 'function');
  assert.ok(RouteHandoff.VERIFIED_DESTINATIONS, 'the verified destination catalog must be exposed');
});

test('buildHandoffUrl: exact-resort contract matches byte-for-byte for Natadola and Outrigger', () => {
  assert.equal(
    RouteHandoff.buildHandoffUrl('INTERCONTINENTAL_NATADOLA', 'natadola-intercontinental'),
    'https://book.fijidash.com/?pickup=NAN&dest=INTERCONTINENTAL_NATADOLA&utm_source=organic&utm_medium=route_page&utm_campaign=nadi_transfer_acquisition&utm_content=natadola-intercontinental'
  );
  assert.equal(
    RouteHandoff.buildHandoffUrl('OUTRIGGER_FIJI', 'coral-coast-outrigger'),
    'https://book.fijidash.com/?pickup=NAN&dest=OUTRIGGER_FIJI&utm_source=organic&utm_medium=route_page&utm_campaign=nadi_transfer_acquisition&utm_content=coral-coast-outrigger'
  );
});

test('buildHandoffUrl: pickup is always NAN, never omitted or overridable', () => {
  const url = new URL(RouteHandoff.buildHandoffUrl('HILTON_DENARAU', 'port-denarau'));
  assert.equal(url.searchParams.get('pickup'), 'NAN');
});

test('buildHandoffUrl: carries all five required UTM values exactly', () => {
  const url = new URL(RouteHandoff.buildHandoffUrl('GRAND_PACIFIC', 'suva'));
  assert.equal(url.searchParams.get('utm_source'), 'organic');
  assert.equal(url.searchParams.get('utm_medium'), 'route_page');
  assert.equal(url.searchParams.get('utm_campaign'), 'nadi_transfer_acquisition');
  assert.equal(url.searchParams.get('utm_content'), 'suva');
  assert.equal(url.searchParams.get('dest'), 'GRAND_PACIFIC');
});

test('buildHandoffUrl: never invents a return query parameter', () => {
  const url = new URL(RouteHandoff.buildHandoffUrl('PEARL_SOUTH_PACIFIC', 'pacific-harbour'));
  assert.equal(url.searchParams.has('return'), false);
});

test('buildHandoffUrl: fails safe (returns null) for an unverified/unknown destination code - never a wrong default, never a fabricated route', () => {
  assert.equal(RouteHandoff.buildHandoffUrl('NOT_A_REAL_DESTINATION', 'port-denarau'), null);
  assert.equal(RouteHandoff.buildHandoffUrl('', 'port-denarau'), null);
  assert.equal(RouteHandoff.buildHandoffUrl(null, 'port-denarau'), null);
  assert.equal(RouteHandoff.buildHandoffUrl(undefined, 'port-denarau'), null);
});

test('buildHandoffUrl: fails safe (returns null) when utm_content is missing - never a URL with no attribution', () => {
  assert.equal(RouteHandoff.buildHandoffUrl('HILTON_DENARAU', ''), null);
  assert.equal(RouteHandoff.buildHandoffUrl('HILTON_DENARAU', null), null);
});

test('VERIFIED_DESTINATIONS never conflates Port Denarau Marina with a Denarau resort - the exact defect being fixed', () => {
  // PORT_DENARAU_MARINA is a real FijiDash destination, but port-denarau-
  // marina.html (the separate, already-correct ferry-terminal page) was
  // deliberately left untouched by this mission - it keeps its own
  // existing hardcoded URL rather than being migrated onto this shared
  // builder, so PORT_DENARAU_MARINA correctly has no reason to appear in
  // this catalog at all. The real regression guard - that port-denarau.
  // html's chooser never offers it as a resort option - is asserted
  // directly in the CHOOSER_PAGES loop below (mustNotOffer).
  assert.equal('PORT_DENARAU_MARINA' in RouteHandoff.VERIFIED_DESTINATIONS, false);
});

test('chooser labels describe the exact hotel selected by FijiDash, never a multi-hotel marketing group', () => {
  assert.equal(RouteHandoff.VERIFIED_DESTINATIONS.HILTON_DENARAU, 'Hilton Fiji Beach Resort & Spa');
  assert.equal(RouteHandoff.VERIFIED_DESTINATIONS.SOFITEL_DENARAU, 'Sofitel Fiji Resort & Spa');
  assert.equal(RouteHandoff.VERIFIED_DESTINATIONS.GRAND_PACIFIC, 'Grand Pacific Hotel');
  assert.equal(RouteHandoff.VERIFIED_DESTINATIONS.TANOA_PLAZA_SUVA, 'Tanoa Plaza Hotel Suva');
  assert.equal(RouteHandoff.VERIFIED_DESTINATIONS.HILTON_DENARAU.includes('Sheraton'), false);
  assert.equal(RouteHandoff.VERIFIED_DESTINATIONS.TANOA_PLAZA_SUVA.includes('Holiday Inn'), false);
});

test('VERIFIED_DESTINATIONS never includes an invented code - every key is a real, human-readable FijiDash destination label', () => {
  for (const [code, label] of Object.entries(RouteHandoff.VERIFIED_DESTINATIONS)) {
    assert.match(code, /^[A-Z0-9_]+$/, `destination code ${code} must be a real allowlisted constant, not free text`);
    assert.ok(label && label.length > 0, `destination ${code} must have a real label`);
  }
});

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.value = '';
    this.focusCount = 0;
    this.scrollCount = 0;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type, event) { this.listeners.get(type)?.(event); }
  focus() { this.focusCount += 1; }
  scrollIntoView() { this.scrollCount += 1; }
}

function cancellableEvent() {
  return {
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
}

test('wireDestChooser: pending CTAs guide to the chooser, valid selection enables all exact links, and cross-area values fail safe', () => {
  const ctas = Array.from({ length: 4 }, () => new FakeElement());
  const select = new FakeElement();
  const form = new FakeElement();
  form.querySelector = (selector) => selector === '[name="dest"]' ? select : null;
  const documentStub = { querySelectorAll: () => ctas };
  const api = loadRouteHandoffModule(documentStub);

  api.wireDestChooser(form, ['HILTON_DENARAU', 'SOFITEL_DENARAU'], 'port-denarau');

  for (const cta of ctas) {
    assert.equal(cta.getAttribute('href'), '#destChooser');
    assert.equal(cta.getAttribute('aria-disabled'), null, 'pending chooser CTA must remain actionable');
    assert.equal(cta.getAttribute('aria-describedby'), 'destChooserLabel');
    assert.equal(cta.classList.contains('rp-cta-pending'), true);
  }

  const pendingClick = cancellableEvent();
  ctas[0].dispatch('click', pendingClick);
  assert.equal(pendingClick.defaultPrevented, true);
  assert.equal(select.scrollCount, 1);
  assert.equal(select.focusCount, 1);

  select.value = 'HILTON_DENARAU';
  select.dispatch('change', cancellableEvent());
  const expected = api.buildHandoffUrl('HILTON_DENARAU', 'port-denarau');
  for (const cta of ctas) {
    assert.equal(cta.getAttribute('href'), expected);
    assert.equal(cta.getAttribute('aria-describedby'), null);
    assert.equal(cta.classList.contains('rp-cta-pending'), false);
  }
  const validClick = cancellableEvent();
  ctas[0].dispatch('click', validClick);
  assert.equal(validClick.defaultPrevented, false);

  select.value = 'GRAND_PACIFIC';
  select.dispatch('change', cancellableEvent());
  assert.equal(ctas[0].getAttribute('href'), '#destChooser', 'a verified code from another page must not enable this page');
  const invalidSubmit = cancellableEvent();
  form.dispatch('submit', invalidSubmit);
  assert.equal(invalidSubmit.defaultPrevented, true);
});

// ─── Part 2: the real, shipped HTML files ───────────────────────────────

const EXACT_PAGES = [
  { file: 'natadola-intercontinental.html', dest: 'INTERCONTINENTAL_NATADOLA', slug: 'natadola-intercontinental' },
  { file: 'coral-coast-outrigger.html', dest: 'OUTRIGGER_FIJI', slug: 'coral-coast-outrigger' },
];

const CHOOSER_PAGES = [
  { file: 'port-denarau.html', slug: 'port-denarau', codes: ['HILTON_DENARAU', 'SOFITEL_DENARAU'], mustNotOffer: ['PORT_DENARAU_MARINA'] },
  { file: 'pacific-harbour.html', slug: 'pacific-harbour', codes: ['ARTS_VILLAGE', 'PEARL_SOUTH_PACIFIC', 'UPRISING', 'NANUKU_RESORT'], mustNotOffer: [] },
  { file: 'suva.html', slug: 'suva', codes: ['GRAND_PACIFIC', 'TANOA_PLAZA_SUVA'], mustNotOffer: ['NAUSORI_AIRPORT'] },
];

function readPage(file) {
  return readFileSync(path.join(TRANSFER_DIR, file), 'utf8');
}

for (const { file, dest, slug } of EXACT_PAGES) {
  test(`${file}: all 5 CTAs have a correct no-JavaScript booking URL and are synchronised by the shared builder`, () => {
    const html = readPage(file);
    const expectedHtmlUrl = RouteHandoff.buildHandoffUrl(dest, slug).replaceAll('&', '&amp;');
    const exactLinkCount = html.split(`href="${expectedHtmlUrl}" data-route-cta`).length - 1;
    assert.equal(exactLinkCount, 5, `expected 5 resilient, correctly attributed CTAs in ${file}`);
    assert.ok(html.includes('<script src="../route-handoff.js"></script>'), `${file} must load the shared builder`);
    assert.ok(
      html.includes(`NadiRouteHandoff.applyDestToAllCtas('${dest}', '${slug}');`),
      `${file} must resolve its fixed destination (${dest}) through the shared builder, not re-hardcode it`
    );
  });
}

for (const { file, slug, codes, mustNotOffer } of CHOOSER_PAGES) {
  test(`${file}: native GET form works without JavaScript and secondary CTAs guide to its allowlisted chooser`, () => {
    const html = readPage(file);
    const chooserLinkCount = (html.match(/href="#destChooser" data-route-cta/g) || []).length;
    assert.equal(chooserLinkCount, 4, `expected 4 secondary CTAs to guide to the chooser in ${file}`);
    assert.ok(html.includes('<form id="destChooserForm" class="rp-dest-form" action="https://book.fijidash.com/" method="get">'));
    assert.ok(html.includes('<select id="destChooser" class="rp-dest-chooser" name="dest" required>'));
    assert.ok(html.includes('<input type="hidden" name="pickup" value="NAN">'));
    assert.ok(html.includes('<input type="hidden" name="utm_source" value="organic">'));
    assert.ok(html.includes('<input type="hidden" name="utm_medium" value="route_page">'));
    assert.ok(html.includes('<input type="hidden" name="utm_campaign" value="nadi_transfer_acquisition">'));
    assert.ok(html.includes(`<input type="hidden" name="utm_content" value="${slug}">`));
    assert.ok(html.includes('<script src="../route-handoff.js"></script>'), `${file} must load the shared builder`);

    const wireCallMatch = html.match(/NadiRouteHandoff\.wireDestChooser\([^;]*\);/);
    assert.ok(wireCallMatch, `${file} must wire its native destination chooser`);
    const wireCall = wireCallMatch[0];

    for (const code of codes) {
      assert.ok(RouteHandoff.VERIFIED_DESTINATIONS[code], `chooser code ${code} in ${file} must be a real verified destination`);
      assert.ok(wireCall.includes(`'${code}'`), `${file}'s wiring must allow ${code}`);
      const exactLabel = RouteHandoff.VERIFIED_DESTINATIONS[code].replaceAll('&', '&amp;');
      assert.ok(html.includes(`<option value="${code}">${exactLabel}</option>`), `${file}'s native form must map ${code} to its exact live hotel label`);
    }
    for (const forbidden of mustNotOffer) {
      assert.equal(wireCall.includes(`'${forbidden}'`), false, `${file}'s chooser must NEVER allow ${forbidden} - it belongs to a separate, already-correct page or a different product entirely`);
      assert.equal(html.includes(`<option value="${forbidden}">`), false, `${file}'s native form must NEVER offer ${forbidden}`);
    }
    assert.ok(wireCall.includes(`'${slug}'`), `${file}'s chooser init must pass its own slug as utm_content`);
  });
}

test('every one of the 5 mission-scope pages uses the SAME shared builder file - no page re-duplicates the URL contract on its own', () => {
  const allFiles = [...EXACT_PAGES.map((p) => p.file), ...CHOOSER_PAGES.map((p) => p.file)];
  for (const file of allFiles) {
    const html = readPage(file);
    const scriptTagCount = (html.match(/<script src="\.\.\/route-handoff\.js"><\/script>/g) || []).length;
    assert.equal(scriptTagCount, 1, `${file} must load route-handoff.js exactly once`);
  }
});

test('Port Denarau and Suva pages give non-shortlisted hotels an explicit manual-selection path without a false destination prefill', () => {
  const port = readPage('port-denarau.html');
  const suva = readPage('suva.html');
  assert.ok(port.includes('Another Denarau hotel?'));
  assert.ok(port.includes('Choose your exact hotel'));
  assert.ok(port.includes('href="/transfer/port-denarau-marina"'));
  assert.ok(suva.includes('Holiday Inn or another Suva hotel?'));
  assert.ok(suva.includes('Choose your exact hotel'));
  for (const html of [port, suva]) {
    const manualLink = html.match(/<a href="(https:\/\/book\.fijidash\.com\/\?pickup=NAN&amp;utm_source=organic[^\"]*)">Choose your exact hotel<\/a>/);
    assert.ok(manualLink, 'manual-selection fallback must be an attributed FijiDash link');
    assert.equal(manualLink[1].includes('dest='), false, 'manual-selection link must not lie about a specific destination');
  }
});

test('chooser pages do not ship inert href="#" CTAs or pointer-disabled pending CTAs', () => {
  for (const { file } of CHOOSER_PAGES) {
    const html = readPage(file);
    assert.equal(/href="#" data-route-cta/.test(html), false, `${file} must not ship a no-op CTA`);
    assert.equal(/\.rp-cta-pending[^}]*pointer-events\s*:\s*none/.test(html), false, `${file}'s pending CTA must remain actionable`);
  }
});
