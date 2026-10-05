# P0 - booking #237 (FTT-UKAZTE): guest saw FJ$142, staff were alerted FJ$300.45

**Investigation + prepared repair. NOTHING is deployed.** No booking was created, no message sent, no fare changed, #237 was not touched. Production was read only (read-only D1 queries; no guest name, phone, email or IP was selected). Evidence files: `docs/evidence/p0-booking-237/`.

## 1. Confirmed cause (one paragraph)
The NAT page priced the trip from its **published route table** (`ROUTES_DATA`: Marriott Momi Bay minibus = **FJ$79**) and showed **FJ$142**. The booking system (Worker `nadi-dispatch-api`) re-prices every guest booking from its own **distance formula** (Nadi Airport -> Momi Bay = 38.623 km; minibus rule 35-70 km: 139 + 0.956/km = **FJ$175.92 one-way**) and gets **FJ$300.45**. Because 142 is outside the Worker's 0.8x-1.3x acceptance band (240.36-390.585), the Worker **silently replaced the guest's amount with its own**, saved 300.45, and alerted staff 300.45. The page never reads the saved amount back, so the guest was never told. The immediate trigger is a **catalogue data error: the published minibus price (FJ$79) is lower than the minivan (FJ$149) and sedan (FJ$99) for the same route** - the only row in the table where that is true. The silent replacement is the defect that turned a data error into a guest-visible mismatch.

