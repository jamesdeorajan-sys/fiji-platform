# FijiDash pricing reconciliation (preview-only) - 2026-10-05

Nothing here is a live booking, message or fare change. Every number below was produced in an isolated harness:

- **Page figures** (advertised / selection / review / submitted) come from the real page code (`app.js` functions run in a sandbox): NAT = released `c5ee3b1`, FijiDash production = `8c6f920`, FijiDash candidate = this branch.
- **Worker figures** (Worker-calculated / saved) come from the real deployed Worker (a `wrangler deploy --dry-run` bundle of the production script, `test-fixtures/worker-deployed-7a32a034.mjs`) over an in-memory database seeded from a read-only production pricing snapshot **refreshed 2026-10-05 05:08 UTC** with read-only `SELECT --command` queries (19 zones, 15 pricing rules, 15 airport distances, fuel index id 1 = multiplier 1 / FJ$3.39 per litre). The refresh was compared field by field with the 2026-09-27 snapshot: **zero differences**, so no earlier result changed because of pricing data. The live Worker version was re-checked the same time (`7a32a034`, deployed 2026-10-05 03:06 UTC, unchanged).
- Every outbound call the Worker attempted (WhatsApp alerts, driver broadcast) was recorded and blocked. No network, no production data written.
- This table **records** what each layer says and classifies the differences. It does **not** approve any fare. The Worker formula is not commercially approved for any route except the Momi minibus base of FJ$175.92 (before the existing discount).

Reproduce: `NAT_APP_JS=<path to nadi-airport-transfers-site/src/app.js> node ftt-booking-site/reconciliation/recon.mjs <outDir>`.
Full data (4,296 rows): `reconciliation_rows.csv` in this folder. Columns: site, route, area, zone, vehicle, direction, trip, time, extras, advertised_one_way_base, published_table_amount, selection, review, submitted, worker_calculated, saved, in_band, selection_review_mismatch, cls, note.

## Coverage

36 FijiDash routes and 35 NAT routes (NAT has no NAVITI_RESORT) x 3 vehicles x one-way/return x {no extras, child seat} x {day 10:00, night 23:00}. Direction: **airport -> destination (arrival) only.**

NOT covered here (stated, not hidden): departures (hotel -> airport, priced from a geocoded custom address), boat/island destinations (separate boat pricing, held with the M13 boat release), custom addresses, tours (no loyalty discount; tour prices have no server rule), the surfboard extra (FJ$24, same mechanism as the child seat), passenger/bag counts above a vehicle's limit.

## Classification (counts of rows)

| Site / path | MATCH | In-band formula difference (kept as shown by the Worker) | Consent required (409, nothing saved) | SILENT SUBSTITUTION (guest not told) | Missing pricing rule |
|---|---|---|---|---|---|
| NAT live `c5ee3b1` | 2 | 794 | 20 | 0 | 24 (Tanoa International) |
| FijiDash production `8c6f920`, live lookup works | 420 | 420 (all night rows) | 0 (no opt-in) | 0 | 24 |
| FijiDash production `8c6f920`, live lookup unavailable | 0 | 812 | 0 (no opt-in) | **28** | 24 |
| FijiDash candidate, live lookup works | 414 | 426 (all 420 night rows, plus the 6 Momi day-return rows that follow the approved page convention) | 0 | 0 | 24 |
| FijiDash candidate, live lookup unavailable | 2 | 818 | 20 | 0 | 24 |

Selection total differs from review total (the guest sees one number when choosing and another when confirming): **FijiDash production 840 of 840 priceable rows differ at all** (790 by more than FJ$1, 696 by more than FJ$5, 392 by more than FJ$20, largest FJ$218.92; in the 210 base cases of day / no extras, 185 differ by more than FJ$1 and 10 by more than 20%); **candidate 0**; NAT 0. The counting definitions, the exact comparison, the treatment of lookup failures and missing prices, and raw calculations are in `AUDIT-selection-vs-review.md`. Note "840" counts combinations (route x vehicle x trip x extras x time), not 840 distinct journeys, and "differ at all" includes differences of cents.

### 1. Guest-facing discrepancies

| # | Finding | Evidence | Status |
|---|---|---|---|
| G1 | FijiDash production shows a different total at selection than at review on every priceable route (selection = static published table, review = Worker live fare). Momi minibus: FJ$71 at selection, FJ$157.92 at review. | 840/840 rows; browser run on the production page | **Fixed in candidate** (selection mirrors review; 0 mismatches) |
| G2 | FijiDash Momi minibus published at 79 (cheaper than the 99 sedan), advertised in the booking tool, the route table, the FAQ and JSON-LD. | catalogue + route page | **Fixed in candidate** to the approved FJ$175.92 base (route page: 175.92 one-way / 330 return, before discount) |
| G3 | When the live lookup is unavailable, FijiDash production saves a DIFFERENT fare from the one shown without telling the guest (28 rows: Nadi/Mercure sedan, Wailoaloa/Crowne Plaza sedan, Momi minibus). Example: Mercure sedan shown FJ$19, saved FJ$30.15. | recon rows, class SILENT_SUBSTITUTION | **Fixed in candidate**: refused with 409, the guest sees both totals and must press "Accept revised price and submit"; saved = accepted amount |
| G4 | The guest was never shown the amount actually saved. | the page ignored the Worker response | **Fixed**: the success card reads "Fare saved: FJD x" from the Worker response (or states the difference) |
| G5 | Float tails (127.96000000000001) were submitted and stored. | night-pricing test (R2) | **Fixed**: whole cents are submitted |
| G6 | At night the booking tool says "Night surcharge applied" and the FAQ promises a 20% surcharge, but on every eligible route the amount shown, submitted and SAVED excludes it (the reference fare has no night component). 414/420 FijiDash night rows saved below the Worker figure (largest shortfall FJ$178.82); the other 6 are Momi return rows, which follow the approved page convention and DO include the page's night modifier, so within the candidate Momi one-way at night is 157.92 but return at night is 355 (297 by day). Boundary and return-time evidence: `NIGHT.md`. **Release blocker B1.** | recon rows, R17 test | **NOT changed**: commercial decision D1 |
| G8 | A slow review-step fare lookup could overwrite the price of a trip the guest had since changed (Back, then change trip type), because it only checked "is this the latest render", not "is this still the same trip". Present in production too. | async test (red before the fix) | **Fixed in candidate** (answer dropped unless the itinerary key is unchanged) |
| G9 | A tap on "Confirm" that lands just after the refusal comes back (a double tap) would have counted as accepting a revised price the guest had not read. | browser run: the third tap booked at 30.15 | **Fixed in candidate** (taps inside 1.5 s of the revised total appearing are ignored; the button is also disabled for that time) |
| G7 | NAT static page vs Worker: 20 rows are refused and routed through the consent flow (already live). FijiDash candidate with the live lookup down: the same 20 rows. | recon rows | consent flow in place; fares unchanged |

