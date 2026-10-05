# Audit: FijiDash production selection vs review (counting definitions and raw calculations)

## Definitions
- **Row** = route x vehicle (sedan/minivan/minibus) x trip (one-way/return) x extras (none / child seat FJ$8) x pickup time (day 10:00 / night 23:00). Arrival direction, airport -> destination, FJD only.
- **Rows enumerated:** 864 (36 FijiDash routes x 24).
- **Excluded from the denominator (no server price to compare against):** 24 rows = TANOA_INTERNATIONAL (Worker has no zone distance/rule). They are counted separately, never as "matching" or "differing".
- **Priceable rows (denominator):** 840.
- **Selection total** = the page's own `calculateTotal(vehicle).final` immediately after `computePrices` (the static published table, with the page's night/return modifiers), for the chosen vehicle, with the same extras, trip type and pickup time. This is what the vehicle card shows.
- **Review total** = `calculateTotal(vehicle).final` after the real `renderFareTiers()` has replaced `state.prices[vehicle]` with the Worker `/reference-fare` answer for the same zone, vehicle and trip type. Same state object, same extras, same discount function (10% of the subtotal, whole dollars, only when the subtotal exceeds FJ$50), same currency (FJD). Only `state.prices[vehicle]` differs between the two reads.
- **Differs** = |selection - review| > FJ$0.005 (any difference at all). Thresholds below show how many differ materially.
- **Lookup failures:** this table assumes the lookup succeeds. When the lookup is unavailable the page cannot replace the price, so selection = review by construction (counted in the separate "lookup-down" variants in RECONCILIATION.md, never in this 840). Missing prices: none among priceable rows (every one has a published table figure and a Worker figure).

## Result
| Measure | Rows | Share of priceable |
|---|---|---|
| Priceable rows | 840 | 100.0% |
| Differ at all (> FJ$0.005) | 840 | 100.0% |
| Identical (<= FJ$0.005) | 0 | 0.0% |
| Differ by more than FJ$1 | 790 | 94.0% |
| Differ by more than FJ$5 | 696 | 82.9% |
| Differ by more than FJ$20 | 392 | 46.7% |
| Differ by more than 5% of the selection total | 636 | 75.7% |
| Differ by more than 20% of the selection total | 142 | 16.9% |

Largest difference: FJ$218.92. Median difference: FJ$18.59.

Rows are combinations, not 840 distinct guest journeys. The base subset (day, no extras) is 210 route/vehicle/trip cases: 210 differ at all, 185 by more than FJ$1, 143 by more than FJ$5, 10 by more than 20%.

Why nearly all rows differ at all: the published table holds whole-dollar figures, the Worker figure is a distance formula in cents, so exact equality is essentially impossible. That is why "840 of 840" overstates the guest impact: 50 rows differ by FJ$1 or less. The material counts above are the honest measure.

### By time

| time | rows | differ at all |
|---|---|---|
| day 10:00 | 420 | 420 |
| night 23:00 | 420 | 420 |

### By trip

| trip | rows | differ at all |
|---|---|---|
| one-way | 420 | 420 |
| return | 420 | 420 |

### By vehicle

| vehicle | rows | differ at all |
|---|---|---|
| sedan | 280 | 280 |
| minivan | 280 | 280 |
| minibus | 280 | 280 |

### By extras

| extras | rows | differ at all |
|---|---|---|
| none | 420 | 420 |
| child seat | 420 | 420 |

## Representative raw calculations (full `calculateTotal` objects)

**MARRIOTT_MOMI / minibus / one-way / extras none / day 10:00**
- selection (static table incl. page modifiers): vehiclePrice 79, extras 0, subtotal 79, discount 8, **final 71**
- Worker /reference-fare (one-way; pre-discount, no night, no extras): 175.92
- review (same state, vehicle price replaced): vehiclePrice 175.92, extras 0, subtotal 175.92, discount 18, **final 157.92**
- difference 86.92; discount function identical (10% of the subtotal when above FJ$50, whole dollars).

**MERCURE_NADI / sedan / one-way / extras none / day 10:00**
- selection (static table incl. page modifiers): vehiclePrice 19, extras 0, subtotal 19, discount 0, **final 19**
- Worker /reference-fare (one-way; pre-discount, no night, no extras): 30.15
- review (same state, vehicle price replaced): vehiclePrice 30.15, extras 0, subtotal 30.15, discount 0, **final 30.15**
- difference 11.15; discount function identical (10% of the subtotal when above FJ$50, whole dollars).

**HILTON_DENARAU / sedan / one-way / extras none / day 10:00**
- selection (static table incl. page modifiers): vehiclePrice 49, extras 0, subtotal 49, discount 0, **final 49**
- Worker /reference-fare (one-way; pre-discount, no night, no extras): 47.87
- review (same state, vehicle price replaced): vehiclePrice 47.87, extras 0, subtotal 47.87, discount 0, **final 47.87**
- difference -1.13; discount function identical (10% of the subtotal when above FJ$50, whole dollars).

**CROWNE_PLAZA_NADI_BAY / sedan / return / extras child seat / night 23:00**
- selection (static table incl. page modifiers): vehiclePrice 90, extras 8, subtotal 98, discount 10, **final 88**
- Worker /reference-fare (return; pre-discount, no night, no extras): 56.17
- review (same state, vehicle price replaced): vehiclePrice 56.17, extras 8, subtotal 64.17, discount 6, **final 58.17**
- difference -29.83; discount function identical (10% of the subtotal when above FJ$50, whole dollars).

**MERCURE_NADI / minivan / return / extras none / day 10:00**
- selection (static table incl. page modifiers): vehiclePrice 95, extras 0, subtotal 95, discount 10, **final 85**
- Worker /reference-fare (return; pre-discount, no night, no extras): 95.13
- review (same state, vehicle price replaced): vehiclePrice 95.13, extras 0, subtotal 95.13, discount 10, **final 85.13**
- difference 0.13; discount function identical (10% of the subtotal when above FJ$50, whole dollars).

**SHANGRI_LA_YANUCA / minibus / one-way / extras none / day 10:00**
- selection (static table incl. page modifiers): vehiclePrice 199, extras 0, subtotal 199, discount 20, **final 179**
- Worker /reference-fare (one-way; pre-discount, no night, no extras): 219.37
- review (same state, vehicle price replaced): vehiclePrice 219.37, extras 0, subtotal 219.37, discount 22, **final 197.37**
- difference 18.37; discount function identical (10% of the subtotal when above FJ$50, whole dollars).
