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

// WhatsApp reservation handoff (2026-10-05) supersedes the earlier "WhatsApp is optional" framing: the guest finishes by pressing Send in WhatsApp, the Fiji team replies
// "Bula, vinaka", checks the details and confirms. Heading / button / instruction are static and identical in every state; only the status line, reference and link vary.
const HANDOFF = 'Tap the green button, then press Send in WhatsApp to send your reservation details. Our Fiji team will reply Bula, vinaka, check your details and confirm your transfer with you.';
test('handoff wording: required heading, button label and instruction in the success card, and the same set in the unknown-save card', () => {
  const card = extract(html, 'id="bulaSuccess"', 'bula-divider');
  assert.ok(card.includes('<h2 class="bula-title" id="bulaTitle">Finish your reservation on WhatsApp</h2>'));
  assert.ok(card.includes(HANDOFF)); assert.ok(card.includes('<span>Open WhatsApp — send reservation</span>'));
  assert.ok(card.includes('Opening WhatsApp alone does not send your request.')); assert.ok(card.includes('Your transfer is confirmed only after our Fiji team confirms it with you.'));
  const fail = extract(html, 'id="bulaFailure"', '</div>\n    </div>').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(fail.includes('<h2 class="bula-title" id="bulaFailureTitle">Finish your reservation on WhatsApp</h2>')); assert.ok(fail.includes(HANDOFF)); assert.ok(fail.includes('<span>Open WhatsApp — send reservation</span>'));
  assert.ok(fail.includes('Opening WhatsApp alone does not send your request.'));
});

test('handoff wording: no "optional" / "faster contact" / old-label / old-heading wording remains anywhere in the guest-facing page or script', () => {
  for (const bad of ['WhatsApp is optional', 'Want faster contact', 'MESSAGE US ON WHATSAPP', 'Message us on WhatsApp instead', 'Send booking request on WhatsApp', 'One more step to send your request', 'Your request is saved</span>', "We couldn't confirm your booking automatically", 'contacted within 15 minutes', 'We contact you within 15 minutes']) {
    assert.ok(!html.includes(bad), 'index.html: ' + bad); assert.ok(!js.includes(bad), 'app.js: ' + bad);
  }
  assert.ok(!/bulaTitleSupported|bulaTitleUnsupported|bulaWaContext|bulaWaReassurance/.test(js + html), 'the per-state headings and optional-framing elements are gone');
  assert.ok(html.includes('After you submit, open WhatsApp and press Send; our Fiji team will reply Bula, vinaka and confirm availability and payment options with you.'));
});

test('saved state is truthful: saved online, NOT yet confirmed; the static default never claims a save (stale-cache safe)', () => {
  const fn = extract(js, 'function showBulaSuccess(ref, bookingId, followupToken) {', '\n// Route not eligible');
  assert.ok(fn.includes("bulaLeadText.textContent = 'Your request is saved online, but your transfer is not confirmed yet. Send your reservation details on WhatsApp to finish.'"));
  assert.ok(!/is confirmed\b|booked|team has been notified/i.test(fn.replace(/\/\/[^\n]*/g, '')));
  const staticLead = extract(html, 'id="bulaLeadText">', '</p>');
  assert.ok(!/saved|booked|received/i.test(staticLead), 'static default: ' + staticLead);
});

test('confirmation truth: no reachable customer-facing copy claims staff has seen the request merely from a saved booking', () => {
  for (const src of [html, js]) {
    assert.ok(!/team has been notified/i.test(src), 'must not claim the team was notified merely because the booking was saved');
  }
});

test('WhatsApp open != message sent: the whatsapp_opened click handler only tracks a funnel event, never writes "sent"/"notified"/"confirmed" copy, and the button is a plain link', () => {
  const handlerLine = extract(js, "document.addEventListener('click', (e) => {", '});');
  assert.ok(handlerLine.includes("if (e.target.closest('#bulaWaBtn')) trackBookingFunnel('whatsapp_opened');"));
  assert.ok(!/message sent|team notified|confirmed/i.test(handlerLine));
  assert.ok(!/<a id="bulaWaBtn"[^>]*onclick/i.test(html) && !/<a id="bulaFailureWaBtn"[^>]*onclick/i.test(html));
  for (const fnName of ['showBulaSuccess', 'showBulaUnsupportedRoute', 'showBulaFailure']) assert.ok(js.includes('function ' + fnName + '('));
});