## 2. The three amounts, traced separately
| Amount | Value | Evidence | How it is known |
|---|---|---|---|
| **Submitted** (page -> Worker) | **FJ$142 - INFERRED, not retained** | the page sends `quoted_amount = calculateTotal().final`; for this exact itinerary the page's own functions compute 142 (reproduced to the cent); matches the guest screenshot | **The submitted payload was not retained.** There is no raw-payload column; the `created` event metadata was `null`; Workers Logs / observability is not enabled, so the Worker's own `[pricing-drift] client sent ...` warning was not persisted (it is visible only in a live tail). 142 is therefore inferred from the screenshot plus exact arithmetic, not read from a record |
| **Stored** (`bookings` #237) | **FJ$300.45** (`quoted_amount = settlement_amount_fjd = 300.45`, fx 1, fuel multiplier 1) | production D1 row (read-only), created 2026-10-05 01:19:31 UTC | database |
| **Notification** (WhatsApp admin alert) | **FJ$300.45** | the alert is composed from the saved row; events 485-487 show the driver broadcast and both admin alerts sent at 01:19:33 UTC with status 200; the amount in the alert text as reported by James is 300.45 and equals the stored amount | database events + James's report (the alert text itself is not stored) |

## 3. The exact pricing branches
**Page (live `app.js?v=20260921-mobile-ux` = commit `c6d62a6`, byte-identical apart from line endings):** `computePrices('NAN','MARRIOTT_MOMI')` -> `lookupPublishedPrices` hits the **published** map (`source:'published'`, minibus 79) -> `applyModifiers`: not night (`isNightPickup()` reads only the OUTBOUND time 09:15), return -> 79 x 1.85 = 146.15 -> **rounded UP to the next FJ$5 = 150** -> `calculateTotal`: + child seat 8 = 158, loyalty discount `Math.round(158 x 0.10)` = 16 -> **142**.
**Worker (deployed `2125a34`, version `8c1fa242`, since 2026-09-27):** `createBookingRecord` -> `computeAuthoritativePrice` -> `computeFareFjd` (pricing_rules + zone distance cache, **no published table exists server-side**) = 175.92 -> x 1.85 (`applyTripTypeMultiplier`) = 325.45 -> night? no -> + child seat 8 = 333.45 -> `applyLoyaltyDiscount` (whole-dollar discount 33) = **300.45** -> the band check (`quotedAmount < ref x 0.8 || > ref x 1.3`) -> **replace** (`quotedAmount = serverFjdDiscounted`) -> insert.
The two child-seat inferences agree independently: 142 needs a subtotal of 158 (150 + 8) and 300.45 needs 333.45 (325.45 + 8). Without the seat the figures would be 135 and 292.45. The `has_child_seat` flag is not stored in `bookings` (it was sent but only the arithmetic remains).

## 4. Deployment, pricing-rule and cache history (checked before alleging a change)
- **Page:** 25 production Pages deployments (back ~3 weeks, current `8d4a440c` from `c6d62a6`, deployed 2026-09-26): the Momi row (**99/149/79**) and the constants (return 1.85, night 0.20, discount 0.10) are **identical in every one**. The row has been in this lineage since 2026-09-17 (`31287e2`) and never changed. **No recent page change.**
- **Worker:** production versions `f5640b11` (2026-09-26 18:54) and `8c1fa242` (2026-09-27 11:11) - nothing deployed after that, i.e. 8 days before #237. The 0.8x-1.3x band has been in the code since 2026-09-02 (`411b810`).
- **Pricing rules:** the live `pricing_rules` (15 rows) are **identical to the read-only snapshot taken 2026-09-26 18:09 UTC** and to the migration seeds (minibus 35-70 km = 139 + 0.956/km from `milestone9-pricing-refit.sql`, 2026-07-22). Zone `Momi Bay` multiplier 1, cached distance 38.623, fuel multiplier 1. The database has **no rule-change history table**, so a change *before* 2026-09-26 cannot be excluded from the database alone; nothing in the code history suggests one.
- **Cache:** `app.js` is served `Cache-Control: public, max-age=14400, must-revalidate` (4 h). Because every production version computes the same number, **no cached asset version could produce a different figure** - cache cannot explain 142 vs 300.45.
- **First occurrence, not a regression:** #237 is the **first minibus booking ever to Momi Bay** (sedan: 13, minivan: 6, all consistent with their rows). The latent error had never been exercised.
- James's FJ$315 comparison: not reproduced for this itinerary (no combination of vehicle, trip type, day/night or extras on Momi gives 315 on either side); Codex's note that it used different dates/times stands.
- The 06:00 return time is irrelevant to price: neither side prices the return time (both read only the outbound time), and 06:00 is not night on either side (`hour < 6` is false; 05:59 is night). Only outbound 22:00-05:59 triggers the surcharge.

## 5. Reproduction (no live booking, no message, no network)
`repro.mjs` evaluates the live page's real price functions and the deployed Worker's real `pricing.mjs`/rule logic with the saved production tables: client 142 and server 300.45 are both reproduced **to the cent**. `e2e_before_after.mjs` drives the real page `submitNadiBooking` into the real Worker over an in-memory database (seeded from the production pricing snapshot):
| | Page shows / submits | Worker | Saved = alert | Guest told? |
|---|---|---|---|---|
| **BEFORE** (live page + deployed Worker) | 142 | 201, replaces silently | **300.45** | **No** |
| **AFTER** (repaired page + repaired Worker) | 142 -> **409 PRICE_MISMATCH (reference 300.45, nothing saved)** -> review shows **300.45** "confirmed by our booking system" -> guest accepts -> submits **300.45** | 201 | **300.45** = shown = accepted | **Yes, before anything is saved** |
| AFTER, an old cached page (no opt-in) | 142 | 201, unchanged | 300.45 | No - but the change is now **recorded** on the `created` event (`pricing_adjustment: submitted 142, saved 300.45, band 240.36-390.585`) |

## 6. Remaining uncertainty (stated, not hidden)
1. The submitted amount (142) and the child seat are inferred (section 2); no record retains them.
2. Which asset version the guest's browser ran cannot be proven, but all candidates compute the same number (section 4).
3. The `pricing_rules` history before 2026-09-26 is not recorded; the values equal the 2026-07-22 migration seeds.
4. The WhatsApp alert text is not stored; its amount is read from the stored row and from James's report.
5. FijiDash (`book.fijidash.com`) was not analysed for this defect; it mirrors the Worker fare at its review step (earlier finding R10), and the repair is opt-in, so FijiDash is unchanged.
6. 12 sweep cases have no server rule (e.g. Tanoa International): the Worker cannot compute them and falls back to trusting the page amount (unchanged, pre-existing).

## 7. Affected routes (this page, daytime, no extras; every published destination x vehicle x trip type, 420 cases)
| Class | Meaning | Count | Routes |
|---|---|---|---|
| **REPLACED by the Worker** (guest shown one number, saved another) | page amount outside 0.8x-1.3x of the Worker | **10 of 420** (6 without extras) | **Marriott Momi minibus** one-way 71 vs 157.92 (ratio 0.45) and return 135 vs 292.45 (0.46); **Nadi City Centre / Mercure Nadi sedan one-way** 19 vs 30.15 (0.63); **Wailoaloa Beach / Crowne Plaza Nadi Bay sedan return** 67 vs 50.17 (1.335: replaced DOWN, in the guest's favour). Production already holds 3 Nadi sedan bookings saved at 30.15 and Wailoaloa sedan returns at 50.17, so earlier guests on these routes may have seen the other number |
| **KEPT, differs** | inside the band: the guest's number is saved (no consent problem) but it is not the Worker's formula | 369 (183 without extras; 82 lower, 101 higher; largest difference FJ$67.17) | many routes - a pricing-consistency question for James, not a consent defect |
| MATCH | equal to the cent | 29 | |
| No server rule | | 12 | Tanoa International |
Minibus is below minivan in exactly one catalogue row: `MARRIOTT_MOMI`. Fares given here are the existing numbers of the two systems; **no commercial fare is chosen or changed by this work.**

## 8. The prepared repair (narrow; frozen candidates)
- **Rule:** the guest must see and accept the same final quote that is saved and sent to staff; never silently increase it; keep server-side validation; choose no new fare.
- **Worker** `ceo/p0-quote-consent-worker` (base = deployed `2125a34`; 4 changes in `worker.js`): a new **opt-in** body field `require_quote_match`. When true and the amount is outside the **unchanged** band, the Worker saves nothing, sends nothing and returns **409** `{code:'PRICE_MISMATCH', reference_fare_fjd, submitted_amount_fjd, errors:[...]}`. Everything else, including the formula, the band, the return-trip sanity check, tours, boats and every other caller, is unchanged. For callers that do not opt in, the existing replacement still happens but is **now recorded** on the `created` event (`pricing_adjustment`), fixing the "payload not retained" gap. Tests: new `quote-consent.test.mjs` 7/7 (failing first: 5 of 7 red against `2125a34`; the deployed behaviour is pinned by a control test that reproduces #237), plus every existing Worker test file unchanged and green.
- **Page** `ceo/p0-quote-consent-site` (base = live `c6d62a6`): the page opts in; on a mismatch it returns to the review step, shows "The fare for this trip is FJ$300.45, not the FJ$142 shown earlier... Nothing has been booked yet", labels the total "confirmed by our booking system", and the same Confirm button then submits exactly that accepted amount. The accepted fare applies only to the same pricing inputs (route, vehicle, extras, trip type, day/night); change any and it is dropped. Tests: new `quote-consent.test.js` 7/7 (5 of 7 red against `c6d62a6`); existing site tests unchanged and green (**112 total**). The cache-key bump to `app.js?v=20261005-quote-consent` is a **separate release-step commit** (it edits the pinned assertion in `mobile-ux.test.js`).
- **Not changed:** the published table (including the FJ$79), the formula, the band, fares, #237, any other route page, FijiDash.

## 9. Proposed release (separate; needs James's decision; nothing is released)
1. **Decision first (commercial, James):** what is the correct Momi Bay minibus fare - the page's FJ$79 (clearly below the minivan) or the Worker formula (FJ$175.92)? And the Nadi sedan (19 vs 30.15) and Wailoaloa sedan return (67 vs 50.17) rows. The repair deliberately **does not decide**: until you decide, a guest on those routes is shown the Worker's number and must accept it, never a silent change.
2. **#237 itself:** not edited. Staff should confirm the fare directly with the guest, who saw FJ$142 (the alert says 300.45), and record the agreed fare through the normal path.
3. **Worker first** (`ceo/p0-quote-consent-worker`; backward compatible, opt-in): deploy; rollback = redeploy version `8c1fa242-bf63-432b-bded-cf6f13b07cbf` (`2125a34`). No migration. Check: Worker tests 107/107; the old page still saves exactly as before; a flagged probe returns 409 without creating a row.
4. **Then the page** (`ceo/p0-quote-consent-site` + the cache-key commit): deploy to production Pages; rollback = Pages production deployment `8d4a440c` (`c6d62a6`). Check on the live page with a mobile viewport and **intercepted** `/bookings` (no real booking): the exact itinerary shows 142, receives a mocked 409, shows the review notice and 300.45, and the resubmission carries 300.45.
5. **Post-release:** watch `booking_events` for `pricing_adjustment` (old cached pages, FijiDash) and for 409s in a live tail; confirm no booking shows a saved amount different from what the guest accepted.
6. **Residual risk (stated):** a guest on a cached old page (up to 4 h) is still repriced silently; this is now recorded, not prevented. Prevention requires either flipping the Worker default for all callers (which would affect FijiDash and needs its own review) or waiting out the cache window.
