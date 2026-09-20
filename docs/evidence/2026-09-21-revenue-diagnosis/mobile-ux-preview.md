# Nadi mobile-UX repair — PREVIEW ONLY (for independent review)

Status 2026-09-21. **Not deployed to production. No production approval exists.** Separate from the Outrigger redirect/404 patch; built on the production base, so the two can be reviewed and released independently.

| | |
|---|---|
| Branch | `ceo/nadi-mobile-ux-preview` (worktree of `jamesdeorajan-sys/fiji-platform`) |
| Base | `31a27fb` (= current production source, deployment `9af4d251`) |
| Head | `7552243a4eeda6b60397ef174743e36656e983a5` (3 commits on the base: `46c9c81`, `9e9eb01`, `7552243`) |
| Preview | `https://cea78a1a.fttlandingpage.pages.dev` (Cloudflare source label `7552243`, branch `ceo-nadi-mobile-ux-preview`, uploaded from the branch's own worktree so the label is accurate) |
| Exact diff | `git diff 31a27fb 7552243` — 4 files, +262/−34: `src/app.js`, `src/index.html`, `src/styles.css`, `test/mobile-ux.test.js`; a copy of the source diff is `mobile-ux-preview.patch` beside this file |
| Not touched | fares/pricing (`calculateTotal`, `applyModifiers`, price tables), booking submission, Worker, notifications, PR #55, route pages, sitemap, chat widget |

## What changed
1. **Explicit vehicle choice.** No silent recommended-vehicle preselection. "★ Recommended" is a suggestion only; a hint says "Tap a vehicle to choose it … nothing is selected yet."
2. **Continue disabled until a valid choice.** Step-2 "Continue to passenger details" (`#nextBtn2`) starts disabled; enabled only when the selected vehicle fits pax/luggage. The step-3 guard and its alert remain as a defensive fallback.
3. **Selected mark.** Selected cards show a "✓ Selected" pill plus a stronger blue ring; radio semantics (`role=radiogroup/radio`, `aria-checked`).
4. **Selection preserved** through add-on toggles and back/forward navigation (state-driven re-render).
5. **Capacity revalidation.** If pax/bags change so the chosen vehicle no longer fits, the choice is cleared (never swapped for the recommended one), Continue is disabled, and the hint says why. The old "we've switched you to a …" behaviour is removed.
6. **Sticky "Get price" bar** is hidden while the booking widget is on screen (`IntersectionObserver` on `#booking`, `rootMargin -80px` so merely touching the fold does not count) and after step 1 (`body.booking-flow`); it returns on the landing sections. While visible it has 96 px right padding so the CTA sits clear of the 60 px chat launcher, and the CTA cannot wrap (`white-space:nowrap`).
7. **Touch hover fix.** `:hover` styling that looked identical to "selected" now applies only under `@media (hover:hover)`. On touch screens `:hover` sticks to the last-tapped card, so a card could look selected without being selected. This is a *plausible* contributor to the recommended-vs-selected confusion in the phone screenshots; it is not proven to be what James saw.
8. Cache-busting: `styles.css` and `app.js` query strings in `index.html` bumped to `?v=20260921-mobile-ux`.

## Focused test evidence (AUTHOR-VERIFIED — for Codex to reproduce)
- Command: `node --test nadi-airport-transfers-site/test/*.test.js` at `7552243` → **89 tests, 89 pass, 0 fail, 0 skipped** (71 existing + 18 new in `test/mobile-ux.test.js`).
- Discrimination check: the 18 new tests run against the base `31a27fb` → **17 fail, 1 pass** (the scope-guard test, which asserts the money-path functions still exist). So the tests genuinely detect the old behaviour.
- New tests cover: nothing preselected; Continue disabled + hint; tap selects exactly one card (aria); step-1 tap also satisfies the gate; selection survives add-on/back re-sync; capacity change clears (no swap) with notice; fitting choice preserved; notice clears on re-selection; no `selectedVehicle = recommendedVehicle()` anywhere; markup (`nextBtn2 disabled`, hint, radiogroup); Selected mark CSS; hover only under `(hover:hover)`; sticky-bar hide rules + observer + rootMargin; launcher clearance ≥ 80 px; CTA no-wrap; cache-bust versions; scope guard.

## Browser verification on the preview (AUTHOR-VERIFIED, emulation — not a real device; no submissions)
| Check | Result |
|---|---|
| 375×812, page top | Bar visible; CTA 160–279 × 758–800 vs launcher 305–359 × 742–796 → **no overlap**; `elementFromPoint` at CTA centre and right edge returns the CTA |
| 320×640 | CTA one line (43 px tall), no overlap, no horizontal overflow |
| 414×896 | no overlap, no overflow |
| Scroll into booking / footer / top | bar hidden in booking, returns at footer and top |
| Step 2 on arrival | nothing selected; Continue disabled; hint shown; clicking Continue → no step change, no alert |
| Tap Sedan | one `selected` card with "✓ Selected", Continue enabled, hint "Selected: Private Sedan…" |
| Add-on toggle; Back → Continue | selection preserved |
| Raise passengers so Sedan no longer fits | choice cleared, Continue disabled, warn hint "Your Sedan can't carry 4 passengers…"; Minivan shown as Recommended but **not** selected; tap Minivan → selected; back to 2 pax keeps Minivan |
| Step 3 | bar hidden (`booking-flow`) |

**Residual risk / not tested:** when a step's Continue button is scrolled to the very bottom edge of the screen, the fixed chat launcher can still cover its right ~25 px (button 121–330 vs launcher 305–359 at 375 px); centred, it is fully tappable. Not changed (would require touching the chat widget or page padding). Real-device behaviour (iPhone Safari touch/hover, IntersectionObserver timing) is untested — needs James's real-phone walkthrough and Codex's independent review. IntersectionObserver-driven hiding was only observable while the emulated tab was rendering.

## Independent-review checklist for Codex
1. Check out `7552243`, run the suite (expect 89/89), run the 18 new tests on `31a27fb` (expect 17 fail).
2. Confirm `git diff 31a27fb 7552243 --stat` touches only the four files above and no fare/submission/Worker code.
3. Open the preview at 375×812 and on a real phone; repeat the table above (do not submit a booking).
4. Confirm production still serves the base (`9af4d251`) — nothing here is deployed to it.

## Release
Separate from the Outrigger patch. Any production release must be a fresh upload from a clean checkout of the exact reviewed commit with accurate commit metadata; Cloudflare Pages cannot promote a preview. James decides.
