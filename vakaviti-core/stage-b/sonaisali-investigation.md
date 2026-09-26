# Sonaisali variance — root-cause investigation (Issue #38 Step 5)

No production change made. All evidence below is from read-only calls (re-verified fresh at time of writing) plus arithmetic on already-public numbers.

## The numbers, side by side

| Vehicle | bookfijitransfers.com (live, re-verified) | nadi-dispatch-api shadow reference fare (live, re-verified) | Absolute variance | % variance |
|---|---|---|---|---|
| sedan | **$69** | **$78.83** (22.09 km) | −$9.83 | −12.5% |
| minivan | **$89** | **$101.46** (22.09 km) | −$12.46 | −12.3% |
| minibus | **$119** | **$131.46** (22.09 km) | −$12.46 | −9.5% |

Direction: **bft is cheaper than the shadow reference fare on this one route** — the opposite direction from every other tested route (which all ran bft *higher*, growing with distance). This is exactly why it was called out separately rather than lumped into the general "marketplace markup" pattern.

## Point-by-point, per Step 5's exact required determinations

- **Exact current public/storefront price:** confirmed above, re-fetched live this pass (not reused from the earlier session).
- **Exact shadow/reference price:** confirmed above, re-fetched live this pass.
- **Vehicle class:** all three of bft's classes tested; the effect is present on all three, ruling out a single-vehicle-only data entry error.
- **Route/distance inputs:** nadi-dispatch's `Sonaisali` zone anchor is a fixed lat/lng centroid (`-17.8225, 177.3634`), `remote_multiplier: 1` (no remoteness surcharge applied — unlike Ba/Rakiraki which carry a 1.37× multiplier), with a live Google-Maps-derived driving distance of 22.09 km for this request. **bft's `/api/quotes` response contains no `distanceKm` or duration field at all**, for this or any other route tested — this is the most important single piece of evidence in this investigation (see below).
- **Fixed fare or dynamic fare:** strong evidence for **fixed**. Every bft quote response observed across all 9 tested destinations returns only `{quoteId, pricingVersionId: "baseline-v1", fares: {...}, currency, expiresAt, pricePromise}` — no distance, no duration, no per-km rate, nothing that looks like a live computation. `pricingVersionId: "baseline-v1"` reads as a versioned *table*, not a versioned *formula*. nadi-dispatch, by contrast, always returns a real `distance_km` that changes only if Google's route changes — the two systems are very likely architecturally different (fixed table vs. live distance formula), not just numerically different.
- **Discount/promotion applied:** no promotion for Sonaisali was found anywhere on the live site (unlike the confirmed, explicit Port Denarau launch-special banner). Absence of evidence isn't proof of absence, but nothing observable supports a promotion explanation here.
- **Marketplace payout/margin logic:** cannot be determined — would require access to bft's backend/source, which remains unlocated (Issue #39). Flagged, not guessed at.
- **Place/route mapping difference:** checked specifically and **ruled unlikely** — nadi-dispatch's guest-facing hotel picker already maps "DoubleTree Sonaisali" (the specific hotel bft's `sonaisali` slug labels) onto this exact same `Sonaisali` zone anchor; there is only one Sonaisali-area zone in nadi-dispatch's model, so there's no plausible alternate, closer zone bft could be resolving to instead.
- **Stale/manual pricing:** consistent with the evidence (see the back-solve below), but not provable without bft's own change history.
- **Confidence in explanation:** **medium** on "this is a fixed table, not a live distance computation" (well-evidenced, see below); **low** on the specific reason that table's Sonaisali entry sits ~10-12% below nadi-dispatch's formula for this corridor specifically.

## The back-solve that shaped this conclusion

If bft secretly ran the *exact same* tiered formula as nadi-dispatch but with a different distance input, the implied distance should be one consistent number across all three vehicle classes (each vehicle's flagfall/rate differ, but they'd all be solving for the same real-world km). Solving each vehicle's live fare against nadi-dispatch's own published tier constants for the 15-35km band:

- sedan → implies 15.82 km
- minivan → implies 17.34 km
- minibus → implies 17.34 km

Minivan and minibus agree with each other; sedan doesn't quite agree with them (15.82 vs 17.34, an ~1.5km/9% internal inconsistency) — a real single shared "true" distance doesn't cleanly reconcile all three. Combined with bft never exposing a distance value anywhere in its own API, the more likely explanation is that bft **isn't computing this from distance at all** — it's a fixed number someone set per destination, and this fixed number is close-but-not-derived-from nadi-dispatch's formula, not a live computation using a shorter distance.

## Bottom line

**This is very likely an independently-maintained fixed-price table (hypothesis 3 from Step 7), not a routing bug, a promotion, or a place-mapping error.** Whether that table's Sonaisali entry is intentionally competitive, simply older/less-rigorously-fitted than nadi-dispatch's Google-Maps-driven formula, or reflects a real contracted operator rate for that specific resort cannot be confirmed without bft's own source or a conversation with whoever set it — this report stops at the evidence rather than guessing the business reason. **Not fixed. Not harmonized. Reported for a human decision, per instruction.**
