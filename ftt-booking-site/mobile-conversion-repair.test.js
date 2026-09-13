// Fiji Dash — mobile conversion repair test suite.
//
// Covers the CEO's "FIJIDASH MOBILE CONVERSION REPAIR" mission (branch
// ceo/fijidash-mobile-conversion-repair, base 14dee75b9f6ab3ff2fa4ce5404e0ef23d687b840):
// confirmation-truth wording, WhatsApp-optional semantics, and the vehicle
// selection-badge fix. Style matches nadi-marketplace/worker/pricing.test.js
// (node's built-in test runner) and the repo's established parity-test
// pattern: app.js is a non-module legacy browser script (no DOM in Node),
// so logic under test (the vehicle badge priority rule) is reimplemented
// here as a pure function and MUST be kept in sync with the real
// buildVehicleCards()/buildVehicleDetailCards() in app.js if that logic
// ever changes again. Copy/wording checks read the real source files
// directly instead, since those are static strings, not logic.
//
// Deliberately has zero network calls and zero side effects — safe to run
// repeatedly, any environment, no live API or D1 dependency.
//
// Run: node --test ftt-booking-site/mobile-conversion-repair.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BASE_SHA = '14dee75b9f6ab3ff2fa4ce5404e0ef23d687b840';

const HTML_PATH = path.join(__dirname, 'src', 'index.html');
const JS_PATH = path.join(__dirname, 'src', 'app.js');
// Normalize CRLF->LF on read: this checkout has core.autocrlf converting
// LF-committed source to CRLF on disk (a known, previously-diagnosed-
// harmless artifact of this environment - see git-bash core.autocrlf
// notes elsewhere in this project). Comparing raw bytes here would fail
// on line-ending differences that carry zero semantic meaning; every
// byte-identity check in this suite is a check on CONTENT, not on
// whichever line-ending convention happened to touch disk.
function normalize(s) { return s.replace(/\r\n/g, '\n'); }
const html = normalize(fs.readFileSync(HTML_PATH, 'utf8'));
const js = normalize(fs.readFileSync(JS_PATH, 'utf8'));

// Slices strictly BETWEEN the two markers (excludes both) — the natural
// meaning for "give me the content that sits here", and what every wording
// check below assumes. The byte-identity checks near the bottom of this
// file compare a candidate slice against a base-commit slice made with the
// exact same two markers, so excluding the markers from both sides changes
// nothing about whether those checks catch a real difference.
function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notStrictEqual(start, -1, `marker not found: ${startMarker}`);
  const contentStart = start + startMarker.length;
  const end = source.indexOf(endMarker, contentStart);
  assert.notStrictEqual(end, -1, `end marker not found: ${endMarker}`);
  return source.slice(contentStart, end);
}

