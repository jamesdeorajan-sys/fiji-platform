# Marau - release gate and candidate record (final pilot readiness)

**Nothing here is approved or requested.** RC1 (`marau-preview-rc1`, Worker `496b4d98`, D1 `marau-stage1-test-db`) and the round-trip preview database are preserved; nothing was deleted; no production change.

## The candidate

| Item | Value |
|---|---|
| Tag | `marau-roundtrip-pilot-rc2` (on the commit that adds this document; **no worker/migration file differs** from the code commit - verify with the command below) |
| **Code commit deployed** | `2b8faeab416ec6769e710e4f2dad40f14f7b74a1` on branch `ceo/marau-pilot-readiness` |
| Hosted Worker | `marau-stage1-preview-legs` version **`2024b8fe-0900-4f3b-b0c1-02712de79b0b`** (separate from RC1) |
| Hosted D1 | `marau-stage1-legs-db` (`80880a7b-7f52-4ce3-b60b-8eb7406648a7`), isolated, synthetic only |
| Migrations on it | 0001-0043 (new this round: **0043** status uncertainty, manual-send contract, booking total at credit) |
| Pre-0043 Time Travel bookmark | `00000002-00000000-000050fa-4080f84c00557f03accfbeeb50a0c08e` |
| Rollback | Worker: `wrangler rollback 11b19336-421c-4c00-98d7-2e9e40a8bed5 --name marau-stage1-preview-legs` (0043 is additive/nullable). Data: `wrangler d1 time-travel restore marau-stage1-legs-db --bookmark=<above>`. **Syntax-checked only, not executed.** |
| Nadi read endpoint | `ceo/nadi-booking-read-itinerary` `7d268e5` - pushed, **NOT deployed** |
| Source | SYNTHETIC (`NADI_SOURCE_BASE_URL` unset) |

Verify "no code after the deployed commit": `git diff --stat 2b8faea marau-roundtrip-pilot-rc2 -- marau/worker marau/migrations` is empty.

## Evidence, by class (none independently verified)

