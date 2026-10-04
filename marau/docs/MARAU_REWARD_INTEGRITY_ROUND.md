# Marau - reward integrity, contact, boundary and guest-browser round (2026-10-04)

Scope: local implementation and the ISOLATED preview only. No production deploy or migration, no real guest data, no payment,
no WhatsApp/email send, no fare change, no public reward promise. Issue #59 files untouched. Nadi milestone38 is NOT deployed.
Reward policy is OFF by default with no amount and no cap; FJ$10 / FJ$20 below are SYNTHETIC test values, not an approved rule.

## Evidence labels (read these first)

| Label | Meaning here | Independently verified? |
|---|---|---|
| LOCAL, AUTHOR-RUN | `node --test` in this repo against `node:sqlite`, default-deny network | No |
| HOSTED SYNTHETIC | `scripts/hosted_revenue_journey.mjs` against the isolated preview Worker + D1, synthetic data, API level | No |
| BROWSER (embedded pane) | Driven by the author in the Claude desktop built-in browser at 375x812, real taps/keys, **simulated** offline (fetch override), clipboard permission denied by that browser | No |
| NOT TESTED | real iPhone/Android, camera QR scan, real WhatsApp/email, production data, true parallelism, real Nadi deployment | - |

**Correction to the previous round's evidence.** The previous checkpoint said the `/staff` sign-in "renders at mobile width".
That was true of the HTML only: the page's script threw `ReferenceError: __name is not defined` at load (defect D14), so the
guest app and `/staff` were non-functional on preview 83e9b919. The earlier hosted run was API-only and could not see it.

## Reproduced defects, exact fixes, before/after

"Before" = commit `e9b7d2e` (or the named preview version). Red tests were committed first (`53fa7a8`, `a14a686`, `7de80cd`).

| # | Defect (reproduced) | Fix | Test (before -> after) |
|---|---|---|---|
| D1 | A fulfilled-but-UNPAID purchase earned credit; no payment evidence existed | `marau_offer_payments` ledger (paid/refunded, idempotent per event key, bounds inside the INSERT); `qualificationState()` pure function; policy `require_payment` (`paid_in_full` default, `none` alternative, configurable) | `marau_reward_integrity` PAYMENT x9: 9 red -> green. Includes partial pay, repeat, overpay, refund-before-pay refused, pay-after-cancel never resurrects, refund after apply flags a human |
| D2 | Two overlapping applies of one credit+booking: loser got 409, attribution unclear | Single transactional batch; the loser is a replay reporting the WINNER as operator | red -> green |
| D3 | Fault after the credit was claimed but before its adjustment: credit left `applied` with no adjustment (never handed back) | Adjustment INSERT and credit claim are one `DB.batch` (one transaction); legacy partial rows repaired by a same-booking retry with the ORIGINAL operator | red (baseline) -> green, fault injected with a real SQLite trigger |
| D4 | Two retries overlapping the adjustment insert: UNIQUE error surfaced as a 500 | UNIQUE caught, treated as the already-repaired replay | red -> green |
| D5 | Reversal racing redemption (two interleavings, forced with a statement gate): credit `reversed` but its adjustment still read as a clean discount | Reversal is one batch that also flags live adjustments `reversal_pending_staff`; apply is conditional on the credit still being `earned` inside the same statement | (a),(b) red -> green; (c) fully concurrent x6 stays consistent |
| D6 | Return booking cancelled during/after redemption: credit burned on a cancelled booking | Booking eligibility checked inside the INSERT; idempotent `reconcileApplications()` releases credit + discount when a booking is cancelled/declined, run on every apply/list/trip read (so a missed hook self-heals) | red -> green |
| D7 | `UNIQUE(booking_id)`: one credit per return booking, ever (made explicit) | Constraint dropped (migration 0038 rebuild); partial UNIQUE on `credit_id` for LIVE adjustments only; amount-due bound enforced inside the INSERT; `BOOKING_FULLY_COVERED`; partial application reports `unused_fjd`; fare shows every adjustment | red -> green incl. concurrent two-credit race x4 |
| D8 | Referral staff view called `followUpPlan({owner: null})`; offer view conflated fulfilment owner with guest follow-up owner | Persisted owner joined everywhere; `/preview/admin/follow-ups` with an explicit `unassigned` section and `by_owner` | red -> green |
| D9 | "Essential messages always allowed" read as universal delivery permission; no suppression; deliverability unlabelled | `sendDecision()` (booking relationship, channel capability, suppression, consent), `marau_suppressions` (0039), `deliverability: unverified` on every contact; guest wording no longer says "always sent" | red (module missing) -> green |
| D10 | The real-booking mirror never set `leg_type`, so mirrored real return legs could never receive a credit | `classifyLeg()` from the source's own zones, applied on mirror insert AND update | red -> green |
| D11 | Verified session merge stranded credits, referral code, purchases, consent, owner and suppressions on the revoked session, in separate non-atomic statements | One atomic batch re-points everything; consent merge never loosens (withheld wins); session lineage keeps the shared code working | red -> green incl. injected mid-merge fault leaves everything on the original session and the link retryable |
| D12 | Source re-quote after a credit left amount due stale | Amount due follows the CURRENT quote, credit capped at it, `quote_changed_since_credit` shown | red -> green |
| D13 | Source client: followed redirects with the admin credential, accepted http/odd URLs, loose booking-ref parsing, dropped the source's operator attestation | https/loopback only, no userinfo/query, `redirect: manual` (3xx = ambiguous), strict `^[1-9][0-9]{0,14}$` ref, attestation passed through | red -> green |
| D14 | **BROWSER.** Wrangler's esbuild injects `__name(...)` into `Function.toString()` output; served pages threw at load; every view stayed hidden (guest app AND `/staff`) on preview 83e9b919 | `BUNDLER_NAME_SHIM` defined first in every served script; test bundles with the real `wrangler deploy --dry-run` and executes the SERVED functions | red (observed in the browser, reproduced by the bundled test) -> green |
| D15 | **BROWSER.** Offline tap on Request left the button disabled, no message, unhandled rejection | Every client call has a failure path; `No connection - nothing was sent. Please try again.` | red -> green; re-verified in the browser |
| D16 | **BROWSER.** An expired offer showed the raw code `OFFER_EXPIRED` and the stale card stayed | Plain-language messages for every refusal code; list refreshes after a refusal | red -> green; observed code in the browser |
| D17 | **BROWSER.** Preview-mode rewards were described to guests who could not earn them; wording omitted that the friend must PAY | Policy view uses the viewing guest's own eligibility; `requires_payment` wording | red -> green; re-verified |
| D18 | **BROWSER.** Opening a different private link in an already-open tab only changed the hash and left the previous guest on screen | `hashchange` handler reloads onto a different link | red -> green; verified live (state marker lost, new guest shown) |
| D19 | **BROWSER.** Copy/Share: clipboard denied = silent unhandled rejection; clipboard missing = false "Link copied" | Honest outcome, link selected for manual copy | red -> green; verified live |
| D20 | An early draft of migration 0040 rebuilt a table other tables reference and FAILED on a populated database | Replaced with a lineage table (`marau_session_merges`); `marau_migration_upgrade.test.mjs` seeds a 0037-state database with rows and applies 0038-0040 | caught by the seeded run, now a permanent test |

