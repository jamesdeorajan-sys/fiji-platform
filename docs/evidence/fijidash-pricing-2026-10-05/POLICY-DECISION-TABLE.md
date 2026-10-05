# Pricing-policy decision table (for James) - 2026-10-05

**Production remains on HOLD. This is a decision aid, not a release and not a recommendation of any fare.** Every figure below is computed from numbers that already exist (the published catalogue `ROUTES_DATA`, the Worker's distance formula, and each side's own arithmetic) in the isolated harness (real page code + the real deployed Worker bundle `7a32a034` + the read-only pricing snapshot of 2026-10-05; outbound blocked). No fare was invented, fuel adjustments are NOT enabled (the fuel index is unchanged: multiplier 1, FJ$3.39/L), and no live booking, message or production write was made. Tick boxes (`[ ]`) are for James.

## What is approved, and what is not

**Approved by James (2026-10-05), and preserved in every comparison below:** Marriott Momi Bay **MINIBUS** - base FJ$175.92 before the 10% discount; one-way **157.92**; day return **297**; day return with a child seat **304** (the existing Nadi convention). Wherever a Worker-formula figure differs from these (292.45 / 300.45) it is shown for information only and is marked as an alternative that **would change this approval**.

**NOT approved:** anything for Momi sedan or minivan (the held candidate currently extends the return convention to them - see 1b, decision E1), and every other route, night rule, rounding rule and the Tanoa fare. "Catalogue" below means the fares published in the booking tool / route pages (`ROUTES_DATA`) - published, **not** approved as the commercially intended fare. "Worker" means the distance formula in the booking Worker - also not approved.

## 1. Published catalogue versus Worker formula, every disputed route

Basis: day pickup 10:00, no extras, arrival (airport -> destination), totals as the guest sees them (after the existing 10% discount). 210 route/vehicle/trip cases are priceable (Tanoa International has no Worker rule, see section 4). **Disputed = the two differ by more than FJ$5 and by more than 5% of the Worker figure: 108 cases on 28 routes.** 4 of them are outside the Worker's 0.8x-1.3x acceptance band (the Worker would refuse the catalogue figure under the quote-consent opt-in); the rest differ but sit inside the band (the Worker keeps the shown figure). The other 102 cases agree to within FJ$5 / 5% and need no decision beyond the global policy. The Momi rows are excluded here and set out in section 1b, because part of Momi is approved and part is not. The full 210-row table (Momi included) is in `policy_catalogue_vs_worker.csv`.

"Charged today" = what is actually saved today: **NAT** (page quotes the catalogue); **FD prod** = FijiDash production (its review step swaps in the Worker figure, so it charges the Worker figure on every priceable route, except when the live lookup fails); **FD cand** = the held candidate (Worker figure, except Momi return = catalogue convention).

Decision per row: **A** = catalogue is the fare (Worker/live fare must follow it), **B** = Worker formula is the fare (catalogue and pages must follow it), **C** = another figure (James supplies it). A global choice can be recorded once in the last section.

