# Owner decision sheet - four out-of-band route cases first (2026-10-05)

> **HOLD - PRICING FREEZE (James, 2026-10-05).** Production prices and pricing rules stay unchanged; the held candidate is not to be deployed; no further fare decisions are requested for now. Kept for reference only; see `HOLD.md`.

**Nothing here is decided, recommended or implemented.** Production, bookings, fares and fuel settings are unchanged. This sheet gives no recommendation on the four cases and invents no fare: it shows the two figures that already exist, how each site behaves today, what history exists, and what is **UNKNOWN**. Terms: *quoted* = shown to the guest; *submitted* = sent in the booking request; *recorded* = stored in a booking record; *paid* = money received (this flow collects none; the guest pays the driver). Data basis: current production code and the Worker deployed as `7a32a034`, run in an isolated harness and browser (outbound blocked), pricing snapshot refreshed read-only 2026-10-05; historical rows below are read-only aggregate queries of recorded amounts (no personal data), extracted 2026-10-05T09:55:39Z.

**Approved so far (only this):** Marriott Momi Bay **minibus**, within its recorded scope: base FJ$175.92 before the 10% discount; one-way 157.92; day return 297; day return with a child seat 304. It approves nothing else (no other vehicle, route, return rounding or night rule).

## Part 1 - the four cases the Worker would refuse (catalogue differs from formula by more than 30%)

Day pickup 10:00, no extras. "Catalogue" = the fare published in the booking tool and pages; "Worker formula" = the distance formula. Neither is approved as the intended fare. Both alternatives are shown with the pre-discount figure and the guest total (10% discount, whole dollars, above FJ$50).

| Case | Alternative A: catalogue | Alternative B: Worker formula | Difference |
|---|---|---|---|
| **1. Nadi downtown, sedan, one-way** | 19 (no discount) | 30.15 (5.57 flagfall + 3.592 x 6.844 km) | catalogue is 11.15 (37%) lower |
| **2. Mercure, sedan, one-way** | 19 | 30.15 (same zone and distance as case 1) | 11.15 (37%) lower |
| **3. Wailoaloa, sedan, return** | 75 before discount, **67** total (39 x 1.85 = 72.15, rounded up to 75, less 8) | 56.17 before discount (30.36 x 1.85), **50.17** total (less 6) | catalogue is 16.83 (34%) higher |
| **4. Crowne Plaza, sedan, return** | 67 (same as case 3) | 50.17 | 16.83 (34%) higher |
| Option C for each | another figure supplied by you: ______ | | |

**Current behaviour on each site (as run in the harness; nothing was submitted to production):**

| Case | NAT page (opt-in to quote consent) | FijiDash production code | FijiDash held candidate | Where the catalogue figure is advertised |
|---|---|---|---|---|
| 1, 2 (sedan one-way) | quotes 19; the Worker refuses it (409); the guest is told the total changed and must accept 30.15 before anything is recorded | selection card shows 19; review step shows **30.15** with a "Price updated" note; submits and records 30.15 (no consent step) | quotes 30.15 at selection and review; if the live lookup fails it shows 19 as an estimate and falls back to the same consent step | routes table (19); "from FJ$19" in the FAQ on both sites; llms.txt "Nadi Town Centre - from FJ$19" |
| 3, 4 (sedan return) | quotes 67 (Crowne Plaza page prints 72 before discount, the calculator gives 75); refused; guest must accept **50.17** | selection 67; review shows **50.17** (the price falls); records 50.17 | quotes 50.17 at selection and review; lookup-failure fallback as above | routes table (sedan one-way 39 for both Wailoaloa rows); Crowne Plaza route page tables (FijiDash 39 one-way / 75 return before discount; NAT 72 return); llms.txt "Wailoaloa Beach Hotels - from FJ$39" |

So today the guest ends up quoted and recorded at the **Worker** figure on every path except where the NAT/lookup-failure consent step is declined (no booking is recorded). In cases 1-2 that is higher than the advertised figure; in cases 3-4 it is lower.

