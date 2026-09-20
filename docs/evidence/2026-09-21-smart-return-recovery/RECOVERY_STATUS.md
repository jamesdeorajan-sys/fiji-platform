# Issue #54 Smart Return / Trigger Fill — recovery review and bounded completion plan

Prepared 2026-09-21 (Claude). Continues the **existing** work (Issue #54, branch `ceo/smart-return-trigger-fill-shadow`); no replacement project. **Nothing here changes a live fare, publishes an offer, sends a message, writes to D1 or wires production.** Figures are AUTHOR-VERIFIED until Codex reproduces them. Customer details are not used or published.

## 1. Bottom line
- The shadow foundation is real and well tested **in memory** (Codex ran 143/143 at `4ca67ac`; I re-ran 143/143), but **the pipeline had never been run against real data**, and the real database cannot supply its main input: **no booking has ever reached `accepted`** (0 accept events; `pending` 150 / `completed` 1 across all rows; 1 driver, 1 vehicle).
- I found and fixed one concrete real-data defect (the adapter recognised **0 of 107** real rows as airport trips because the real zone name is `Nadi Airport`, not `NAN`) and added the missing pieces for a pilot: an ops-verified-movement contract, a structured passenger/luggage extractor, and an internal seven-day shadow pilot runner (recovery branch `ceo/smart-return-recovery-pilot`; revision 1 @ `441c000` 163/163 (independently run by Codex), revision 2 @ `344d4079c198713f9361e328bf5efa4c73834098` 181/181 (independently run by Codex) after Codex's review found four pilot gaps — section 14; **revision 3 @ `d630ebc804f968499abe60b338d0fe3d3669ca90` 194/194** after two further cases — section 15).
- A **what-if** run (saved requests treated *as if* verified — explicitly not a pilot) shows **0 feasible empty-leg opportunities** because the inputs are missing (vehicle assignment, trip duration, turnaround, capacity, availability attestation, economics). **That is not evidence of zero commercial demand or fleet potential** — it only pinpoints what to collect.
- Unknown feasibility or economics remains **HOLD**. Existing formula pricing is **not** treated as an approved commercial source.

## 2. What exists (branch `ceo/smart-return-trigger-fill-shadow` @ `4ca67ac`)
| Area | State |
|---|---|
| Movement ledger schema + idempotent ingestion, PII denylist, opaque `booking_contact_ref` | BUILT, tested in memory; migrations `0001`–`0006` **never applied** to any D1 |
| Matcher (exact/nearby/corridor/extension/multi-leg), completion-based chronology, operational vs commercial verdicts | BUILT, tested; **uses placeholder geography** (`geo_seed.js`, disabled for real matching) and only checks vehicle-class equality (no capacity, luggage, vehicle identity, driver availability) |
| Pricing guardrails (floor enforcement, HOLD reasons, RETURN_LOCK eligibility, AU$50 EARN/REDEEM split) | BUILT, tested; eligibility only — no issuance |
| Offer state machine DISCOVERED→VALIDATED→ACTIVE→HELD→FILLED/EXPIRED with compare-and-swap | BUILT, tested in memory; D1 implementation (`createD1Store`) written but **never run against D1** |
| Production adapter (HMAC opaque ref, Fiji→UTC, human-confirmation proof), route-price-truth builder, live-shadow report, 7-day board, WhatsApp card builder (never sends) | BUILT, tested with hand-made fixtures; **not run on real rows** |
| Docs (README, CEO report, first-run plan) | **Stale**: README said 76 tests, report 85, both now 143; the run plan assumed `accepted` bookings. Reconciled by banner on the recovery branch |
| Wiring | **None**: no storefront, Worker, D1 binding, DNS or offer publication touches it |

## 3. What has actually run against real data
- **Before this session: nothing.** The run plan says so (Cloudflare access was unavailable) and `4ca67ac` adds only helpers.
- **This session (read-only, 2026-09-21, counts only):** table counts and coverage on `nadi-marketplace-db`; and an in-memory what-if pilot over the 107 saved requests not excluded by the current test rules (`data/`-style counts in `whatif_pilot_counts_only.csv`). No writes; the what-if input/output stay private.

## 4. What remains unwired (unchanged)
Applying migrations; populating `route_price_truth`; any storefront reading it; exposing the board; any real-time ingestion; offer creation from real movements; dispatch approval; vehicle/time claims; withdrawal on change; public offers; credit issuance; WhatsApp sending.

## 5. Reconciling Issue #54 with Issue #59
| Topic | #54 (20 Sep live-watch: HOLD/shadow, downstream of booking integrity, pricing truth, notification recovery, lineage) | #59 | Reconciliation |
|---|---|---|---|
| Confirmed movement | assumed `status='accepted'` via a driver-accept/admin-assign event | Stages "human-confirmed / completed / cancelled" are **UNKNOWN**; 106 of 107 rows `pending` | The same missing source. One ops-verified sheet serves both (section 7) |
| Fare authority | route price truth from `computeRealReferenceFare` | Published fares ≠ server formula (6 of 105 cells; Momi minibus 71 vs 157.92); fare authority decision **open** (Codex leans to "price shown at confirmation = price of record") | Pricing truth for #54 is **blocked** on that decision |
| Storefront attribution | 3 storefronts → one truth | FijiDash rows with Nadi referrer are Nadi-origin; BFT has no data | Movements must carry storefront + attribution; BFT stays parked |
| Test / duplicate rules | n/a | 107 = "not excluded by current test rules"; dedup rules documented | The pilot must use the same exclusion and duplicate rules |
| Release gating | shadow only | Outrigger/mobile releases separate; PR #55 HOLD | No coupling: none of this goes near those releases |

## 6. Ordinary return discounts vs fleet-backed empty-leg specials
| Class | What it is | Fleet-backed? | Trigger | Authority / data needed | State |
|---|---|---|---|---|---|
| **Ordinary return pricing** (existing) | Guest books both legs in one booking; the Nadi widget prices return as **×1.85** of one-way. FijiDash's return rule was **not inspected** in this review. | No | Guest choice | Each storefront's own published rule | Live, untouched |
| **RETURN_LOCK** (#54) | Guest books both legs ≥ 7 days ahead → eligible for a lock fare and AU$50 experience credit (2 × AU$25, credit ≠ fare discount) | **No** — a guest-behaviour incentive, no vehicle needed | Booking timing | Approved fare authority, margin approval, per-storefront rule | Eligibility code only; `return_lock_price` must stay blank until approved |
| **SMART_MATCH** | Price for a sold/requested booking that chains onto a vehicle finishing nearby | **Yes** | Feasible match | Verified vehicle assignment, duration, capacity, payout, floor, approved fare | Blocked |
| **LIVE_FILL / empty-leg special** | Discounted offer on a predicted deadhead leg of a specific vehicle | **Yes**, exclusive to that vehicle and time window | Verified movement + free vehicle | All of the above + dispatch approval + exclusive claim | Blocked; no offers exist |
**Do not import BFT's return rule into Nadi/FijiDash.** BFT's return pricing is not in this repo or database (UNKNOWN). The contract's `acquisition_price` (BFT-style deal price) and `return_lock_price` fields must not be populated from BFT rules for Nadi/FijiDash; each storefront keeps its own rule until James records a shared one. Empty-leg specials are a separate mechanism and must never be sold as, or netted against, a return discount.

## 7. The critical input mismatch — and a trustworthy source
**Finding.** Ops reports orders as active; the database shows `pending` 150 / `completed` 1, **0** `accepted` events, **1** driver (verified/online), **1** vehicle, 1 booking with a driver, 0 negotiations linked to bookings. The Worker *does* contain the accept/assign paths (`handleDriverAcceptBooking`, `handleAdminManualAssign` → `accepted` + an event with actor `driver:<id>`/`admin`), but production is not using them: confirmation and dispatch are happening off-system (WhatsApp group, per James).
**What must not be done:** treat `pending`, a sent WhatsApp alert, provider acceptance, or a quote as confirmation; or invent `accepted`.
**Recommended trustworthy source (no invented statuses):** an **ops-verified movements sheet** — one row per confirmed movement with a named confirmer, `confirmed_at`, an evidence pointer (never message text), an opaque vehicle/driver reference, pickup/return legs, passengers/luggage and an ops trip-duration estimate — sanitized into `docs/OPS_VERIFIED_MOVEMENTS_CONTRACT.md` (recovery branch). It extends the private worksheet already sent to James for Issue #59, so one effort serves both. Longer term, and only with James's approval (it is a write path): ops use the existing admin manual-assign action so `accepted` events exist. Not authorised now.

## 8. Coverage assessment (107 saved requests not excluded by current test rules; all figures counts only)
| Input | Coverage | Source and gap | Verdict |
|---|---|---|---|
| Zone vocabulary | 107/107 pick up at `Nadi Airport`; 11 destination zones (Denarau 40, Coral Coast 33, Momi Bay 10, Natadola 9, Wailoaloa 5, Pacific Harbour 4, Vuda Point 2, Lautoka/Suva/Sonaisali/Nadi 1 each) | Fixtures/adapter used `NAN`/`HILTON_DENARAU`; adapter recognised **0/107**. Fixed on recovery branch | Was broken; fixed + tested |
| Reverse leg | 42 of 107 rows carry a return date (across all 151 rows, all 44 return rows have a return time and 42 a return location) | A round trip is **one row**; the return leg exists only as return fields. Pilot expands rows into legs | Available |
| Trip duration | **0 of 107** | No field on `bookings`/`zones`; `zone_distance_cache` (15 pairs) holds distance only; `geocoded_addresses` has duration text for 15 of 28 custom addresses but bookings store zones, not addresses → no join | **HOLD** — needs an ops duration table for the 11 outbound zone pairs (and reverse) |
| Distance | 107/107 (`distance_km`) | Server-computed | Usable sanity check, not duration |
| Passengers / luggage | On-site widget **44/46** (structured `Passengers:`/`Luggage:` tokens in notes); FijiDash **0/36**; no-ref **0/25**; negotiation source **0** (5 requests, all expired, none linked) | New integer-only extractor; FijiDash's storage not found | Partial; others **HOLD** |
| Vehicle capacity | Widget-declared: sedan 3 pax/3 bags, minivan 7/7, minibus 12/14 | From storefront JS, not ops-confirmed | **HOLD** until ops confirms |
| Vehicle/driver identity and availability | 0 assignments in practice (1 driver, 1 vehicle rows; DB has `max_hours_cap` and a rest-gap setting but no real roster) | Fleet/roster lives off-system | **HOLD** — cannot be fleet-backed |
| Turnaround buffer | Placeholder 45 min | Ops decision | **HOLD** until confirmed |
| Commercial inputs | `route_price_truth` rows: **0**; operator payout, incremental cost, floor: unverified; `default_commission_rate` = 0.15 | See section 9 | **HOLD** |

## 9. Revalidating fare authority and incremental cost/payout before any discount
- **Fare authority is open (#59).** `computeRealReferenceFare` is the Worker's zone formula; it disagrees with published fares in 6 of 105 one-way cells and the deployed pricing-drift rule replaces client amounts by that formula. The route-price-truth builder therefore **must not** treat it as approved. Until James records a fare authority, pilot `route_price_truth.fare_authority_approved` stays `false` and the runner returns `FARE_AUTHORITY_UNAPPROVED`.
- **Floor:** the builder reuses `NEGOTIATION_FLOOR_RATIO = 0.80` (a guest-negotiation guard). That is **not** an approved empty-leg floor; a floor for a special must be a business decision tied to marginal cost.
- **Payout/cost:** `default_commission_rate` (0.15) is a platform commission on a booking; it is **not** evidence of what an operator/driver is paid or of the **incremental** cost of a vehicle already repositioning (fuel, driver time, wear, minimum pay). Needs ops-verified marginal cost per route and class.
- **Currency:** the contract example uses AUD while every stored fare is FJD; pick FJD as the pricing currency and state conversion rules before any special.
- Any discounted offer additionally needs: contribution margin ≥ James's threshold, floor ≥ verified marginal cost, and dispatch approval.

## 10. Internal seven-day shadow pilot — prepared
- **Runner:** `scripts/seven_day_pilot.js` (recovery branch): `node scripts/seven_day_pilot.js --input verified.json --start YYYY-MM-DD`. Pure/read-only; input is a sanitized ops-verified file; only exact reverse zone pairs are evaluated (no placeholder geography).
- **Per verified arrival leg with an assigned vehicle** it reports the predicted empty leg, sold reverse bookings the same vehicle can serve (a *chain*: deadhead avoided, not a discountable special), an empty-leg **opportunity** only when every operational gate passes (commercial verdict kept separate: HOLD unless verified payout, floor, price and approved fare authority exist), and **every rejected match with reasons**: `NOT_VERIFIED`, `NO_VEHICLE_ASSIGNMENT`, `DIFFERENT_VEHICLE`, `VEHICLE_CLASS_MISMATCH`, `NOT_EXACT_REVERSE`, `NOT_EVALUATED_GEOGRAPHY_UNVERIFIED`, `DURATION_UNKNOWN`, `TURNAROUND_UNKNOWN`, `TIMING_INFEASIBLE`, `CAPACITY_UNKNOWN`, `CAPACITY_EXCEEDED`, `VEHICLE_CONFLICT`, `ECONOMICS_UNKNOWN`, `FARE_AUTHORITY_UNAPPROVED`.
- **Tests:** 14 pilot tests + 6 real-zone/notes tests, mutation-checked (breaking the fare-authority or timing gate fails tests).
- **Real-data what-if (not a pilot):** window 21–27 Sep, 23 legs (13 arrival, 10 departure) from saved requests treated as verified: **0** chains, **0** operationally feasible, **0** ready-to-price, **13** on hold (all four blockers), **130** rejected matches (83 not-exact-reverse/geography-unverified; 47 exact-reverse candidates blocked by no vehicle, duration, turnaround and capacity; 23 class mismatches). See `whatif_pilot_counts_only.csv`.
- **Real pilot needs (owner: James/ops):** the verified-movements file for the window, an ops duration table, turnaround, confirmed capacity, and vehicle refs. Until then the correct output is HOLD.

## 11. Remaining work for dispatch-approved offers, expiry, exclusive claims and withdrawal
Existing: an offer status machine with CAS, `expires_at`, a sweep, hold/release/fill. Missing:
1. **Dispatch approval state** (e.g. VALIDATED → DISPATCH_APPROVED → ACTIVE) with who/when; no offer may go ACTIVE without a named dispatcher.
2. **Exclusive vehicle-time claim**: today only an *offer* cannot be double-held; nothing prevents the same vehicle/time being assigned to a normal booking. Needs a claim record keyed on `(vehicle_ref, time window)` written atomically with the hold.
3. **Expiry rules**: `expires_at` derived from `min(latest_pickup − cutoff, source-completion changes)`; hold TTL (`HELD` currently never times out on its own).
4. **Withdrawal** when the source movement is cancelled, reassigned, delayed or the vehicle conflicts: new WITHDRAWN status, automatic on assignment change, with reason and audit row; a held/filled offer needs a compensation path.
5. **Audit log** of every transition and recommendation; idempotent fill → booking creation.
6. **D1 execution**: run `createD1Store` CAS against a real D1 in preview with concurrent-claim tests (changes()===1 semantics).
7. **Ops UX**: the card builder exists but nothing sends; approval/withdraw actions must be human, in the ops channel.

## 12. Bounded completion plan
| # | Work | Owner | Acceptance evidence | Gate |
|---|---|---|---|---|
| 0 | Recovery: fix real-zone defect, contract, extractor, pilot runner, doc reconciliation | Claude (done) | Branch `ceo/smart-return-recovery-pilot` @ `441c000`, 163/163; Codex reruns | — |
| 1 | Independent review of recovery branch; reconcile original branch docs | Codex | Rerun 163/163; sign-off list of stale statements fixed | none |
| 2 | Ops-verified movements for the pilot window (with evidence refs, vehicle refs, pax/bags) | James / ops | File passes the contract; ≥ N verified movements; evidence refs resolvable privately | James supplies |
| 3 | Ops input tables: durations for 11 zone pairs (+reverse), turnaround, confirmed capacity | Ops → James | Signed CSV in repo (no PII) with source/date | needed for any FEASIBLE |
| 4 | Fare authority decision (#59) and marginal cost/payout/floor per route+class | James (decision), ops (numbers), Codex (review) | Decision recorded; rows with `fare_authority_approved`, `last_verified_at`, verifier | needed for any price |
| 5 | Run the seven-day shadow pilot | Claude runs; Codex verifies | Report + input file hash; feasible opportunities, rejected matches with reasons, no writes; reproducible | after 2–4 |
| 6 | Go/no-go on building the offer lifecycle (section 11) | James | Written decision using the pilot's feasible-opportunity count and contribution; threshold set by James | only if pilot shows real value |
| 7 | Offer lifecycle build in preview (approval, claims, expiry, withdrawal, D1 CAS) | Claude; Codex | Tests for each section-11 item incl. concurrent claims on D1 preview | after 6 |
| 8 | Any public offer, fare change, message, D1 migration on production | **James, separately** | Explicit recorded approval | HOLD |

## 13. Authorisation
This review authorises none of: live fare changes, public offers, customer/driver messages, D1 writes, migrations, or production wiring. The recovery branch is a separate, unmerged branch; the Codex-verified branch `ceo/smart-return-trigger-fill-shadow` @ `4ca67ac` is unchanged.

## 14. Revision 2 — Codex review of `441c000` (independent suite 163/163 PASS) and fixes
Codex's synthetic cases exposed four gaps in `scripts/seven_day_pilot.js`. Regression tests were written **first**: 18 tests in `test/seven_day_pilot_regressions.test.js`, of which **16 fail on `441c000`** (2 are guard tests that already held) and **all 18 pass on `344d407`**. Full suite **181/181**; each fix was mutation-checked (removing the chain conflict check, the floor-vs-cost check, the capacity gate or the confirmer check fails tests).

| Codex finding | Fix |
|---|---|
| Opportunity FEASIBLE with unconfirmed capacity; reverse duration silently assumed equal to outbound | Operationally feasible now requires confirmed capacity, an **ops-verified reverse duration** (`route_durations_verified`), confirmed turnaround, and an **availability attestation** covering the whole window; no duration is assumed |
| Approved fare flag + price 30 / floor 20 / payout 40 gave READY, contribution −10 | Inputs validated; **additional cost** required; the floor must cover payout + additional cost; contribution must meet the requirement **James** approves (`contribution_requirement`: approved, minimum, approver). No threshold is invented; anything missing is HOLD with a named reason |
| Sold reverse booking with unknown duration accepted as a chain; bypassed conflict checks | Chains use the same gates: complete sold-return interval, known duration, capacity, attested availability, and overlap against **all supplied movements** (verified or not, inside or outside the window, including commitments straddling the window start or end) |
| `confirmed_at=""` passed; named confirmer not enforced | Strict contract: source, named `confirmed_by` (a system source must be `admin` or `driver:<id>`), ISO timestamp **with zone**, non-empty evidence; rejects are counted by reason; the confirmer never appears in a report |

**Kept distinct in the output:** `HYPOTHETICAL` predicted empty legs; `OPERATIONALLY_FEASIBLE` (all operational gates); `READY_FOR_DISPATCH_REVIEW` (feasible and commercially safe) — still **not an offer** (no dispatch approval, exclusive claim, expiry or withdrawal exists). Sold chains are separate and never discountable specials. Every report carries an `interpretation` line and an `input_gaps` list.

**What-if refreshed on revision 2** (23 legs, 21–27 Sep, saved requests given placeholder confirmations): 13 hypothetical empty legs, 0 chains, 0 operationally feasible, 0 ready for review, 13 on hold, 130 rejected matches, 7 input gaps (`whatif_pilot_counts_only.csv`). Zero here reflects **missing inputs**, not demand or fleet potential.

**Smallest ops request (private worksheet; no customer details in GitHub):** one vehicle, one day (24 Sep, the day with the most saved requests), then seven days for that vehicle, then more vehicles — `ONE_VEHICLE_OPS_INPUT_REQUEST.md` on the recovery branch. Two private templates were sent to James: the day's jobs (ids, times, zones, booked class only) and the vehicle / routes / attestation sheet.

**Remaining input gaps:** verified movements with vehicle assignment; an ops duration table (both directions) for the zone pairs used; turnaround; confirmed capacity; availability attestation per vehicle and period; payout and additional cost per leg; fare authority (#59); James's approved minimum contribution; then the section-11 lifecycle work.

## 15. Revision 3 — Codex review of `344d407` (independent suite 181/181 PASS) and two remaining cases
Codex confirmed: unconfirmed capacity now holds and suppresses price; empty `confirmed_at` is excluded; a fully specified control reaches READY_FOR_DISPATCH_REVIEW. Two cases reproduced and fixed on the same branch. **Regression tests first:** `test/seven_day_pilot_regressions_r3.test.js`, 13 tests — **9 fail on `344d407`**, all 13 pass on `d630ebc`; full suite **194/194** (author-run; mutation-checked).
| Case | Fix |
|---|---|
| Source arrival (vehicle-A, Nadi Airport → Denarau, 24 Sep 09:00, 60 min) overlapping another vehicle-A job (Momi Bay → Nadi Airport 09:15, 30 min) still let the return reach READY | The **source arrival is validated too**: its own interval, with the turnaround on both sides, may not overlap another job of the same vehicle (`SOURCE_JOB_CONFLICT`). The same buffer now applies before and after the proposed empty leg and the sold return; a job with unknown duration cannot be ruled out. **An availability attestation never overrides contradictory job records**; the source check also blocks sold chains |
| Sold reverse movement with passengers −1 / luggage −1 accepted as a chain | Passengers must be a positive integer and luggage a non-negative integer (numbers only); malformed = `INVALID_LOAD`, absent = `CAPACITY_UNKNOWN`; capacity limits must be a positive-integer `pax` and non-negative-integer `bags` (0 valid) else `INVALID_CAPACITY_LIMIT`; a source load above capacity = `CAPACITY_EXCEEDED` |
The refreshed what-if is unchanged (13 hypothetical legs, 0 feasible, 0 ready, 7 input gaps) — zero reflects missing inputs, not demand or fleet potential. **Still unfinished (unchanged):** dispatch approval, exclusive vehicle-time claims, expiry/hold timeout, withdrawal after assignment changes, audit, D1 concurrency. The one-vehicle/one-day ops collection (24 Sep) continues in parallel via the private templates; nothing in the templates needed to change.

## 16. Independent verification of revision 3 and the one-vehicle/day exercise (status)
**INDEPENDENTLY-VERIFIED (Codex), `d630ebc804f968499abe60b338d0fe3d3669ca90`:** full suite 194/194; the 13 revision-3 regression tests fail 9 / pass 4 on `344d407` and pass 13/13 on `d630ebc`; source-conflict, turnaround, load and capacity changes reviewed. The reproduced findings are closed. My mutation checks and real-data counts remain **AUTHOR-VERIFIED**. This is not live dispatch or release approval.

**One-vehicle / one-day exercise (24 Sep): waiting on ops.** As of this checkpoint the two private templates are still blank, so **no exercise result exists** and none is invented. Tooling is ready and tested on the recovery branch (`60ea41fcb4a04168ef94afb88e659bdfd1f27683`, 203/203 = 194 + 9): `scripts/one_vehicle_day_exercise.js` reads the two completed private CSVs, writes the sanitized pilot input, the full pilot report and a per-leg ops-comparison sheet **only into a private folder**, and prints an **aggregate-only** summary in the five requested sections — (1) input completeness and contradictions, (2) verified movements and existing sold-return matches, (3) hypothetical vs operationally feasible legs, (4) operational holds separately from commercial holds, (5) the ops comparison (ops answer Y/N per proposed leg: vehicle actually free? matches reality?). A dry run on the blank templates confirms everything reads as unknown: 0 of 7 saved-booking rows answered, 0 vehicle answers, 0 verified movements, 7 input gaps; the pre-filled attestation sentence left untouched is **not** counted as an attestation. Unknowns stay HOLD; commercial holds (no route price truth, fare authority or approved contribution) are reported apart from operational holds. Nothing here builds dispatch approval, exclusive claims, expiry, withdrawal, audit or D1 concurrency, or conveys any live offer, message, D1 write or production approval.