Test totals (LOCAL, AUTHOR-RUN, at the final commit): Marau **344/344**, engine **247/247** (untouched), Nadi attempt-identity
**17/17** (untouched; includes the real-contract file in the Marau suite). Red baseline output: `docs/evidence/reward_integrity_RED_baseline_e9b7d2e.txt`
(20 of 26 failed against `e9b7d2e` with only the payment endpoint stubbed; the 6 that passed were ordering/regression guards).
Honest note: the concurrency proofs use gated interleavings and single-statement atomicity; `node:sqlite` is synchronous, so this
is not a claim of true parallel execution on D1.

## Guest-browser acceptance (BROWSER, embedded pane, synthetic data, preview a7ea41ba)

Journey executed through the real UI at 375x812: start form -> trip (arrival + return) -> Offers tab -> referral card (rewards-off
wording first, then preview-mode wording) -> friend opens the PUBLIC `/r/CODE` on a device with no session -> friend books through the
form -> friend taps Request (double-tap = exactly one request, 5 of 6 places left) -> staff confirm (credit PENDING) -> fulfil while
UNPAID (credit still PENDING) -> payment evidence recorded (credit EARNED) -> staff apply to the return -> referrer's return-transfer
card shows **Original fare FJ$100.00 / Referral credit - FJ$10.00 / Amount due FJ$90.00** with "original quote and your driver's payout
are unchanged".

| Check | Result |
|---|---|
| Mobile taps | Request, Share, nav tabs are >= 45px tall; double-tap does not double-request |
| Keyboard | Shift+Tab / Enter switches tabs; focus ring is a visible 3px outline on keyboard focus |
| Back / reload | Reload keeps the session (cookie/storage by design); Back after an invalid link lands on the start form with no trip data |
| Network failure | SIMULATED (fetch override): found D15; fixed; re-verified: button re-enabled, "No connection - nothing was sent" |
| Expired offer | Server-side expiry then tap: found D16 (raw code); fixed; refusal reads as a sentence and the list refreshes |
| Rewards-off wording | "Referral rewards are not switched on yet. You can still share the link." - no amount promised |
| Private-link protection | No token / bad token => 401 on trip, referral; anonymous landing HTML has no token or guest data; bad link falls back to the start form; a different link in the same tab switches guest (D18) |
| Public surfaces | `/preview/offers` and the QR are anonymous by design and contain no guest data |
| Share | Share counted server-side; native share absent here so it falls back to copy; clipboard denied by this browser => D19 found and fixed |
| QR destination | The hosted `qr.svg` for the code was parsed and decoded with OpenCV to `https://marau-stage1-preview.helpronline.workers.dev/r/HDW5PCMH` at 4 raster scales. **Camera scanning is UNVERIFIED** (not tested on a phone camera) |
| Return leg | The return booking was a DB fixture (stated), standing in for the real-booking mirror, which is proven separately |