| Route | Vehicle | Trip | Catalogue base (before discount) | Catalogue total | Worker total | Catalogue - Worker | In band? | NAT charges | FD prod charges | FD cand charges | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BA_HOTEL | minivan | one-way | 199 | 179 | 194.05 | -15.05 (-8%) | yes | 179 | 194.05 | 194.05 | A / B / C: ____ |
| BA_HOTEL | minivan | return | 199 | 333 | 359.69 | -26.69 (-7%) | yes | 333 | 359.69 | 359.69 | A / B / C: ____ |
| BA_HOTEL | minibus | one-way | 249 | 224 | 242.12 | -18.12 (-7%) | yes | 224 | 242.12 | 242.12 | A / B / C: ____ |
| BA_HOTEL | minibus | return | 249 | 418 | 447.87 | -29.87 (-7%) | yes | 418 | 447.87 | 447.87 | A / B / C: ____ |
| BEACHHOUSE_FIJI | sedan | one-way | 169 | 152 | 127.96 | +24.04 (19%) | yes | 152 | 127.96 | 127.96 | A / B / C: ____ |
| BEACHHOUSE_FIJI | sedan | return | 169 | 283 | 236.63 | +46.37 (20%) | yes | 283 | 236.63 | 236.63 | A / B / C: ____ |
| BEACHHOUSE_FIJI | minivan | one-way | 199 | 179 | 158.81 | +20.19 (13%) | yes | 179 | 158.81 | 158.81 | A / B / C: ____ |
| BEACHHOUSE_FIJI | minivan | return | 199 | 333 | 294.10 | +38.90 (13%) | yes | 333 | 294.10 | 294.10 | A / B / C: ____ |
| BEACHHOUSE_FIJI | minibus | one-way | 259 | 233 | 197.37 | +35.63 (18%) | yes | 233 | 197.37 | 197.37 | A / B / C: ____ |
| BEACHHOUSE_FIJI | minibus | return | 259 | 432 | 364.83 | +67.17 (18%) | yes | 432 | 364.83 | 364.83 | A / B / C: ____ |
| BEDARRA_INN | sedan | one-way | 129 | 116 | 124.49 | -8.49 (-7%) | yes | 116 | 124.49 | 124.49 | A / B / C: ____ |
| BEDARRA_INN | sedan | return | 129 | 216 | 230.21 | -14.21 (-6%) | yes | 216 | 230.21 | 230.21 | A / B / C: ____ |
| CROWNE_PLAZA_NADI_BAY | sedan | one-way | 39 | 39 | 30.36 | +8.64 (28%) | yes | 39 | 30.36 | 30.36 | A / B / C: ____ |
| CROWNE_PLAZA_NADI_BAY | sedan | return | 39 | 67 | 50.17 | +16.83 (34%) | **no (refused)** | refused at 67: guest must accept the Worker fare | 50.17 | 50.17 | A / B / C: ____ |
| CROWNE_PLAZA_NADI_BAY | minivan | one-way | 59 | 53 | 46.63 | +6.37 (14%) | yes | 53 | 46.63 | 46.63 | A / B / C: ____ |
| CROWNE_PLAZA_NADI_BAY | minivan | return | 59 | 99 | 85.52 | +13.48 (16%) | yes | 99 | 85.52 | 85.52 | A / B / C: ____ |
| CROWNE_PLAZA_NADI_BAY | minibus | one-way | 89 | 80 | 71.70 | +8.30 (12%) | yes | 80 | 71.70 | 71.70 | A / B / C: ____ |
| CROWNE_PLAZA_NADI_BAY | minibus | return | 89 | 148 | 132.45 | +15.55 (12%) | yes | 148 | 132.45 | 132.45 | A / B / C: ____ |
| CRUSOES_RETREAT | sedan | one-way | 129 | 116 | 127.96 | -11.96 (-9%) | yes | 116 | 127.96 | 127.96 | A / B / C: ____ |
| CRUSOES_RETREAT | sedan | return | 129 | 216 | 236.63 | -20.63 (-9%) | yes | 216 | 236.63 | 236.63 | A / B / C: ____ |
| CRUSOES_RETREAT | minivan | one-way | 159 | 143 | 158.81 | -15.81 (-10%) | yes | 143 | 158.81 | 158.81 | A / B / C: ____ |
| CRUSOES_RETREAT | minivan | return | 159 | 265 | 294.10 | -29.10 (-10%) | yes | 265 | 294.10 | 294.10 | A / B / C: ____ |
| CRUSOES_RETREAT | minibus | one-way | 199 | 179 | 197.37 | -18.37 (-9%) | yes | 179 | 197.37 | 197.37 | A / B / C: ____ |
| CRUSOES_RETREAT | minibus | return | 199 | 333 | 364.83 | -31.83 (-9%) | yes | 333 | 364.83 | 364.83 | A / B / C: ____ |
| DOUBLETREE_SONAISALI | sedan | one-way | 69 | 62 | 70.83 | -8.83 (-12%) | yes | 62 | 70.83 | 70.83 | A / B / C: ____ |
| DOUBLETREE_SONAISALI | sedan | return | 69 | 117 | 130.84 | -13.84 (-11%) | yes | 117 | 130.84 | 130.84 | A / B / C: ____ |
| DOUBLETREE_SONAISALI | minivan | one-way | 89 | 80 | 91.46 | -11.46 (-13%) | yes | 80 | 91.46 | 91.46 | A / B / C: ____ |
| DOUBLETREE_SONAISALI | minivan | return | 89 | 148 | 168.70 | -20.70 (-12%) | yes | 148 | 168.70 | 168.70 | A / B / C: ____ |
| DOUBLETREE_SONAISALI | minibus | one-way | 119 | 107 | 118.46 | -11.46 (-10%) | yes | 107 | 118.46 | 118.46 | A / B / C: ____ |
| DOUBLETREE_SONAISALI | minibus | return | 119 | 202 | 219.20 | -17.20 (-8%) | yes | 202 | 219.20 | 219.20 | A / B / C: ____ |
| FIRST_LANDING | sedan | return | 79 | 135 | 123.83 | +11.17 (9%) | yes | 135 | 123.83 | 123.83 | A / B / C: ____ |
| FIRST_LANDING | minivan | return | 99 | 166 | 157.33 | +8.67 (6%) | yes | 166 | 157.33 | 157.33 | A / B / C: ____ |
| HIDEAWAY_RESORT | sedan | one-way | 129 | 116 | 127.96 | -11.96 (-9%) | yes | 116 | 127.96 | 127.96 | A / B / C: ____ |
| HIDEAWAY_RESORT | sedan | return | 129 | 216 | 236.63 | -20.63 (-9%) | yes | 216 | 236.63 | 236.63 | A / B / C: ____ |
| HIDEAWAY_RESORT | minivan | one-way | 159 | 143 | 158.81 | -15.81 (-10%) | yes | 143 | 158.81 | 158.81 | A / B / C: ____ |
| HIDEAWAY_RESORT | minivan | return | 159 | 265 | 294.10 | -29.10 (-10%) | yes | 265 | 294.10 | 294.10 | A / B / C: ____ |
| HIDEAWAY_RESORT | minibus | one-way | 199 | 179 | 197.37 | -18.37 (-9%) | yes | 179 | 197.37 | 197.37 | A / B / C: ____ |
| HIDEAWAY_RESORT | minibus | return | 199 | 333 | 364.83 | -31.83 (-9%) | yes | 333 | 364.83 | 364.83 | A / B / C: ____ |
| HILTON_DENARAU | sedan | return | 49 | 85 | 79.56 | +5.44 (7%) | yes | 85 | 79.56 | 79.56 | A / B / C: ____ |
| INTERCONTINENTAL_NATADOLA | sedan | one-way | 99 | 89 | 105.43 | -16.43 (-16%) | yes | 89 | 105.43 | 105.43 | A / B / C: ____ |
| INTERCONTINENTAL_NATADOLA | sedan | return | 99 | 166 | 195.25 | -29.25 (-15%) | yes | 166 | 195.25 | 195.25 | A / B / C: ____ |
| INTERCONTINENTAL_NATADOLA | minibus | one-way | 179 | 161 | 172.31 | -11.31 (-7%) | yes | 161 | 172.31 | 172.31 | A / B / C: ____ |
| INTERCONTINENTAL_NATADOLA | minibus | return | 179 | 301 | 318.92 | -17.92 (-6%) | yes | 301 | 318.92 | 318.92 | A / B / C: ____ |
| KULA_ECO | sedan | one-way | 129 | 116 | 124.49 | -8.49 (-7%) | yes | 116 | 124.49 | 124.49 | A / B / C: ____ |
| KULA_ECO | sedan | return | 129 | 216 | 230.21 | -14.21 (-6%) | yes | 216 | 230.21 | 230.21 | A / B / C: ____ |
| LAUTOKA_CRUISE | sedan | return | 89 | 148 | 139.53 | +8.47 (6%) | yes | 148 | 139.53 | 139.53 | A / B / C: ____ |
| LAUTOKA_CRUISE | minivan | one-way | 119 | 107 | 99.22 | +7.78 (8%) | yes | 107 | 99.22 | 99.22 | A / B / C: ____ |
| LAUTOKA_CRUISE | minivan | return | 119 | 202 | 183.91 | +18.09 (10%) | yes | 202 | 183.91 | 183.91 | A / B / C: ____ |
| LAUTOKA_CRUISE | minibus | one-way | 149 | 134 | 126.22 | +7.78 (6%) | yes | 134 | 126.22 | 126.22 | A / B / C: ____ |
| LAUTOKA_CRUISE | minibus | return | 149 | 252 | 233.41 | +18.59 (8%) | yes | 252 | 233.41 | 233.41 | A / B / C: ____ |
| LAUTOKA_HOTEL | sedan | return | 89 | 148 | 139.53 | +8.47 (6%) | yes | 148 | 139.53 | 139.53 | A / B / C: ____ |
| LAUTOKA_HOTEL | minivan | one-way | 119 | 107 | 99.22 | +7.78 (8%) | yes | 107 | 99.22 | 99.22 | A / B / C: ____ |
| LAUTOKA_HOTEL | minivan | return | 119 | 202 | 183.91 | +18.09 (10%) | yes | 202 | 183.91 | 183.91 | A / B / C: ____ |
| LAUTOKA_HOTEL | minibus | one-way | 149 | 134 | 126.22 | +7.78 (6%) | yes | 134 | 126.22 | 126.22 | A / B / C: ____ |
| LAUTOKA_HOTEL | minibus | return | 149 | 252 | 233.41 | +18.59 (8%) | yes | 252 | 233.41 | 233.41 | A / B / C: ____ |
| MERCURE_NADI | sedan | one-way | 19 | 19 | 30.15 | -11.15 (-37%) | **no (refused)** | refused at 19: guest must accept the Worker fare | 30.15 | 30.15 | A / B / C: ____ |
| MERCURE_NADI | sedan | return | 19 | 40 | 49.78 | -9.78 (-20%) | yes | 40 | 49.78 | 49.78 | A / B / C: ____ |
| NADI_DOWNTOWN | sedan | one-way | 19 | 19 | 30.15 | -11.15 (-37%) | **no (refused)** | refused at 19: guest must accept the Worker fare | 30.15 | 30.15 | A / B / C: ____ |
| NADI_DOWNTOWN | sedan | return | 19 | 40 | 49.78 | -9.78 (-20%) | yes | 40 | 49.78 | 49.78 | A / B / C: ____ |
| NAUSORI_AIRPORT | minivan | one-way | 499 | 449 | 421.69 | +27.31 (6%) | yes | 449 | 421.69 | 421.69 | A / B / C: ____ |
| NAUSORI_AIRPORT | minivan | return | 499 | 832 | 780.08 | +51.92 (7%) | yes | 832 | 780.08 | 780.08 | A / B / C: ____ |
| NAVITI_RESORT | sedan | return | 149 | 252 | 236.63 | +15.37 (6%) | yes | - | 236.63 | 236.63 | A / B / C: ____ |
| NAVITI_RESORT | minivan | one-way | 189 | 170 | 158.81 | +11.19 (7%) | yes | - | 158.81 | 158.81 | A / B / C: ____ |
| NAVITI_RESORT | minivan | return | 189 | 315 | 294.10 | +20.90 (7%) | yes | - | 294.10 | 294.10 | A / B / C: ____ |
| NAVITI_RESORT | minibus | one-way | 239 | 215 | 197.37 | +17.63 (9%) | yes | - | 197.37 | 197.37 | A / B / C: ____ |
| NAVITI_RESORT | minibus | return | 239 | 400 | 364.83 | +35.17 (10%) | yes | - | 364.83 | 364.83 | A / B / C: ____ |
| OUTRIGGER_FIJI | sedan | one-way | 129 | 116 | 127.96 | -11.96 (-9%) | yes | 116 | 127.96 | 127.96 | A / B / C: ____ |
| OUTRIGGER_FIJI | sedan | return | 129 | 216 | 236.63 | -20.63 (-9%) | yes | 216 | 236.63 | 236.63 | A / B / C: ____ |
| OUTRIGGER_FIJI | minivan | one-way | 159 | 143 | 158.81 | -15.81 (-10%) | yes | 143 | 158.81 | 158.81 | A / B / C: ____ |
| OUTRIGGER_FIJI | minivan | return | 159 | 265 | 294.10 | -29.10 (-10%) | yes | 265 | 294.10 | 294.10 | A / B / C: ____ |
| OUTRIGGER_FIJI | minibus | one-way | 199 | 179 | 197.37 | -18.37 (-9%) | yes | 179 | 197.37 | 197.37 | A / B / C: ____ |
| OUTRIGGER_FIJI | minibus | return | 199 | 333 | 364.83 | -31.83 (-9%) | yes | 333 | 364.83 | 364.83 | A / B / C: ____ |
| PORT_DENARAU_MARINA | sedan | return | 49 | 85 | 79.56 | +5.44 (7%) | yes | 85 | 79.56 | 79.56 | A / B / C: ____ |
| ROBINSON_CRUSOE | sedan | one-way | 99 | 89 | 105.43 | -16.43 (-16%) | yes | 89 | 105.43 | 105.43 | A / B / C: ____ |
| ROBINSON_CRUSOE | sedan | return | 99 | 166 | 195.25 | -29.25 (-15%) | yes | 166 | 195.25 | 195.25 | A / B / C: ____ |
| ROBINSON_CRUSOE | minibus | one-way | 179 | 161 | 172.31 | -11.31 (-7%) | yes | 161 | 172.31 | 172.31 | A / B / C: ____ |
| ROBINSON_CRUSOE | minibus | return | 179 | 301 | 318.92 | -17.92 (-6%) | yes | 301 | 318.92 | 318.92 | A / B / C: ____ |
| SHANGRI_LA_YANUCA | sedan | one-way | 129 | 116 | 127.96 | -11.96 (-9%) | yes | 116 | 127.96 | 127.96 | A / B / C: ____ |
| SHANGRI_LA_YANUCA | sedan | return | 129 | 216 | 236.63 | -20.63 (-9%) | yes | 216 | 236.63 | 236.63 | A / B / C: ____ |
| SHANGRI_LA_YANUCA | minivan | one-way | 159 | 143 | 158.81 | -15.81 (-10%) | yes | 143 | 158.81 | 158.81 | A / B / C: ____ |
| SHANGRI_LA_YANUCA | minivan | return | 159 | 265 | 294.10 | -29.10 (-10%) | yes | 265 | 294.10 | 294.10 | A / B / C: ____ |
| SHANGRI_LA_YANUCA | minibus | one-way | 199 | 179 | 197.37 | -18.37 (-9%) | yes | 179 | 197.37 | 197.37 | A / B / C: ____ |
| SHANGRI_LA_YANUCA | minibus | return | 199 | 333 | 364.83 | -31.83 (-9%) | yes | 333 | 364.83 | 364.83 | A / B / C: ____ |
| SIGATOKA_SAND_DUNES | sedan | one-way | 129 | 116 | 124.49 | -8.49 (-7%) | yes | 116 | 124.49 | 124.49 | A / B / C: ____ |
| SIGATOKA_SAND_DUNES | sedan | return | 129 | 216 | 230.21 | -14.21 (-6%) | yes | 216 | 230.21 | 230.21 | A / B / C: ____ |
| SOFITEL_DENARAU | sedan | return | 49 | 85 | 79.56 | +5.44 (7%) | yes | 85 | 79.56 | 79.56 | A / B / C: ____ |
| TANOA_LAUTOKA | sedan | return | 89 | 148 | 139.53 | +8.47 (6%) | yes | 148 | 139.53 | 139.53 | A / B / C: ____ |
| TANOA_LAUTOKA | minivan | one-way | 119 | 107 | 99.22 | +7.78 (8%) | yes | 107 | 99.22 | 99.22 | A / B / C: ____ |
| TANOA_LAUTOKA | minivan | return | 119 | 202 | 183.91 | +18.09 (10%) | yes | 202 | 183.91 | 183.91 | A / B / C: ____ |
| TANOA_LAUTOKA | minibus | one-way | 149 | 134 | 126.22 | +7.78 (6%) | yes | 134 | 126.22 | 126.22 | A / B / C: ____ |
| TANOA_LAUTOKA | minibus | return | 149 | 252 | 233.41 | +18.59 (8%) | yes | 252 | 233.41 | 233.41 | A / B / C: ____ |
| THE_WARWICK | sedan | return | 149 | 252 | 236.63 | +15.37 (6%) | yes | 252 | 236.63 | 236.63 | A / B / C: ____ |
| THE_WARWICK | minivan | one-way | 189 | 170 | 158.81 | +11.19 (7%) | yes | 170 | 158.81 | 158.81 | A / B / C: ____ |
| THE_WARWICK | minivan | return | 189 | 315 | 294.10 | +20.90 (7%) | yes | 315 | 294.10 | 294.10 | A / B / C: ____ |
| THE_WARWICK | minibus | one-way | 239 | 215 | 197.37 | +17.63 (9%) | yes | 215 | 197.37 | 197.37 | A / B / C: ____ |
| THE_WARWICK | minibus | return | 239 | 400 | 364.83 | +35.17 (10%) | yes | 400 | 364.83 | 364.83 | A / B / C: ____ |
| VOLIVOLI_BEACH | minivan | one-way | 299 | 269 | 290.72 | -21.72 (-7%) | yes | 269 | 290.72 | 290.72 | A / B / C: ____ |
| VOLIVOLI_BEACH | minivan | return | 299 | 499 | 537.03 | -38.03 (-7%) | yes | 499 | 537.03 | 537.03 | A / B / C: ____ |
| VOLIVOLI_BEACH | minibus | one-way | 349 | 314 | 335.44 | -21.44 (-6%) | yes | 314 | 335.44 | 335.44 | A / B / C: ____ |
| VOLIVOLI_BEACH | minibus | return | 349 | 585 | 620.01 | -35.01 (-6%) | yes | 585 | 620.01 | 620.01 | A / B / C: ____ |
| VUDA_MARINA | sedan | return | 79 | 135 | 123.83 | +11.17 (9%) | yes | 135 | 123.83 | 123.83 | A / B / C: ____ |
| VUDA_MARINA | minivan | return | 99 | 166 | 157.33 | +8.67 (6%) | yes | 166 | 157.33 | 157.33 | A / B / C: ____ |
| WAILOALOA_BEACH | sedan | one-way | 39 | 39 | 30.36 | +8.64 (28%) | yes | 39 | 30.36 | 30.36 | A / B / C: ____ |
| WAILOALOA_BEACH | sedan | return | 39 | 67 | 50.17 | +16.83 (34%) | **no (refused)** | refused at 67: guest must accept the Worker fare | 50.17 | 50.17 | A / B / C: ____ |
| WAILOALOA_BEACH | minivan | one-way | 59 | 53 | 46.63 | +6.37 (14%) | yes | 53 | 46.63 | 46.63 | A / B / C: ____ |
| WAILOALOA_BEACH | minivan | return | 59 | 99 | 85.52 | +13.48 (16%) | yes | 99 | 85.52 | 85.52 | A / B / C: ____ |
| WAILOALOA_BEACH | minibus | one-way | 89 | 80 | 71.70 | +8.30 (12%) | yes | 80 | 71.70 | 71.70 | A / B / C: ____ |
| WAILOALOA_BEACH | minibus | return | 89 | 148 | 132.45 | +15.55 (12%) | yes | 148 | 132.45 | 132.45 | A / B / C: ____ |

