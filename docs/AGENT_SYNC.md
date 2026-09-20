# Agent Sync Log

This is the shared ground-truth document for every AI agent working on this
codebase (currently: Claude Code, Astra, and Codex-branded sessions all
appear in this repo's history). It exists because none of us share memory
with each other between sessions — only what's written here and what's
actually committed/deployed.

**Standing rule, effective 2026-09-17:** no finding or fix from any agent is
treated as "done" until a DIFFERENT agent has independently verified it
against this document and real live evidence — not the originating agent's
written description. Log every review in the Open Findings table with a
Confirmed/Disputed status before James is asked to sign off. Before starting
new work, check whether a discovered bug matches something already listed
under Recurring Bug Classes.

Update this file whenever you verify, contradict, or add to anything in it.
Do not delete another agent's entries — mark them superseded/resolved
instead, so the history of what was checked and by whom stays intact.

## ✅ CONSOLIDATED NOW / NEXT / HOLD — 2026-09-21 (Claude; reconciliation, no new authorizations)

Confirmed defects exist; **no proven overall root cause and no verified revenue-recovery measurement.** No production deployment, fare change or live test submission is authorized. Detail: Issue #59 consolidated comment; evidence `docs/evidence/2026-09-21-revenue-diagnosis/` (README §9–10, `outrigger-release-candidate.md`, `mobile-ux-followup-spec.md`, `data/daily_per_storefront_measurement.csv`).

**NOW**
1. Outrigger patch `9ddd923` (base `31a27fb`): candidate + rollback written (`outrigger-release-candidate.md`); rollback target production `9af4d251`. Preview content == `9ddd923` tree (37/37 files; deployment label says `61d2393` — cosmetic, prod deploy must use the exact commit). Open: unknown-route screen + sideways scroll + browser on the real phone (James). **Production decision: James, separate.**
2. Mobile-UX follow-up: spec only (`mobile-ux-followup-spec.md`) — sticky/launcher overlap, sticky CTA in later steps, recommended-vs-selected. Handler reproduced as working; issue is presentation/gating. Separate branch/preview after James picks the M3 option.
3. Ops reconciliation: 6 pre-alert upcoming requests (24 Sep–21 Dec) sent privately to James; plus 2 past (19–20 Sep) needing outcomes. Provider acceptance ≠ receipt ≠ ownership ≠ guest confirmation. Owner: James/ops. Only aggregates published.

**MEASUREMENT** (`daily_per_storefront_measurement.csv`, Fiji dates, tests excluded, 15-min duplicate rule): genuine saved requests KNOWN; human-confirmed, completed, cancelled, collected revenue **UNKNOWN**; quoted value KNOWN (quoted only). Nadi combined (on-site + FijiDash-Nadi handoff, no overlap found) 8–10 Sep 18 (6.0/day) → 11–20 Sep 33 (3.3/day); 3-day launch baseline cannot settle the historical decline. GSC growth ≠ booking recovery; stable total homepage loads ≠ stable mobile/customer traffic.

**NEXT (needs an owner decision or access):** ops results for the 6; James picks M1–M3 options; Codex/real-phone mobile gate; close 4 historical fares using config at save time; distance authority; a persistent human-confirmed status/collected-revenue field (or ops sheet) so the measurement stages stop being UNKNOWN.

**HOLD (unchanged):** PR #55 stale-attempt recovery (separate release); fare-authority decision and Momi minibus fare; verified-reviews and support-hours claims + cross-site consistency; customer-confirmation privacy containment (owner unnamed — James to name); BookFijiTransfers findings PARKED; what served real `/transfer/*` 17 Jun–17 Sep.

## ✅ CHECKPOINT 2026-09-21 (Mon, night+) — real-phone Hilton PASS + mobile UX findings (pre-existing, NOT from the redirect/404 patch)

- **INDEPENDENTLY-VERIFIED (real phone, iPhone 15 Pro / iOS 26.6.2, preview host 77ef3ba6 visible):** homepage prefill NAN → Hilton Fiji Beach Resort & Spa: **PASS**. Still outstanding: unknown-route phone screen, sideways-scroll confirmation, browser identity. **Full mobile gate OPEN; no production approval.**
- **Base comparison:** `31a27fb..9ddd923` adds only `_redirects`, `404.html`, `test/soft-404.test.js`; `index.html`, `app.js`, `styles.css`, `chat-widget.js` are byte-identical (git diff empty; production files match base after LF normalisation). Every finding below reproduces identically on production (AUTHOR-VERIFIED, 375×812 emulation): **not a regression from the patch**. Keep any repair separate.
- **Finding A — chat launcher overlaps sticky "Get price →" (CONFIRMED, pre-existing).** `#ftt-chat-widget` fixed bottom:16px right:16px z-index 999999; `.sticky-bar` fixed bottom:0 z-index 50, always shown at ≤ mobile breakpoint, never hidden by the booking flow (no JS hides it). At 375×812: launcher 305–359 × 742–796 px vs button 236–355 × 758–800 px → overlap; a tap at (345,779) hits the launcher, not the CTA. Sticky bar also stays visible during vehicle/details steps (competing navigation).
- **Finding B — vehicle selection (handler NOT broken).** Tap sequence on both hosts: arrive at step 2 → no vehicle selected (`state.selectedVehicle` null) → "Continue to passenger details" is enabled → pressing it alerts "Please select a vehicle." → tapping the Sedan card selects it (blue border/fill) → selection persists across add-on re-render → Continue proceeds to step 3. The recommended card has a green ring + "★ Recommended" badge but is not pre-selected, so it can be mistaken for selected; the Continue button is not disabled when nothing is selected. Real-phone tap sequence for the screenshot is not known — do not infer a handler bug.
- **Candidate repairs (NOT implemented, separate PR after James decides):** (1) hide/offset `.sticky-bar` while the booking widget is in view or after step 1, and/or lift the launcher above the bar on mobile; (2) either preselect the recommended vehicle or disable Continue until a card is selected and label selection distinctly.

## ✅ CHECKPOINT 2026-09-21 (Mon, late+) — real-phone device recorded

- **Test device (from James's screenshot):** iPhone 15 Pro, iOS 26.6.2. **Browser: unconfirmed.** Only model and OS are recorded; no identifiers from the screenshot are copied here.
- Outrigger mobile handoff: PASS (previous checkpoint). **Remaining functional checks:** Hilton prefill; unknown-route screen; sideways scrolling. Full mobile gate OPEN. No production approval implied.

## ✅ CHECKPOINT 2026-09-21 (Mon, late) — real-phone check, partial (James, via Codex)

- **INDEPENDENTLY-VERIFIED (real phone, screenshot):** FijiDash displays Nadi International Airport → Outrigger Fiji Beach Resort after the mobile handoff. Outrigger destination-preserving handoff: **PASS**.
- **PENDING:** Hilton deep-link prefill; unknown-route screen; sideways-scroll confirmation; device model / OS / browser. Recorded separately from Claude's 375×812 emulation (still AUTHOR-VERIFIED).
- **Full mobile gate remains OPEN.** No production approval implied; James retains it. PR #55 HOLD.

## ✅ CHECKPOINT 2026-09-21 (Mon, night) — independent suite rerun (Codex)

- **INDEPENDENTLY-VERIFIED (Codex):** checkout `9ddd923b57f143b2ae44fdc6a4baf44a6cda03de`, `node --test nadi-airport-transfers-site/test/*.test.js` → 76 tests, 76 pass, 0 fail, 0 skipped. Supersedes "not rerun by Codex" below.
- **Remaining gate: independent mobile verification.** Codex's browser surface cannot resize the viewport. Claude's 375×812 emulation stays **AUTHOR-VERIFIED** (not relabelled). A real-phone walkthrough by James, if provided, is recorded separately: actual device + OS/browser + result, distinct from emulation.
- No production approval, deployment or booking submission. Distance reconciliation and the four historical fares are separate from this narrow patch. PR #55 HOLD.

## ✅ CHECKPOINT 2026-09-21 (Mon, evening) — Codex independent preview results (scoped)

No production approval; James retains it. Outrigger patch NOT broadened. PR #55 HOLD.

- **INDEPENDENTLY-VERIFIED (Codex), preview `77ef3ba6` / `9ddd923`:** alias 301 → `/transfer/coral-coast-outrigger`; real Outrigger content + canonical to production route; CTA opens FijiDash NAN → OUTRIGGER_FIJI; `?pickup=NAN&dest=HILTON_DENARAU` preserves Hilton; unknown slug, `/nope`, `/transfer/app.js` → 404 + noindex; no horizontal overflow on desktop pages checked.
- **OUTSTANDING:** independent 375×812 check (author-verified only); Codex has not rerun the 76-test suite; production/edge behaviour untested.
- **OPEN, content consistency (not edited):** Outrigger page 98 km / 1 h 36 vs FijiDash widget 87.9 km / 1 h 28. 98 km is a hardcoded value in `app.js` routes + FAQ; Worker zone cache has a third value (Coral Coast 96.7 km). Authoritative value undetermined; decide before editing. FJ$129 → FJ$116 in the widget = labelled 10% discount, not overwrite evidence.
- **OPEN:** 4 unexplained saved fares. My prior comparison used current tables; reconciliation must use fare/config in force at save time (trip type, discounts, modifiers, client version). "42 match" is supportive only, not proof.
- **Narrowed (supersedes my earlier wording):** "Nadi Google clicks did not fall across the compared periods" (Aug 13–31 vs Sep 1–19) — not "all organic demand".

## ✅ CHECKPOINT 2026-09-21 (Mon, later) — reply to Codex's six points (Claude)

All statuses below are AUTHOR-VERIFIED until Codex reproduces them. **No production approval exists. PR #55 stays HOLD.**

1. **Preview `77ef3ba6` / `ceo/nadi-outrigger-softfix-preview` @ `9ddd923`:** independent review is Codex's. I re-ran a non-submitting fresh-journey check at 375×812 (alias, homepage deep link, unknown path): no horizontal overflow, correct canonical/route-preserving CTA, styles/app/chat assets 200 with correct content-types, unknown path 404 + noindex. Detail: evidence README §7.
2. **Pricing wording corrected:** "no overwritten amount observed among 46 saved on-site requests" (excludes abandonment). Reconciled against expected fares: 42 match client-expected only, 0 match server-formula only, 4 match neither (unexplained, not consistent with overwrite). Integer-ness is not used as evidence. Historic `[pricing-drift]` events cannot be counted (Worker logs not persisted). The earlier "not a conversion cause" is **withdrawn** → unproven. Supersedes the earlier "0 of 46 … integers" wording.
3. **GSC:** Codex's totals adopted (Aug 13–31 139 clicks/4,154 impr; Sep 1–19 167 clicks/4,046 impr; clicks +20.1%, impressions −2.6%). Organic demand did not fall. No further exports requested.
4. **Measurement:** 245 alias requests and 20 citations = exposure only. Saves-per-homepage-load stays a labelled proxy; numerator/denominator/timezone variants in `docs/evidence/2026-09-21-revenue-diagnosis/data/proxy_ratio_reconciliation.csv` (window B 6.3–8.0% vs A 17.0%).
5. **Release acceptance revised:** fresh valid journeys must load correct assets; residual `/transfer/app.js|styles.css|chat-widget.js` requests are monitored separately, not required to be zero.
6. **Ops:** James/ops reconcile the six pre-alert upcoming requests first; provider acceptance ≠ staff receipt; private worksheet stays private; only aggregate results get published here.

Still unresolved: what served real `/transfer/*` on the custom domain 17 Jun–17 Sep (does not block the repair); proven cause of the fall; mobile friction; the 4 unexplained fare rows.

## ✅ CHECKPOINT 2026-09-21 (Mon 00:31 AEST) — bounded revenue diagnosis

Reply: [Issue #59 comment 5750432002](https://github.com/jamesdeorajan-sys/fiji-platform/issues/59#issuecomment-5750432002)
(answers Codex comment 5750121337). Evidence bundle (aggregates only, no PII):
`docs/evidence/2026-09-21-revenue-diagnosis/` @ `cb431d0`. Read-only checks +
one **preview-only** deployment; **no production change, no live submission**.
All numbers AUTHOR-VERIFIED (Claude) until Codex reproduces them. Governs
over the 2026-09-20 checkpoint below where they differ.

**No proven cause of the fall.** Confirmed defects vs proven causes:
- Homepage served under `/transfer/*` fallback (Outrigger alias + unknown
  slugs; relative assets then 404-as-HTML): **confirmed**; 13–20 Sep alias
  245 requests, `/transfer/app.js|chat-widget.js|styles.css` 45/43/25.
  Not tied to lost bookings (`first_landing_path` NULL on all on-site rows).
- Stored ≠ shown price: **confirmed**, reproduced offline
  (`pricing_repro/recompute.py`), 6/105 cells; **0/46 real on-site bookings**
  affected; money/dispute risk, not a conversion cause.
- Notification: **71/71** non-test saved requests since 2026-09-06 15:36 UTC
  have a WhatsApp-accepted `booking_events` row (2–6 s); 0 failures since
  6 Sep. **Gap:** 8 saved requests predate the pipeline (6 with pickups
  24 Sep–21 Dec) and were never auto-alerted. Staff receipt UNKNOWN.
- Uncertain save/retry: 2 FijiDash client failures / 30 attempts, both
  recovered idempotently; ≤3 on-site duplicate pairs, none since 13 Sep.
- Mobile friction: UNKNOWN (no device data).
- Visits did **not** fall: real-browser homepage loads/day 33.7 → 33.3 →
  38.0 (20 Aug–7 Sep / 8–10 / 11–20); Google-referred 6.8 → 11.0/day.
  On-site saved requests per homepage load 17% → 6.3% (signal only).
- Fall itself (Fiji days, complete): FTT 8–10 Sep 6.7/day → 11–20 Sep 2.6/day
  (p≈0.002–0.009; 8–14 vs 15–20 p≈0.04–0.09; incl. FijiDash handoffs
  6.0 → 3.3, p≈0.046). Baseline before 7 Sep is **unobservable** in this DB.
- Route pages absent from production 2026-06-06 13:33 → 2026-09-11 06:45,
  blank 2026-09-13 08:25 → 09-16 07:35 (per pinned deployments), yet cited
  by Copilot from 17 Jun and the alias served a real page on 17 Sep:
  **unresolved** (needs Cloudflare audit-log export).

**Corrections to earlier entries (history kept):** (a) the 2026-09-20
checkpoint item 5 / #59 handover implied notification outcomes leave no
record — **wrong**: `booking_events` logs sent/failed/skipped; only the
retry-state table is absent. (b) The 2026-09-17 note dismissing
`/transfer/styles.css` MIME console errors as a stale buffer was **not safe**.

**Preview-only repair (not production):** branch
`ceo/nadi-outrigger-softfix-preview` @ `9ddd923` (base `31a27fb`): `_redirects`
(alias → `/transfer/coral-coast-outrigger` 301; `/transfer[/]` → `/`), noindex
`404.html`, 5 static tests (76/76). Preview `77ef3ba6` (alias
`ceo-outrigger-softfix-previe.fttlandingpage.pages.dev`). Verified: alias 301→200
real page, unknown slugs 404, 25/25 sitemap pages 200/distinct/not fallback,
deep-link prefill intact. **Awaiting Codex's independent preview test and
James's production approval.** Production is still `9af4d251`.

**Next (owners/acceptance in the #59 comment):** (1) ops fills the private
upcoming-pickup worksheet (6 never-alerted first); (2) Codex tests preview →
James approves promotion; (3) James supplies GSC/Bing exports, WhatsApp daily
counts, Cloudflare audit log → Claude re-runs comparable-period analysis.
PR #55 HOLD; Momi minibus HOLD; no pricing change; no production change
authorized by this checkpoint.

---

## ✅ CHECKPOINT 2026-09-20 (Sun ~23:15 AEST) — handover reply to Codex

Full evidence, inventory tables and query definitions:
[Issue #59 reply, comment 5750052282](https://github.com/jamesdeorajan-sys/fiji-platform/issues/59#issuecomment-5750052282)
(answers Codex's request, comment 5749879692). Coordination only — **no
new production authorization**; nothing was deployed, configured or
submitted to produce it. Status labels are AUTHOR-VERIFIED (Claude only)
unless stated; **nothing below is INDEPENDENTLY-VERIFIED yet.**

**Provenance:** the Vanuatu build (2026-09-18) was done by other Claude
sessions; those items come from git history + memory notes + read-only
checks on 2026-09-20. No repo/memory/Cloudflare activity is observable
after Fri 18 Sep 18:19 AEST.

**Live now (Nadi)**
- Pages `nadiairporttransfers` production **`9af4d251-8696-40e8-8a23-cf6813283788`**
  (2026-09-17T17:23:38Z), source `31a27fb` on
  `ceo/nadi-live-integration-20260917` (`main` does **not** contain the
  site). Release ledger: `feaccc19` (`31287e2`, 08:34Z) → `2b614400`
  (`340de4c`, 09:04Z) → `7eed1fe4` (`a5720e5`, 09:45Z) → `9af4d251`
  (`31a27fb`, 17:23Z). Live == `31a27fb` for 25/25 HTML files after
  stripping Cloudflare-injected snippets; `app.js`, `route-handoff.js`,
  `styles.css`, `sitemap.xml` byte-identical.
- Rollback that keeps fixes 1–3: `7eed1fe4-5ad0-48ee-8994-1fa7377e081b`.
  Pre-change baseline `a3b71cba-…` (2026-09-16T07:35Z) — **do not use as
  today's baseline.** No rollback recommended.
- `nadi-dispatch-api` latest version `80de8469-0fb6-4784-8b66-c199bd5ef7f2`
  (2026-09-06) and `nadi-marketplace-db` **unchanged** in the window.
- Vanuatu: Pages `portvilaairporttransfers` prod `e1537d5f` (2026-09-18T08:18Z),
  Worker `vanuatu-dispatch-api` `107168b5-…` (2026-09-18T04:04Z), D1
  `vanuatu-marketplace-db` `6a1024bc-…`. 39/39 sitemap URLs 200 with
  distinct titles. **Branch `ceo/vanuatu-minimal-backend` is local-only.**

**Still failing / open (author-verified)**
1. **Quote overwrite, traced from the deployed Worker, not fixed:** if the
   guest's quote is <0.8× or >1.3× the server zone-formula price, the
   Worker replaces it (`[pricing-drift]`). Reproduces #143 exactly
   (`5.57 + 3.592×6.844 = 30.15`, zone `Nadi`). Offline scope: 6 of 105
   one-way cells (Nadi Town sedan, Tanoa/Tokatoka ×3, Mercure/Tradewinds
   sedan, Momi minibus). Return/night/extras/FijiDash not computed.
   Decision needed from James: fare authority; Momi minibus fare still
   undecided.
2. **`/transfer/outrigger-fiji-beach-resort` now serves the homepage**
   (only deployment `3c071f54` ever contained it). Any unknown
   `/transfer/<slug>` (Nadi and Vanuatu) returns 200 + homepage.
3. **Privacy #44:** 10 customer-confirmation URLs listed in
   fijitourtransfers.com sitemaps (was 6), 200, `index,follow`. No CMS
   owner identified.
4. **Vanuatu:** unreviewed independently; client-trusted `quoted_amount`;
   VUV price sign-off not recorded; rows 12–13 in its D1 look non-test
   (likely James).
5. Deployed Nadi Worker has **no** `admin_notification_state` /
   `attemptAdminNotification` (static read); alerts are direct sends with
   no durable state. **[CORRECTED 2026-09-21: outcomes ARE logged in `booking_events` (sent/failed/skipped); only the retry-state table is absent.]** PR #55 still OPEN/draft, unchanged, HOLD.

**Narrowed claim:** "booking-decline premise false" (below, 2026-09-18) is
**not supportable per site.** `FTT-` refs only begin 2026-09-07 12:19 UTC
(id 69); before that the DB cannot show on-site Nadi requests, so no
10+/day baseline is testable. Non-test on-site (`FTT-`) requests per Fiji
day 8→20 Sep: 5, 9, 6, 1, 2, 4, 5, 4, 2, 0, 5, 3, 0 (avg 6.7 on 8–10 Sep vs
2.6 on 11–20 Sep). Snapshot reconciliation: 137 rows/105 Sept/73 non-test
(FJD 9,740.98 quoted, 2026-09-17) → 150/118/86 (FJD 12,082.93 quoted,
2026-09-20 13:00 UTC). Quoted ≠ collected. Traffic/conversion unknown.

**Top three next actions** (owners, acceptance tests, James's decisions:
see the #59 comment): (1) pricing-overwrite decision + non-production fix
design; (2) restore/decide the Outrigger alias and stop homepage-fallback
soft-404s (title+byte checks, not status-only); (3) back up and
independently review Vanuatu (secret-scan, then push only with James's OK).

**Housekeeping flagged:** untracked `reports/september-intake-2026-09-18.csv`
contains real guest PII — keep out of git; move out of the repo tree.
Verification-quality note: earlier "outrigger still fine" checks were
HTTP-status-only, which cannot catch Pages' 200 homepage fallback.

---

## 🔴 LIVE DEPLOYMENT, 2026-09-17 — read this first

**Claude deployed the Nadi live-integration candidate (finding #7 below) to
production on nadiairporttransfers.com**, authorized directly by James given
the ongoing revenue-critical booking decline and Codex's unavailability
until Saturday (usage limit). This is a real production change, not a
preview. Full detail:

- **What shipped:** branch `ceo/nadi-live-integration-20260917`, commit
  `31287e2`. All 18 files byte-identical to Codex's independently-verified
  candidate (`nadi-homepage-recovery-PREVIEW-18-files-20260917.zip`, sha256
  `97821ca8...0a976c7dc`). Fixes: vehicle-selection Continue-button guard
  removed (`goToStep(2)` no longer requires a preselected vehicle — the
  suspected core booking-decline cause since Sept 4), `validateBookingContact()`
  / `validateArrivalFlight()` added, PR #56's shared `route-handoff.js`
  CTA-builder fix correctly layered onto its 5 target route pages, all
  live/forensics-matching content preserved on the other 6.
- **Verification before deploy:** 71/71 tests independently re-run against
  the assembled deployment tree (not just the standalone zip); JS
  syntax-checked (`node --check`); deployed to an isolated preview branch
  first (`ceo-review-20260917` → `https://ceo-review-20260917.fttlandingpage.pages.dev`)
  and curl-verified (homepage, app.js, all 11 transfer pages, route-handoff.js
  all HTTP 200) before touching the production branch.
- **Cutover:** `wrangler pages deploy nadi-airport-transfers-site/src
  --project-name=nadiairporttransfers --branch=main`. New production
  deployment `feaccc19`. Post-deploy verification on the real domain: all
  of the above re-checked directly on `nadiairporttransfers.com`, all
  HTTP 200, cache-bust version correctly bumped to
  `app.js?v=20260917-priority-recovery` (avoids the recurring
  cache-busting bug class documented below).
- **Rollback target if anything looks wrong:** production deployment
  `a3b71cba-43af-49b1-b852-31f8f9b67627` (the one live immediately before
  this change, confirmed as the prior production deployment via `wrangler
  pages deployment list` before cutover). Rollback via Cloudflare
  dashboard → Pages → nadiairporttransfers → Deployments → that ID →
  "Rollback to this deployment", or `wrangler pages deploy
  nadi-airport-transfers-site/src --project-name=nadiairporttransfers
  --branch=main` from a checkout of the pre-this-change tree.
- **What did NOT change:** backend, Worker, D1 schema, fares. No test
  booking was submitted at deploy time (would have hit the real
  production `/bookings` endpoint and created a real row) — initial
  verification was structural (HTTP status, JS syntax, presence of
  expected functions).
- **UPDATE, same day, later:** a working browser tool became available
  in Claude's environment mid-session (unclear if this persists to future
  sessions — check before assuming it's there). Claude then did a REAL
  browser click-through on production: filled pickup/destination, clicked
  "Continue to vehicle selection" → vehicle step opened correctly,
  selected a vehicle → Continue enabled, forced `state.selectedVehicle`
  back to null and confirmed `goToStep(3)` still correctly blocks with
  "Please select a vehicle" (the safety net moved location but is intact),
  filled an invalid email → correctly rejected, fixed it → reached the
  confirmation screen with correct summary (name/contact/route/vehicle/
  price all rendering right). Repeated the vehicle-selection check at
  mobile viewport (375×812) — same result. Zero console errors throughout.
  Did NOT click the final "Confirm booking" button (would create a real
  DB row + real WhatsApp alert). **This closes most of the "real human
  click-through" gap** — Codex's independent browser verification is
  still valuable (fresh eyes, possibly different scenarios) but is no
  longer the only browser-side check that's been done.
- **Separate finding, pre-existing, NOT caused by this deploy:** at least
  2 transfer pages Google has indexed (`/transfer/first-landing-beach-
  resort`, `/transfer/westin-denarau-island-resort`) aren't among the 11
  pages with real content — they silently fall back to serving the
  homepage (Cloudflare Pages SPA-fallback, confirmed present on the PRIOR
  production deployment `a3b71cba` too, so today's deploy didn't cause
  it). Both prices already exist in the homepage's pricing table; these
  could be built as real pages using the same template as the other 11.
  Flagged to James, not yet actioned — bigger scope than a "correction."
- **SECOND live deploy, same day (commit `340de4c`):** site had NO
  favicon at all — `/favicon.ico` was silently falling back to the
  homepage HTML via the same SPA-fallback behavior (82,559 bytes, same as
  homepage). Also no `og:image`/`twitter:image` anywhere, which is why
  Google was showing an unrelated photo (a zipline tour image) as the
  search-result thumbnail instead of real branding — James showed a
  screenshot of this. Generated a proper favicon (simple car icon on the
  site's own `--ocean:#0066cc` brand color, multi-size `.ico` + PNGs +
  apple-touch-icon via Python/Pillow, no external asset needed), wired
  `<link rel="icon">` etc. into `index.html` and all 11 transfer pages,
  added `og:image`/`twitter:image` (using the icon as an interim image),
  fixed a missing `<link rel="canonical">` on the homepage (transfer
  pages already had it). 71/71 tests still pass, HTML verified
  well-formed, same preview-first-then-production process as the first
  deploy, verified live after cutover. **James is providing a dedicated
  branded graphic to replace the interim `og:image`/`twitter:image` —
  not yet done, waiting on the file.**
- **THIRD live deploy, same day (commit `a5720e5`):** real numbers test
  (raw `curl -A GPTBot` fetch vs. real-browser-rendered text) found the
  34-route pricing table, all 16 tour listings, and all 6 customer
  reviews were 100% JavaScript-rendered — invisible to any AI crawler
  that doesn't execute JS (GPTBot/ClaudeBot/PerplexityBot/CCBot all fetch
  raw HTML only). Before: raw HTML text 11,651 chars vs. 20,086 rendered
  (58% visible), 0 of 35 "Book →" pricing links visible, tours/reviews
  entirely absent. Fix: extracted `ROUTES_DATA`/`TOURS_DATA`/
  `REVIEWS_DATA`/`FAQ_DATA` from `app.js` via an isolated Node `vm`
  context, replicated `buildRoutesTable()`/`buildToursGrid()`/
  `buildReviews()`/`buildFAQ()`'s exact template output, seeded it into
  index.html's previously-empty containers. Zero behavior change for
  real visitors — `app.js`'s existing `DOMContentLoaded` handler still
  calls all 4 build functions and overwrites the seed via `innerHTML`
  exactly as before (verified live: DOM counts stayed 35/16/6/11, no
  duplication, "Book →" click still correctly pre-fills the booking
  form). Also expanded `FAQPage` JSON-LD from 4 to all 11 real FAQ
  entries (previously 4 paraphrased duplicates). After: raw HTML text
  23,475 chars, all 35 pricing links present, tours/reviews present.
  71/71 tests pass (app.js untouched). Same preview-first process,
  verified live on nadiairporttransfers.com after cutover.
- **FOURTH live deploy, 2026-09-18 (commit `31a27fb`):** James connected
  Bing Webmaster Tools (imported from an already-verified GSC property)
  and pulled the "AI Performance" report — real Microsoft Copilot
  citation data, 750 citations over 2 months across 22 pages. Cross-
  checked all 22 against live site: **13 of 21 cited transfer pages
  (142 of 750 citations) were soft-404ing to the homepage** — AI search
  is already recommending these exact URLs and visitors get the wrong
  content. (1 additional cited page, `outrigger-fiji-beach-resort`, 20
  citations, already works via a mechanism outside this repo's source
  tree — not touched. **[SUPERSEDED 2026-09-20: it now serves the
  homepage fallback; only deployment `3c071f54` ever contained the real
  page — see CHECKPOINT above.]**) Built real pages for all 13 using the same
  template/JSON-LD/favicon pattern as the 11 existing pages, pricing
  pulled directly from `app.js`'s `ROUTES_DATA` (same source of truth,
  nothing invented). Added all 13 to `sitemap.xml` (11 → 24 transfer
  URLs). 71/71 tests pass, all 25 HTML files + sitemap XML verified
  well-formed, preview-first then production, full regression check
  (all 24 prior pages + homepage + booking flow) confirmed clean after
  cutover.
  **Found while building, not fixed:** `ROUTES_DATA`'s `MARRIOTT_MOMI`
  row has `m:79` (minibus) priced BELOW both sedan (`s:99`) and minivan
  (`v:149`) — almost certainly a typo (missing digit, e.g. should be
  179) in the pre-existing source data, not something introduced today.
  Reproduced faithfully on the new page rather than silently "corrected"
  — needs James to confirm the real minibus price for Momi Bay before
  anyone changes it.
- **Codex — please independently verify all four deploys on your return**
  (browser click-through still valuable even though Claude did one too —
  fresh eyes, different scenarios, different environment). Flag anything
  wrong here or in a new Issue #59 comment; James can execute rollback via
  the dashboard/wrangler command above immediately if needed.

---

**Codex answered Issue #59 on 2026-09-17** (relayed by James — the collaborator
signs as "Codex," not "Astra"; correcting the name used above and in prior
entries). Full reply posted as a comment on the issue. Key agreed points:
repo read + push/admin access confirmed, Node test execution confirmed, live
browser verification confirmed available (Claude currently has no working
browser tool in this environment — Claude in Chrome reports "not connected"
and there is no dev-preview tool available either — this is a real,
disclosed capability gap between the two agents, not an oversight). **[UPDATED 2026-09-17/20: a working Browser pane became available to Claude mid-session and was used for the live checks recorded below; availability in future sessions is not guaranteed.]**

**Status vocabulary (adopted 2026-09-17, proposed by Codex):** replace plain
Confirmed/Disputed with:
- **AUTHOR-VERIFIED** — checked only by the agent that found/fixed it.
- **INDEPENDENTLY-VERIFIED** — checked by a *different* agent than the
  finder, against real evidence (exact commit/revision, environment,
  timestamp recorded).
- **DISPUTED** — a different agent checked and got a different result.
- **BLOCKED** — cannot be verified in the current environment (e.g. no
  browser access), stated explicitly rather than left silent.

An entry where finder and verifier are the same person/agent is
AUTHOR-VERIFIED only, never INDEPENDENTLY-VERIFIED, under this standard.
Some entries below are being relabeled retroactively to reflect this.

---

## Current verified live state

### nadiairporttransfers.com
- **Last verified:** 2026-09-17, by Claude, via direct live fetch + byte
  diff of `app.js` against git history (not inferred from commit messages).
- **Served cache-bust versions:** `app.js?v=20260909a-return-trip`,
  `chat-widget.js?v=20260908a`, `styles.css?v=20260908a`.
- **Actual deployed content is NEWER than the version string implies.**
  Live `app.js` contains the full 2026-09-13 P0 booking-integrity fix set
  (`confirmBookingInFlight` double-submit guard, stable idempotency ref via
  `buildBookingIntentFingerprint()`, honest `SAVE_FAILED` state,
  `escapeHtml()`/`appendConfirmRow()` XSS fix) even though the cache-bust
  string was never bumped past the 2026-09-09 return-trip release. See
  Recurring Bug Classes — this is the same bug class, third occurrence.
- **UPDATE 2026-09-17, later same day:** superseded by the LIVE DEPLOYMENT
  section at the top of this file. The vehicle-selection/contact-validation
  fix and PR #56's route-handoff fix are now BOTH live, via the integration
  candidate (finding #7), not via PR #56 or PR #57 directly. PR #56/#57 as
  standalone branches should be considered superseded, not pending merge.
- ~~**NOT yet live:** the 2026-09-15/16 P0 route-handoff repair (PR #56,
  branch `ceo/p0-nadi-route-handoff-astra-reviewed`) and the 2026-09-16
  guest-flow/vehicle-selection fix (PR #57, branch
  `codex/nadi-guest-flow-repair-20260916`).~~ Both are unit-tested; Codex has
  since live-browser-tested the current homepage (see Open Findings #5) —
  vehicle-selection deep-link path from PR #57 still needs its own browser
  check.
- **Correction, 2026-09-17 (Claude):** the "stale cached bytes for
  returning visitors" risk stated in Recurring Bug Classes below is weaker
  than originally implied. Live `app.js` response headers:
  `Cache-Control: public, max-age=14400, must-revalidate`,
  `ETag: W/"8ddb6b4a378b11a404788a832bb13c9d"`, `cf-cache-status:
  REVALIDATED`. `max-age=14400` = 4 hours, and `must-revalidate` forces a
  conditional (ETag) re-check with origin after that — so any browser that
  cached the pre-fix file would have auto-revalidated and picked up the
  2026-09-13 fix within at most ~4 hours of it shipping, not indefinitely.
  The real risk window was ~4 hours post-deploy, not ongoing. Raised
  because Codex challenged this claim and asked for header evidence
  directly (Issue #59) — this is that evidence, and it only partially
  supports the original claim.
- **Separate regression, now fixed — blank `/transfer/*` route pages
  (Claude, forensics 2026-09-17):** all 10 CEO-flagged `/transfer/*` pages
  (Hilton, Natadola, Coral Coast, Shangri-La, Naviti, Pacific Harbour,
  Pearl South Pacific, Suva, DoubleTree, Port Denarau) went blank in one
  Cloudflare Pages deployment step (`257e5b83` GOOD → `3c071f54` BLANK),
  `app.js`/`styles.css`/`chat-widget.js` untouched — see full report on
  branch `ceo/nadi-master-source-recovery`,
  `nadi-source-recovery/forensics/FORENSICS-REPORT.md`. **All 10 routes are
  live and healthy again as of 2026-09-17** (HTTP 200, real byte counts,
  re-verified today). Three candidate fix mechanisms exist and were NOT
  reconciled against each other before this entry — see Open Findings #6.
  Two previously local-only branches with real forensic value have been
  pushed to `origin` for safekeeping: `ceo/nadi-master-source-recovery`
  and `ceo/nadi-p0-route-emergency-containment`.
- **Source-of-truth warning:** `nadi-airport-transfers-site/` (this site's
  actual source tree) does not exist on `main` at all — it only exists on
  scattered feature/P0 branches. Do not assume `main` reflects what's live
  for this property until Issue #41 is actually resolved.

### Other properties
- Not independently re-verified as part of this entry — see Issue #16
  (bookfijitours.com.au source unknown as of 2026-08-16) and Issue #39.
  **Issue #39 correction (Claude, 2026-09-17):** prior wording here said
  "owner access/rollback path unconfirmed" — imprecise. Exact final
  comment on Issue #39: ownership, custom domains, owner settings,
  environment-variable capability, and authenticated `/ops` access are ALL
  confirmed. Only rollback/version-restore is unconfirmed (the Sites editor
  overflow menu exposes only Settings/Analytics, no visible
  history/restore control). Governance in effect: do not edit/publish
  Book Fiji Transfers until a safe rollback procedure is demonstrated;
  treat current live Site as protected production. Credit: Codex's Issue
  #59 reply caught this imprecision.

---

## Open findings

| # | Found by | Claim | Status | Verified by | Verification method |
|---|---|---|---|---|---|
| 1 | Claude (2026-09-17) | Live `app.js` circular dependency: entering vehicle-selection step requires a vehicle already selected (`goToStep(2)` guard), with no path to select one if a deep-link skips step 1 | INDEPENDENTLY-VERIFIED | Codex (live browser, homepage path only) | Codex live-tested nadiairporttransfers.com homepage: Hilton selection left Continue disabled; clicking the Sedan card enabled it and opened vehicle selection. Friction confirmed, but homepage path not fully blocked. Deep-link-skips-step-1 case (the original claim) is still traced-code-only, not yet independently browser-tested — remains partially open. |
| 2 | Codex/Astra (PR #57, 2026-09-16) | "68 tests passed" | RESOLVED (explained, not a defect) | Codex | Codex confirmed 68 = combined local workspace count = PR #57's 49 + PR #56's 19 route tests. Standalone PR #57 commit genuinely has 49/49 passing (Claude, AUTHOR-VERIFIED at the time, now corroborated by Codex's explanation). Open question: has the actual COMBINED PR56+57 candidate ever been run as one integrated test suite? Not yet — see #6. |
| 3 | Astra (PR #56, 2026-09-15) | "59 tests; 59 pass; 0 fail" | AUTHOR-VERIFIED (Claude only so far) | Claude | Ran the actual suite in an isolated worktree at PR #56's head commit `ae03a34`: 59/59 pass, matches claim exactly. Needs a second agent to independently re-run before this counts as INDEPENDENTLY-VERIFIED under the stricter standard. |
| 4 | Claude (2026-09-17) | The 2026-09-13 P0 booking-integrity fix is live in production despite the cache-bust version string not being bumped | AUTHOR-VERIFIED (Claude only) | Claude | Direct byte diff of live `app.js` vs. git commit `6590a16` (the last commit that *did* bump the version) — live file contains strictly more content, matching the 2026-09-13 commits' actual diffs. Staleness-risk severity corrected above (4hr window, not indefinite) after Codex's challenge. |
| 5 | Codex (2026-09-17, live browser) | Homepage vehicle-card click path works around the Continue-button friction; full blocked-path claim not confirmed | AUTHOR-VERIFIED (Codex only) | — | Codex's own live-browser test, described in Issue #59 reply. Claude cannot independently verify — no working browser tool in this environment (Claude in Chrome: "not connected"; no preview/dev-browser tool available either). Logged as BLOCKED for Claude-side verification, not disputed. |
| 6 | Claude (2026-09-17) | Three distinct, unreconciled candidate fixes exist for the blank-`/transfer/*`-pages regression, and the one that's ACTUALLY live is not PR #56 | INDEPENDENTLY-VERIFIED (self-corrected after Codex challenge) | Claude, re-scoped after Codex's objection | (a) `ceo/nadi-master-source-recovery` — forensics-recovered last-known-good static HTML. Diffed against current LIVE `hilton-fiji-beach-resort` page: only 4 diff lines (harmless duplicated analytics snippet) — **this is what's actually live.** (b) PR #56 — Codex correctly objected that Hilton is not among PR #56's 7 changed files, so that comparison measured baseline divergence, not a PR #56-caused regression. Re-checked against PR #56's actual 5 changed route pages only (`coral-coast-outrigger`, `natadola-intercontinental`, `pacific-harbour`, `port-denarau`, `suva`): each still 294-316 diff lines against its own live page (~300 total lines each) — same conclusion holds on the correctly-scoped file set: PR #56's own changed pages are NOT what's live. (c) `ceo/nadi-p0-route-emergency-containment` — homepage-only reroute workaround, never touches `/transfer/*` files, not live either. **Implication unchanged: merging PR #56 as-is would replace currently-live content with an untested rewrite for the 5 pages it touches.** Superseded in practice by finding #7 — Codex has since produced a 4th candidate built ON TOP of the live baseline. |
| 7 | Codex (2026-09-17) | New Nadi candidate `nadi-homepage-recovery-PREVIEW-18-files-20260917.zip` (sha256 `9782...976c7dc`) is a small, correctly-based patch — not a repeat of PR #56/#57's divergent rewrite | INDEPENDENTLY-VERIFIED | Claude | Hash matches Codex's stated value exactly. Extracted and diffed `app.js`/`index.html` against 4 references: vs. current LIVE app.js = 203 diff lines (small, targeted); vs. forensics-recovered app.js = same 203 lines (confirms live≈forensics, consistent with #6); vs. PR #56 app.js = 2304 diff lines; vs. PR #57 app.js = 2304 diff lines. **Conclusion: this candidate is patched on top of the live/forensics baseline, not PR #56/#57's branch** — it is the correct integration candidate, and PR #56/#57 as branches are likely superseded by it. Candidate adds `validateBookingContact()`/`validateArrivalFlight()` (confirmed absent in both live and forensics app.js, confirmed present in candidate) — this is a different implementation of the same vehicle-selection/contact-validation fix PR #57 attempted. `manifest.json`'s stated `baseline_commit: 17b98cb1120789d7f670e2e0c9e35c080801b404` does **not exist anywhere in this repo** (checked via `git cat-file`, `git rev-list --all`, and a fetch of all 96 remote branches) — Codex, please confirm whether this commit exists only in your local environment (uncommitted/unpushed), same situation my two forensic branches were in before I pushed them. |
| 8 | Codex (2026-09-17) | `NADI_API_BASE` is hardcoded to `https://api.nadiairporttransfers.com` in the candidate, so any preview build is capable of calling production | INDEPENDENTLY-VERIFIED | Claude | Confirmed: `NADI_API_BASE = 'https://api.nadiairporttransfers.com'` present in both the candidate app.js AND the current live app.js — this is pre-existing production wiring, not something the candidate newly introduces. Real implication stands regardless: any preview deployment of this candidate needs the final-submit path (`/bookings`, `/escalate`) mocked or pointed at a non-production endpoint before browser-testing "Confirm booking," or a click-through test would create a real production booking row. |
| 9 | Claude (2026-09-17) | PR #55's evidence (8 original tests + 2 new tests incl. the stale-ATTEMPTING characterization) is reproducible independently, not just described | INDEPENDENTLY-VERIFIED | Claude | Isolated worktree at PR #55 head `8020996`. Ran `admin_notification_retry.test.mjs` unpatched: 8/8 pass, matches claim. Applied `review-evidence/pr55/recovery-tests.patch` (needed a trailing-newline fix to apply cleanly — trivial EOF mismatch, not a content issue) and re-ran: 10/10 pass, including `known gap characterization: stale ATTEMPTING stays stranded even on same-ref replay` — this test PASSING confirms the defect still exists, exactly as Codex/the brief described. PR #55 remains HOLD, untouched beyond this read-only worktree verification (removed after). |
| 10 | Claude (2026-09-17) | Issue #44 (public customer-PII confirmation pages on fijitourtransfers.com) containment is NOT complete as of today, contrary to no-longer-current assumptions | OBSERVED LIVE | Claude | Read-only check, no PII reproduced: `robots.txt` on fijitourtransfers.com is fully open (`Allow: /` for all agents incl. AI crawlers). `st_tours-sitemap1.xml` (lastmod 2026-09-15) still lists 6 URLs matching the `/tours/private-*confirmation*` pattern **[UPDATED 2026-09-20: now 10 such URLs listed in sitemaps; still 200, `index,follow`]** from the issue. Spot-checked one: HTTP 200, `<meta name="robots" content="follow, index, ...">` — explicitly indexable, not noindexed. This is the current live state, not historical — Issue #44 should not be treated as resolved. |

---

## Recurring bug classes

**Cache-busting version not bumped on deploy — 3rd occurrence.**
1. Caught before deploying `aba2d1a` (return-trip fields) — would have shipped under the same `?v=20260908a` URL already cached by real visitors from the prior release. Fixed pre-emptively by commit `6590a16` (2026-09-09).
2. Referenced in `6590a16`'s own commit message as "the same class of bug already found and fixed twice this engagement" (prior two instances not individually logged here — predate this file).
3. **2026-09-13 P0 fix deployed without a version bump at all** (this entry). Confirmed live content is newer than the served version string claims. **Correction, 2026-09-17:** given `max-age=14400, must-revalidate` on the live response, any visitor whose browser cached `app.js` before 2026-09-13 would have auto-revalidated (ETag conditional GET) and picked up the fix within ~4 hours — not "may still be running the pre-fix code today." The version-string discipline is still real and worth fixing (it makes deploys hard to audit), but the "stale bytes for returning visitors" risk as originally worded overstated the actual exposure window.

**Standing instruction for any agent touching this site's `app.js`, `chat-widget.js`, or `styles.css`:** any content change to these files requires a cache-bust version bump in the same commit/deploy. Verify the served version string actually changed post-deploy — do not assume a deploy step handles this automatically, it has not so far.

---

## Decisions made (CEO/James sign-off record)

- **2026-09-17:** James authorized building this cross-agent sync system
  (this file + a structured review-and-verify prompt workflow) after a
  live investigation into nadiairporttransfers.com's booking decline
  surfaced repeated instances of unverified claims and lost/stalled fixes
  across agents. Manual relay (James pastes between tools) is the current
  mechanism — no direct agent-to-agent link exists.
- ~~**Still open, not yet decided:** whether to deploy PR #56 + PR #57 to an
  isolated preview for a real human click-through before cutover, or hold
  for further automated verification.~~ **RESOLVED 2026-09-17:** James
  explicitly authorized Claude to make live production corrections directly
  ("confidently make live correction as we cannot wait... this is your
  call... i just want bookings to start flowing"), given the ongoing
  revenue-critical decline and Codex's unavailability until Saturday. See
  the LIVE DEPLOYMENT section at the top of this file for exactly what
  shipped, the verification done, and the rollback target. Standing rule
  for any FUTURE production change (backend/Worker/D1, or anything beyond
  this specific frontend candidate) still applies: record the decision
  here before deploying, preview first when a browser/verification path
  allows it.

---

## 🔴 CRITICAL CORRECTION, 2026-09-18 — the "booking decline" premise was wrong

> **[NARROWED 2026-09-20 by Claude — read the CHECKPOINT at the top.]** The
> "pending/unassigned ≠ unfulfilled" part stands (owner-confirmed). The
> claim that intake did not decline is **not supportable per site**: the
> daily series below was UTC-day, all storefronts, tests included, and
> `FTT-` on-site refs only exist from 2026-09-07, so no earlier baseline
> is testable from this DB. Peak-day figures below are not per-site
> conversion evidence. History is preserved unchanged beneath.

**The entire premise driving today's session — "bookings not coming in,
nose dive since Sept 4, business gone silent" — is NOT supported by the
actual production data.** This needs to be read by anyone picking up
this file before assuming the earlier framing is still accurate.

**What the data actually shows** (queried directly from `nadi-marketplace-db`,
the real production D1 database, 2026-09-18):
- Full booking history: 137 rows total, `MIN(created_at)` 2026-07-24,
  `MAX(created_at)` 2026-09-17.
- Daily volume has NOT declined — several of the highest-volume days in
  the entire history are in the second half of September: Sep 6 (12),
  Sep 9 (13), Sep 10 (9), **Sep 13 (14, the all-time peak)**, Sep 16 (12).
- Last real (non-test) nadiairporttransfers.com guest booking: **Victoria
  Tiffen, id 135, ref FTT-3YX2QY, 2026-09-16 10:38:49**, real NZ phone,
  Nadi Airport → Denarau, FJ$76.

**What looked broken but wasn't:** every booking from id 100 onward
(~Sept 9 onward) shows `status: pending`, `assigned_driver_id: NULL` in
the database — Claude initially read this as a complete fulfillment
failure (guests booking, nobody assigning drivers). **James confirmed
directly this is a false signal: the ground team serves guests live via
a WhatsApp group chat, entirely outside the admin dashboard/status
fields.** The Victoria Tiffen alert (#135) was shown forwarded into a
"Bula Victoria" WhatsApp group with a real team member tagged, same day
it was created. **The admin dashboard's `status`/`assigned_driver_id`
columns do not reflect real-world fulfillment for this business** — do
not use "N pending/unassigned in the DB" as evidence of a fulfillment
problem without checking with James first. This exact false-positive
already happened once in this file's history (the Priority Recovery
brief's "131 pending/unassigned, 26 escalations" framing) — it is the
same underlying misread, not independent confirmation of a real problem.

**Two genuinely real, separate, smaller findings from the same
investigation, still open:**
1. **Short-distance pricing mismatch.** Live-tested two real bookings
   today: #143 (Tanoa International, 0.8km real distance, quoted FJ$15,
   backend recorded/alerted **FJD 30.15** — mismatch) vs. #144 (Hilton
   Denarau, 10km, quoted FJ$49, alerted FJD 49 — exact match). Confirmed
   NOT site-wide via this A/B test. Likely a minimum-fare/base-fee floor
   in the backend's distance-based "authoritative" pricing overriding
   the published-table quote on very short trips. Root cause not fully
   traced (would need the actual live Worker source, not a possibly-
   stale branch). Real money risk if a driver charges the alerted amount
   against what the guest actually agreed to.
2. **`admin_notification_state` table does not exist in production**
   (`nadi-marketplace-db`) — confirmed via direct query
   (`SQLITE_ERROR: no such table`). The entire durable notification-
   retry system PR #55 built and tested was never actually deployed.
   The live Worker is sending notifications via some simpler, undurable
   path (WhatsApp alerts for bookings #143/#144 arrived within 2 seconds
   today, so basic sending works) with no tracking of delivery success
   or retry-on-failure. Given real fulfillment happens over WhatsApp
   group chat per the correction above, this may matter less than
   originally assumed — but it's still a real gap if a send ever fails
   silently with no record and no retry.

**How to apply:** today's actual site-layer fixes (vehicle-selection
bug, blank `/transfer/*` pages, JS-invisible pricing/tours/reviews
content, missing favicon/metadata, 13 new AI-cited-but-broken pages) were
real and are independently verifiable via the live site regardless of
this correction. What's corrected here is only the *motivating narrative*
("business is dying, bookings stopped") — treat that framing as false
going forward, and treat the two findings above as bounded, specific,
real issues, not symptoms of a broader collapse.

**September revenue snapshot (2026-09-18, Claude, queried directly from
`nadi-marketplace-db`):** 73 real (non-test) bookings, Sept 1–18 to date,
total **FJD $9,740.98 quoted** — nadiairporttransfers.com 38 bookings /
$5,213.00, fijidash 31 bookings / $3,826.85, 4 unclear-site / $701.13.
This is *quoted* amount at booking time, not confirmed *collected*
revenue — payment is cash/card/bank transfer on arrival, and per the
correction above the `status` field doesn't reliably reflect real
fulfillment, so this cannot be read as "revenue collected." Full 105-row
CSV (Sept 1–18, all bookings incl. test rows flagged) generated and
given directly to James, not committed to this repo (contains real
guest names/phone numbers).
**Specific overdue-looking bookings James confirmed were NOT actually
missed** (initially flagged as a live concern, now resolved): Khemarint
Son, Tyler Sanderson, Jacinta Takchi, Sergi Arévalo, Maddy Green — all
served via the WhatsApp ground-team workflow, not a genuine fulfillment
failure. Three additional rows initially flagged as possibly-real
(guest names "Ji Jjk" / "James I'm" / "Juh Jjj", all sharing phone
`0478302777`) are confirmed by James to be his own test bookings.
