# Nadi mobile-UX repair — PREVIEW ONLY (for independent review)

Status 2026-09-21 (revision 2, after Codex's review of `7552243`). **Not deployed to production. No production approval exists.** Separate branch built on the production base; the combined tree with the Outrigger patch is documented in `combined-release-candidate.md`.

| | |
|---|---|
| Branch | `ceo/nadi-mobile-ux-preview` |
| Base | `31a27fb` (= current production source, deployment `9af4d251`) |
| Head (rev 2) | `272cfebb577df770aa199c0c1a11e8a17ac9d717` (4 commits on the base: `46c9c81`, `9e9eb01`, `7552243`, `272cfeb`) |
| Preview | `https://706dcc02.fttlandingpage.pages.dev` (label: source `272cfeb`, branch `ceo-nadi-mobile-ux-preview`) |
| Exact diff | `git diff 31a27fb 272cfeb` — 4 files: `src/app.js`, `src/index.html`, `src/styles.css`, `test/mobile-ux.test.js`; source diff copy `mobile-ux-preview.patch` (regenerated at `272cfeb`) |
| Not touched | fares/pricing, booking submission, Worker, notifications, PR #55, route pages, sitemap, `chat-widget.js` |
| Revision 1 (superseded) | `7552243` / preview `cea78a1a` — Codex ran its suite (89/89, INDEPENDENTLY-VERIFIED for the suite only; emulation stayed AUTHOR-VERIFIED) |

## Changes in revision 2 (Codex findings 1 and 2)
1. **Chat launcher no longer overlaps Continue and other booking buttons.** `.step-actions` gets right padding (40 px ≤ 900 px, 30 px ≤ 480 px) and stacks vertically on ≤ 480 px (Continue on top, Back below), so the buttons end left of the launcher's column. The launcher itself is **not moved, hidden or restyled** (`chat-widget.js` untouched; no `#ftt-chat` override in `styles.css`), so assistance stays one tap away everywhere.
2. **Vehicle cards are native radios.** Each card is `<label><input type="radio" class="vehicle-radio" …>`; step-1 cards use group `vehiclePreview`, step-2 cards `vehicleChoice`. Tab/arrow keys/Space selection, `checked` and `disabled` come from the browser; the input is visually hidden but focusable; a 3 px `:focus-visible` ring shows on the card (`:has()` with a `:focus-within` fallback under `@supports not selector(:has(*))`). An unfit vehicle is a **disabled** radio (skipped by arrows) and tapping its card still explains why (`alertCapacity`). Custom `role="radio"`/`aria-checked` removed (no ARIA override of native state). Keyboard focus is kept on the same vehicle when the cards re-render (`setVehicleCards`).

## Behaviour retained from revision 1
Explicit choice with no preselect; Continue (`#nextBtn2`) disabled until a fitting vehicle; hint + "✓ Selected" mark; selection preserved across add-ons/back; capacity change clears (never swaps) with a notice; sticky "Get price" bar hidden while `#booking` is visible or after step 1 and clear of the launcher; hover styling only under `(hover:hover)`.

## Focused test evidence (AUTHOR-VERIFIED — for Codex to reproduce)
- `node --test nadi-airport-transfers-site/test/*.test.js` at `272cfeb` → **95 tests, 95 pass, 0 fail, 0 skipped** (71 existing + 24 in `test/mobile-ux.test.js`).
- New/changed tests in rev 2: native radio markup (2 inputs, 2 labels, distinct group names, no `role="radio"`, no `aria-checked`); `checked` mirrors state; unfit vehicle = disabled radio + label explains; hidden input stays focusable (no `display:none`) and has a focus-visible ring rule + fallback; focus is restored to the same vehicle after re-render and not stolen otherwise; step-action padding/stacking rules and no chat override.

## Browser evidence on the rev-2 preview (AUTHOR-VERIFIED, emulation — not a real device; no submissions)
| Check | Result |
|---|---|
| Real key events (ArrowDown/ArrowUp) on step 2 | ArrowDown from Sedan → Minivan selected, `checked` `[false,true,false]`, focus stays on Minivan after re-render, focus-visible ring `solid 3px`, Continue enabled, hint updated; ArrowUp → Sedan |
| Capacity change (5 passengers) | Sedan radio `disabled`, card class `disabled`, badge "Too small for 5 pax", Continue disabled, notice shown; tapping the disabled card alerts the reason and selects nothing |
| Step buttons vs launcher at the bottom edge (`scrollIntoView({block:'end'})`), steps 1–4 | 375 px: all buttons span x 45–300, launcher 305–359 → **0 overlaps**; 320 px: buttons end at x 245, launcher 250–304 → 0 overlaps, no horizontal overflow; 768 px: buttons end at 668, launcher 673–733 → 0 overlaps |
| Other booking controls | Only the step-1 currency select and price cards reach the launcher column, by ≤ 4 px at their right edge (x 309 vs 305); nothing else narrower than 255 px reaches it |
| Earlier rev-1 checks (sticky bar hide/return, CTA clear of launcher at 320/375/414, selection/notice flow) | unchanged; re-run at 375 on the combined tree |

**Residual risk / not tested:** real-device behaviour (iPhone Safari touch/hover, VoiceOver, hardware keyboard on iPad), IntersectionObserver timing on a real page, and any browser without `:has()` (falls back to `:focus-within`, which also shows on mouse focus). If a focused radio becomes disabled by a capacity change, browsers reset focus to the page; the live-region hint announces why. Full-width fields can pass a few px under the launcher while scrolling (≤ 4 px measured) — not action buttons.

## Independent-review checklist for Codex
1. Check out `272cfeb`, run the suite (expect 95/95); confirm `git diff 31a27fb 272cfeb --stat` touches only the four files and no fare/submission/Worker/chat-widget code.
2. On the preview at 375×812, 320×640 and on a real phone: Tab into the vehicle cards, use arrows/Space, confirm focus ring, Selected mark and disabled state; confirm no step button sits under the launcher; do not submit a booking.
3. Confirm production still serves the base (`9af4d251`).

## Release
Not on its own: because a Cloudflare Pages deploy replaces the whole site, this branch must not be deployed alone after the Outrigger patch (or vice versa). Use the combined candidate in `combined-release-candidate.md`. James decides; nothing here is authorized for deployment.
