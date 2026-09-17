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

**Codex answered Issue #59 on 2026-09-17** (relayed by James — the collaborator
signs as "Codex," not "Astra"; correcting the name used above and in prior
entries). Full reply posted as a comment on the issue. Key agreed points:
repo read + push/admin access confirmed, Node test execution confirmed, live
browser verification confirmed available (Claude currently has no working
browser tool in this environment — Claude in Chrome reports "not connected"
and there is no dev-preview tool available either — this is a real,
disclosed capability gap between the two agents, not an oversight).

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
- **NOT yet live:** the 2026-09-15/16 P0 route-handoff repair (PR #56,
  branch `ceo/p0-nadi-route-handoff-astra-reviewed`) and the 2026-09-16
  guest-flow/vehicle-selection fix (PR #57, branch
  `codex/nadi-guest-flow-repair-20260916`). Both are unit-tested; Codex has
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
| 10 | Claude (2026-09-17) | Issue #44 (public customer-PII confirmation pages on fijitourtransfers.com) containment is NOT complete as of today, contrary to no-longer-current assumptions | OBSERVED LIVE | Claude | Read-only check, no PII reproduced: `robots.txt` on fijitourtransfers.com is fully open (`Allow: /` for all agents incl. AI crawlers). `st_tours-sitemap1.xml` (lastmod 2026-09-15) still lists 6 URLs matching the `/tours/private-*confirmation*` pattern from the issue. Spot-checked one: HTTP 200, `<meta name="robots" content="follow, index, ...">` — explicitly indexable, not noindexed. This is the current live state, not historical — Issue #44 should not be treated as resolved. |

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
- **Still open, not yet decided:** whether to deploy PR #56 + PR #57 to an
  isolated preview for a real human click-through before cutover, or hold
  for further automated verification. Do not merge either to `main` or
  deploy to production without this decision being recorded here first.