Priority routes: **Momi** is in 1b. **Nadi / Mercure** - sedan one-way catalogue 19 vs Worker 30.15, outside the band. **Wailoaloa / Crowne Plaza** - sedan return catalogue 67 vs Worker 50.17, outside the band. Nadi downtown and Mercure sedan one-way, and Wailoaloa and Crowne Plaza sedan return, are the four cases the Worker would refuse.

### 1b. Momi Bay: the approved minibus is separate from any sedan / minivan extension

**1b-i. Momi MINIBUS - APPROVED (preserved).** Day pickup 10:00. "Approved" is James's figure; "Worker formula" is information only and is NOT proposed.

| Case | **Approved** | Worker formula (information) | Worker - approved | Candidate saves | FD production saves today | NAT saves |
|---|---|---|---|---|---|---|
| One-way | **157.92** | 157.92 | 0 | 157.92 | 157.92 | 157.92 |
| Return | **297** | 292.45 | -4.55 | 297 | 292.45 (the Worker figure: production does not follow the approval) | 297 |
| Return + child seat | **304** | 300.45 | -3.55 | 304 | 300.45 (the Worker figure: production does not follow the approval) | 304 |

The candidate and NAT both save exactly the approved figures (checked by this script, which stops otherwise). Adopting the Worker figure for the minibus return would change the approved 297 to 292.45 and 304 to 300.45; that is **not** proposed.