function gitShow(relPath) {
  return normalize(execFileSync('git', ['show', `${BASE_SHA}:${relPath}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }));
}

// ─── AREA 1/2: CONFIRMATION TRUTH + WHATSAPP SEMANTICS ─────────────────────

test('confirmation truth: price sub-caption no longer claims instant/guaranteed confirmation', () => {
  assert.ok(!html.includes('Instant confirmation'), 'must not claim instant confirmation');
  assert.ok(!html.includes('Guaranteed driver'), 'must not claim a guaranteed driver before human confirmation');
  assert.ok(html.includes('Saved online · Fiji team confirms pickup'));
});

test('confirmation truth: bulaTitleSupported no longer frames WhatsApp as a mandatory final step', () => {
  const heading = extract(html, 'id="bulaTitleSupported"', '</span>');
  assert.ok(!/final step/i.test(heading));
  assert.ok(!/confirm your pickup with our fiji team/i.test(heading));
  assert.ok(/your request is saved/i.test(heading));
});

test('confirmation truth: bulaLeadText static default is byte-identical to showBulaSuccess()\'s JS-set value, per the file\'s own stale-cache discipline', () => {
  // The static HTML default carries a leading "✅ " emoji the JS-set
  // runtime value doesn't (matching showBulaUnsupportedRoute()'s own
  // wording, which also has no emoji) — everything after that emoji must
  // still be the exact same sentence, per the file's own inline comment
  // requiring the two to "stay in sync".
  const staticInner = extract(html, 'id="bulaLeadText">', '</p>');
  const jsInner = extract(js, "bulaLeadText.innerHTML = '", "';");
  assert.ok(staticInner.includes(jsInner), 'static HTML default must contain the exact same sentence JS sets at runtime');
});

test('confirmation truth: canonical saved-state wording ("saved" / "checks availability" / "confirms your pickup") appears in both the static default and the JS runtime copy', () => {
  const jsInner = extract(js, "bulaLeadText.innerHTML = '", "';");
  assert.ok(/your transfer request is saved/i.test(jsInner));
  assert.ok(/checks availability/i.test(jsInner));
  assert.ok(/confirms your pickup/i.test(jsInner));
  assert.ok(html.includes(jsInner));
});

test('confirmation truth: no reachable customer-facing copy claims staff has seen the request merely from a saved booking', () => {
  for (const src of [html, js]) {
    assert.ok(!/team has been notified/i.test(src), 'must not claim the team was notified merely because the booking was saved');
  }
});

test('WhatsApp semantics: bulaWaContext is optional/faster-contact framed, not a mandatory step, in both index.html and app.js, and the two stay byte-identical', () => {
  const htmlContext = extract(html, 'id="bulaWaContext">', '</p>').trim();
  const jsContext = extract(js, "bulaWaContext.textContent = '", "';");
  assert.ok(htmlContext.includes(jsContext), 'static default must contain the exact JS-set string');
  assert.ok(/want faster contact/i.test(jsContext));
  assert.ok(!/tap the green whatsapp button now/i.test(jsContext));
  assert.ok(!/complete your pickup confirmation/i.test(jsContext));
});

test('WhatsApp semantics: the WhatsApp button label no longer claims it confirms the pickup', () => {
  assert.ok(!html.includes('CONTINUE TO WHATSAPP — CONFIRM MY PICKUP'));
  assert.ok(!js.includes('CONTINUE TO WHATSAPP — CONFIRM MY PICKUP'));
  assert.ok(html.includes('MESSAGE US ON WHATSAPP'));
  assert.ok(js.includes("BULA_WA_ICON_SVG + 'MESSAGE US ON WHATSAPP'"));
});

test('WhatsApp semantics: bulaWaReassurance frames WhatsApp as optional, not as where confirmation happens, and stays in sync between HTML and JS', () => {
  const htmlReassurance = extract(html, 'id="bulaWaReassurance">', '</p>').trim();
  const jsReassurance = extract(js, "bulaWaReassurance.textContent = '", "';");
  assert.ok(htmlReassurance.includes(jsReassurance));
  assert.ok(/optional/i.test(jsReassurance));
  assert.ok(!/whatsapp is where our fiji team confirms your pickup/i.test(jsReassurance));
});

test('WhatsApp open != message sent: the whatsapp_opened click handler only tracks a funnel event, never writes "sent"/"notified" copy', () => {
  const handlerLine = extract(js, "document.addEventListener('click', (e) => {", '});');
  assert.ok(handlerLine.includes("if (e.target.closest('#bulaWaBtn')) trackFunnelEvent?.('whatsapp_opened');"));
  assert.ok(!/message sent/i.test(handlerLine));
  assert.ok(!/team notified/i.test(handlerLine));
});

test('WhatsApp-only flow (showBulaUnsupportedRoute) remains truthful and untouched: never claims the booking is saved', () => {
  const fn = extract(js, 'function showBulaUnsupportedRoute(ref) {', '\nfunction showBulaFailure');
  // Check the actual runtime-visible string literal, not the function's
  // comments — one of its comments explicitly documents banned phrases
  // ("safely saved", "booking received", etc.) as a warning to future
  // editors, which would otherwise trip a naive regex scan of the whole
  // function source (comments included).
  const leadText = extract(fn, "bulaLeadText.innerHTML = '", "';");
  assert.ok(/needs human review/i.test(leadText));
  assert.ok(!/booking received/i.test(leadText));
  assert.ok(!/safely saved/i.test(leadText));

  assert.ok(fn.includes("bulaWaContext.style.display = 'none'"));
  assert.ok(fn.includes("bulaWaReassurance.style.display = 'none'"));
});

test('definitive failure wording (bulaFailure card) is truthful for an unknown-save outcome and never claims success', () => {
  // CEO P1 truthful-failure fix (2026-09-13): the old copy asserted "your
  // details are saved and our team has already been alerted" as a blanket
  // fact for every failure outcome, including the genuinely unknown one
  // (network timeout after the server may have already committed - see
  // the unknown-save test below). That's only true for a confirmed server
  // rejection, never for an unknown outcome, so it's replaced with wording
  // that doesn't assert either way.
  // Strip HTML comments first: this card carries an explanatory comment
  // that names the exact banned phrases being removed (for future
  // editors), which would otherwise trip a naive substring/regex scan of
  // the raw markup. Only rendered (customer-visible) text should be
  // checked against these assertions.
  const cardRaw = extract(html, 'id="bulaFailure"', '</div>\n    </div>');
  const card = cardRaw.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(/we couldn.t confirm your booking automatically/i.test(card));
  assert.ok(/couldn.t confirm whether your booking request was saved/i.test(card), 'must not claim a settled save/no-save outcome');
  assert.ok(!/details are saved/i.test(card), 'must not claim the booking is saved when the outcome is unknown');
  assert.ok(!/team has already been alerted/i.test(card), 'must not claim the team has been alerted when the outcome is unknown');
  assert.ok(!/booking confirmed/i.test(card));
  assert.ok(/do not make a second booking with different details/i.test(card), 'must warn against a second, different-details booking while save state is unknown');
});

test('unknown-save retry identity: retryMarketplaceBooking() reuses the same client_booking_ref, never mints a new one', () => {
  const fn = extract(js, 'async function retryMarketplaceBooking() {', '\n// A2:');
  assert.ok(fn.includes('const ref = state.currentBookingRef;'), 'retry must reuse the original booking ref, not generate a fresh one');
  assert.ok(fn.includes('submitMarketplaceBooking(ref)'), 'retry must submit with that same ref, so the existing idempotency path can never create a duplicate booking');
});

test('unknown-save wording: a network timeout after the server may have already committed still routes to showBulaFailure(), never to a false success', () => {
  const submitFn = extract(js, 'async function submitMarketplaceBooking(ref) {', '\nasync function reportBookingSyncFailure');
  // The comment documenting this exact "did it actually save?" case wraps
  // across a line break inside a // comment, so match tolerant of that
  // rather than requiring one unbroken phrase.
  assert.ok(/network\s*\n\s*\/\/\s*timeout after server commit/i.test(submitFn), 'must document the unknown-save case explicitly');
  const catchBlock = submitFn.slice(submitFn.lastIndexOf('} catch (err) {'));
  assert.ok(catchBlock.includes('return { ok: false'), 'an unknown-outcome network error must resolve to ok:false (routes to showBulaFailure), never ok:true');
});

// ─── AREA 5: VEHICLE SELECTION CLARITY ─────────────────────────────────────

// Pure-function reimplementation of the badge-priority rule now in both
// buildVehicleCards() and buildVehicleDetailCards() (app.js). Must be kept
// in sync with those two functions if this logic changes again.
function pickBadge({ fits, isSelected, isRec, warn }) {
  if (!fits) return { cls: 'warn', text: warn };
  if (isSelected) return { cls: 'sel', text: '✓ Selected' };
  if (isRec) return { cls: 'rec', text: '★ Recommended' };
  return null;
}

test('vehicle badge priority: a manually-selected non-recommended vehicle shows "Selected", not "Recommended"', () => {
  const badge = pickBadge({ fits: true, isSelected: true, isRec: false, warn: '' });
  assert.deepStrictEqual(badge, { cls: 'sel', text: '✓ Selected' });
});

test('vehicle badge priority: an unselected recommended vehicle still shows "Recommended"', () => {
  const badge = pickBadge({ fits: true, isSelected: false, isRec: true, warn: '' });
  assert.deepStrictEqual(badge, { cls: 'rec', text: '★ Recommended' });
});

test('vehicle badge priority: the selected AND recommended vehicle (default on load) shows "Selected", never both/neither', () => {
  const badge = pickBadge({ fits: true, isSelected: true, isRec: true, warn: '' });
  assert.deepStrictEqual(badge, { cls: 'sel', text: '✓ Selected' });
});

test('vehicle badge priority: a disabled (too-small) vehicle always shows its capacity warning, even if selected or recommended', () => {
  const badge = pickBadge({ fits: false, isSelected: true, isRec: true, warn: 'Too small for 9 pax' });
  assert.deepStrictEqual(badge, { cls: 'warn', text: 'Too small for 9 pax' });
});

test('vehicle badge priority: a fitting, unselected, non-recommended vehicle shows no badge at all', () => {
  const badge = pickBadge({ fits: true, isSelected: false, isRec: false, warn: '' });
  assert.strictEqual(badge, null);
});

test('buildVehicleCards() and buildVehicleDetailCards() both implement isSelected-first badge priority and reference the new .vehicle-badge.sel class', () => {
  const cardsFn = extract(js, 'function buildVehicleCards() {', '\nfunction buildVehicleDetailCards() {');
  const detailFn = extract(js, 'function buildVehicleDetailCards() {', '\nfunction alertCapacity(');
  for (const fn of [cardsFn, detailFn]) {
    assert.ok(fn.includes('const isSelected = state.selectedVehicle === v.key;'));
    assert.ok(fn.includes('vehicle-badge sel'));
    // isSelected must be checked before isRec in the ternary chain.
    const selIdx = fn.indexOf('isSelected\n');
    const recIdx = fn.indexOf('isRec ?');
    assert.ok(selIdx !== -1 && recIdx !== -1 && selIdx < recIdx, 'selection must be checked before recommendation');
  }
});

// ─── AREA 3: MOBILE CTA COLLISION ──────────────────────────────────────────

test('sticky bar visibility: an IntersectionObserver hides #stickyBar while #bookingWidget is in view, and restores the CSS default otherwise', () => {
  const initBlock = extract(js, "document.getElementById('stickyBar');", '\n});');
  assert.ok(initBlock.includes("new IntersectionObserver"));
  assert.ok(initBlock.includes("stickyBar.style.display = entry.isIntersecting ? 'none' : '';"));
});

test('sticky bar visibility: the fix is purely a JS visibility toggle — no change to the underlying CSS default rules', () => {
  const baseCss = gitShow('ftt-booking-site/src/styles.css');
  const candidateCss = normalize(fs.readFileSync(path.join(__dirname, 'src', 'styles.css'), 'utf8'));
  const stickyRuleRe = /\.sticky-bar\{[^}]*\}/g;
  assert.deepStrictEqual(candidateCss.match(stickyRuleRe), baseCss.match(stickyRuleRe), 'sticky-bar CSS rules must be untouched — only JS controls visibility now');
});

// ─── AREA 4: OPTIONAL EXTRAS MOBILE HEIGHT ─────────────────────────────────

test('extras grid: mobile breakpoint (900px) keeps the same 2-column layout as desktop instead of collapsing to 1 column', () => {
  const css = normalize(fs.readFileSync(path.join(__dirname, 'src', 'styles.css'), 'utf8'));
  // Two separate "@media(max-width:900px){" blocks exist in this file (one
  // for the routes table, one — containing .extras-grid — for the main
  // booking-form responsive rules), so anchor on the .form-grid rule that
  // immediately precedes .extras-grid inside the correct block rather than
  // matching the first (wrong) "@media(max-width:900px){" occurrence.
  const responsiveBlock = extract(css, '.form-grid{grid-template-columns:1fr}', '\n}');
  assert.ok(responsiveBlock.includes('.extras-grid{grid-template-columns:repeat(2,1fr)}'));
  assert.ok(!responsiveBlock.includes('.extras-grid{grid-template-columns:1fr}\n'));
});

// ─── PRICE / BOOKING-CORE REGRESSION PROOF ─────────────────────────────────
// Byte-identical diff against the mission's base commit for every function
// this mission's STRICT NO-CHANGE clause covers. Any edit to fares, capacity,
// or recommendation logic fails this suite immediately.

test('pricing untouched: calculateTotal() is byte-identical to the base commit', () => {
  const candidate = extract(js, 'function calculateTotal(vehicleKey) {', '\n\n// ─── EMOJI STRIPPER');
  const base = extract(gitShow('ftt-booking-site/src/app.js'), 'function calculateTotal(vehicleKey) {', '\n\n// ─── EMOJI STRIPPER');
  assert.strictEqual(candidate, base);
});

test('pricing untouched: VEHICLES, vehicleFits(), and recommendedVehicle() are byte-identical to the base commit', () => {
  const candidate = extract(js, "const VEHICLES = [", '\n\n// ─── VEHICLE CARD HTML');
  const base = extract(gitShow('ftt-booking-site/src/app.js'), "const VEHICLES = [", '\n\n// ─── VEHICLE CARD HTML');
  assert.strictEqual(candidate, base);
});

test('booking-core untouched: submitMarketplaceBooking()\'s payload construction and idempotency key handling are byte-identical to the base commit', () => {
  const marker = 'const payload = {';
  const endMarker = '\n\n  try {';
  const candidate = extract(js, marker, endMarker);
  const base = extract(gitShow('ftt-booking-site/src/app.js'), marker, endMarker);
  assert.strictEqual(candidate, base);
});

test('booking-core untouched: confirmBooking()\'s idempotency/fingerprint ref generation is byte-identical to the base commit', () => {
  const marker = 'const attemptFingerprint = JSON.stringify([';
  const endMarker = 'state.currentBookingRef = ref;';
  const candidate = extract(js, marker, endMarker);
  const base = extract(gitShow('ftt-booking-site/src/app.js'), marker, endMarker);
  assert.strictEqual(candidate, base);
});
