# Nadi mobile-UX follow-up — SPEC ONLY (not implemented, not deployed)

Status 2026-09-21. Separate from the Outrigger redirect/404 patch (`9ddd923`): that patch does not touch `index.html`, `app.js`, `styles.css` or `chat-widget.js`, and every finding below reproduces identically on production (base `31a27fb`). Ship on its own branch and its own preview; no production deployment is authorized by this document.

## Evidence (AUTHOR-VERIFIED at 375×812 emulation on production and preview; real-phone screenshots from James on iPhone 15 Pro / iOS 26.6.2)

| # | Finding | Reproduction result |
|---|---|---|
| M1 | Chat launcher overlaps the sticky "Get price →" CTA | Launcher (fixed, bottom/right 16 px, z-index 999999) occupies x 305–359, y 742–796; CTA occupies x 236–355, y 758–800. `document.elementFromPoint(345,779)` returns `#ftt-chat-launcher`, not the CTA. |
| M2 | Sticky "Get price →" (`href="#booking"`) stays visible during steps 2–4, after the guest already has a price | `.sticky-bar` is `position:fixed` and shown at the mobile breakpoint; no JS ever hides it (`display:block` in the media query only). |
| M3 | Recommended vs selected vehicle | **Handler is not broken.** Sequence: step 2 opens with `state.selectedVehicle === null` and the Sedan card carries `recommended` (green ring + "★ Recommended") but not `selected` → "Continue to passenger details" is enabled → pressing it alerts "Please select a vehicle." → tapping the Sedan card gives `selected` (blue border/fill), persists across an add-on re-render → Continue advances to step 3. The defect is presentation/gating, not selection. |

The exact tap sequence behind James's "Please select a vehicle." screenshot is unknown; the reproduction above is the only claim made.

## Proposed changes (options; James decides before any build)

- **M1:** on mobile, either (a) add right padding to `.sticky-bar-inner` so the CTA sits clear of the launcher, or (b) raise `#ftt-chat-widget` above the bar while the bar is visible. Prefer (a)+M2; (b) changes another component.
- **M2:** hide the sticky bar once the guest is in the booking flow (booking section in view, or step > 1). Suggested: `body.in-flow .sticky-bar{display:none}` toggled from `showStep(n)` and an `IntersectionObserver` on `#booking`. Keep it on the landing/route sections where it is the primary CTA.
- **M3 (recommendation: informed explicit choice, not silent preselect):** keep nothing pre-selected, but (i) disable "Continue to passenger details" until a card is tapped, (ii) add a short hint ("Tap a vehicle to choose it"), (iii) give the selected card a check mark and "Selected" label so it cannot be confused with the green "Recommended" ring. Alternative: preselect the recommended vehicle with a visible "Selected ✓" — higher conversion, but the vehicle sets the fare, so a guest who does not notice is committed to it (price is re-shown on the confirmation step). This is a money-path presentation decision for James.

## Acceptance tests (all non-submitting)

1. Viewports 360×740, 375×812, 390×844: for the sticky CTA's centre and right edge, `elementFromPoint` returns the CTA (or the bar is hidden).
2. Steps 2, 3, 4: `#stickyBar` is not displayed; landing and route pages still show it.
3. Step 2 with nothing selected: Continue is disabled (or inert with hint) and no alert fires; after tapping any fitting card it becomes enabled and exactly one card has `selected`; the selected card has the ✓ marker and is visually distinct from `recommended`.
4. Add-on toggles, pax/luggage change and vehicle-capacity auto-upgrade keep a valid single selection.
5. Existing `node --test nadi-airport-transfers-site/test/*.test.js` (76) still passes plus new static tests for the above.
6. Independent real-phone walkthrough by James (device, OS, browser recorded), Codex review of the preview, then James's separate production decision.

## Reproduction snippet (paste in DevTools at 375×812; does not submit anything)

```js
const R=e=>{const b=e.getBoundingClientRect();return[b.left,b.top,b.right,b.bottom].map(Math.round)};
console.log('CTA',R(document.querySelector('.btn-sticky')),'launcher',R(document.querySelector('#ftt-chat-launcher')),
  'hit@345,779',document.elementFromPoint(345,779).id);
window.alert=m=>console.log('ALERT',m);
document.getElementById('flightUnknown').checked=true; document.getElementById('nextBtn1').click();
setTimeout(()=>{console.log('selected',state.selectedVehicle,[...document.querySelectorAll('.vehicle-detail-card')].map(c=>c.className));
 [...document.querySelectorAll('#step2 button')].find(b=>/passenger details/.test(b.textContent)).click();},500);
```
