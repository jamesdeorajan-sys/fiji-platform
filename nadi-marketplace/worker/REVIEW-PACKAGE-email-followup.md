# Review package - email follow-up fallback (supplemental checks included)

**Verdict: READY FOR INDEPENDENT REVIEW** (open decisions in section 9). Production unchanged: no deployment, migration, secret change, merge or outbound message. Candidates preserved for review: Worker `e99e52c`, NAT `5897656`, FijiDash `335c26a` (+ the supplemental commits listed in AGENT_SYNC; code under review is unchanged, supplemental commits add tests, docs and the staff-page release branch).

## 1. Evidence index (GitHub repo `jamesdeorajan-sys/fiji-platform`; replace `<ref>` with the commit in AGENT_SYNC or use the branch)
| Item | Branch | Path |
|---|---|---|
| Runbook | `ceo/email-followup-worker` | `nadi-marketplace/worker/EMAIL-FOLLOWUP-RUNBOOK.md` |
| This review package | same | `nadi-marketplace/worker/REVIEW-PACKAGE-email-followup.md` |
| Migration | same | `nadi-marketplace/migrations/milestone38-email-followups.sql` |
| Destructive SQL (manual only) | same | `nadi-marketplace/manual-only/DESTRUCTIVE-milestone38-drop-email-followups.sql.txt` |
| Worker code | same | `nadi-marketplace/worker/email_followup.mjs`, `worker.js` |
| Worker tests (23) | same | `nadi-marketplace/worker/email_followup.test.mjs` |
| Browser test server (real Worker + SQLite) | same | `nadi-marketplace/worker/integration/ef-browser-server.mjs` |
| Staff page (as developed) | same | `nadi-marketplace/staging-site/admin-email-followups.html`, `admin-escalations.html` |
| **Staff page RELEASE branch** | `ceo/email-followup-staff-page` (`719b5da`) | same two files, on top of the production-branch tip `20c0f64` |
| Page module (identical copies) | `ceo/email-followup-nat` / `ceo/email-followup-fijidash` | `nadi-airport-transfers-site/src/email-followup.js` / `ftt-booking-site/src/email-followup.js` |
| Page module tests (11, identical) | same | `nadi-airport-transfers-site/test/email-followup.test.js` / `ftt-booking-site/email-followup.test.mjs` |
| Page wiring | same | `src/app.js`, `src/index.html`, `src/styles.css` of each site |
URL form: `https://github.com/jamesdeorajan-sys/fiji-platform/blob/<branch-or-commit>/<path>`.

## 2. What is under review (summary)
Durable email follow-up request, token-protected, idempotent per reference; designated owner (James) vs actual claim; staff queue page; mirrored escalation; honest wording (request received != email sent != transfer confirmed); migration additive; no email is sent automatically; fares, booking payloads and WhatsApp wording unchanged.

## 3. Which browser scenarios were rerun against the FINAL combined candidate (2026-10-06) and which rely on earlier evidence
**Rerun now** (isolated server, real Worker code of the candidate over in-memory SQLite + all migrations incl. milestone38, outbound blocked, synthetic data, 390 wide), final page branches `5897656`/`335c26a`, final staff release page `719b5da`:
- NAT: saved + triple click (1 booking, 1 follow-up, 1 escalation, designated owner James, unclaimed, site nat, inbox tourfijitours@gmail.com); uncertain (booking committed + response lost -> reconcile -> failed request -> retry; 1 booking, corrected address kept and flagged); WhatsApp-only enquiry (0 bookings).
- FijiDash: saved + triple click; uncertain via the failure card (card switch, corrected address carried, 1 booking); unsupported-route enquiry (function-driven).
- Staff release page: 2 requests shown "2 open · 2 UNCLAIMED"; Claim -> CLAIMED BY JAMES / ACKNOWLEDGED; I emailed the guest -> CONTACTED; Guest confirmed -> CLOSED; the ENQUIRY stays open.
**Relies on earlier unchanged-code evidence** (page code unchanged since): 320-wide layout checks of the email box (NAT and FijiDash), the screenshot review at 390, the defect fix check (corrected email across the card switch) at 320. **Not re-run:** the FijiDash enquiry via a real custom-address booking (function-driven only, because that path needs geocoding); the negotiated-fare screen (no email option).
**Automated (final code):** Worker 142 tests / 141 pass / 0 fail / **1 skipped - the env-gated live-preview suite (needs `NADI_API_BASE_TEST` = a deployed API): UNVERIFIED, deliberately not run**; NAT 156 pass; FijiDash 6 + 24 + 17 + 11 pass.

