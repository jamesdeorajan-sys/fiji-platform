# Outrigger redirect/404 patch — release candidate and rollback (for James's SEPARATE production decision)

Prepared 2026-09-21. **Nothing here has been executed. No production approval exists.**

## Candidate
- Branch `ceo/nadi-outrigger-softfix-preview`, commit `9ddd923b57f143b2ae44fdc6a4baf44a6cda03de`, base `31a27fb` (= current production source).
- Diff vs base: three added files only — `nadi-airport-transfers-site/src/_redirects`, `src/404.html`, `test/soft-404.test.js`. No change to `index.html`, `app.js`, `styles.css`, `chat-widget.js`, any route page, the sitemap or the Worker.
- Behaviour: `/transfer/outrigger-fiji-beach-resort` → 301 → `/transfer/coral-coast-outrigger`; `/transfer` and `/transfer/` → 301 → `/`; every other unmatched path returns a real 404 (noindex page) instead of the homepage.

## Verification state
| Check | State |
|---|---|
| 76/76 tests at `9ddd923` | INDEPENDENTLY-VERIFIED (Codex) |
| Alias 301, real content, canonical, route-preserving CTA, Hilton deep link, unknown slug/`/nope`/`/transfer/app.js` 404 + noindex, no desktop overflow | INDEPENDENTLY-VERIFIED (Codex) |
| Real phone (iPhone 15 Pro, iOS 26.6.2): Outrigger handoff, Hilton prefill | INDEPENDENTLY-VERIFIED (James) |
| 375×812 emulation | AUTHOR-VERIFIED |
| Preview content == candidate tree | AUTHOR-VERIFIED 2026-09-21: 37 of 37 served files identical to the `9ddd923` tree after stripping only Cloudflare's analytics beacon; `_redirects`/`404.html` verified by behaviour |
| **Open:** unknown-route screen on the real phone; sideways-scroll confirmation; browser identity | PENDING (James) |

**Provenance (kept as documented; parity is AUTHOR-VERIFIED until independently checked).** Preview deployment `77ef3ba6…` shows source label `61d2393` and branch `ceo-outrigger-softfix-preview-20260921` in Cloudflare because it was uploaded from a different git working directory. Content parity with `9ddd923` is verified above; the label is cosmetic but the production deploy must use the exact commit (below). Cloudflare Pages cannot promote a preview, so production is a fresh upload of the same tree.

## Production step (do not run until James approves)
From a clean checkout of `9ddd923` (with `CLOUDFLARE_API_TOKEN` unset so OAuth is used):
```
npx wrangler pages deploy nadi-airport-transfers-site/src --project-name nadiairporttransfers --branch main --commit-hash 9ddd923b57f143b2ae44fdc6a4baf44a6cda03de --commit-message "Outrigger 301 + real 404"
```

## Rollback (single step, seconds)
Current production: deployment `9af4d251-8696-40e8-8a23-cf6813283788` (source `31a27fb`, 2026-09-17). Roll back by "Rollback to this deployment" on that deployment in the Cloudflare Pages dashboard, or `POST /accounts/595101df2c562b3c65595420d43f9fe1/pages/projects/nadiairporttransfers/deployments/9af4d251-8696-40e8-8a23-cf6813283788/rollback`. Rolling back restores the homepage-fallback behaviour (alias/unknown paths → homepage 200) and nothing else.

## Post-deploy acceptance (revised; not "zero /transfer/app.js")
1. `HEAD/GET` alias → 301 to `/transfer/coral-coast-outrigger`; that page 200 with its own canonical.
2. 25/25 sitemap pages 200 with distinct titles; unknown path 404 + noindex.
3. Fresh journeys (homepage, deep link `?pickup=NAN&dest=HILTON_DENARAU`, a route page, alias) load `styles.css`/`app.js`/`chat-widget.js` with 2xx and correct content-types; booking widget renders.
4. Residual requests for `/transfer/app.js|styles.css|chat-widget.js` are tracked separately as residual errors, not required to be zero.
5. Within 24 h: the alias's daily request count and status mix (`outrigger_alias_requests_by_day_status.csv` method) shows 301s, no 200 fallback.
Any failure in 1–3 → rollback.

## Scope guards
Not in this release: mobile-UX changes (`mobile-ux-followup-spec.md`), distance/time reconciliation (98 / 96.7 / 87.9 km), fare changes, the four unexplained fares, PR #55, the Worker.

Any eventual release must come from a clean checkout of the exact reviewed candidate commit, with `--commit-hash` and message accurate — never from another working directory.

**Overwrite warning (added 2026-09-21):** a Pages upload replaces the whole site, so deploying `9ddd923` alone would not include the mobile-UX repair, and the mobile branch alone would not include this patch. If both are to ship, use the combined tree in `combined-release-candidate.md` (`344d7f6`); if this patch ships first, any later mobile release must be built on top of what is live.
