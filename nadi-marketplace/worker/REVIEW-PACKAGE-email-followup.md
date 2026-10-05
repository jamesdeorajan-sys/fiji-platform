# Review package - email follow-up fallback (release preparation)

**Verdict: READY FOR INDEPENDENT REVIEW** (with the open decisions in section 8). Production is unchanged: no deployment, migration, secret change, booking submission or outbound message was made. Staging/prod baseline verified 2026-10-05T21:04Z: Worker `7a32a034` (0b961a4), NAT Pages `e43dc900` (4c2aec1), FijiDash Pages `6346db54` (27f5650); AGENT_SYNC had no newer entries than `a1b5931`.

## 1. Branches and commits (see the AGENT_SYNC entry for the final hashes)
Worker `ceo/email-followup-worker` (base prod `0b961a4`); NAT `ceo/email-followup-nat` (base released `4c2aec1`); FijiDash `ceo/email-followup-fijidash` (base released `27f5650`). The NAT and FijiDash page branches have NO code change in this round: the reviewed code commits `c50fe3a` / `2c3bde4` stand, plus one test-only commit each (NAT `5897656`, FijiDash `335c26a`: an old-Worker 404 is never shown as success). Changes this round are Worker + staff page + docs only.

## 2. What changed this round (files)
- `migrations/milestone38-email-followups.sql` (still unapplied): + `designated_owner` column; seeds `email_followup_owner = James` and `email_followup_inbox = tourfijitours@gmail.com`. New `migrations/rollback/milestone38-rollback.sql`.
- `worker/email_followup.mjs`: designated vs claimed owner; `POST /admin/email-followups/:id/claim` (claim = assign + acknowledge, 409 if someone else holds it); open list = everything not CLOSED, with `age_minutes` and `claim_state`; staff/escalation text "CLAIMED by X" vs "Owner: James - NOT YET CLAIMED" kept in step on claim/correction; any unexpected failure (e.g. migration missing) answers 503 NOT_RECORDED, never "received".
- `worker/worker.js` (+6 lines): route regex gains `claim`; resolving an escalation that mirrors an OPEN follow-up is refused (409 EMAIL_FOLLOWUP_OPEN, pointer to the follow-up page; guarded so it also works on the pre-migration schema).
- `staging-site/admin-email-followups.html` (new, smallest usable staff UI in the existing admin area, same login as the other admin pages) and a one-line link from `admin-escalations.html`.
- `worker/integration/ef-browser-server.mjs` (test tool: real Worker over in-memory SQLite, outbound blocked, forwards Authorization).
- `worker/email_followup.test.mjs`: 15 -> 21 tests. Docs: `EMAIL-FOLLOWUP-RUNBOOK.md`, this file.
Page code, fares, booking payloads, WhatsApp wording, same-reference reconciliation, duplicate protection and the corrected-email-through-retries behaviour are untouched this round (their 10 + 10 module tests and suites re-run green).

## 3. Staff workflow evidence (synthetic data, isolated server, outbound blocked)
- **Automated** (`STAFF WORKFLOW end to end`): find open -> claim -> reply address / phone / site / reference / journey returned -> guest correction now locked -> outcome "EMAIL_SENT_MANUALLY" (CONTACTED, still open) -> "GUEST_CONFIRMED" (CLOSED, linked escalation resolved) with who/when recorded.
- **Browser:** the new page against the real Worker + SQLite: 2 requests (one saved booking with a differing reply address, one WhatsApp-only ENQUIRY) shown as "2 open · 2 UNCLAIMED" with designated owner James; Claim -> "CLAIMED BY JAMES / ACKNOWLEDGED"; "I emailed the guest" -> CONTACTED; "Guest confirmed" -> CLOSED; the ENQUIRY stays open and is labelled "not a booking".
- **What the existing escalations page supports (verified):** it lists the "EMAIL FOLLOW-UP REQUIRED | #id | Ref | Email | kind | Site | Status | Owner | Inbox | Guest | journey ..." line and Resolve only. Claim, contact outcome and closure are NOT possible there, and Resolve would have closed the line while the follow-up stayed open - hence the refusal (409) and the new page.

## 4. Failed staff alert (tested)
`FAILED STAFF ALERT`: provider error, thrown network error, and no alert phone configured each leave the request recorded (201), `alert_status` = FAILED / NOT_ATTEMPTED, still on `GET /admin/email-followups?status=open`, and fully actionable (claim -> outcome). The queue, not WhatsApp, is the source of truth; the staff page also shows a warning on such cards.

