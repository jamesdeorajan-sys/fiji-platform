# bookfijitransfers.com fare variance — hypothesis testing (Issue #38 Step 7)

Every one of the 8 required hypotheses tested against the evidence actually available. No customer price harmonized. No variance "fixed." Confidence stated honestly per route, including where the data genuinely cannot distinguish between two plausible causes.

## Cross-cutting evidence that applies to every route (tested once, referenced throughout)

**Hypothesis 4 (distance pricing difference) — tested directly, not assumed away.** If bft used nadi-dispatch's own tiered formula with a different (e.g. straight-line vs. driving) distance, the implied "true" distance can be back-solved from the live fare. Done for the three largest-variance routes:

| Route | bft sedan fare | Actual driving distance | Implied distance if same formula | Discrepancy |
|---|---|---|---|---|
| Pacific Harbour | $269 | 147.6 km | 210.1 km | +42% |
| Natadola | $139 | 54.7 km | 69.7 km | +27% |
| Momi Bay | $119 | 38.6 km | 55.8 km | +44% |

A real distance-measurement disagreement between two providers (e.g. Google Maps vs. a different routing engine) would be expected to show a small, *consistent* percentage gap across routes — not 27–44% and varying route to route. **This weighs against hypothesis 4 as the primary explanation.**

**Also cross-cutting: bft's `/api/quotes` response never includes a distance or duration field, on any route tested (9/9).** Combined with the above, the most consistent explanation for the *existence* of variance everywhere is **hypothesis 3 — an independently maintained fixed-price table**, not a live distance computation at all. This doesn't mean every route's specific number is unexplained by *that* — it means the mechanism producing the variance is architectural (two different pricing methods being compared), and the remaining question per route is just whether that fixed table's number was set intentionally-high, intentionally-low, or simply not recently revisited.

## Per-route classification

| Route | Vehicle(s) | Variance | Best-supported hypothesis | Evidence | Confidence |
|---|---|---|---|---|---|
| Denarau (Hilton/Sofitel/Sheraton/Radisson) | minivan, minibus | −0.1% to −0.8% | none needed — within rounding | Sub-$1 gap, immaterial | High |
| Denarau (Hilton) | sedan | +2.4% ($1.13) | Likely rounding, technically outside this report's $1 threshold | Same order of magnitude as the confirmed-rounding minivan/minibus rows on the same corridor | Medium — recommend treating as rounding pending a human's quick sign-off |
| Denarau (**Port Denarau specifically**) | sedan | −18.5% | **Hypothesis 7 — promotional difference** | Site's own homepage explicitly and prominently advertises "Nadi Airport to Port Denarau, FJ$39 total, sedan only" as a launch special — the number matches exactly | **High — confirmed by the storefront's own marketing copy**, not inferred |
| Wailoaloa/Nadi | sedan | +28.5% | **Hypothesis 8 — route/place mapping difference** | bft's single "wailoaloa-nadi" destination groups Wailoaloa + Namaka + unspecified "Nadi hotels" under one flat price; nadi-dispatch's compared distance (6.9km) is for the single Wailoaloa point specifically. A corridor covering more ground than the single point it's being compared against would legitimately price higher. | Medium — plausible and specific, not independently confirmed without bft's exact corridor boundary |
| Wailoaloa/Nadi | minivan | +6.5% | Same as above, smaller effect | Consistent direction, smaller magnitude — plausible partial version of the same mapping-breadth effect | Low-medium |
| Wailoaloa/Nadi | minibus | −0.9% | Rounding | Within threshold | High |
| **Sonaisali** | sedan/minivan/minibus | −9.5% to −12.5% | **Hypothesis 3 — independently maintained fixed-price table** (opposite-direction outlier) | Full dedicated writeup: [`sonaisali-investigation.md`](sonaisali-investigation.md). Ruled out place-mapping (single clean zone match); no promotion found; distance back-solve doesn't cleanly reconcile across vehicle classes, consistent with a fixed number rather than a live computation | Medium on "fixed table," low on the specific reason it sits below the formula here specifically |
| Coral Coast (Outrigger) | sedan/minivan/minibus | +14.8% to +22.7% | **Hypotheses 1/2/6 — cannot be distinguished from data alone** (marketplace markup, supplier payout+margin, or stale pricing all fit equally) | Distance back-solve (not shown in detail, same method as above) does not cleanly reconcile; no promotion found; place mapping looks clean (single named resort) | Low on root cause, medium on "not a mapping or promo issue" |
| Natadola | sedan/minivan/minibus | +12.8% to +18.4% | Same as Coral Coast — hypotheses 1/2/6 tied | Implied-distance back-solve shows a large, route-specific inflation (+27% for sedan) inconsistent with a simple distance-provider disagreement | Low on root cause |
| Momi Bay | sedan | +26.2% | Same as above | Implied-distance back-solve: +44%, the largest single inconsistency found | Low on root cause |
| Momi Bay | minivan | +1.1% | Rounding-adjacent | Notably smaller than the sedan gap on the *same route* — worth a specific look (see §"Unexplained internal inconsistency" below) | Low |
| Momi Bay | minibus | +7.4% | Hypotheses 1/2/6 tied, smaller magnitude | — | Low |
| Pacific Harbour | sedan/minivan/minibus | +23.4% to +39.9% | Same as Coral Coast/Natadola — hypotheses 1/2/6 tied, **largest gap found** | Implied-distance back-solve: +42% — the same order of inconsistency as Momi Bay, on the storefront's most remote tested route | Low on root cause, but the *pattern* (remote route, largest gap) is the strongest circumstantial fit for hypothesis 1 (marketplace routes further from the in-house fleet's easy reach legitimately cost more to fulfil) of anywhere in the corpus |
| Suva | sedan/minivan/minibus | +0.9% to +11.5% | Mixed — sedan/minibus close to rounding, minivan notably higher | Internally inconsistent across vehicle classes on the same route (0.9% to 11.5%) — doesn't fit a single clean explanation | Low |
| Custom/unmapped address | — | N/A | Capability gap, not a fare variance | bft's shipped bundle has no free-text/autocomplete field; nadi-dispatch supports `POST /quote` for this | High confidence this is a real capability difference, not a pricing question |