### 2. Formula differences accepted within the current band (0.8x-1.3x of the Worker figure)

The Worker keeps the page's own figure whenever it is inside the band. These are saved as shown (never silently replaced), so the guest is not misled, but the page table and the Worker formula disagree. NAT: 794 rows; FijiDash with the lookup down: 818 rows. The page figure is above the Worker figure in about 57% of them (by up to FJ$80) and below it in about 43% (by up to FJ$46.82). Examples: Momi sedan one-way 89 (page) vs 85.29 (Worker); Momi minibus return 297 vs 292.45 (the page rounds returns up to the next FJ$5, the Worker does not); Crowne Plaza sedan one-way 39 vs 30.36. With the live lookup working the FijiDash candidate shows and saves the Worker figure, so these apply only on the static path.

### 3. Missing pricing rules

- **Tanoa International Hotel** (`TANOA_INTERNATIONAL`, area "Nadi Airport"): the Worker has no distance or rule for Nadi Airport -> Nadi Airport, so it cannot price it (24 rows per site). The page shows FJ$15 / 25 / 45. No server fare exists to reconcile against.
- No other FijiDash route lacks a zone or rule in the snapshot. (Areas that resolve through the live address lookup, such as Sabeto, Saweni and Maui Bay, cannot be priced offline.)

### 4. Commercial decisions awaiting James