**1b-ii. Momi SEDAN and MINIVAN - NOT approved (extension decision E1).** The approval above was for the minibus figures. The held candidate nevertheless applies the same return convention to the sedan and minivan returns (code scope: Momi, all vehicles, return trips), so those two rows are a change nobody has approved.

| Vehicle | Trip | Catalogue total | Worker total | NAT saves | FD production saves | FD candidate saves today |
|---|---|---|---|---|---|---|
| sedan | one-way | 89 | 85.29 | 89 | 85.29 | 85.29 (Worker figure) |
| sedan | return | 166 | 157.44 | 166 | 157.44 | 166 (convention extended: UNAPPROVED) |
| minivan | one-way | 134 | 132.42 | 134 | 132.42 | 132.42 (Worker figure) |
| minivan | return | 252 | 245.73 | 252 | 245.73 | 252 (convention extended: UNAPPROVED) |

Options (nothing is implemented):

- **E1a Approval stays minibus-only.** Momi sedan/minivan return follow the global policy. On FijiDash that means the Worker figures (157.44 / 245.73) unless James chooses otherwise; NAT keeps its catalogue (166 / 252). The candidate would need a one-line scope change (minibus only) - not made here.
- **E1b Extend the return convention to Momi sedan and minivan returns** (what the candidate does today): 166 / 252, equal to NAT. FijiDash returns rise by 8.56 / 6.27 versus what production charges today.
- **E1c Extend the catalogue to Momi sedan and minivan one-way as well:** 89 / 134 (NAT today) instead of the Worker figures 85.29 / 132.42 that FijiDash charges today.