## 5. FijiDash negotiated-fare email fallback - UNRESOLVED COVERAGE GAP
- The "Your fare was accepted" card has no email option. That flow has no client booking reference or follow-up token (the booking is created server-side by accept-offer, not through POST /bookings), so adding the option would need either a Worker change (issue a token + reference at accept-offer) or a weaker bypass. Neither was done: no reference was invented and token protection was not loosened.
- **Recommendation: does NOT block this release.** (1) Production evidence (read-only, 2026-10-05T21:09Z): `negotiation_requests` total 7, 4 in the last 30 days, **0 accepted**, latest 2026-09-26 - the accepted-fare screen has not been reached in production. (2) The card already carries the WhatsApp handoff and, by design (Milestone 31), negotiation is a human-led conversation on the guest's phone number. (3) Fixing it properly is a separate Worker change with its own review. Revisit if negotiation volume or acceptance appears.

## 5b. Failed command in the previous run
The one non-zero exit in the previous run was the AGENT_SYNC-append step (`bash: line 21: /c/Users/James/AppData/Local/Temp/claude: Is a directory`): a stray unquoted path being executed as a command inside a long shell line. It did not stop the chain: afterwards `origin/main` was verified at `a1b5931`, the entry present exactly once, the file tail intact and the work tree clean. No code, test or branch was affected, so it does not affect completion; the root cause of the stray token inside that heredoc line was not isolated (cosmetic tooling issue, no state change).

## 6. Secret configuration and missing-secret behaviour
Instructions in the runbook section 4 (generate-and-pipe, never displayed; verify by NAME only). Tested matrix: dedicated secret -> used; only ADMIN_TOKEN -> derived key; neither -> 503 NOT_CONFIGURED and no token (bookings unchanged); cross-key tokens refused; the module never logs secrets/tokens. Production today has `ADMIN_TOKEN` and no `FOLLOWUP_SECRET` (names listed read-only). Setting it creates a Worker version: part of the release sequence, not done now.

## 7. Migration compatibility and rollback (tested on real SQLite)
- Applies on top of schema + milestones 34-36 with **no change to existing rows** (bookings / escalations counts identical before and after); pure additions (table, 3 indexes, 2 settings rows).
- **New Worker + schema without the migration:** bookings are created normally; `/email-followup` answers 503 NOT_RECORDED (never "received"); escalation resolve works (guarded lookup). **Old Worker + migration applied:** the table is simply unused. **New pages + old Worker:** `/email-followup` is 404, the pages show "could not record ... use WhatsApp" (module test).
- **Rollback:** `migrations/rollback/milestone38-rollback.sql` drops the table and the two settings; after it bookings, booking events and escalations are intact (mirrored escalations remain as ordinary staff-visible escalations) and booking creation still works. Export the table first (read-only SELECT) if real requests exist.

## 8. Remaining blockers and decisions
No technical blocker. Decisions / confirmations for James:
1. Accept the proposed internal follow-up target/escalation (runbook section 3) or change it. No guest-facing promise exists.
2. Confirm how the staging-site (admin pages) deploys: the `nadi-marketplace-staging` Pages project (driver.fijidash.com) is git-connected, so merging to its production branch may auto-deploy the new admin page; confirm the intended deploy path before release.
3. Approve setting `FOLLOWUP_SECRET` (new Worker version) as release step 1b.
4. Accept the negotiated-fare gap as non-blocking (section 5).
5. The staff alert still depends on the existing alert template/phone; recorded per request, queue is authoritative.
6. Admin tokens do not identify a person: the claimer's name is self-declared and recorded as typed.

## 9. Test evidence
Worker `node --test *.test.mjs *.test.js`: 140 tests, 139 pass, 0 fail, 1 env-gated skip (live-preview suite); includes 21 email follow-up tests (validation, saved, 10 concurrent duplicate clicks -> 1 row / 1 escalation / 1 booking, token security, correction + lock, uncertain save, enquiry, invalid email, failure honesty, not-configured, rate limit, staff queue, privacy/Meta-safe alert, inbox/site, ownership designated-vs-claimed, staff workflow, escalation-resolve guard, failed-alert visibility, missing secret, migration compatibility + rollback). NAT and FijiDash page suites and the 10 shared module tests re-run green on the unchanged page branches.