Not done: a real iPhone pass this round; real-device camera scan; screenshots of every state were not archived (state was read from
the DOM; three screenshots were captured during the run).

## Production contract (still NOT approved, nothing deployed)

1. **Shared-admin-token limitation, unchanged and explicit.** The real source authenticates only the shared `ADMIN_TOKEN`. Marau
   sends an operator name derived from the caller's STAFF token, and the source stores it as `service-asserted`. That is an
   asserted name vouched for by Marau's service, **not** independently authenticated human identity at the source. The client now
   surfaces the source's own `confirmed_operator_attestation` so no screen can mistake one for the other.
2. **Trusted Marau-to-source boundary (tested):** https (or loopback) only; no credentials/query in the base URL; redirect never
   followed with the credential; only `GET /admin/bookings/:id/confirmation` and `POST /admin/bookings/manual-assign`; ids are
   validated positive integers; the POST body is exactly `driver_id, booking_id, attempt_id, operator`; guest details in the win
   response are dropped; every transport/auth/5xx/redirect/non-JSON outcome is ambiguous and recovered by readback.
3. **Return-leg mirror (tested):** the leg is derived from the source's zones on insert AND update; a credit applies only to the
   holder's own upcoming, uncancelled RETURN; the holder's arrival and return live in different sessions until the existing
   verified-link flow merges them, and that merge now carries rewards atomically. Access is never granted from a phone/email/ref
   match (an unlinked session with the same phone is refused, tested).
4. **Still required before any production request:** deploy Nadi milestone38 (attempt identity) to the real source - NOT done;
   production Marau D1/Worker and migrations 0035-0040 - NOT done; mirror rows must be created with `test_data = 0` and a decision on
   whether rewards apply to them (today `preview` mode rewards only synthetic guests, `live` is un-settable via the API and needs an
   owner approval plus `MARAU_ALLOW_LIVE_REWARDS`); collection of the discounted amount stays outside Marau.
5. Known limitation: when the source SYNC re-quotes, Marau reflects it (D12), but a quote change never re-opens or re-prices the
   operator payout - payout is untouched by design.

## What "morning and afternoon editions" means TODAY

**Grouping + Fiji-time slot logic + recipient PREVIEW. Nothing more.** Staff prepare an edition (a set of published offers for a Fiji
date and a morning/afternoon slot) and publish it; the guest app shows it as "Morning deals"/"Afternoon deals" in the right slot
(07:00 / 14:00 Fiji time, rolling on the Fiji date, tested); staff can preview which guests a promotional edition could reach
(consent + usable channel + no suppression). **NOT implemented, and asserted absent by test:** scheduled generation, any cron or
timer (no `scheduled`/`queue` export, no `[triggers]`), any outbound message or notification. No notification is operating.
Browsing every published offer is always open regardless of editions.

## WhatsApp handoff (limitation kept explicit)

The handoff composes a private enquiry text (offer title, reference, places) for an in-page panel. It contains no `wa.me` link, sends
nothing, and includes no guest contact details. The real destination number/link and whether to open WhatsApp automatically remain an
open commercial decision.

## Decisions James must make (nothing below is approved)

1. Reward amount, per-referrer cap, minimum purchase, qualifying stage (confirmed vs fulfilled) and whether payment in full is required
   (`require_payment`; default `paid_in_full`). FJ$10 was an illustration.
2. Who funds a reward, and one credit per friend ever (current rule) vs repeatable.
3. When a credit exceeds what is left to discount: today the credit is consumed and the unused part is reported (`unused_fjd`) and
   forfeited. Alternative: keep the remainder for another return.
4. Who records payment evidence and when (cash on arrival vs card vs bank), and who may reverse a refunded purchase's discount.
5. Whether staff or the guest applies credits (today staff only).
6. Hold duration (12h default), cancellation window, wa.me handoff on/off and the destination number.
7. Supplier verification process and fulfilment owners; who owns each guest's follow-up.
8. Promotional consent wording and channels; whether a merge may inherit consent (today: withheld wins, otherwise the newer answer).
9. Approval for any live mode (code refuses it without an owner approval and an environment flag).

## Commits

Marau branch `ceo/marau-stage1-preview`: `53fa7a8` (red) -> `ce6a4a1` (reward integrity, 0038) -> `a14a686` (red) -> `6ea4595` (contact, 0039)
-> `7de80cd` (red) -> `90c7c05` + `ec564b2` (boundary, mirror, merge, 0040) -> `d97fcbc` (hosted journey) -> `0b3f11c` (`__name`) ->
`6a4ebab` (offline, wording) -> `2f37dbf` (refusals) -> `0ce3675` (link switch) -> `939c281` (copy/share) -> this doc and evidence.
Preview Worker: `a7ea41ba-4f9f-4050-a4ff-5954a958e09e` (migrations 0038-0040 applied to `marau-stage1-test-db`).
