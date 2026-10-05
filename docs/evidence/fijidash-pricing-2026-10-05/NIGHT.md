# Night pricing: release blocker B1 (reproduction only; no commercial rule changed or approved)

Actual client code (NAT `c5ee3b1`, FijiDash production `8c6f920`, FijiDash candidate) and the actual deployed Worker (`7a32a034` bundle) run together in the isolated harness (`reconciliation/night.mjs`; assertions in `night-boundaries.test.mjs`). Outbound blocked, no live booking.

## What was reproduced

1. **Boundaries agree.** The client and the Worker both treat 22:00 and 05:59 as night and 21:59 and 06:00 as day (Hilton sedan: Worker 47.87 at 21:59 and 06:00, 51.44 at 22:00 and 05:59).
2. **FijiDash (production and candidate) never charge the surcharge on a live-fare route.** At all four times the selection (candidate), review, submitted and SAVED amount is the day fare (47.87). At 22:00 and 05:59 the Worker's own figure is 51.44, which it would only apply if it replaced the page's amount; it does not, because 47.87 is inside its 0.8x-1.3x band. The reference fare the page uses has no night component.
3. **NAT (static table) does include a night modifier** (49 -> 54 at 22:00) and the Worker keeps it, so NAT and FijiDash disagree with each other at night for the same route.
4. **The return pickup time is ignored by both the client and the Worker.** Only the OUTBOUND time decides night. Outbound 10:00 with a 23:00 or 05:59 return: no surcharge anywhere. Outbound 23:00 with a 10:00 return: the whole return fare is surcharged (Worker 95.27 vs 79.56 by day, Hilton sedan). Outbound 21:59 with a 22:00 return: no surcharge.
5. **Inconsistency inside the candidate on Momi at night:** one-way minibus 157.92 (live fare, no surcharge) but return 355 (page convention, includes the page night modifier), against 297 by day.
6. The page still says "Night surcharge applied" at night and the FAQ promises 20%, while the FijiDash amounts exclude it.

## Decision needed from James (not made here)

Apply the 20% to the live fare (selection = review = Worker), apply it to neither, or keep it only on static-table sites; and whether a night RETURN pickup should count. Until then the candidate is **not releasable** on night pricing.

## Full table (selection -> review -> submitted -> Worker-calculated -> saved)

