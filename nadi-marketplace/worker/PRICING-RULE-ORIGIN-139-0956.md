# Origin of the FJ$139 starting amount and the FJ$0.956/km coefficient (minibus, 35-70 km)

> **HOLD** - James's instruction, 2026-10-05: all three Momi final-fare releases are on hold and production is unchanged. This note is evidence reporting only; it proposes and changes nothing.

**Question:** where do `flagfall_fjd = 139.00` and `base_rate_fjd_per_km = 0.956` (the live `pricing_rules` row for minibus, 35 <= km < 70) come from?

**Answer, with the original evidence:** they are **ordinary-least-squares regression coefficients fitted to five of the website's own published minibus SELLING prices** (`price = flagfall + rate x km`), not an operating-cost build-up.

| Link in the chain | Evidence (commit / file) |
|---|---|
| Rows exist | `nadi-marketplace/schema.sql` (current): `('minibus', 35, 70, 0.956, 139.00)`; live D1 snapshot read-only 2026-10-05 identical (`pricing_rules`, minibus 35-70: flagfall 139, rate 0.956) |
| Applied to live D1 | `nadi-marketplace/migrations/milestone9-pricing-refit.sql`, line `UPDATE pricing_rules SET flagfall_fjd = 139.00, base_rate_fjd_per_km = 0.956 WHERE id = 13; -- 35-70km`. Commit `7ce19901a4ab0e2968546afc8591a14647746316`, 2026-07-22 14:34 +1000, author James Richardson (co-authored by an AI session): "Pricing refit: real least-squares fit replaces Milestone 9's eyeballed bands" |
| Method as documented | The commit message, the migration header and `nadi-marketplace/README.md` ("Pricing refit"): ordinary least-squares per vehicle type and per distance band "against all 35 real ftt-booking-site ROUTES_DATA routes"; "Full derivation ... reviewed and approved by James before this was applied" |
| Data actually fitted | Reproduced here from `ftt-booking-site/src/app.js` **as it was at that commit** (`7ce1990:ftt-booking-site/src/app.js`): the minibus routes with 35 <= km < 70 are Natadola InterContinental (38 km, published FJ$179), Robinson Crusoe (50 km, 179), Sigatoka Sand Dunes (60 km, 199), Bedarra Inn (62 km, 199), Kula Eco (62 km, 199) and Marriott Momi Bay (42 km, 79). The migration excluded Momi's 79 as "a known live-table data-entry error". **OLS on the five remaining points gives slope 0.956 and intercept 139.00 exactly**; including Momi's 79 it would have given 2.793 and 26.17 |
| What preceded it | Commit `7574ac5b9669e6a041f7e0a6c012bd6a6e3fcc4b` (2026-07-22 12:51, "milestone 9: geocode + real-distance pricing"): `pricing_rules` had been empty since Milestone 1; its first values (minibus 35-70: 3.145/km, flagfall 34) were "fitted by eye ('checked within ~15% of real actuals')" from the "implied $/km across all 35 live ROUTES_DATA routes" and confirmed with James before populating. The refit replaced them about 1 hour 43 minutes later |

**Consequences that follow from the evidence (facts, not inferences about cost):**

1. The prices the regression was fitted to are the website's **pre-discount published prices** (the 10% discount is applied on top by the pages and, since Milestone 18, by the Worker after the formula). So the formula is a smoothed reproduction of the published pre-discount table, and 175.92 (= 139 + 0.956 x 38.623 km) is what that smoothing gives for Momi. The 175.92 you approved coincides with this formula output and with a pre-discount basis (published Natadola minibus, 38 km, is 179 before discount, 161 after).
2. The Momi minibus datapoint was **not** an input to the fit; 175.92 is an extrapolation of a line through other routes' published prices. The refit's own notes flagged Momi's 79 as an error and "flagged for a content check ... independent of this work" - the content was left at 79 until the 2026-10-05 approval.
3. The README states the band "rests on" published prices; it records **no operator cost, driver payout, fuel cost per km or margin** as an input to 139 or 0.956. The `FUEL_MULTIPLIER_BASELINE_FJD = 3.93` comment in `worker.js` refers to a fuel *multiplier reference point*; the fuel multiplier is recorded on bookings but does not enter the fare (`computeFareFjdDetailed` ignores it), so no fuel-cost derivation of these coefficients exists in the code.

**What is UNKNOWN:** whether the original published prices (179 / 199) were themselves derived from operator costs, competitor prices or judgement - no document in the repository says. The derivation artifact that James reviewed ("published as an artifact") is referenced in the README but is **not in the repository** (not retrievable here). Actual operating costs behind these coefficients: **UNKNOWN**; none should be inferred from them.

Reproduce: `git show 7ce1990:ftt-booking-site/src/app.js` and run an ordinary-least-squares fit of price on km over the minibus rows with 35 <= km < 70, excluding `MARRIOTT_MOMI` (script used: five points, slope 0.956, intercept 139).