test('WhatsApp-only flow (showBulaUnsupportedRoute) is truthful: never claims an online save; same handoff heading / button / instruction', () => {
  const fn = extract(js, 'function showBulaUnsupportedRoute(ref) {', '\nfunction showBulaFailure');
  const leadText = extract(fn, "bulaLeadText.textContent = '", "';");
  assert.ok(/has not been saved online/i.test(leadText) && /needs human review/i.test(leadText));
  assert.ok(!/booking received|safely saved|is saved online|booked/i.test(leadText));
  assert.ok(fn.includes('bulaWaBtn.href = buildWhatsAppURL(ref)'));
  assert.ok(!/textContent\s*=\s*''|insertAdjacentHTML/.test(fn), 'the button label is static; this state never rewrites it');
});

test('unknown-save state (bulaFailure card) is truthful: cannot tell whether it was saved, reference kept, same-reference retry, never claims success', () => {
  const card = extract(html, 'id="bulaFailure"', '</div>\n    </div>').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(/couldn.t confirm whether your request was saved online/i.test(card), 'must not claim a settled save/no-save outcome');
  assert.ok(!/details are saved|team has already been alerted|booking confirmed|you.re booked|is saved online, but/i.test(card));
  assert.ok(/do not make a second booking with different details/i.test(card));
  assert.ok(card.includes('id="bulaRetryBtn"') && card.includes('retryMarketplaceBooking()'));
  const fn = extract(js, 'function showBulaFailure(ref, errorDetail) {', '\n// "Try again" on the failure card');
  assert.ok(fn.includes('Keep your reference (${ref})') && fn.includes('failWaBtn.href = waUrl'));
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
  // P0 incident fix (2026-09-26): the previous end marker '\n\n  try {' was not unique to this
  // function — it coincidentally matched a much later, unrelated try block deep in the file (the
  // negotiation-offer code), so this check was silently covering ~15,500 bytes it was never meant
  // to, well past this payload's real end. Narrowed to a marker confirmed unique (exactly one
  // occurrence) that actually terminates at this payload object's own closing brace.
  // The tracking call after the payload was renamed to the guarded helper (issue #59), so the base
  // commit's end marker is the old bare call; the payload text between the markers must stay identical.
  const endMarker = "  };\n\n  trackBookingFunnel('booking_post_started');";
  const baseEndMarker = "  };\n\n  trackFunnelEvent?.('booking_post_started');";
  const candidate = extract(js, marker, endMarker);
  const base = extract(gitShow('ftt-booking-site/src/app.js'), marker, baseEndMarker);
  assert.strictEqual(candidate, base);
});

test('booking-core untouched: confirmBooking()\'s idempotency/fingerprint ref generation is byte-identical to the base commit', () => {
  const marker = 'const attemptFingerprint = JSON.stringify([';
  const endMarker = 'state.currentBookingRef = ref;';
  const candidate = extract(js, marker, endMarker);
  const base = extract(gitShow('ftt-booking-site/src/app.js'), marker, endMarker);
  assert.strictEqual(candidate, base);
});

test('negotiated-fare result card: correct heading, fare acceptance vs transfer confirmation separated, WhatsApp handoff required, no "you\'re booked" claim; negotiation/booking code untouched', () => {
  const card = extract(html, 'id="negotiateSuccess"', 'bula-foot');
  assert.ok(card.includes('<h2 class="bula-title" id="negotiateSuccessTitle">Your fare was accepted — confirm the details on WhatsApp</h2>'));
  assert.ok(card.includes('Fare acceptance and transfer confirmation are separate: your transfer is confirmed only after our Fiji team confirms the details with you.'));
  assert.ok(card.includes('Tap the green button, then press Send in WhatsApp to send your reservation details. Our Fiji team will reply Bula, vinaka, check your details and confirm your transfer with you.'));
  assert.ok(card.includes('<span>Open WhatsApp — send reservation</span>') && card.includes('Opening WhatsApp alone does not send your request.'));
  for (const bad of ["you're booked", 'locked in your booking', 'A driver has agreed', 'Message us on WhatsApp →']) assert.ok(!html.includes(bad), bad);
  const fn = extract(js, 'function showNegotiationSuccess(', '\n// CEO P0 fix (Issue #34): both markWhatsAppTapped()');
  assert.ok(fn.includes('buildNegotiationWhatsAppURL(state.negotiationRequestId, bookingId, agreedAmount)'));
  assert.ok(!/fetch\(|state\.negotiation\w+\s*=|NADI_API_BASE/.test(fn), 'display/link only: no network call, no negotiation state change');
  // behaviour untouched: same endpoints / polling / accept path
  for (const c of ['/negotiate/${state.negotiationRequestId}/accept-offer', 'startNegotiationPolling();', "data.request.status === 'accepted'", 'stopNegotiationPolling();']) assert.ok(js.includes(c), c);
});