| Site | Route / vehicle | Trip | Outbound pickup | Return pickup | Selection | Review | Submitted | Worker-calculated | Saved | Class |
|---|---|---|---|---|---|---|---|---|---|---|
| NAT live c5ee3b1 | HILTON_DENARAU sedan | one-way | 21:59 | - | 49 | 49 | 49 | 47.87 | 49 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | HILTON_DENARAU sedan | one-way | 22:00 | - | 54 | 54 | 54 | 51.44 | 54 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | HILTON_DENARAU sedan | one-way | 05:59 | - | 54 | 54 | 54 | 51.44 | 54 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | HILTON_DENARAU sedan | one-way | 06:00 | - | 49 | 49 | 49 | 47.87 | 49 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | HILTON_DENARAU sedan | return | 10:00 | 23:00 | 85 | 85 | 85 | 79.56 | 85 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | HILTON_DENARAU sedan | return | 10:00 | 05:59 | 85 | 85 | 85 | 79.56 | 85 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | HILTON_DENARAU sedan | return | 23:00 | 10:00 | 99 | 99 | 99 | 95.27 | 99 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | HILTON_DENARAU sedan | return | 23:00 | 23:00 | 99 | 99 | 99 | 95.27 | 99 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | HILTON_DENARAU sedan | return | 21:59 | 22:00 | 85 | 85 | 85 | 79.56 | 85 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | HILTON_DENARAU sedan | return | 10:00 | 10:00 | 85 | 85 | 85 | 79.56 | 85 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MARRIOTT_MOMI minibus | one-way | 21:59 | - | 157.92 | 157.92 | 157.92 | 157.92 | 157.92 | MATCH |
| NAT live c5ee3b1 | MARRIOTT_MOMI minibus | one-way | 22:00 | - | 193 | 193 | 193 | 190.10 | 193 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MARRIOTT_MOMI minibus | one-way | 05:59 | - | 193 | 193 | 193 | 190.10 | 193 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MARRIOTT_MOMI minibus | one-way | 06:00 | - | 157.92 | 157.92 | 157.92 | 157.92 | 157.92 | MATCH |
| NAT live c5ee3b1 | MARRIOTT_MOMI minibus | return | 10:00 | 23:00 | 297 | 297 | 297 | 292.45 | 297 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MARRIOTT_MOMI minibus | return | 10:00 | 05:59 | 297 | 297 | 297 | 292.45 | 297 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MARRIOTT_MOMI minibus | return | 23:00 | 10:00 | 355 | 355 | 355 | 351.54 | 355 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MARRIOTT_MOMI minibus | return | 23:00 | 23:00 | 355 | 355 | 355 | 351.54 | 355 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MARRIOTT_MOMI minibus | return | 21:59 | 22:00 | 297 | 297 | 297 | 292.45 | 297 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MARRIOTT_MOMI minibus | return | 10:00 | 10:00 | 297 | 297 | 297 | 292.45 | 297 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MERCURE_NADI minivan | one-way | 21:59 | - | 49 | 49 | 49 | 46.42 | 49 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MERCURE_NADI minivan | one-way | 22:00 | - | 54 | 54 | 54 | 55.70 | 54 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MERCURE_NADI minivan | one-way | 05:59 | - | 54 | 54 | 54 | 55.70 | 54 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MERCURE_NADI minivan | one-way | 06:00 | - | 49 | 49 | 49 | 46.42 | 49 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MERCURE_NADI minivan | return | 10:00 | 23:00 | 85 | 85 | 85 | 85.13 | 85 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MERCURE_NADI minivan | return | 10:00 | 05:59 | 85 | 85 | 85 | 85.13 | 85 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MERCURE_NADI minivan | return | 23:00 | 10:00 | 99 | 99 | 99 | 103.15 | 99 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MERCURE_NADI minivan | return | 23:00 | 23:00 | 99 | 99 | 99 | 103.15 | 99 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MERCURE_NADI minivan | return | 21:59 | 22:00 | 85 | 85 | 85 | 85.13 | 85 | IN_BAND_DIFFERENCE |
| NAT live c5ee3b1 | MERCURE_NADI minivan | return | 10:00 | 10:00 | 85 | 85 | 85 | 85.13 | 85 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | HILTON_DENARAU sedan | one-way | 21:59 | - | 49 | 47.87 | 47.87 | 47.87 | 47.87 | MATCH |
| FijiDash production 8c6f920 | HILTON_DENARAU sedan | one-way | 22:00 | - | 54 | 47.87 | 47.87 | 51.44 | 47.87 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | HILTON_DENARAU sedan | one-way | 05:59 | - | 54 | 47.87 | 47.87 | 51.44 | 47.87 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | HILTON_DENARAU sedan | one-way | 06:00 | - | 49 | 47.87 | 47.87 | 47.87 | 47.87 | MATCH |
| FijiDash production 8c6f920 | HILTON_DENARAU sedan | return | 10:00 | 23:00 | 85 | 79.56 | 79.56 | 79.56 | 79.56 | MATCH |
| FijiDash production 8c6f920 | HILTON_DENARAU sedan | return | 10:00 | 05:59 | 85 | 79.56 | 79.56 | 79.56 | 79.56 | MATCH |
| FijiDash production 8c6f920 | HILTON_DENARAU sedan | return | 23:00 | 10:00 | 99 | 79.56 | 79.56 | 95.27 | 79.56 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | HILTON_DENARAU sedan | return | 23:00 | 23:00 | 99 | 79.56 | 79.56 | 95.27 | 79.56 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | HILTON_DENARAU sedan | return | 21:59 | 22:00 | 85 | 79.56 | 79.56 | 79.56 | 79.56 | MATCH |
| FijiDash production 8c6f920 | HILTON_DENARAU sedan | return | 10:00 | 10:00 | 85 | 79.56 | 79.56 | 79.56 | 79.56 | MATCH |
| FijiDash production 8c6f920 | MARRIOTT_MOMI minibus | one-way | 21:59 | - | 71 | 157.92 | 157.92 | 157.92 | 157.92 | MATCH |
| FijiDash production 8c6f920 | MARRIOTT_MOMI minibus | one-way | 22:00 | - | 85 | 157.92 | 157.92 | 190.10 | 157.92 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | MARRIOTT_MOMI minibus | one-way | 05:59 | - | 85 | 157.92 | 157.92 | 190.10 | 157.92 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | MARRIOTT_MOMI minibus | one-way | 06:00 | - | 71 | 157.92 | 157.92 | 157.92 | 157.92 | MATCH |
| FijiDash production 8c6f920 | MARRIOTT_MOMI minibus | return | 10:00 | 23:00 | 135 | 292.45 | 292.45 | 292.45 | 292.45 | MATCH |
| FijiDash production 8c6f920 | MARRIOTT_MOMI minibus | return | 10:00 | 05:59 | 135 | 292.45 | 292.45 | 292.45 | 292.45 | MATCH |
| FijiDash production 8c6f920 | MARRIOTT_MOMI minibus | return | 23:00 | 10:00 | 162 | 292.45 | 292.45 | 351.54 | 292.45 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | MARRIOTT_MOMI minibus | return | 23:00 | 23:00 | 162 | 292.45 | 292.45 | 351.54 | 292.45 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | MARRIOTT_MOMI minibus | return | 21:59 | 22:00 | 135 | 292.45 | 292.45 | 292.45 | 292.45 | MATCH |
| FijiDash production 8c6f920 | MARRIOTT_MOMI minibus | return | 10:00 | 10:00 | 135 | 292.45 | 292.45 | 292.45 | 292.45 | MATCH |
| FijiDash production 8c6f920 | MERCURE_NADI minivan | one-way | 21:59 | - | 49 | 46.42 | 46.42 | 46.42 | 46.42 | MATCH |
| FijiDash production 8c6f920 | MERCURE_NADI minivan | one-way | 22:00 | - | 54 | 46.42 | 46.42 | 55.70 | 46.42 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | MERCURE_NADI minivan | one-way | 05:59 | - | 54 | 46.42 | 46.42 | 55.70 | 46.42 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | MERCURE_NADI minivan | one-way | 06:00 | - | 49 | 46.42 | 46.42 | 46.42 | 46.42 | MATCH |
| FijiDash production 8c6f920 | MERCURE_NADI minivan | return | 10:00 | 23:00 | 85 | 85.13 | 85.13 | 85.13 | 85.13 | MATCH |
| FijiDash production 8c6f920 | MERCURE_NADI minivan | return | 10:00 | 05:59 | 85 | 85.13 | 85.13 | 85.13 | 85.13 | MATCH |
| FijiDash production 8c6f920 | MERCURE_NADI minivan | return | 23:00 | 10:00 | 99 | 85.13 | 85.13 | 103.15 | 85.13 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | MERCURE_NADI minivan | return | 23:00 | 23:00 | 99 | 85.13 | 85.13 | 103.15 | 85.13 | IN_BAND_DIFFERENCE |
| FijiDash production 8c6f920 | MERCURE_NADI minivan | return | 21:59 | 22:00 | 85 | 85.13 | 85.13 | 85.13 | 85.13 | MATCH |
| FijiDash production 8c6f920 | MERCURE_NADI minivan | return | 10:00 | 10:00 | 85 | 85.13 | 85.13 | 85.13 | 85.13 | MATCH |
| FijiDash candidate | HILTON_DENARAU sedan | one-way | 21:59 | - | 47.87 | 47.87 | 47.87 | 47.87 | 47.87 | MATCH |
| FijiDash candidate | HILTON_DENARAU sedan | one-way | 22:00 | - | 47.87 | 47.87 | 47.87 | 51.44 | 47.87 | IN_BAND_DIFFERENCE |
| FijiDash candidate | HILTON_DENARAU sedan | one-way | 05:59 | - | 47.87 | 47.87 | 47.87 | 51.44 | 47.87 | IN_BAND_DIFFERENCE |
| FijiDash candidate | HILTON_DENARAU sedan | one-way | 06:00 | - | 47.87 | 47.87 | 47.87 | 47.87 | 47.87 | MATCH |
| FijiDash candidate | HILTON_DENARAU sedan | return | 10:00 | 23:00 | 79.56 | 79.56 | 79.56 | 79.56 | 79.56 | MATCH |
| FijiDash candidate | HILTON_DENARAU sedan | return | 10:00 | 05:59 | 79.56 | 79.56 | 79.56 | 79.56 | 79.56 | MATCH |
| FijiDash candidate | HILTON_DENARAU sedan | return | 23:00 | 10:00 | 79.56 | 79.56 | 79.56 | 95.27 | 79.56 | IN_BAND_DIFFERENCE |
| FijiDash candidate | HILTON_DENARAU sedan | return | 23:00 | 23:00 | 79.56 | 79.56 | 79.56 | 95.27 | 79.56 | IN_BAND_DIFFERENCE |
| FijiDash candidate | HILTON_DENARAU sedan | return | 21:59 | 22:00 | 79.56 | 79.56 | 79.56 | 79.56 | 79.56 | MATCH |
| FijiDash candidate | HILTON_DENARAU sedan | return | 10:00 | 10:00 | 79.56 | 79.56 | 79.56 | 79.56 | 79.56 | MATCH |
| FijiDash candidate | MARRIOTT_MOMI minibus | one-way | 21:59 | - | 157.92 | 157.92 | 157.92 | 157.92 | 157.92 | MATCH |
| FijiDash candidate | MARRIOTT_MOMI minibus | one-way | 22:00 | - | 157.92 | 157.92 | 157.92 | 190.10 | 157.92 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MARRIOTT_MOMI minibus | one-way | 05:59 | - | 157.92 | 157.92 | 157.92 | 190.10 | 157.92 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MARRIOTT_MOMI minibus | one-way | 06:00 | - | 157.92 | 157.92 | 157.92 | 157.92 | 157.92 | MATCH |
| FijiDash candidate | MARRIOTT_MOMI minibus | return | 10:00 | 23:00 | 297 | 297 | 297 | 292.45 | 297 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MARRIOTT_MOMI minibus | return | 10:00 | 05:59 | 297 | 297 | 297 | 292.45 | 297 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MARRIOTT_MOMI minibus | return | 23:00 | 10:00 | 355 | 355 | 355 | 351.54 | 355 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MARRIOTT_MOMI minibus | return | 23:00 | 23:00 | 355 | 355 | 355 | 351.54 | 355 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MARRIOTT_MOMI minibus | return | 21:59 | 22:00 | 297 | 297 | 297 | 292.45 | 297 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MARRIOTT_MOMI minibus | return | 10:00 | 10:00 | 297 | 297 | 297 | 292.45 | 297 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MERCURE_NADI minivan | one-way | 21:59 | - | 46.42 | 46.42 | 46.42 | 46.42 | 46.42 | MATCH |
| FijiDash candidate | MERCURE_NADI minivan | one-way | 22:00 | - | 46.42 | 46.42 | 46.42 | 55.70 | 46.42 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MERCURE_NADI minivan | one-way | 05:59 | - | 46.42 | 46.42 | 46.42 | 55.70 | 46.42 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MERCURE_NADI minivan | one-way | 06:00 | - | 46.42 | 46.42 | 46.42 | 46.42 | 46.42 | MATCH |
| FijiDash candidate | MERCURE_NADI minivan | return | 10:00 | 23:00 | 85.13 | 85.13 | 85.13 | 85.13 | 85.13 | MATCH |
| FijiDash candidate | MERCURE_NADI minivan | return | 10:00 | 05:59 | 85.13 | 85.13 | 85.13 | 85.13 | 85.13 | MATCH |
| FijiDash candidate | MERCURE_NADI minivan | return | 23:00 | 10:00 | 85.13 | 85.13 | 85.13 | 103.15 | 85.13 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MERCURE_NADI minivan | return | 23:00 | 23:00 | 85.13 | 85.13 | 85.13 | 103.15 | 85.13 | IN_BAND_DIFFERENCE |
| FijiDash candidate | MERCURE_NADI minivan | return | 21:59 | 22:00 | 85.13 | 85.13 | 85.13 | 85.13 | 85.13 | MATCH |
| FijiDash candidate | MERCURE_NADI minivan | return | 10:00 | 10:00 | 85.13 | 85.13 | 85.13 | 85.13 | 85.13 | MATCH |