## 4. Staff workflow and failed alert
Unchanged from the previous package: find -> claim -> reply address / phone / site / reference / journey -> outcome -> closed (automated test + browser above). A failed staff alert (provider error, thrown error, no alert phone) leaves the request recorded, on the open queue, claimable and closable; the page warns; the DB queue is authoritative. The existing escalations page shows the mirrored text but cannot claim/record outcomes and now refuses Resolve for an open follow-up.

## 5. FijiDash negotiated-fare result - exception, ACCEPTANCE PENDING James's decision
**What a guest who cannot use WhatsApp actually has on that screen today:** the card ("Your fare was accepted - confirm the details on WhatsApp") offers only (a) the WhatsApp button, prefilled with the fare-request/booking reference, agreed fare and journey, and (b) "Book another transfer". There is **no email option and no phone/call link** on the card. Outside the card the site has its general contact links; the footer "Email us" is the published address `info@fijidash.com`, whose monitoring is **not established**; tourfijitours@gmail.com is not shown anywhere on that screen.
**What the system does behind it (Worker `handleNegotiationAcceptOffer`):** creates the booking (status accepted, driver assigned), **sends the guest a driver-assigned message on WhatsApp** (useless to a guest without WhatsApp) and **alerts staff** "Negotiated booking #N agreed" on the admin alert phone. The negotiation request carries the guest's name and **phone only - no email address is collected on this path**, so staff have a phone number but no email for that guest. Whether anyone then phones such a guest is a process question that is **not established or verified**.
**Why it cannot be fixed without more work:** no client booking reference or follow-up token exists on this path (the booking is created server-side by accept-offer); adding one needs a Worker change (issue a token at accept-offer) plus page work. No reference was invented and token protection was not loosened.
**Evidence on frequency (read-only, 2026-10-05T21:09Z):** `negotiation_requests` total 7, 4 in the last 30 days, 0 accepted, latest 2026-09-26. Zero historical acceptances shows the screen has not been reached; it does **not** prove the gap is harmless.
**Options for James (decision pending):** (A) accept the exception for the first release with an explicit interim rule: treat the "Negotiated booking agreed" staff alert as a call-the-guest task by the backup/designated owner, and review after 2 weeks; (B) hold the email release until accept-offer issues a token/reference and the card gets the option; (C) accept the exception and add a small interim line on that card (no new promise) after review. Default recommendation unchanged: not a technical blocker, but its acceptance is James's call.

## 6. Secret and Worker activation
See runbook section 4 (exact commands, preconditions, why the secret-put step cannot activate an undeployed version, how secrets are retained by `versions upload`/`deploy`, explicit `versions deploy <id>@100`). Evidence used: wrangler 4.147.0 source (`secret put` issues only the secrets API call and surfaces the "latest version isn't currently deployed" refusal; `uploadWorkerVersion` and `deployWorker` pass `keep_bindings` for `secret_text`/`secret_key`), `wrangler.toml` has no `[vars]`, production state read-only (latest version `7a32a034` is the deployed 100% version). Behaviour of the secrets endpoint creating+deploying a version is documented Cloudflare behaviour and was **not exercised** (no production change). No secret value appears anywhere.

## 7. Data-preserving rollback and old-code compatibility
Application rollback is the default and keeps the table, rows and settings; destructive SQL is manual-only, outside `migrations/`, `.sql.txt`, guarded. Tests (real SQLite): the previous production Worker `0b961a4` (materialised from git) runs against the migrated schema with real follow-up rows - bookings and replays work, escalations list/resolve work, no email routes (404), rows and settings are byte-identical afterwards, and the documented read-only SELECT returns the outstanding requests; new Worker without the migration answers 503 NOT_RECORDED and still creates bookings; the destructive file refuses to run as shipped. Known quirk: old code's Resolve closes the mirrored escalation line without touching the follow-up row (the row stays and is found by the SELECT). How James reaches requests after any revert: runbook section 6.

## 8. Operational response
Replaced with a proposal distinguishing staffed hours, after-hours and urgent pickups (runbook section 3): promptly inspect alerts and the queue at least hourly in staffed hours; first human email within 1 hour of receipt; pickup within 24 hours = priority handling + immediate staff escalation; backup owner and real coverage hours are blank decisions for James; no 24/7 cover assumed; no guest-facing guarantee.

## 9. Remaining decisions / blockers
No technical blocker found. For James: (1) staffed hours, backup owner and cover hours (runbook section 3); (2) acceptance option for the negotiated-fare exception (section 5); (3) approve the staff-page release path (fast-forward the production branch to `719b5da`) and the secret step; (4) the staff alert still depends on the existing alert template/phone; (5) claimer name is self-declared.
