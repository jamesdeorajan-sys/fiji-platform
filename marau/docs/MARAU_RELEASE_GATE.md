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
| DESKTOP BROWSER (hosted RC2, preserved) | On the hosted legs preview the RETURN TO AIRPORT card shows **return pickup 10:30 AM Fiji time on Monday, Oct 13, 2031** from Sofitel Denarau lobby to Nadi Airport; the ARRIVAL card shows Monday, Oct 6, 2031, 9:00 AM Fiji time. Checked initially, after switching legs, after reload and in a freshly opened tab (Worker `efc611e1`; unchanged in `615f1da8`, which only relabels a form field). This is desktop evidence, not phone evidence |

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
