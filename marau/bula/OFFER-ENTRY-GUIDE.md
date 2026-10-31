# Bula Happiness — offer entry template (for James)

File: `marau/bula/OFFER-ENTRY-TEMPLATE.csv` — open in Excel/Google Sheets, one offer per row, save as CSV (UTF-8).
Import creates **drafts only**. A second named staff member approves each row; nothing is published until the 6 pm Fiji release **after** approval. The first row is an example and is **rejected on import** until replaced or deleted.
All prices and capacity are **yours** — the system and AI never fill in or change a price, discount or quantity.

| Column | What to enter | Rules |
|---|---|---|
| offer_id | Your unique code, e.g. `SUN-CRUISE-1111` | unique; must not start with EXAMPLE |
| title | Guest-facing name | |
| operator_id | Operator code | |
| service_date | Fiji date `YYYY-MM-DD` | the offer appears at 6 pm Fiji the evening before |
| service_time | Start time 24h `HH:MM`, Fiji time | |
| pickup_zones | Zones/resorts, separated by `;` | |
| pricing_basis | `person`, `party` or `vehicle` | what the price is *per* |
| offer_price_fjd | Offer price in FJ$ per basis unit, e.g. `150.00` | > 0, max 2 decimals |
| max_credit_fjd | Most welcome credit usable on ONE unit, e.g. `25.00` | ≤ offer price; `0` = no credit allowed |
| capacity_unit | What is counted: `seat`, `vehicle`, `party` … | |
| capacity_quantity | How many units you are selling | whole number ≥ 1 |
| booking_cutoff | Last booking time `YYYY-MM-DD HH:MM`, Fiji time | at or before the service start |
| inclusions / exclusions | Plain text | inclusions required |
| min_spend_fjd | Minimum offer price for credit to apply (optional, `0`) | |
| cancellation_terms | Text the guest sees | required |
| credit_restore_hours_before | Hours before start up to which a cancellation gives credit back (blank = never) | |
| inventory_restore_hours_before | Hours before start up to which a cancelled place is put back on sale (blank = never) | |
| funding_party | `operator`, `vakaviti` or `shared` — who pays for the discount/credit | |
| operator_payout_fjd | What the operator receives per unit | unchanged by any credit |
| instant_confirm | `yes` only if an operator acceptance contract covers it, else `no` | `no` = request-only until staff confirm |
| operator_contract_id | Contract reference (required if instant_confirm = yes) | |

Money is in whole dollars and cents (`150`, `150.5`, `150.50`). Do not use currency symbols or commas inside numbers.
