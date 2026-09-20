# Nadi combined release candidate (Outrigger 301/404 + mobile-UX) — documented and preview-tested; NOT deployed

Prepared 2026-09-21. **No deployment has been made and none is approved.** Approvals stay separate: James decides the Outrigger patch and the mobile-UX repair independently; this document exists so that whichever is released cannot silently overwrite the other.

## Why a combined tree exists
Cloudflare Pages direct-upload replaces the **whole site** with the uploaded folder. The Outrigger branch (`9ddd923`) and the mobile branch (`272cfeb`) are both based on production `31a27fb` and each lacks the other's files. Deploying either one alone to production would remove the other fix. So there are three safe options, all from a clean checkout of an exact commit:
| Option | Tree to upload | Effect |
|---|---|---|
| A. Outrigger only | `9ddd923` | alias 301 + real 404; mobile behaviour unchanged (today's) |
| B. Mobile only | `272cfeb` | mobile repair; alias/unknown paths still fall back to the homepage |
| C. Both (this document) | `344d7f6feac9d9246efccbc337c4a80d06493e08` | both fixes |
**Rule:** if A is released first and B is approved later (or vice versa), the second release must be uploaded from a tree that already contains the first (i.e. C, or a new merge on top of what is live) — never from the bare branch.

## Combined candidate
- Branch `ceo/nadi-combined-release-candidate`, commit `344d7f6feac9d9246efccbc337c4a80d06493e08` = merge of `9ddd923` (Outrigger) and `272cfeb` (mobile-UX) on base `31a27fb`; the merge was conflict-free (disjoint files).
- `git diff 272cfeb 344d7f6` = exactly the three Outrigger files (`_redirects`, `404.html`, `test/soft-404.test.js`); `git diff 9ddd923 344d7f6` = exactly the four mobile files. No fare, submission, Worker, notification, chat-widget or PR #55 change.
- **Tests:** `node --test nadi-airport-transfers-site/test/*.test.js` at `344d7f6` → **100 tests, 100 pass, 0 fail, 0 skipped** (71 existing + 5 soft-404 + 24 mobile-UX) — AUTHOR-VERIFIED until Codex reruns it.
- **Preview** (uploaded from the combined worktree, label accurate): `https://2e470705.fttlandingpage.pages.dev` (alias `ceo-nadi-combined-release-ca.fttlandingpage.pages.dev`), Cloudflare source `344d7f6`, branch `ceo-nadi-combined-release-candidate`.

## Combined-tree verification on the preview (AUTHOR-VERIFIED)
| Check | Result |
|---|---|
| Served files vs `344d7f6` tree | 37 of 37 comparable files identical after stripping only Cloudflare's analytics beacon; `_redirects`/`404.html` verified by behaviour |
| Outrigger alias | 301 → `/transfer/coral-coast-outrigger`; final page has canonical `https://nadiairporttransfers.com/transfer/coral-coast-outrigger` |
| Unknown paths | `/transfer/does-not-exist`, `/nope`, `/transfer/app.js`, `/transfer/styles.css` → 404 with `noindex`; `/transfer` → 301 `/` |
| Route pages | 24 sitemap route pages 200 with 24 distinct titles (plus the homepage) |
| Assets | `styles.css` text/css, `app.js` and `chat-widget.js` application/javascript, all 200 |
| Mobile flow at 375×812 (emulation) | deep link `?pickup=NAN&dest=HILTON_DENARAU` prefills; radio vehicle cards present; step 2 opens with nothing selected and Continue disabled; picking Minivan enables Continue and reaches step 3; sticky bar visible at top and CTA (160–279) clear of launcher (305–359) |
Not tested: production edge behaviour after upload, real-device behaviour (James's phone), Codex's independent rerun of the combined tree.

## Production step for option C (do not run until James approves)
From a **clean checkout of `344d7f6`** (never another working directory), `CLOUDFLARE_API_TOKEN` unset:
```
npx wrangler pages deploy nadi-airport-transfers-site/src --project-name nadiairporttransfers --branch main --commit-hash 344d7f6feac9d9246efccbc337c4a80d06493e08 --commit-message "Nadi: Outrigger 301 + real 404 + mobile-UX repair"
```
Verify the Cloudflare deployment shows source `344d7f6` / branch `main`; the label mismatch seen on the earlier Outrigger preview (`61d2393`) must not recur.

## Rollback
Production is still `9af4d251-8696-40e8-8a23-cf6813283788` (source `31a27fb`). Roll back with "Rollback to this deployment" in the Pages dashboard or `POST /accounts/595101df2c562b3c65595420d43f9fe1/pages/projects/nadiairporttransfers/deployments/9af4d251-8696-40e8-8a23-cf6813283788/rollback`. This reverts **both** fixes; a partial rollback needs a fresh upload of option A or B from a clean checkout.

## Post-deploy acceptance (fresh valid journeys, not "zero /transfer/app.js")
1. Alias → 301 → route page 200; unknown path 404 + noindex; `/transfer` → `/`.
2. 25/25 sitemap pages 200, distinct titles.
3. Fresh journeys (homepage, deep link, a route page, alias) load `styles.css`/`app.js`/`chat-widget.js` with 2xx and correct content-types; booking widget renders; step 2 opens with nothing selected and Continue disabled; keyboard arrows select a vehicle.
4. On a real phone (James): sticky bar hides in the booking section, no step button sits under the chat launcher, vehicle cards work by tap.
5. Residual `/transfer/app.js|styles.css|chat-widget.js` requests are tracked separately as residual errors, not required to be zero.
Any failure in 1–3 → rollback.

## Out of scope for this release
Distance/time reconciliation (98 / 96.7 / 87.9 km), fare changes and the four unexplained fares, PR #55, the Worker, notification changes.