Decision E1: **[ ] E1a  [ ] E1b  [ ] E1c**. (The minibus approval is unaffected by any E1 choice.)

## 2. Night surcharge: options, with day / night-arrival / night-return / both-night totals

Today (facts, reproduced in `NIGHT.md`): the client and the Worker agree night = pickup 22:00-05:59 (21:59 and 06:00 are day). FijiDash (production and candidate) saves the **day** fare at night on every live-fare route; NAT (static table) applies the page's own night modifier (x1.2, then rounded up to FJ$5). Neither the page nor the Worker looks at the return pickup time. The FAQ and the "Night surcharge applied" label say 20% applies.

Options (the figures are computed with each side's existing arithmetic; **no new surcharge rate, no new fare**):

- **N0 No night surcharge anywhere** (what FijiDash saves today). Pages, FAQ and label stop claiming it; NAT's static modifier and the Worker's night step are removed.
- **N1 Existing Worker rule on the live fare** (x1.2 on the whole transfer when the OUTBOUND pickup is night; return pickup ignored; extras added after; 10% discount after). Changes FijiDash only; Worker unchanged. Selection = review = Worker.
- **N2 Per-leg surcharge** (each leg whose own pickup is 22:00-05:59 is surcharged). Needs new Worker and page code and the return-pickup time on the booking. **Every N2 figure below rests on the allocation assumption stated next.**
- **N3 Static-table convention everywhere** (the page's modifier: x1.2 and x1.85, rounded UP to the next FJ$5, outbound time only). Needs the Worker to adopt the round-up (otherwise in-band differences continue). This is what NAT shows today.

**Allocation assumption behind every per-leg (N2) figure - AL-1, the only one used in the tables:**

1. A return is two legs of EQUAL price: each leg is exactly half of the return fare as it stands before night, extras and discount. Worker basis: return = 1.85 x one-way, so each leg = 0.925 x the one-way fare, no rounding (cents). Momi minibus approved basis: return = 330 before discount, so each leg = 165.
2. A leg is a night leg when ITS OWN pickup time is 22:00-05:59 (the same boundaries as today). A night leg is multiplied by 1.2; a day leg by 1. The two legs are then added; nothing is rounded up to FJ$5 on the Worker basis.
3. Extras (child seat 8 / surfboard 24) are added once, after the legs, and belong to neither leg. The 10% discount is applied once to the final subtotal (whole dollars, above FJ$50). A one-way trip is one leg at its full fare.
4. **This allocation is an assumption, not a rule that exists anywhere.** Today no system prices legs separately; the Worker prices a return as one fare and the booking records one outbound pickup time and a return time that is not used for pricing. A different split changes every N2 total: see the sensitivity table after the options (AL-2).

Totals (guest-visible, no extras, after the 10% discount where it applies). Base = the published catalogue one-way figure; Worker one-way = the formula figure before discount. N0 uses the Worker formula figure (what FijiDash production saves today); the held candidate shows the catalogue convention instead for Momi return (297), which is the N3 column.

**MARRIOTT_MOMI minibus - APPROVED BASIS.** Day figures are James's approved 157.92 one-way and **297** return; every option below keeps the approved day figures and builds the night figures on the approved pre-discount figures (175.92 one-way, 330 return). The right-hand columns show the Worker-formula basis for information: they would **change the approved day return 297 to 292.45** and are not proposed.

| Scenario | N0 none | N1 x1.2 on the approved figure | N2 per-leg (AL-1, 165 per leg) | N3 static convention (NAT today) | *Worker basis N1 (changes 297)* | *Worker basis N2 (changes 297)* |
|---|---|---|---|---|---|---|
| One-way, day | 157.92 | 157.92 | 157.92 | 157.92 | *157.92* | *157.92* |
| One-way, night pickup | 157.92 | 190.10 | 190.10 | 193 | *190.10* | *190.10* |
| Return: day out / day back | 297 | 297 | 297 | 297 | *292.45* | *292.45* |
| Return: NIGHT ARRIVAL (out night, back day) | 297 | 356 | 327 | 355 | *351.54* | *322* |
| Return: NIGHT RETURN pickup (out day, back night) | 297 | 297 | 327 | 297 | *292.45* | *322* |
| Return: BOTH night | 297 | 356 | 356 | 355 | *351.54* | *351.54* |

**HILTON_DENARAU sedan** - catalogue one-way base 49, Worker one-way before discount 47.87

| Scenario | N0 none (FD today) | N1 Worker rule on live fare | N2 per-leg (AL-1) | N3 static convention (NAT today) |
|---|---|---|---|---|
| One-way, day | 47.87 | 47.87 | 47.87 | 49 |
| One-way, night pickup | 47.87 | 51.44 | 51.44 | 54 |
| Return: day out / day back | 79.56 | 79.56 | 79.56 | 85 |
| Return: NIGHT ARRIVAL (out night, back day) | 79.56 | 95.27 | 87.42 | 99 |
| Return: NIGHT RETURN pickup (out day, back night) | 79.56 | 79.56 | 87.42 | 85 |
| Return: BOTH night | 79.56 | 95.27 | 95.27 | 99 |

**MERCURE_NADI sedan** - catalogue one-way base 19, Worker one-way before discount 30.15

| Scenario | N0 none (FD today) | N1 Worker rule on live fare | N2 per-leg (AL-1) | N3 static convention (NAT today) |
|---|---|---|---|---|
| One-way, day | 30.15 | 30.15 | 30.15 | 19 |
| One-way, night pickup | 30.15 | 36.18 | 36.18 | 25 |
| Return: day out / day back | 49.78 | 49.78 | 49.78 | 40 |
| Return: NIGHT ARRIVAL (out night, back day) | 49.78 | 59.93 | 55.36 | 45 |
| Return: NIGHT RETURN pickup (out day, back night) | 49.78 | 49.78 | 55.36 | 40 |
| Return: BOTH night | 49.78 | 59.93 | 59.93 | 45 |

**GRAND_PACIFIC minivan** - catalogue one-way base 369, Worker one-way before discount 357.92

| Scenario | N0 none (FD today) | N1 Worker rule on live fare | N2 per-leg (AL-1) | N3 static convention (NAT today) |
|---|---|---|---|---|
| One-way, day | 321.92 | 321.92 | 321.92 | 332 |
| One-way, night pickup | 321.92 | 386.50 | 386.50 | 400 |
| Return: day out / day back | 596.15 | 596.15 | 596.15 | 616 |
| Return: NIGHT ARRIVAL (out night, back day) | 596.15 | 715.58 | 655.37 | 738 |
| Return: NIGHT RETURN pickup (out day, back night) | 596.15 | 596.15 | 655.37 | 616 |
| Return: BOTH night | 596.15 | 715.58 | 715.58 | 738 |

**Sensitivity of N2 to the allocation assumption** (Hilton Denarau sedan, Worker basis, return trips). AL-1 = equal legs (each 0.925 x one-way). AL-2 = outbound leg is the full one-way fare and the return leg is 0.85 x one-way (same 1.85 total). Both are assumptions; neither exists in any system today.

| Return scenario | AL-1 equal legs | AL-2 outbound 1.00 / return 0.85 |
|---|---|---|
| Return: day out / day back | 79.56 | 79.56 |
| Return: NIGHT ARRIVAL (out night, back day) | 87.42 | 88.13 |
| Return: NIGHT RETURN pickup (out day, back night) | 87.42 | 86.70 |
| Return: BOTH night | 95.27 | 95.27 |

Cross-checks run before this table was written: the Worker-basis N1 arithmetic equals the real Worker's saved amount in all six scenarios for all four cases, the N3 arithmetic equals the real page's quote, and the approved Momi minibus day return is 297 in every option (the script stops if any of these differs). N2 has no real system to check against: it depends only on AL-1 above.

**What each night option requires** (nothing is applied):

| Option | Worker | FijiDash page | NAT page | Advertised text |
|---|---|---|---|---|
| N0 | remove the night step (or leave it: the page figure is always in band) | already the behaviour; remove the label "Night surcharge applied" | remove the page modifier (night quotes drop to the day figure) | delete "20% night surcharge" from the FAQ in both sites (the FAQ line in `app.js`) |
| N1 | none | add x1.2 to the live fare when the outbound pickup is night (selection and review) | unchanged (static modifier already similar but rounds up to FJ$5) | FAQ stays; the label becomes true. Say plainly that only the OUTBOUND pickup time counts |
| N2 | new per-leg logic; needs `return_time` in the pricing step; new `pricing_version` | new arithmetic | new arithmetic | FAQ rewritten: surcharge per leg |
| N3 | adopt FJ$5 round-up for modifier fares (or accept in-band differences) | selection/review use the static figure again (the live fare would no longer be shown) | unchanged | FAQ stays; label true |

Decision: night option **[ ] N0  [ ] N1  [ ] N2  [ ] N3**.  Does a night RETURN pickup count (matters for N2 only, and for N1/N3 it is ignored today): **[ ] yes  [ ] no**.

## 3. Exact treatment of return discounts, rounding and extras

| Step | Page (published-table path) | Worker (`computeAuthoritativePrice` + `applyLoyaltyDiscount`) |
|---|---|---|
| One-way base | the published figure for the route and vehicle (whole dollars), else a distance formula rounded up to FJ$5 | flagfall + rate x distance for the distance band (zone-pair distance table), x the destination zone multiplier (1.37 for Ba and Rakiraki, otherwise 1), rounded to cents. The fuel index (currently multiplier 1) is only RECORDED on the booking; it does not enter the fare, so no option here depends on fuel |
| Return | x1.85 of the one-way base, then **rounded UP to the next FJ$5** (only when a modifier applies) | x1.85 of the one-way fare, cents, **no round-up** |
| "Return discount" | none beyond the x1.85 (about 7.5% below two one-ways). The FAQ line "discounted vs two one-ways" describes this | same |
| Night | x1.2 on the base, applied before the return multiplier, outbound pickup only, then round up to FJ$5 | x1.2 on the whole transfer, outbound pickup only, cents |
| Extras | child seat FJ$8, surfboard FJ$24, **once per booking**, never multiplied by return or night, added BEFORE the discount | same: added once, before the discount |
| Discount | 10% of the subtotal, **whole dollars (`Math.round`)**, only when the subtotal exceeds FJ$50, never with a tour | identical function (`applyLoyaltyDiscount`) |
| Where they can differ | the FJ$5 round-up and the catalogue base itself | cents vs whole dollars; the formula base |

Rounding is a real, separate source of difference: across the 105 priceable return cases the page's round-up adds between FJ$0.35 and FJ$4.85 (mean FJ$2.47) to the pre-discount return fare compared with x1.85 alone.

Worked examples (all computed, none invented):

| Case | Page arithmetic | Worker arithmetic | Difference |
|---|---|---|---|
| Momi minibus one-way (approved) | 175.92 - 18 = **157.92** | 175.92 - 18 = **157.92** | 0 |
| Momi minibus return (approved convention) | 330 - 33 = **297** | 325.45 - 33 = **292.45** | 4.55 |
| Momi minibus return + child seat (approved convention) | 338 - 34 = **304** | 333.45 - 33 = **300.45** | 3.55 |
| Hilton Denarau sedan return | 95 - 10 = **85** | 88.56 - 9 = **79.56** | 5.44 |
| Hilton Denarau sedan return + child seat | 103 - 10 = **93** | 96.56 - 10 = **86.56** | 6.44 |

Harmonisation options (apply only to the **path that quotes**; the extras and discount functions already match):

- **R1 Page convention everywhere:** the Worker adopts the FJ$5 round-up for return and night fares. Returns rise by up to FJ$5 versus today's Worker figures; one-way is unchanged. Needs a Worker change and a new `pricing_version`.
- **R2 Worker convention everywhere:** the page drops the round-up (cents). Static catalogue returns fall by up to FJ$5; pages that print return figures must be re-derived.
- **R3 Status quo (tolerance):** both stay; differences inside the 0.8x-1.3x band are kept as shown. This is why 794 NAT and 818 FijiDash static rows differ in the reconciliation and is the option that keeps the current Momi exception.

Decision: **[ ] R1  [ ] R2  [ ] R3**.  Extras and the 10% discount: **[ ] keep as is** (they already match).

## 4. Tanoa International Hotel: the missing pricing rule

Facts: the booking tool and route pages quote **FJ$15 sedan / FJ$25 minivan / FJ$45 minibus** one-way (return by the page convention: 30 / 50 / 85 before discount). The destination resolves to the zone "Nadi Airport", the same as the pickup, so the Worker has no distance and no rule and cannot compute a reference fare. With the real Worker bundle: an amount of 5 is saved as **5**, 15 as **15**, 500 as **500** (each recorded `client_trusted_authoritative_unavailable`). The Worker therefore trusts whatever the client sends for this route; it never refuses or reprices it.

| Option | What it means | Needs from James |
|---|---|---|
| T1 Explicit fixed-fare rule | Add a fixed-fare entry for Nadi Airport <-> Tanoa International so the Worker can verify it | the three one-way fares (and confirmation the page convention applies to returns) - **not invented here** |
| T2 Treat as an existing zone | Map the hotel to the neighbouring "Nadi" zone and use the formula | confirmation that is the intended fare. For reference only, the formula fares for Nadi are: FJ$30.15 / FJ$51.42 / FJ$79.46 before discount (sedan / minivan / minibus) - this is not a proposal |
| T3 Quote on request | Remove Tanoa from the instant-booking tool and the pages' fixed table; guests are quoted by the team | nothing numeric; pages must be edited |
| T4 Status quo | Keep FJ$15 / 25 / 45 with no server check (any amount can be saved) | explicit acceptance of the unverified route |

Decision: **[ ] T1  [ ] T2  [ ] T3  [ ] T4**.

## 5. Advertised-price corrections required by each option

Counted from the route pages as they stand (FijiDash `ftt-booking-site/src/transfer`, NAT `c5ee3b1`), comparing each printed one-way / return figure (before discount) with (a) the published catalogue (return by the page convention) and (b) the Worker figure to the cent. **Nothing was edited and no replacement figure is proposed.**

| Surface | Printed items checked | Not equal to the catalogue | Not equal to the Worker (to the cent) |
|---|---|---|---|
| FijiDash route pages (21 pages; 0 cannot be reconciled: no booking link or route not in the booking tool) | 126 table figures | 0 on 0 pages | 125 on 21 pages |
| FijiDash "From FJ$" in page titles | 21 | 0 | 21 |
| NAT route pages (23 pages; 10 cannot be reconciled: no booking link or route not in the booking tool) | 72 table figures | 19 on 7 pages | 71 on 12 pages |
| NAT "From FJ$" in page titles | 0 | 0 | 0 |
| FijiDash llms.txt "from FJ$" lines | 19 | 2 | not compared |
| FijiDash `app.js` FAQ / marketing strings and index.html JSON-LD | listed in `ADVERTISED-PRICES-AUDIT.md` | manual | manual |

Because pages print whole dollars and the Worker works in cents, "not equal to the Worker" counts almost every figure. Option B below therefore also needs a **display rule** (round for display? show cents?) - a further decision.

Scope notes: **A** and **C** must include figures that are ALREADY inaccurate against their own catalogue, not only the disputed routes. "Existing inaccurate figure" = a printed table figure that does not equal the site's own published catalogue (return by the page convention). "Unreconciled pages" = pages with no booking link or a route the booking tool does not know: they could not be checked and are unverified under every option.

| Policy option | What changes in the booking path | Advertised corrections required |
|---|---|---|
| **A. Catalogue is the fare** | the Worker (or a server fare table) enforces the catalogue; FijiDash selection returns to the static figure (no live fare); disputed routes keep their published fares | the existing inaccurate figures only: 0 on 0 FijiDash pages, 19 on 7 NAT pages, 2 llms.txt lines; plus the night / return conventions in the FAQ; plus 0 FijiDash and 10 NAT pages that cannot be reconciled and must be checked by hand |
| **B. Worker formula is the fare** | the catalogue is rebuilt from the formula; NAT and the pages show it | essentially every printed figure changes: 196 table figures, 21 "From" titles, llms.txt, the routes table (108 disputed route/vehicle/trip figures differ by more than FJ$5 / 5%), FAQ; plus the display-rule decision |
| **C. Per-route hybrid** (A, B or C chosen per row in section 1) | each route follows its own choice; a server fare table holds the A/C routes so the Worker can verify them | **the UNION of two sets, not just the 28 disputed routes:** (a) pages of the disputed routes (FijiDash 15, NAT 8 pages) AND (b) pages that already print inaccurate figures (FijiDash 0, NAT 7 pages, 19 figures), of which 2 pages (6 figures) sit on routes that are NOT disputed and would be missed by a disputed-only scope. Total: FijiDash 15 pages (90 printed figures), NAT 10 pages (60 printed figures), 17 llms.txt lines, plus Momi sedan/minivan if E1 changes them, plus the FAQ; plus 10 NAT / 0 FijiDash unreconciled pages to check by hand |

Night and return options add FAQ / label changes as listed in section 2 (N0: delete the 20% sentence and the label; N1-N3: keep, with the outbound-pickup rule stated plainly). Return rounding (R1/R2) changes every printed return figure that is derived by the other convention.

## Decisions to record

- Momi minibus (approved, no decision needed): base 175.92; 157.92 / 297 / 304
- Momi sedan / minivan extension: **[ ] E1a  [ ] E1b  [ ] E1c**
- Global fare policy: **[ ] A  [ ] B  [ ] C (per row above)**
- Night: **[ ] N0  [ ] N1  [ ] N2  [ ] N3**; night return pickup counts: **[ ] yes  [ ] no**; if N2, leg allocation: **[ ] AL-1 equal legs  [ ] AL-2 1.00 / 0.85  [ ] other: ______**
- Return rounding: **[ ] R1  [ ] R2  [ ] R3**
- Tanoa International: **[ ] T1 (fares: ______ / ______ / ______)  [ ] T2  [ ] T3  [ ] T4**
- Display rule for pages if B or C: **[ ] whole dollars (rounding rule: ______)  [ ] show cents**

Nothing is released by recording these. Each decision needs its own change, re-test and independent review; production stays on HOLD until then. Fuel adjustments are not part of any option and remain disabled.