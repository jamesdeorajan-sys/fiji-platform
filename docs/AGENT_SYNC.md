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
  `codex/nadi-guest-flow-repair-20260916`). Both are unit-tested but
  explicitly NOT verified in a live/preview browser by either author.
- **Source-of-truth warning:** `nadi-airport-transfers-site/` (this site's
  actual source tree) does not exist on `main` at all — it only exists on
  scattered feature/P0 branches. Do not assume `main` reflects what's live
  for this property until Issue #41 is actually resolved.

### Other properties
- Not independently re-verified as part of this entry — see Issue #16
  (bookfijitours.com.au source unknown as of 2026-08-16) and Issue #39
  (bookfijitransfers.com hosted on ChatGPT Sites, owner access/rollback
  path unconfirmed as of the last comment, 2026-09-02). Whoever next
  touches either property should verify current state before acting, not
  assume these are resolved.

---

## Open findings

| # | Found by | Claim | Status | Verified by | Verification method |
|---|---|---|---|---|---|
| 1 | Claude (2026-09-17) | Live `app.js` circular dependency: entering vehicle-selection step requires a vehicle already selected (`goToStep(2)` guard), with no path to select one if a deep-link skips step 1 | Confirmed | Claude | Traced actual live code (`goToStep`/`selectVehicle`/`nextBtn1` wiring); confirmed PR #57 fixes it (test: "valid route reaches vehicle selection without a preselected vehicle") | 
| 2 | Codex/Astra (PR #57, 2026-09-16) | "68 tests passed" | **Disputed** | Claude | Ran the actual suite in an isolated worktree at PR #57's head commit: 3 test files, 49 tests, 49 pass. Not a correctness issue — the fix itself works — but the stated count in the PR description does not match reality. Next agent to touch this PR should reconcile where "68" came from before trusting other numeric claims in the same description. |
| 3 | Astra (PR #56, 2026-09-15) | "59 tests; 59 pass; 0 fail" | Confirmed | Claude | Ran the actual suite in an isolated worktree at PR #56's head commit: 59/59 pass, matches claim exactly. |
| 4 | Claude (2026-09-17) | The 2026-09-13 P0 booking-integrity fix is live in production despite the cache-bust version string not being bumped | Confirmed | Claude | Direct byte diff of live `app.js` vs. git commit `6590a16` (the last commit that *did* bump the version) — live file contains strictly more content, matching the 2026-09-13 commits' actual diffs |

---

## Recurring bug classes

**Cache-busting version not bumped on deploy — 3rd occurrence.**
1. Caught before deploying `aba2d1a` (return-trip fields) — would have shipped under the same `?v=20260908a` URL already cached by real visitors from the prior release. Fixed pre-emptively by commit `6590a16` (2026-09-09).
2. Referenced in `6590a16`'s own commit message as "the same class of bug already found and fixed twice this engagement" (prior two instances not individually logged here — predate this file).
3. **2026-09-13 P0 fix deployed without a version bump at all** (this entry). Confirmed live content is newer than the served version string claims. Any visitor whose browser cached `app.js` before 2026-09-13 may still be running the pre-fix code (no double-submit guard, false-success messaging) today.

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
