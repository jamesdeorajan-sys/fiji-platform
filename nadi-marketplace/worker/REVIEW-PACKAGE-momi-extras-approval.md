# FINAL REVIEW PACKAGE - Momi minibus daytime one-way final fare WITH extras (night on HOLD)

Status: **review only. Nothing deployed, no migration, no cache purge, no production write, no message sent, no production test booking.** This package supersedes `REVIEW-PACKAGE-momi-final-fare.md` for readiness (that file's earlier statements about extras are superseded; its HOLD banner stands for night).

## 1. Approval recorded (James, 2026-10-05, "updated approval" - supersedes the earlier instruction to implement night totals)

Nadi Airport -> Fiji Marriott Resort Momi Bay, minibus, **daytime one-way (06:00-21:59 Fiji time)**:

| Selection | Total (FJ$) |
|---|---|
| No extras | **175.92 FINAL** (standard discount already included) |
| Child seat | **183.92** |
| Surfboard | **199.92** |
| Both | **207.92** |

Extras FJ$8 / FJ$24, added undiscounted; **no further standard discount on the transfer or its extras.**
**HOLD / not implemented:** proposed night totals 211.10 / 219.10 / 235.10 / 243.10; no night policy; existing night surcharge not disabled; daytime approval not extended to night.
**Preserved:** returns incl. approved 297 / 304; other routes, hotels, vehicle classes; released booking / quote-consent / retry / notification fixes; fuel adjustments OFF; historical bookings.

## 2. Branches / commits for review (all pushed; hashes are in the AGENT_SYNC entry)

Worker `ceo/momi-final-fare-worker`, NAT `ceo/momi-final-fare-nat`, FijiDash `ceo/momi-final-fare-fijidash`. Runtime files only: Worker `pricing.mjs`, `worker.js`; NAT and FijiDash `src/app.js`, `src/index.html` (cache key `20261005-momi-final-fare-extras`), the Momi route page. Everything else is tests / documents.

Mechanism (unchanged in shape, widened by extras): the page names `approved_final_fare_id = MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY`; the Worker recognises it only for Nadi Airport -> Momi Bay, minibus, one-way, daytime, no tour, no custom address, and then returns transfer 175.92 + listed extras with no discount; otherwise the normal formula + 10% runs unchanged. Pages compute the same figure (transfer 175.92, extras 0 / 8 / 24 / 32, discount 0, subtotal = final) only when the extras amount is one of those four values.

## 3. Task 1 - the four totals through every stage, both sites

| Stage | NAT | FijiDash |
|---|---|---|
| Selection (vehicle card + `calculateTotal`) | 175.92 / 183.92 / 199.92 / 207.92 | same (card shows the 175.92 transfer, "transfer is a final fare, no further discount") |
| Review | same | same (live-fare swap leaves the approved total untouched) |
| Submitted `quoted_amount` + id | same, id sent | same, id sent |
| Saved `quoted_amount` / `settlement_amount_fjd` | same | same |
| Worker response | same | same |
| Pricing decision | `matched` / `approved_final_fare`, calculated = accepted = total | same |
| Admin short alert and full alert | carry the approved total; none carries 157.92 / 165.92 / 179.92 / 186.92; no FARE CHECK | same |

Evidence: `integration/journey.test.mjs` (real page functions + real Worker over an in-memory DB, outbound blocked) AND a real in-app Chromium at 390x844 against isolated servers (NAT 175.92 / 183.92 / 199.92 / 207.92 each: review total, "Fare saved", Worker saved amount, pricing decision `matched`, alert text; FijiDash the same four with review totals 175.92 / 183.92 / 199.92 / 207.92). Browser servers were isolated (blocked outbound, no production data); the page-level guard blocked only cross-origin analytics-type calls.

## 4. Task 2 - "adding extras cannot lower the fare" is a PASSING regression

`integration/inversions.test.mjs` I1 (NAT saved, FijiDash saved after review, Worker; day 10:00 / 21:59 / 06:00 and night 22:00 / 23:00 / 05:59: none <= seat <= surfboard <= both; day totals exactly the four approved); also NAT `momi-final-fare.test.js`, FijiDash `momi-final-fare.test.mjs` (selection and review; steps exactly 8 / 24 / 32) and Worker `approved-final-fare.test.mjs`. The earlier characterisation (165.92 < 175.92) and the TODO I1 are gone.

## 5. Task 3 - boundaries, itinerary edits, remaining night inconsistencies

* **21:59 and 06:00 = day** (approved totals, selection and review, with and without extras); **22:00 and 05:59 = night** and keep the **existing** arithmetic on every component. Tested on NAT, FijiDash and the Worker.
* **Itinerary edits** (NAT and FijiDash unit tests): one-way <-> return re-derives (183.92 <-> 304 with a child seat); extras 0 / 8 / 24 / 32 re-derive (175.92 ... 207.92); an extras amount outside the listed ones (5), another vehicle, or a tour removes the approved branch.
* **Night inconsistencies that remain (NOT changed; existing behaviour):**

| Night 23:00 one-way (none / seat / surf / both) | Selection | Saved |
|---|---|---|
| NAT | 193 / 201 / 215 / 222 | 193 / 201 / 215 / 222 |
| FijiDash | 193 / 201 / 215 / 222 | **157.92 / 165.92 / 179.92 / 186.92** (review drops the night modifier, normal discount applies) |
| Worker (own calculation) | - | 190.10 / 197.10 / 211.10 / 219.10 |

  FijiDash night saved totals are **18.00-21.00 below the approved daytime totals** (UNRESOLVED, visible TODO I2). The three components also disagree with each other. The proposed 211.10 etc. are not implemented.

## 6. Task 4 - public wording

* NAT and FijiDash Momi route pages: "FJ$175.92 final fare ... extras ... FJ$183.92 with a child seat, FJ$199.92 with a surfboard, FJ$207.92 with both ... no further discount" in the table, visible FAQ (NAT) and JSON-LD; the sentence "extras ... added before the discount" is removed for this fare (other fares: "count towards the existing 10% discount"). Tests assert table / FAQ / JSON-LD agree and no superseded total appears.
* Booking tool: the "10% off automatically applied to bookings over FJ$50" banner now adds "not on the Momi Bay Marriott minibus one-way, which is a final fare with the discount already included" when Momi Bay is the selected destination (NAT and FijiDash).
* **Not changed, flagged:** NAT `index.html` static promo "10% OFF every booking over FJ$50" (general, not fare-specific); other route pages' "automatic 10% loyalty discount" copy.

## 7. Task 5 - retries and mixed versions (outbound blocked, no production test bookings)

* **Same-reference retry** (Worker test, with and without extras): replay returns the same booking and fare, no second booking, no second short alert; a stale / superseded amount cannot change it. (The in-memory D1 stub re-sends the full admin alert on replay; production shows exactly one per booking - harness artefact, noted earlier.)
* **New pages + OLD Worker:** submit 175.92 / 183.92 / 199.92 / 207.92 without the id; the old Worker keeps them (`kept_in_band`, 0.8x-1.3x of 157.92 / 165.92 / ...). Deployment order cannot lose the new amounts.
* **OLD pages / tabs (NAT c5ee3b1, FijiDash 8c6f920) + NEW Worker:** keep quoting 157.92 / 165.92 / 179.92 / 186.92 and are saved as quoted (`matched`, nothing repriced). **Shortfall vs the approved totals 18.00 / 18.00 / 20.00 / 21.00 per booking until the guest reloads - NOT fixed.**
* Lost-reply / retry behaviour of the released consent and idempotency fixes: unchanged and still covered by their suites.

## 8. Scope of change (whole-grid verification, `integration/scope-grid.test.mjs`)

NAT: exactly the four daytime one-way Momi minibus cells change (no night cell). FijiDash: only Momi minibus cells change - exclusions to "all other pricing unchanged": (a) catalogue 79 -> 175.92 (16 selection cells), (b) review of the four approved cells and the 8 Momi minibus RETURN cells (292.45 etc. -> approved 297 / 304 page convention); night review unchanged. Worker: without the id equal to production in all 672 cells; with the id on every cell exactly four differ. Sedan, minivan, other Momi hotels, other routes: identical.

## 9. Test results

Worker `node --test *.test.mjs *.test.js`: 130 tests, 129 pass, 0 fail, 1 skipped (the env-gated live-preview suite, which needs NADI_API_BASE_TEST and is deliberately not run: it would call a deployed API). NAT `node --test test/*.test.js`: 154 pass / 0 fail. FijiDash: analytics 6, mobile-conversion 26, submit-timeout 17, momi 13 pass + 1 visible TODO (I2 night). Integration (journey, inversions, scope-grid): 11 tests, 10 pass + 1 visible TODO (I2 night), 0 fail.

## 10. Is a coherent release possible with night on HOLD? - the exact remaining decision

**The approved daytime behaviour is complete and coherent on its own.** The hold leaves night pickups of this fare behaving as they do today, which is internally inconsistent (table in section 5). Releasing daytime only is therefore possible, but it ships the known FijiDash night review figures (157.92 etc.) below the daytime totals. Remaining decision before a release can claim a coherent price list for this fare:

1. **Night policy for this fare:** N-A no night surcharge (night = day) / N-B x1.2 on the 175.92 transfer in cents (211.10 / 219.10 / 235.10 / 243.10) / N-C x1.2 rounded up to FJ$5 (215 / 223 / 239 / 247) / other / keep today's existing behaviour (accept the inconsistency).
2. **FijiDash night review step:** whichever of the above is chosen, whether FijiDash night one-way should follow it at review (today the live-fare swap discards the night modifier).
3. **Old-tab exposure:** accept the 18-21 FJ$ shortfall for tabs open at release time, or require a coordinated cache refresh (not performed here).

## 11. Read-only production monitoring and drift

Extraction 2026-10-05T11:55-11:57Z. Production IDs unchanged: Worker `7a32a034-e48f-4c67-af70-63b184006350` (tag 0b961a4, created 2026-10-05T03:06:40Z, latest in `wrangler deployments list`); NAT Pages project `nadiairporttransfers` last modified "7 hours ago" (consistent with 8be05ec7); FijiDash Pages project `nadi-guest-widget-preview` last modified "1 week ago" (consistent with 8d1dc75d). Latest saved booking **#246 at 2026-10-05 11:20:40 UTC** (unchanged since the previous check); 238 bookings, 11 in the last 24 h (SQLite `datetime('now')` window). Notification states and escalation counts: **UNKNOWN this run** (the `admin_notification_state` status query failed; not assumed healthy - last known 48/48 SENT at 11:27:25Z). Provider acceptance only; inbox receipt, human confirmation and payment are UNKNOWN / not applicable. Nothing modified, replayed or interrupted.

## 12. Rollback targets (if a later release is approved)

Worker `7a32a034` (tag 0b961a4); NAT Pages `8be05ec7` (c5ee3b1); FijiDash Pages `8d1dc75d` (8c6f920); fallbacks Worker `8c1fa242` (2125a34), NAT `b0ab2505` (fa9f2af).
