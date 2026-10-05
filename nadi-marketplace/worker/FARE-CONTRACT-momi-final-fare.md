# Fare contract: legacy pre-discount reference amounts versus the approved FINAL fare (Momi minibus)

> **HOLD** - James's instruction, 2026-10-05: all three Momi final-fare releases are on hold; production unchanged. This document only removes ambiguity; it changes no behaviour and decides nothing.

Reconciled against the actual code of the Worker candidate (`pricing.mjs`, `worker.js`: `computeRealReferenceFare`, `computeAuthoritativePrice`, `createBookingRecord`), the NAT and FijiDash pages, and the isolated test grid. The same word, "reference fare", currently names **two different amounts** in the Worker, and several earlier statements in this review blurred them. Corrections are listed at the end.

## The amounts, defined once

| Name used here | Where it appears (field / function) | Includes the 10% discount? | Includes extras? | Includes night? | Includes the return multiplier? |
|---|---|---|---|---|---|
| **Published base** (catalogue) | page `ROUTES_DATA` `s` / `v` / `m`; `state.prices[vehicle]` | **No** - it is the pre-discount list price (the pages discount it afterwards) | No | No (the page applies its own modifier first when night/return) | via the page's own x1.85 and round-up |
| **Formula fare, pre-discount** (LEGACY reference amount) | `GET /reference-fare` -> `reference_fare_fjd`; `computeRealReferenceFare`; the negotiation floor | **No** | **No** | **No** | Yes (`trip_type`), no round-up |
| **Authoritative pre-discount subtotal** | `computeAuthoritativePrice().transferPlusExtrasFjd` (internal; the name is misleading: it **does** include extras and night) | No | **Yes** | **Yes** | Yes |
| **Calculated total** (Worker, "reference" in a 409) | `POST /bookings` 409 `reference_fare_fjd`; `pricing_decision.calculated_amount_fjd` = the authoritative subtotal after `applyLoyaltyDiscount` | **Yes** (whole-dollar `Math.round(10%)` above FJ$50) | Yes | Yes | Yes |
| **Quoted total** | what a page shows the guest (`calculateTotal().final`, the price block, the confirmation, the WhatsApp text) | Yes (except an approved final fare) | Yes | Yes | Yes |
| **Submitted amount** | `quoted_amount` in the booking request | = quoted total (cents) | | | |
| **Saved / recorded amount** | `bookings.quoted_amount`, response `booking.quoted_amount`, staff alert text, driver broadcast | whatever was kept or replaced (see the 0.8-1.3x band rule) | | | |
| **Approved final fare** (new) | `APPROVED_FINAL_FARES.MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY` = FJ$175.92; page `approvedFinalFareFor` | **Already included - never deducted again** | **No - not approved with extras** | **No - daytime only** | One-way only (the return 297 / 304 is a separate approval) |

**Key point.** For the one approved journey the legacy pre-discount reference amount (`GET /reference-fare`) is **numerically equal** to the approved final fare (both 175.92) **by coincidence of history**, not because the two are the same concept: 175.92 = 139 + 0.956 x 38.623 km is the formula's PRE-discount output, which James has now approved as the quoted/recorded FINAL amount (see `PRICING-RULE-ORIGIN-139-0956.md`). The page must therefore never treat a reference fare as final in general (FijiDash replaces its price with the reference fare at review and then applies the discount; that is correct for every other fare and is exactly the double discount the approved journey must avoid). What prevents the second discount is the explicit **approved-final-fare branch** in `calculateTotal` and in the Worker, **not** the equality of the two numbers.

## The contract for the approved journey (unchanged by this document)

Nadi Airport -> Fiji Marriott Resort Momi Bay, minibus, one-way, daytime pickup (06:00-21:59), no child seat, no surfboard, no tour, no custom address: quoted total = submitted amount = saved amount = **175.92**; the Worker's calculated total for the named approved id is **175.92** (not the formula-then-discount 157.92). Any other combination is priced by the unchanged formula + discount rules.

## What the contract does NOT say (open - see MOMI-DECISION-TABLE.md)

How the 175.92 combines with extras; what it becomes at night; whether other vehicles/hotels follow. Until James decides, the transfer component of an itinerary with extras or a night pickup is **not** the approved final fare; it falls back to the existing arithmetic, which produces the two price inversions recorded as release blockers.

## Corrections to earlier statements in this review (the earlier text is not rewritten; this list supersedes it)

1. "The booking system's reference fare (pre-discount formula figure) equals the final fare, so nothing is discounted again" (journey test message, package, AGENT_SYNC entry) - **wrong reasoning**: nothing is discounted again because of the approved-final-fare branch; the equality is incidental. The legacy reference amount remains PRE-discount.
2. "`reference_fare_fjd`" without qualification - it means the **pre-discount formula fare** in `GET /reference-fare` but the **post-discount calculated total including extras and night** in a `POST /bookings` 409. Anything that reads both fields must not assume they are comparable.
3. "All other pricing unchanged" - must be read with two explicit exclusions on FijiDash: (a) the Momi minibus **catalogue** figure 79 -> 175.92 (moves all 16 Momi minibus selection figures); (b) the Momi minibus **return review** figures (292.45 etc. -> the approved page convention 297 / 304 etc., 8 cells). Verified cell by cell in `integration/scope-grid.test.mjs`.
4. "Held broad candidate untouched" remains true, but it also assumes the 157.92 reading and would need rebasing.