| Class | Result |
|---|---|
| LOCAL, AUTHOR-RUN | Marau **401/401**, engine 247/247, Nadi 111/111. Red baseline for this round: `docs/evidence/pilot_readiness_RED_baseline_roundtrip1.txt` (12 red of 14; the 2 that passed were regression guards) |
| **HOSTED SYNTHETIC (the exact candidate)** | `scripts/hosted_roundtrip_journey.mjs` **40/40** on Worker `2024b8fe`, run on the hosted legs preview, repeatedly (4 consecutive passes across two deploys). One earlier run during deploy propagation hit the previous version and failed 6 new checks (reported; it passed once the new version served). Covers: one source booking -> two legs, unresolved value -> approved rule -> credit only on the return, one booking balance, repeated sync, return edit/removal/restoration, **source re-quote after credit**, **arrival completed -> uncertain return -> LEG_STATUS_UNVERIFIED -> staff verification with evidence -> credit**, missing return details, source cancellation, provenance, and the **staff pilot workflow incl. pre-send check, consent withdrawn after preparation, honest contrary-to-eligibility outcome**. Evidence: `docs/evidence/hosted_roundtrip_journey_2024b8fe.json` (guest tokens redacted) |
| HOSTED BROWSER (guest side) | On the hosted legs preview, with the two synthetic private links: Link A shows both legs Confirmed; Link B shows the return as *Awaiting human confirmation* with the plain-language uncertainty sentence. No credentials typed; screenshots show page content only |
| LOCAL BROWSER (staff console) | The staff console panel (pilot + verify button) was driven earlier on a local 127.0.0.1 demo server. **Not driven on the hosted preview**: that would mean typing staff credentials into a non-local page, which I do not do. The hosted staff pilot workflow was exercised through the hosted API by the script above |
| PHYSICAL PHONE (partial) | James's latest phone screenshots cover the **updated synthetic form**, the **journey choices** (Arrival / Return to airport / Round trip) and the **separate arrival and return date-time fields**. They do **not** yet prove: saved dates on the Trip view, reopening a private link, QR scanning, or private-link switching (checklist rows 1-7 below remain open) |
| **JAMES'S DESKTOP SCREENSHOT (earlier, preserved as recorded)** | James's earlier desktop screenshot showed the return pickup as **Tuesday, Oct 13, with NO year displayed**. That is James's evidence and it is not relabelled as anything else. (Under the pre-RC3 build the year was not shown; RC3 now shows it.) |
| AUTHOR BROWSER, hosted RC3-line (SEPARATE evidence, not James's) | A separate synthetic **2031 fixture** created by the author on the hosted legs preview shows ARRIVAL Monday, Oct 6, 2031, 9:00 AM Fiji time and RETURN TO AIRPORT **Monday, Oct 13, 2031, 10:30 AM Fiji time**, from Sofitel Denarau lobby to Nadi Airport; correct initially, after switching legs, after reload and in a fresh tab (Worker `efc611e1`; `615f1da8` differs only by a form label). This is author evidence on an author-created fixture; it is **not** the record of James's screenshot, and the weekday/year differ because it is a different fixture |

## Gate status

| # | Gate | Status |
|---|---|---|
| 1 | Completed-status ambiguity | **Resolved in code:** return visible, `pending` + `status_uncertainty`, no inferred confirmation/fulfilment/redemption; staff verification (named actor, timestamp, evidence; Marau-side only; tied to the facts verified). Source confirmation still wanted (T6) |
| 2 | Manual-send timing contract | **Resolved in code:** pre-send check, stale invalidation, honest outcomes; the app does **not** claim it can stop an external send |
| 3 | Exact candidate verified hosted | **Done** (above) |
| 4 | Focused tests (balance, re-quote, cancel/restore, ambiguity, consent between prepare and send) | **Done** (`marau_pilot_readiness`, 14 tests + updated suites) |
| 5 | Decision sheet | **Done** - `MARAU_DECISION_SHEET.md` |
| 6 | Nadi read endpoint deployed | **NOT DONE** (blocker T1) |
| 7 | Production resources + migrations 0035-0043 | **NOT DONE** (T2) |
| 8 | milestone38 | **NOT DEPLOYED** (T3) |
| 9 | Mirror `test_data=0` / live eligibility approval | **NOT DONE** (T4) |
| 10 | Physical-phone evidence | **PARTIAL** - form, journey choices and arrival/return fields seen on a phone; saved dates, reopening, QR scan and link switching **not yet proven** (T5) |
| 11 | Allocation approach (explicit return price for future; controlled staff allocation for existing) | **Decision pending** (C1/C2); live allocation disabled |
| 12 | Edition delivery + human-team workflow | **next commercial milestone - not started** |

Reproducible acceptance: `node --test test/*.test.mjs` (401) · `(cd ../smart-return-trigger-fill && node --test test/*.test.js)` (247) · Nadi `node --test nadi-marketplace/worker/*.test.mjs` (111) ·
`node scripts/hosted_roundtrip_journey.mjs <legs preview url> <admin token>` (40). Deploy the legs preview with `wrangler deploy --config wrangler.legs.toml --var MARAU_ADMIN_TEST_TOKEN:<token>` (the token is never stored in the repo).

## Hygiene note (disclosed)

A committed evidence file from the previous round (`hosted_roundtrip_journey_11b19336.json`, pushed) contained a synthetic guest access token inside a check's detail. Both tokens found in committed history were **revoked on the preview server** (verified: the trip endpoint now returns 401 for each), the files were
redacted, and the evidence script now records detail only for failing checks and redacts any token. The old token text remains in git history (revoked, synthetic, preview-only); say if you want the history rewritten.


## Leg-clarity candidate (consolidated)
- Branch `ceo/marau-leg-clarity`; hosted Worker `marau-stage1-preview-legs` **`615f1da8-2cc1-4f8d-91ab-ca66e5ba2bbf`** (supersedes `efc611e1`; difference: the form's amount label). No migration. Local Marau 415/415; hosted synthetic journey 40/40 (`docs/evidence/hosted_leg_clarity_journey_615f1da8.json`).
- **Intentional 2031 fixture dates:** the leg-clarity fixtures (arrival 6 Oct 2031, return 13 Oct 2031) are deliberately far in the future so the synthetic legs stay *upcoming* and can never read as past, completed or expired, and cannot be mistaken for a real booking. They are test data, not a typo or a real date.
- **Fare labels:** the form's amount is stored as the quoted amount of the leg being created, in FJD. It is therefore labelled **Arrival fare (FJD)** for Arrival and Round trip (the return's own amount is the separate **Return fare (FJD)**), and **Return fare (FJD)** for a standalone return.
- **Still OUTSTANDING: hosted staff-console browser acceptance.** The staff console has not been driven on the hosted preview (staff credentials are not typed into non-local pages); it is exercised through the hosted API and a local demo server only. Needs James or a credentialed operator.
- No production deployment, migration, real guest import, outbound message or fare change.


## FINAL CONSOLIDATED RELEASE-GATE RESULT (RC3 held fixed)

**Exact candidate identity.** Repo `marau-stage1`, branch `ceo/marau-leg-clarity`, tag `marau-leg-clarity-rc3`. **Code commit `a7b8d3c`** (everything after it is docs/evidence only; `git diff --stat a7b8d3c HEAD -- marau/worker marau/migrations` is empty). Hosted: Worker `marau-stage1-preview-legs` version **`615f1da8-2cc1-4f8d-91ab-ca66e5ba2bbf`** on D1 `marau-stage1-legs-db` (migrations through 0043; none added). RC1 (`marau-preview-rc1`, `496b4d98`) preserved. Nadi read endpoint `7d268e5` NOT deployed. No production change anywhere.

**PASSED (with evidence class):**
- LOCAL AUTHOR-RUN: Marau 415/415 (incl. 14 leg-clarity tests, red-first commit `e1f9428`), engine 247/247, Nadi 111/111 (as last recorded).
- HOSTED SYNTHETIC: `scripts/hosted_roundtrip_journey.mjs` 40/40 on `615f1da8` (`docs/evidence/hosted_leg_clarity_journey_615f1da8.json`).
- AUTHOR HOSTED BROWSER (guest side): both legs' own date/time/location/status after switching, reload and a fresh tab; form labels and direction guard shown (2031 fixture).
- JAMES PHONE (partial): updated synthetic form, journey choices, separate arrival/return date-time fields.
- JAMES DESKTOP: earlier screenshot (Tuesday, Oct 13, no year) - recorded as-is.

**OUTSTANDING:**
1. **Hosted staff-console browser acceptance - BLOCKED, see below.**
2. Phone: saved dates on the Trip view, reopening a private link, QR scan, private-link switching (checklist rows 1-7).
3. Technical blockers T1-T4, T6 (decision sheet): Nadi read endpoint deploy, production Worker/D1/migrations, milestone38, mirror `test_data=0`/approved provenance, source meaning of booking-level `completed`.
4. Edition delivery + human-team workflow (not started).

**COMMERCIAL DECISIONS (James):** C1 return pricing (recommend explicit return amount at source for future bookings); C2 existing bookings (recommend one approved envelope + named-staff allocation); C3 reward terms; C4 partial-refund rule and payment-evidence owner; C5 pilot sender/owner/rota/text/consent wording/caps/quiet hours; C6 who may verify an uncertain return; C7 wa.me handoff; C8 non-FJD quotes. Rewards remain OFF; live allocation and reward policy disabled.

### Hosted staff-console acceptance: BLOCKED (not attempted)
- **Exact restriction:** my operating rules prohibit entering passwords, tokens or API keys into any form field on a page that is not a local development host (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`, `*.test`). The staff console at `https://marau-stage1-preview-legs.helpronline.workers.dev/staff` is a `workers.dev` host, and signing in needs an admin test token and a staff identity token typed into its fields. The rule applies even to a temporary, least-privilege, synthetic credential, and I may not work around it (for example by injecting the token into page storage or script, which is the same act). The test-credential exception covers only local hosts.
- **Consequence:** no operator credential was created, so there is nothing to revoke or verify as revoked. The preview's existing `MARAU_ADMIN_TEST_TOKEN` (a Worker variable, never stored in the repo) was not used in any browser field.
- **What is covered instead:** the same staff workflow was exercised through the hosted API (40/40) and the staff console was driven in a browser on the local `127.0.0.1` demo server (`scripts/local_pilot_demo_server.mjs`). Neither is hosted staff-console browser acceptance.

**Short human-operated checklist (about 10 minutes, on the hosted preview, synthetic data only):**
1. Open `/staff` on the hosted legs preview. Enter the admin test token and a staff name you choose (e.g. `Acceptance Operator`). Do not screenshot the sign-in fields.
2. Create a pilot edition and a recipient with granted marketing consent (use the harness form); run **Prepare sends**.
3. For one recipient press **Check before send**: message text appears, no link/phone/email in it, and the page states the app cannot stop an external send.
4. Withdraw that recipient's consent (Contact preferences on their Trip), press **Check before send** again: it must refuse with `no_marketing_consent`.
5. Record outcome **Sent manually**: it must be recorded and flagged **contrary to eligibility**.
6. On a leg showing *Awaiting human confirmation* with the uncertainty sentence, use **Verify status** with evidence of 10+ characters: the leg becomes Confirmed; the source is stated unchanged; the guest page never shows who verified or the evidence.
7. Afterwards ask the engineer to rotate `MARAU_ADMIN_TEST_TOKEN` (a redeploy with a new `--var`) and confirm the old value returns 401.
Record: date, who ran it, browser, any step that differed.