**Recorded history (aggregate of recorded amounts, not payments; may include staff or test bookings - UNKNOWN):**

| Group (zones are shared: Nadi downtown and Mercure both map to zone "Nadi"; Wailoaloa and Crowne Plaza to "Wailoaloa") | Records | Recorded amounts |
|---|---|---|
| Airport -> Nadi, sedan, one-way | 3 (2026-08-09 to 2026-09-21) | all 30.15; none at 19 |
| Airport -> Wailoaloa, sedan, return | 1 (2026-08-24) | 50.17; none at 67 |
| Airport -> Wailoaloa, sedan, one-way (context; not an out-of-band case) | 6 (2026-08-09 to 2026-10-05) | between 30.36 and 39 |
| Negotiation requests / driver offers on these zones | 0 | none exist |

**Operator-cost evidence (what exists, and what does not):**

| Item | Status |
|---|---|
| Driver / operator cost or payout for these four route/vehicle/trip cases | **UNKNOWN** (no per-route cost or payout field exists in the bookings, drivers or settings tables that were inspected; the wallet / ledger tables were not queried) |
| Fuel and vehicle running cost per km | **UNKNOWN** (the formula's fuel baseline FJ$3.39/L and multiplier 1 are a price-rule input, not a measured cost; no fuel adjustment is enabled or proposed) |
| Platform commission | default rate 0.15 is recorded in settings; what the driver receives net of it is **UNKNOWN** here |
| Driver custom per-km rates | none enabled (0 drivers) |
| Driver counter-offers on these routes | none recorded |
| Margin or minimum acceptable fare for these routes | **UNKNOWN**; none is recommended or inferred |

**Your decision for each case (no recommendation is made):**

| Case | A catalogue | B Worker formula | C other figure | Defer |
|---|---|---|---|---|
| 1 Nadi downtown sedan one-way | [ ] | [ ] | [ ] ______ | [ ] |
| 2 Mercure sedan one-way | [ ] | [ ] | [ ] ______ | [ ] |
| 3 Wailoaloa sedan return | [ ] | [ ] | [ ] ______ | [ ] |
| 4 Crowne Plaza sedan return | [ ] | [ ] | [ ] ______ | [ ] |

If you want cost-based evidence before deciding, the missing inputs are: the driver payout or cost for a sedan from the airport to Nadi town and to Wailoaloa, one-way and return, and your minimum acceptable fare. Those are not in any system queried.

## Part 2 - separate decisions (each independent; none is implied by Part 1)

| Decision | Options | Status |
|---|---|---|
| **Night pricing.** Pages and FAQ say 20%, but FijiDash quotes, submits and records the day amount at night; the return pickup time is ignored by both client and Worker | N0 none / N1 existing Worker rule (outbound pickup only) / N2 per leg (needs an approved allocation rule; the equal-legs and 1.00/0.85 splits in the policy table are assumptions only) / N3 page convention (outbound only, rounded up to FJ$5). Any outbound-only rule ignores a night return pickup | open |
| **Global return rounding.** Page rounds returns up to the next FJ$5; Worker does not | R1 page convention everywhere / R2 Worker convention everywhere / R3 keep both. The Momi approval above covers the Momi minibus figures only and does not approve R1 or any rounding for other routes | open |
| **Momi sedan / minivan scope.** The held candidate currently extends the Momi return convention to them (166 / 252) without approval | E1a minibus-only / E1b extend to sedan and minivan returns / E1c also their one-way | open; unapproved extension in the candidate |
| **Tanoa International.** Worker has no rule and records whatever amount is sent; pages quote 15 / 25 / 45 | T1 fixed-fare rule with fares you supply / T2 treat as an existing zone / T3 quote on request / T4 keep as is. No default is assumed | open |

Reference: `POLICY-DECISION-TABLE.md` (figures, all 108 disputed rows), `NIGHT.md`, `RECONCILIATION.md`, `CATALOGUE-LED-IMPLEMENTATION-PLAN.md`. After you decide, each rule becomes its own change, re-tested and independently reviewed, with a production drift check before any release. No implementation or deployment happens before then.