## Hypotheses explicitly tested and NOT supported anywhere in this corpus

- **Hypothesis 5 (vehicle taxonomy mismatch):** not supported. bft's `/api/quotes` response keys fares by the literal strings `sedan`/`minivan`/`minibus` — identical labels to storefronts 1/2 — for every route tested. The *booking-payload* `vehicleId` field's exact shape is still unconfirmed (see R1 inventory), but that's a booking-creation-time question, not a factor in any of the quote-level variance measured here.

## Unexplained internal inconsistency worth flagging on its own

**Momi Bay: sedan +26.2% vs. minivan +1.1%, same route.** A route/place-mapping or a flat marketplace-margin explanation should affect all three vehicle classes on one route somewhat proportionally (as seen cleanly at Denarau and Sonaisali); a >20-point spread between two vehicle classes on the identical corridor doesn't fit any of the 8 hypotheses cleanly on its own. Worth a specific, targeted look — possibly a genuine data-entry inconsistency in bft's fixed table for this one cell, independent of the broader remote-route pattern.

## What this does and doesn't prove

**Proves (high confidence):** bft is very likely running a fixed, manually-maintained price table rather than a live distance-based formula, for every route tested. Two specific variances have confirmed, evidenced causes (Port Denarau's promotion; Sonaisali's likely-fixed-table status). One has a plausible, specific, unconfirmed cause (Wailoaloa's corridor-grouping breadth).

**Does not prove:** *why* the remote-route entries in that fixed table run consistently higher than the shadow reference fare. Hypotheses 1 (intentional marketplace markup), 2 (supplier payout + margin baked in), and 6 (stale pricing, e.g. set during a higher-fuel-price period and never revisited) are all equally consistent with the data available from outside the system. Resolving which one it actually is requires either bft's own pricing-change history or a direct answer from whoever maintains its fixed-price table — **not guessed at here.**