- **D1 Night surcharge.** Published as 20% (FAQ, the "Night surcharge applied" label, the Worker formula) but not applied on the live-fare path, so no FijiDash night booking on an eligible route is charged it today. Options: apply it to the live fare (selection = review = Worker) or stop claiming it. Not decided here.
- **D2 Which fare is right per route.** Where the published table and the Worker formula differ materially (examples: Mercure/Nadi sedan 19 vs 30.15; Crowne Plaza/Wailoaloa sedan return 67 vs 50.17; Crowne Plaza sedan one-way 39 vs 30.36), decide the commercially intended fare. The candidate does not choose: it shows the Worker's current number on FijiDash and asks for consent where the static figure is refused.
- **D3 Return rounding.** Page: one-way x1.85 then round up to the next FJ$5. Worker: x1.85 without the round-up (part of the return differences). **Momi only is decided**: James approved the existing Nadi convention (minibus one-way 157.92, return 297, return + child seat 304), and the candidate shows and saves exactly those (the Worker's 292.45 / 300.45 are reported, never substituted). Production FijiDash today charges the Worker figures (292.45 / 300.45) for Momi return because its review step swaps them in. Every other route is undecided.
- **D4 Tanoa International** price (no rule exists; FJ$15/25/45 is page-only).
- **D5 Other route pages** (NAT and FijiDash) that still quote table figures: only Momi has been corrected so far.
- **D6** Whether the routes table and vehicle cards should keep advertising the table "from" fares (e.g. Mercure sedan FJ$19) now that FijiDash selection shows the live fare (FJ$30.15).

## Priority routes: Momi, Nadi / Mercure, Wailoaloa / Crowne Plaza (day 10:00, no extras)

Amounts are the guest-visible totals after the existing 10% discount where it applies. Advertised = published one-way base before discount. NAT shown = NAT page selection = review = submitted. "-" under Saved means nothing was saved (consent refused).

| Route | Vehicle | Trip | Advertised one-way base | NAT shown (sel=review=submitted) | FD prod selection | FD prod review (=submitted) | FD candidate selection=review | Worker-calculated | Saved: NAT / FD prod / FD cand | NAT class | FD prod class | FD cand class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MARRIOTT_MOMI | sedan | one-way | 99 | 89 | 89 | 85.29 | 85.29 | 85.29 | 89 / 85.29 / 85.29 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| MARRIOTT_MOMI | sedan | return | 99 | 166 | 166 | 157.44 | 166 | 157.44 | 166 / 157.44 / 166 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | IN_BAND_DIFFERENCE |
| MARRIOTT_MOMI | minivan | one-way | 149 | 134 | 134 | 132.42 | 132.42 | 132.42 | 134 / 132.42 / 132.42 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| MARRIOTT_MOMI | minivan | return | 149 | 252 | 252 | 245.73 | 252 | 245.73 | 252 / 245.73 / 252 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | IN_BAND_DIFFERENCE |
| MARRIOTT_MOMI | minibus | one-way | 175.92 | 157.92 | 71 | 157.92 | 157.92 | 157.92 | 157.92 / 157.92 / 157.92 | MATCH | MATCH (sel≠review) | MATCH |
| MARRIOTT_MOMI | minibus | return | 175.92 | 297 | 135 | 292.45 | 297 | 292.45 | 297 / 292.45 / 297 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | IN_BAND_DIFFERENCE |
| MERCURE_NADI | sedan | one-way | 19 | 19 | 19 | 30.15 | 30.15 | 30.15 | - / 30.15 / 30.15 | CONSENT_REQUIRED | MATCH (sel≠review) | MATCH |
| MERCURE_NADI | sedan | return | 19 | 40 | 40 | 49.78 | 49.78 | 49.78 | 40 / 49.78 / 49.78 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| MERCURE_NADI | minivan | one-way | 49 | 49 | 49 | 46.42 | 46.42 | 46.42 | 49 / 46.42 / 46.42 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| MERCURE_NADI | minivan | return | 49 | 85 | 85 | 85.13 | 85.13 | 85.13 | 85 / 85.13 / 85.13 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| MERCURE_NADI | minibus | one-way | 79 | 71 | 71 | 71.46 | 71.46 | 71.46 | 71 / 71.46 / 71.46 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| MERCURE_NADI | minibus | return | 79 | 135 | 135 | 132 | 132 | 132 | 135 / 132 / 132 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NADI_DOWNTOWN | sedan | one-way | 19 | 19 | 19 | 30.15 | 30.15 | 30.15 | - / 30.15 / 30.15 | CONSENT_REQUIRED | MATCH (sel≠review) | MATCH |
| NADI_DOWNTOWN | sedan | return | 19 | 40 | 40 | 49.78 | 49.78 | 49.78 | 40 / 49.78 / 49.78 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NADI_DOWNTOWN | minivan | one-way | 49 | 49 | 49 | 46.42 | 46.42 | 46.42 | 49 / 46.42 / 46.42 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NADI_DOWNTOWN | minivan | return | 49 | 85 | 85 | 85.13 | 85.13 | 85.13 | 85 / 85.13 / 85.13 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NADI_DOWNTOWN | minibus | one-way | 79 | 71 | 71 | 71.46 | 71.46 | 71.46 | 71 / 71.46 / 71.46 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NADI_DOWNTOWN | minibus | return | 79 | 135 | 135 | 132 | 132 | 132 | 135 / 132 / 132 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| WAILOALOA_BEACH | sedan | one-way | 39 | 39 | 39 | 30.36 | 30.36 | 30.36 | 39 / 30.36 / 30.36 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| WAILOALOA_BEACH | sedan | return | 39 | 67 | 67 | 50.17 | 50.17 | 50.17 | - / 50.17 / 50.17 | CONSENT_REQUIRED | MATCH (sel≠review) | MATCH |
| WAILOALOA_BEACH | minivan | one-way | 59 | 53 | 53 | 46.63 | 46.63 | 46.63 | 53 / 46.63 / 46.63 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| WAILOALOA_BEACH | minivan | return | 59 | 99 | 99 | 85.52 | 85.52 | 85.52 | 99 / 85.52 / 85.52 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| WAILOALOA_BEACH | minibus | one-way | 89 | 80 | 80 | 71.70 | 71.70 | 71.70 | 80 / 71.70 / 71.70 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| WAILOALOA_BEACH | minibus | return | 89 | 148 | 148 | 132.45 | 132.45 | 132.45 | 148 / 132.45 / 132.45 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| CROWNE_PLAZA_NADI_BAY | sedan | one-way | 39 | 39 | 39 | 30.36 | 30.36 | 30.36 | 39 / 30.36 / 30.36 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| CROWNE_PLAZA_NADI_BAY | sedan | return | 39 | 67 | 67 | 50.17 | 50.17 | 50.17 | - / 50.17 / 50.17 | CONSENT_REQUIRED | MATCH (sel≠review) | MATCH |
| CROWNE_PLAZA_NADI_BAY | minivan | one-way | 59 | 53 | 53 | 46.63 | 46.63 | 46.63 | 53 / 46.63 / 46.63 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| CROWNE_PLAZA_NADI_BAY | minivan | return | 59 | 99 | 99 | 85.52 | 85.52 | 85.52 | 99 / 85.52 / 85.52 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| CROWNE_PLAZA_NADI_BAY | minibus | one-way | 89 | 80 | 80 | 71.70 | 71.70 | 71.70 | 80 / 71.70 / 71.70 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| CROWNE_PLAZA_NADI_BAY | minibus | return | 89 | 148 | 148 | 132.45 | 132.45 | 132.45 | 148 / 132.45 / 132.45 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |


## Same routes, night 23:00 with a child seat

| Route | Vehicle | Trip | Advertised one-way base | NAT shown (sel=review=submitted) | FD prod selection | FD prod review (=submitted) | FD candidate selection=review | Worker-calculated | Saved: NAT / FD prod / FD cand | NAT class | FD prod class | FD cand class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MARRIOTT_MOMI | sedan | one-way | 99 | 115 | 115 | 92.29 | 92.29 | 109.15 | 115 / 92.29 / 92.29 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| MARRIOTT_MOMI | sedan | return | 99 | 205 | 205 | 164.44 | 205 | 195.32 | 205 / 164.44 / 205 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| MARRIOTT_MOMI | minivan | one-way | 149 | 169 | 169 | 139.42 | 139.42 | 166.90 | 169 / 139.42 / 139.42 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| MARRIOTT_MOMI | minivan | return | 149 | 309 | 309 | 252.73 | 309 | 301.27 | 309 / 252.73 / 309 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| MARRIOTT_MOMI | minibus | one-way | 175.92 | 201 | 93 | 165.92 | 165.92 | 197.10 | 201 / 165.92 / 165.92 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| MARRIOTT_MOMI | minibus | return | 175.92 | 363 | 169 | 300.45 | 363 | 358.54 | 363 / 300.45 / 363 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| MERCURE_NADI | sedan | one-way | 19 | 33 | 33 | 38.15 | 38.15 | 44.18 | - / 38.15 / 38.15 | CONSENT_REQUIRED | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| MERCURE_NADI | sedan | return | 19 | 48 | 48 | 57.78 | 57.78 | 67.93 | - / 57.78 / 57.78 | CONSENT_REQUIRED | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| MERCURE_NADI | minivan | one-way | 49 | 61 | 61 | 53.42 | 53.42 | 62.70 | 61 / 53.42 / 53.42 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| MERCURE_NADI | minivan | return | 49 | 106 | 106 | 93.13 | 93.13 | 110.15 | 106 / 93.13 / 93.13 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| MERCURE_NADI | minibus | one-way | 79 | 93 | 93 | 78.46 | 78.46 | 93.35 | 93 / 78.46 / 78.46 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| MERCURE_NADI | minibus | return | 79 | 169 | 169 | 139 | 139 | 166.40 | 169 / 139 / 139 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| NADI_DOWNTOWN | sedan | one-way | 19 | 33 | 33 | 38.15 | 38.15 | 44.18 | - / 38.15 / 38.15 | CONSENT_REQUIRED | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| NADI_DOWNTOWN | sedan | return | 19 | 48 | 48 | 57.78 | 57.78 | 67.93 | - / 57.78 / 57.78 | CONSENT_REQUIRED | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| NADI_DOWNTOWN | minivan | one-way | 49 | 61 | 61 | 53.42 | 53.42 | 62.70 | 61 / 53.42 / 53.42 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| NADI_DOWNTOWN | minivan | return | 49 | 106 | 106 | 93.13 | 93.13 | 110.15 | 106 / 93.13 / 93.13 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| NADI_DOWNTOWN | minibus | one-way | 79 | 93 | 93 | 78.46 | 78.46 | 93.35 | 93 / 78.46 / 78.46 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| NADI_DOWNTOWN | minibus | return | 79 | 169 | 169 | 139 | 139 | 166.40 | 169 / 139 / 139 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| WAILOALOA_BEACH | sedan | one-way | 39 | 52 | 52 | 38.36 | 38.36 | 44.43 | 52 / 38.36 / 38.36 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| WAILOALOA_BEACH | sedan | return | 39 | 88 | 88 | 58.17 | 58.17 | 67.40 | - / 58.17 / 58.17 | CONSENT_REQUIRED | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| WAILOALOA_BEACH | minivan | one-way | 59 | 75 | 75 | 53.63 | 53.63 | 62.96 | 75 / 53.63 / 53.63 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| WAILOALOA_BEACH | minivan | return | 59 | 129 | 129 | 93.52 | 93.52 | 110.62 | 129 / 93.52 / 93.52 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| WAILOALOA_BEACH | minibus | one-way | 89 | 106 | 106 | 78.70 | 78.70 | 93.64 | 106 / 78.70 / 78.70 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| WAILOALOA_BEACH | minibus | return | 89 | 187 | 187 | 139.45 | 139.45 | 166.93 | 187 / 139.45 / 139.45 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| CROWNE_PLAZA_NADI_BAY | sedan | one-way | 39 | 52 | 52 | 38.36 | 38.36 | 44.43 | 52 / 38.36 / 38.36 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| CROWNE_PLAZA_NADI_BAY | sedan | return | 39 | 88 | 88 | 58.17 | 58.17 | 67.40 | - / 58.17 / 58.17 | CONSENT_REQUIRED | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| CROWNE_PLAZA_NADI_BAY | minivan | one-way | 59 | 75 | 75 | 53.63 | 53.63 | 62.96 | 75 / 53.63 / 53.63 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| CROWNE_PLAZA_NADI_BAY | minivan | return | 59 | 129 | 129 | 93.52 | 93.52 | 110.62 | 129 / 93.52 / 93.52 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| CROWNE_PLAZA_NADI_BAY | minibus | one-way | 89 | 106 | 106 | 78.70 | 78.70 | 93.64 | 106 / 78.70 / 78.70 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |
| CROWNE_PLAZA_NADI_BAY | minibus | return | 89 | 187 | 187 | 139.45 | 139.45 | 166.93 | 187 / 139.45 / 139.45 | IN_BAND_DIFFERENCE | IN_BAND_DIFFERENCE (sel≠review) | IN_BAND_DIFFERENCE |


## All remaining supported routes (day 10:00, no extras)

| Route | Vehicle | Trip | Advertised one-way base | NAT shown (sel=review=submitted) | FD prod selection | FD prod review (=submitted) | FD candidate selection=review | Worker-calculated | Saved: NAT / FD prod / FD cand | NAT class | FD prod class | FD cand class |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TANOA_INTERNATIONAL | sedan | one-way | 15 | 15 | 15 | 15 | 15 | - | - / - / - | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA |
| TANOA_INTERNATIONAL | sedan | return | 15 | 30 | 30 | 30 | 30 | - | - / - / - | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA |
| TANOA_INTERNATIONAL | minivan | one-way | 25 | 25 | 25 | 25 | 25 | - | - / - / - | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA |
| TANOA_INTERNATIONAL | minivan | return | 25 | 50 | 50 | 50 | 50 | - | - / - / - | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA |
| TANOA_INTERNATIONAL | minibus | one-way | 45 | 45 | 45 | 45 | 45 | - | - / - / - | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA |
| TANOA_INTERNATIONAL | minibus | return | 45 | 76 | 76 | 76 | 76 | - | - / - / - | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA | ZONE_NOT_IN_PRICING_DATA |
| HILTON_DENARAU | sedan | one-way | 49 | 49 | 49 | 47.87 | 47.87 | 47.87 | 49 / 47.87 / 47.87 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| HILTON_DENARAU | sedan | return | 49 | 85 | 85 | 79.56 | 79.56 | 79.56 | 85 / 79.56 / 79.56 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| HILTON_DENARAU | minivan | one-way | 69 | 62 | 62 | 62.08 | 62.08 | 62.08 | 62 / 62.08 / 62.08 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| HILTON_DENARAU | minivan | return | 69 | 117 | 117 | 114.80 | 114.80 | 114.80 | 117 / 114.80 / 114.80 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| HILTON_DENARAU | minibus | one-way | 99 | 89 | 89 | 89.84 | 89.84 | 89.84 | 89 / 89.84 / 89.84 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| HILTON_DENARAU | minibus | return | 99 | 166 | 166 | 166.70 | 166.70 | 166.70 | 166 / 166.70 / 166.70 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SOFITEL_DENARAU | sedan | one-way | 49 | 49 | 49 | 47.87 | 47.87 | 47.87 | 49 / 47.87 / 47.87 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SOFITEL_DENARAU | sedan | return | 49 | 85 | 85 | 79.56 | 79.56 | 79.56 | 85 / 79.56 / 79.56 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SOFITEL_DENARAU | minivan | one-way | 69 | 62 | 62 | 62.08 | 62.08 | 62.08 | 62 / 62.08 / 62.08 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SOFITEL_DENARAU | minivan | return | 69 | 117 | 117 | 114.80 | 114.80 | 114.80 | 117 / 114.80 / 114.80 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SOFITEL_DENARAU | minibus | one-way | 99 | 89 | 89 | 89.84 | 89.84 | 89.84 | 89 / 89.84 / 89.84 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SOFITEL_DENARAU | minibus | return | 99 | 166 | 166 | 166.70 | 166.70 | 166.70 | 166 / 166.70 / 166.70 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PORT_DENARAU_MARINA | sedan | one-way | 49 | 49 | 49 | 47.87 | 47.87 | 47.87 | 49 / 47.87 / 47.87 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PORT_DENARAU_MARINA | sedan | return | 49 | 85 | 85 | 79.56 | 79.56 | 79.56 | 85 / 79.56 / 79.56 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PORT_DENARAU_MARINA | minivan | one-way | 69 | 62 | 62 | 62.08 | 62.08 | 62.08 | 62 / 62.08 / 62.08 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PORT_DENARAU_MARINA | minivan | return | 69 | 117 | 117 | 114.80 | 114.80 | 114.80 | 117 / 114.80 / 114.80 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PORT_DENARAU_MARINA | minibus | one-way | 99 | 89 | 89 | 89.84 | 89.84 | 89.84 | 89 / 89.84 / 89.84 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PORT_DENARAU_MARINA | minibus | return | 99 | 166 | 166 | 166.70 | 166.70 | 166.70 | 166 / 166.70 / 166.70 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| DOUBLETREE_SONAISALI | sedan | one-way | 69 | 62 | 62 | 70.83 | 70.83 | 70.83 | 62 / 70.83 / 70.83 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| DOUBLETREE_SONAISALI | sedan | return | 69 | 117 | 117 | 130.84 | 130.84 | 130.84 | 117 / 130.84 / 130.84 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| DOUBLETREE_SONAISALI | minivan | one-way | 89 | 80 | 80 | 91.46 | 91.46 | 91.46 | 80 / 91.46 / 91.46 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| DOUBLETREE_SONAISALI | minivan | return | 89 | 148 | 148 | 168.70 | 168.70 | 168.70 | 148 / 168.70 / 168.70 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| DOUBLETREE_SONAISALI | minibus | one-way | 119 | 107 | 107 | 118.46 | 118.46 | 118.46 | 107 / 118.46 / 118.46 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| DOUBLETREE_SONAISALI | minibus | return | 119 | 202 | 202 | 219.20 | 219.20 | 219.20 | 202 / 219.20 / 219.20 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| FIRST_LANDING | sedan | one-way | 79 | 71 | 71 | 67.50 | 67.50 | 67.50 | 71 / 67.50 / 67.50 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| FIRST_LANDING | sedan | return | 79 | 135 | 135 | 123.83 | 123.83 | 123.83 | 135 / 123.83 / 123.83 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| FIRST_LANDING | minivan | one-way | 99 | 89 | 89 | 85.23 | 85.23 | 85.23 | 89 / 85.23 / 85.23 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| FIRST_LANDING | minivan | return | 99 | 166 | 166 | 157.33 | 157.33 | 157.33 | 166 / 157.33 / 157.33 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| FIRST_LANDING | minibus | one-way | 129 | 116 | 116 | 112.23 | 112.23 | 112.23 | 116 / 112.23 / 112.23 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| FIRST_LANDING | minibus | return | 129 | 216 | 216 | 206.83 | 206.83 | 206.83 | 216 / 206.83 / 206.83 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VUDA_MARINA | sedan | one-way | 79 | 71 | 71 | 67.50 | 67.50 | 67.50 | 71 / 67.50 / 67.50 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VUDA_MARINA | sedan | return | 79 | 135 | 135 | 123.83 | 123.83 | 123.83 | 135 / 123.83 / 123.83 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VUDA_MARINA | minivan | one-way | 99 | 89 | 89 | 85.23 | 85.23 | 85.23 | 89 / 85.23 / 85.23 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VUDA_MARINA | minivan | return | 99 | 166 | 166 | 157.33 | 157.33 | 157.33 | 166 / 157.33 / 157.33 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VUDA_MARINA | minibus | one-way | 129 | 116 | 116 | 112.23 | 112.23 | 112.23 | 116 / 112.23 / 112.23 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VUDA_MARINA | minibus | return | 129 | 216 | 216 | 206.83 | 206.83 | 206.83 | 216 / 206.83 / 206.83 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_HOTEL | sedan | one-way | 89 | 80 | 80 | 76.07 | 76.07 | 76.07 | 80 / 76.07 / 76.07 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_HOTEL | sedan | return | 89 | 148 | 148 | 139.53 | 139.53 | 139.53 | 148 / 139.53 / 139.53 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_HOTEL | minivan | one-way | 119 | 107 | 107 | 99.22 | 99.22 | 99.22 | 107 / 99.22 / 99.22 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_HOTEL | minivan | return | 119 | 202 | 202 | 183.91 | 183.91 | 183.91 | 202 / 183.91 / 183.91 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_HOTEL | minibus | one-way | 149 | 134 | 134 | 126.22 | 126.22 | 126.22 | 134 / 126.22 / 126.22 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_HOTEL | minibus | return | 149 | 252 | 252 | 233.41 | 233.41 | 233.41 | 252 / 233.41 / 233.41 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_LAUTOKA | sedan | one-way | 89 | 80 | 80 | 76.07 | 76.07 | 76.07 | 80 / 76.07 / 76.07 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_LAUTOKA | sedan | return | 89 | 148 | 148 | 139.53 | 139.53 | 139.53 | 148 / 139.53 / 139.53 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_LAUTOKA | minivan | one-way | 119 | 107 | 107 | 99.22 | 99.22 | 99.22 | 107 / 99.22 / 99.22 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_LAUTOKA | minivan | return | 119 | 202 | 202 | 183.91 | 183.91 | 183.91 | 202 / 183.91 / 183.91 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_LAUTOKA | minibus | one-way | 149 | 134 | 134 | 126.22 | 126.22 | 126.22 | 134 / 126.22 / 126.22 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_LAUTOKA | minibus | return | 149 | 252 | 252 | 233.41 | 233.41 | 233.41 | 252 / 233.41 / 233.41 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_CRUISE | sedan | one-way | 89 | 80 | 80 | 76.07 | 76.07 | 76.07 | 80 / 76.07 / 76.07 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_CRUISE | sedan | return | 89 | 148 | 148 | 139.53 | 139.53 | 139.53 | 148 / 139.53 / 139.53 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_CRUISE | minivan | one-way | 119 | 107 | 107 | 99.22 | 99.22 | 99.22 | 107 / 99.22 / 99.22 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_CRUISE | minivan | return | 119 | 202 | 202 | 183.91 | 183.91 | 183.91 | 202 / 183.91 / 183.91 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_CRUISE | minibus | one-way | 149 | 134 | 134 | 126.22 | 126.22 | 126.22 | 134 / 126.22 / 126.22 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| LAUTOKA_CRUISE | minibus | return | 149 | 252 | 252 | 233.41 | 233.41 | 233.41 | 252 / 233.41 / 233.41 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| INTERCONTINENTAL_NATADOLA | sedan | one-way | 99 | 89 | 89 | 105.43 | 105.43 | 105.43 | 89 / 105.43 / 105.43 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| INTERCONTINENTAL_NATADOLA | sedan | return | 99 | 166 | 166 | 195.25 | 195.25 | 195.25 | 166 / 195.25 / 195.25 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| INTERCONTINENTAL_NATADOLA | minivan | one-way | 149 | 134 | 134 | 139.13 | 139.13 | 139.13 | 134 / 139.13 / 139.13 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| INTERCONTINENTAL_NATADOLA | minivan | return | 149 | 252 | 252 | 257.99 | 257.99 | 257.99 | 252 / 257.99 / 257.99 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| INTERCONTINENTAL_NATADOLA | minibus | one-way | 179 | 161 | 161 | 172.31 | 172.31 | 172.31 | 161 / 172.31 / 172.31 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| INTERCONTINENTAL_NATADOLA | minibus | return | 179 | 301 | 301 | 318.92 | 318.92 | 318.92 | 301 / 318.92 / 318.92 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ROBINSON_CRUSOE | sedan | one-way | 99 | 89 | 89 | 105.43 | 105.43 | 105.43 | 89 / 105.43 / 105.43 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ROBINSON_CRUSOE | sedan | return | 99 | 166 | 166 | 195.25 | 195.25 | 195.25 | 166 / 195.25 / 195.25 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ROBINSON_CRUSOE | minivan | one-way | 149 | 134 | 134 | 139.13 | 139.13 | 139.13 | 134 / 139.13 / 139.13 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ROBINSON_CRUSOE | minivan | return | 149 | 252 | 252 | 257.99 | 257.99 | 257.99 | 252 / 257.99 / 257.99 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ROBINSON_CRUSOE | minibus | one-way | 179 | 161 | 161 | 172.31 | 172.31 | 172.31 | 161 / 172.31 / 172.31 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ROBINSON_CRUSOE | minibus | return | 179 | 301 | 301 | 318.92 | 318.92 | 318.92 | 301 / 318.92 / 318.92 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SIGATOKA_SAND_DUNES | sedan | one-way | 129 | 116 | 116 | 124.49 | 124.49 | 124.49 | 116 / 124.49 / 124.49 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SIGATOKA_SAND_DUNES | sedan | return | 129 | 216 | 216 | 230.21 | 230.21 | 230.21 | 216 / 230.21 / 230.21 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SIGATOKA_SAND_DUNES | minivan | one-way | 159 | 143 | 143 | 146.14 | 146.14 | 146.14 | 143 / 146.14 / 146.14 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SIGATOKA_SAND_DUNES | minivan | return | 159 | 265 | 265 | 269.96 | 269.96 | 269.96 | 265 / 269.96 / 269.96 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SIGATOKA_SAND_DUNES | minibus | one-way | 199 | 179 | 179 | 184.31 | 184.31 | 184.31 | 179 / 184.31 / 184.31 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SIGATOKA_SAND_DUNES | minibus | return | 199 | 333 | 333 | 341.82 | 341.82 | 341.82 | 333 / 341.82 / 341.82 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEDARRA_INN | sedan | one-way | 129 | 116 | 116 | 124.49 | 124.49 | 124.49 | 116 / 124.49 / 124.49 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEDARRA_INN | sedan | return | 129 | 216 | 216 | 230.21 | 230.21 | 230.21 | 216 / 230.21 / 230.21 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEDARRA_INN | minivan | one-way | 159 | 143 | 143 | 146.14 | 146.14 | 146.14 | 143 / 146.14 / 146.14 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEDARRA_INN | minivan | return | 159 | 265 | 265 | 269.96 | 269.96 | 269.96 | 265 / 269.96 / 269.96 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEDARRA_INN | minibus | one-way | 199 | 179 | 179 | 184.31 | 184.31 | 184.31 | 179 / 184.31 / 184.31 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEDARRA_INN | minibus | return | 199 | 333 | 333 | 341.82 | 341.82 | 341.82 | 333 / 341.82 / 341.82 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| KULA_ECO | sedan | one-way | 129 | 116 | 116 | 124.49 | 124.49 | 124.49 | 116 / 124.49 / 124.49 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| KULA_ECO | sedan | return | 129 | 216 | 216 | 230.21 | 230.21 | 230.21 | 216 / 230.21 / 230.21 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| KULA_ECO | minivan | one-way | 159 | 143 | 143 | 146.14 | 146.14 | 146.14 | 143 / 146.14 / 146.14 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| KULA_ECO | minivan | return | 159 | 265 | 265 | 269.96 | 269.96 | 269.96 | 265 / 269.96 / 269.96 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| KULA_ECO | minibus | one-way | 199 | 179 | 179 | 184.31 | 184.31 | 184.31 | 179 / 184.31 / 184.31 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| KULA_ECO | minibus | return | 199 | 333 | 333 | 341.82 | 341.82 | 341.82 | 333 / 341.82 / 341.82 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SHANGRI_LA_YANUCA | sedan | one-way | 129 | 116 | 116 | 127.96 | 127.96 | 127.96 | 116 / 127.96 / 127.96 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SHANGRI_LA_YANUCA | sedan | return | 129 | 216 | 216 | 236.63 | 236.63 | 236.63 | 216 / 236.63 / 236.63 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SHANGRI_LA_YANUCA | minivan | one-way | 159 | 143 | 143 | 158.81 | 158.81 | 158.81 | 143 / 158.81 / 158.81 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SHANGRI_LA_YANUCA | minivan | return | 159 | 265 | 265 | 294.10 | 294.10 | 294.10 | 265 / 294.10 / 294.10 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SHANGRI_LA_YANUCA | minibus | one-way | 199 | 179 | 179 | 197.37 | 197.37 | 197.37 | 179 / 197.37 / 197.37 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| SHANGRI_LA_YANUCA | minibus | return | 199 | 333 | 333 | 364.83 | 364.83 | 364.83 | 333 / 364.83 / 364.83 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| HIDEAWAY_RESORT | sedan | one-way | 129 | 116 | 116 | 127.96 | 127.96 | 127.96 | 116 / 127.96 / 127.96 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| HIDEAWAY_RESORT | sedan | return | 129 | 216 | 216 | 236.63 | 236.63 | 236.63 | 216 / 236.63 / 236.63 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| HIDEAWAY_RESORT | minivan | one-way | 159 | 143 | 143 | 158.81 | 158.81 | 158.81 | 143 / 158.81 / 158.81 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| HIDEAWAY_RESORT | minivan | return | 159 | 265 | 265 | 294.10 | 294.10 | 294.10 | 265 / 294.10 / 294.10 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| HIDEAWAY_RESORT | minibus | one-way | 199 | 179 | 179 | 197.37 | 197.37 | 197.37 | 179 / 197.37 / 197.37 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| HIDEAWAY_RESORT | minibus | return | 199 | 333 | 333 | 364.83 | 364.83 | 364.83 | 333 / 364.83 / 364.83 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| CRUSOES_RETREAT | sedan | one-way | 129 | 116 | 116 | 127.96 | 127.96 | 127.96 | 116 / 127.96 / 127.96 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| CRUSOES_RETREAT | sedan | return | 129 | 216 | 216 | 236.63 | 236.63 | 236.63 | 216 / 236.63 / 236.63 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| CRUSOES_RETREAT | minivan | one-way | 159 | 143 | 143 | 158.81 | 158.81 | 158.81 | 143 / 158.81 / 158.81 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| CRUSOES_RETREAT | minivan | return | 159 | 265 | 265 | 294.10 | 294.10 | 294.10 | 265 / 294.10 / 294.10 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| CRUSOES_RETREAT | minibus | one-way | 199 | 179 | 179 | 197.37 | 197.37 | 197.37 | 179 / 197.37 / 197.37 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| CRUSOES_RETREAT | minibus | return | 199 | 333 | 333 | 364.83 | 364.83 | 364.83 | 333 / 364.83 / 364.83 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| OUTRIGGER_FIJI | sedan | one-way | 129 | 116 | 116 | 127.96 | 127.96 | 127.96 | 116 / 127.96 / 127.96 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| OUTRIGGER_FIJI | sedan | return | 129 | 216 | 216 | 236.63 | 236.63 | 236.63 | 216 / 236.63 / 236.63 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| OUTRIGGER_FIJI | minivan | one-way | 159 | 143 | 143 | 158.81 | 158.81 | 158.81 | 143 / 158.81 / 158.81 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| OUTRIGGER_FIJI | minivan | return | 159 | 265 | 265 | 294.10 | 294.10 | 294.10 | 265 / 294.10 / 294.10 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| OUTRIGGER_FIJI | minibus | one-way | 199 | 179 | 179 | 197.37 | 197.37 | 197.37 | 179 / 197.37 / 197.37 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| OUTRIGGER_FIJI | minibus | return | 199 | 333 | 333 | 364.83 | 364.83 | 364.83 | 333 / 364.83 / 364.83 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| THE_WARWICK | sedan | one-way | 149 | 134 | 134 | 127.96 | 127.96 | 127.96 | 134 / 127.96 / 127.96 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| THE_WARWICK | sedan | return | 149 | 252 | 252 | 236.63 | 236.63 | 236.63 | 252 / 236.63 / 236.63 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| THE_WARWICK | minivan | one-way | 189 | 170 | 170 | 158.81 | 158.81 | 158.81 | 170 / 158.81 / 158.81 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| THE_WARWICK | minivan | return | 189 | 315 | 315 | 294.10 | 294.10 | 294.10 | 315 / 294.10 / 294.10 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| THE_WARWICK | minibus | one-way | 239 | 215 | 215 | 197.37 | 197.37 | 197.37 | 215 / 197.37 / 197.37 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| THE_WARWICK | minibus | return | 239 | 400 | 400 | 364.83 | 364.83 | 364.83 | 400 / 364.83 / 364.83 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEACHHOUSE_FIJI | sedan | one-way | 169 | 152 | 152 | 127.96 | 127.96 | 127.96 | 152 / 127.96 / 127.96 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEACHHOUSE_FIJI | sedan | return | 169 | 283 | 283 | 236.63 | 236.63 | 236.63 | 283 / 236.63 / 236.63 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEACHHOUSE_FIJI | minivan | one-way | 199 | 179 | 179 | 158.81 | 158.81 | 158.81 | 179 / 158.81 / 158.81 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEACHHOUSE_FIJI | minivan | return | 199 | 333 | 333 | 294.10 | 294.10 | 294.10 | 333 / 294.10 / 294.10 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEACHHOUSE_FIJI | minibus | one-way | 259 | 233 | 233 | 197.37 | 197.37 | 197.37 | 233 / 197.37 / 197.37 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BEACHHOUSE_FIJI | minibus | return | 259 | 432 | 432 | 364.83 | 364.83 | 364.83 | 432 / 364.83 / 364.83 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ARTS_VILLAGE | sedan | one-way | 199 | 179 | 179 | 178.95 | 178.95 | 178.95 | 179 / 178.95 / 178.95 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ARTS_VILLAGE | sedan | return | 199 | 333 | 333 | 331.06 | 331.06 | 331.06 | 333 / 331.06 / 331.06 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ARTS_VILLAGE | minivan | one-way | 269 | 242 | 242 | 239.56 | 239.56 | 239.56 | 242 / 239.56 / 239.56 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ARTS_VILLAGE | minivan | return | 269 | 450 | 450 | 444.14 | 444.14 | 444.14 | 450 / 444.14 / 444.14 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ARTS_VILLAGE | minibus | one-way | 299 | 269 | 269 | 269.56 | 269.56 | 269.56 | 269 / 269.56 / 269.56 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| ARTS_VILLAGE | minibus | return | 299 | 499 | 499 | 499.19 | 499.19 | 499.19 | 499 / 499.19 / 499.19 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PEARL_SOUTH_PACIFIC | sedan | one-way | 199 | 179 | 179 | 178.95 | 178.95 | 178.95 | 179 / 178.95 / 178.95 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PEARL_SOUTH_PACIFIC | sedan | return | 199 | 333 | 333 | 331.06 | 331.06 | 331.06 | 333 / 331.06 / 331.06 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PEARL_SOUTH_PACIFIC | minivan | one-way | 269 | 242 | 242 | 239.56 | 239.56 | 239.56 | 242 / 239.56 / 239.56 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PEARL_SOUTH_PACIFIC | minivan | return | 269 | 450 | 450 | 444.14 | 444.14 | 444.14 | 450 / 444.14 / 444.14 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PEARL_SOUTH_PACIFIC | minibus | one-way | 299 | 269 | 269 | 269.56 | 269.56 | 269.56 | 269 / 269.56 / 269.56 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| PEARL_SOUTH_PACIFIC | minibus | return | 299 | 499 | 499 | 499.19 | 499.19 | 499.19 | 499 / 499.19 / 499.19 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| UPRISING | sedan | one-way | 199 | 179 | 179 | 178.95 | 178.95 | 178.95 | 179 / 178.95 / 178.95 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| UPRISING | sedan | return | 199 | 333 | 333 | 331.06 | 331.06 | 331.06 | 333 / 331.06 / 331.06 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| UPRISING | minivan | one-way | 269 | 242 | 242 | 239.56 | 239.56 | 239.56 | 242 / 239.56 / 239.56 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| UPRISING | minivan | return | 269 | 450 | 450 | 444.14 | 444.14 | 444.14 | 450 / 444.14 / 444.14 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| UPRISING | minibus | one-way | 299 | 269 | 269 | 269.56 | 269.56 | 269.56 | 269 / 269.56 / 269.56 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| UPRISING | minibus | return | 299 | 499 | 499 | 499.19 | 499.19 | 499.19 | 499 / 499.19 / 499.19 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NANUKU_RESORT | sedan | one-way | 199 | 179 | 179 | 178.95 | 178.95 | 178.95 | 179 / 178.95 / 178.95 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NANUKU_RESORT | sedan | return | 199 | 333 | 333 | 331.06 | 331.06 | 331.06 | 333 / 331.06 / 331.06 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NANUKU_RESORT | minivan | one-way | 269 | 242 | 242 | 239.56 | 239.56 | 239.56 | 242 / 239.56 / 239.56 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NANUKU_RESORT | minivan | return | 269 | 450 | 450 | 444.14 | 444.14 | 444.14 | 450 / 444.14 / 444.14 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NANUKU_RESORT | minibus | one-way | 299 | 269 | 269 | 269.56 | 269.56 | 269.56 | 269 / 269.56 / 269.56 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NANUKU_RESORT | minibus | return | 299 | 499 | 499 | 499.19 | 499.19 | 499.19 | 499 / 499.19 / 499.19 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BA_HOTEL | sedan | one-way | 169 | 152 | 152 | 154.45 | 154.45 | 154.45 | 152 / 154.45 / 154.45 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BA_HOTEL | sedan | return | 169 | 283 | 283 | 285.18 | 285.18 | 285.18 | 283 / 285.18 / 285.18 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BA_HOTEL | minivan | one-way | 199 | 179 | 179 | 194.05 | 194.05 | 194.05 | 179 / 194.05 / 194.05 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BA_HOTEL | minivan | return | 199 | 333 | 333 | 359.69 | 359.69 | 359.69 | 333 / 359.69 / 359.69 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BA_HOTEL | minibus | one-way | 249 | 224 | 224 | 242.12 | 242.12 | 242.12 | 224 / 242.12 / 242.12 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| BA_HOTEL | minibus | return | 249 | 418 | 418 | 447.87 | 447.87 | 447.87 | 418 / 447.87 / 447.87 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VOLIVOLI_BEACH | sedan | one-way | 249 | 224 | 224 | 220.59 | 220.59 | 220.59 | 224 / 220.59 / 220.59 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VOLIVOLI_BEACH | sedan | return | 249 | 418 | 418 | 409.34 | 409.34 | 409.34 | 418 / 409.34 / 409.34 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VOLIVOLI_BEACH | minivan | one-way | 299 | 269 | 269 | 290.72 | 290.72 | 290.72 | 269 / 290.72 / 290.72 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VOLIVOLI_BEACH | minivan | return | 299 | 499 | 499 | 537.03 | 537.03 | 537.03 | 499 / 537.03 / 537.03 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VOLIVOLI_BEACH | minibus | one-way | 349 | 314 | 314 | 335.44 | 335.44 | 335.44 | 314 / 335.44 / 335.44 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| VOLIVOLI_BEACH | minibus | return | 349 | 585 | 585 | 620.01 | 620.01 | 620.01 | 585 / 620.01 / 620.01 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| GRAND_PACIFIC | sedan | one-way | 319 | 287 | 287 | 283.75 | 283.75 | 283.75 | 287 / 283.75 / 283.75 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| GRAND_PACIFIC | sedan | return | 319 | 535 | 535 | 524.29 | 524.29 | 524.29 | 535 / 524.29 / 524.29 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| GRAND_PACIFIC | minivan | one-way | 369 | 332 | 332 | 321.92 | 321.92 | 321.92 | 332 / 321.92 / 321.92 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| GRAND_PACIFIC | minivan | return | 369 | 616 | 616 | 596.15 | 596.15 | 596.15 | 616 / 596.15 / 596.15 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| GRAND_PACIFIC | minibus | one-way | 499 | 449 | 449 | 445.75 | 445.75 | 445.75 | 449 / 445.75 / 445.75 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| GRAND_PACIFIC | minibus | return | 499 | 832 | 832 | 823.29 | 823.29 | 823.29 | 832 / 823.29 / 823.29 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_PLAZA_SUVA | sedan | one-way | 319 | 287 | 287 | 283.75 | 283.75 | 283.75 | 287 / 283.75 / 283.75 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_PLAZA_SUVA | sedan | return | 319 | 535 | 535 | 524.29 | 524.29 | 524.29 | 535 / 524.29 / 524.29 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_PLAZA_SUVA | minivan | one-way | 369 | 332 | 332 | 321.92 | 321.92 | 321.92 | 332 / 321.92 / 321.92 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_PLAZA_SUVA | minivan | return | 369 | 616 | 616 | 596.15 | 596.15 | 596.15 | 616 / 596.15 / 596.15 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_PLAZA_SUVA | minibus | one-way | 499 | 449 | 449 | 445.75 | 445.75 | 445.75 | 449 / 445.75 / 445.75 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| TANOA_PLAZA_SUVA | minibus | return | 499 | 832 | 832 | 823.29 | 823.29 | 823.29 | 832 / 823.29 / 823.29 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NAUSORI_AIRPORT | sedan | one-way | 369 | 332 | 332 | 321.35 | 321.35 | 321.35 | 332 / 321.35 / 321.35 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NAUSORI_AIRPORT | sedan | return | 369 | 616 | 616 | 595.10 | 595.10 | 595.10 | 616 / 595.10 / 595.10 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NAUSORI_AIRPORT | minivan | one-way | 499 | 449 | 449 | 421.69 | 421.69 | 421.69 | 449 / 421.69 / 421.69 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NAUSORI_AIRPORT | minivan | return | 499 | 832 | 832 | 780.08 | 780.08 | 780.08 | 832 / 780.08 / 780.08 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NAUSORI_AIRPORT | minibus | one-way | 549 | 494 | 494 | 483.35 | 483.35 | 483.35 | 494 / 483.35 / 483.35 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |
| NAUSORI_AIRPORT | minibus | return | 549 | 918 | 918 | 895.10 | 895.10 | 895.10 | 918 / 895.10 / 895.10 | IN_BAND_DIFFERENCE | MATCH (sel≠review) | MATCH |

