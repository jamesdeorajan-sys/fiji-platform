# Review package - Momi minibus FINAL fare FJ$175.92 (P0 clarification, 2026-10-05) - CANDIDATE, NOT DEPLOYED

> **HOLD - ALL THREE RELEASES (James, 2026-10-05).** The exact no-extras case works, but adding a child seat makes the journey cheaper (165.92 < 175.92) and the FijiDash night review (157.92) falls below the approved daytime fare. These are **release blockers for this candidate.** Production is unchanged; nothing is to be deployed. Follow-up documents on this branch: `FARE-CONTRACT-momi-final-fare.md` (corrects ambiguous wording below), `MOMI-DECISION-TABLE.md` (16-cell table, options, owner decisions), `PRICING-RULE-ORIGIN-139-0956.md`.
>
> **Corrections to this package (supersede the text below where they conflict):** (1) the FijiDash reference-fare statements: `GET /reference-fare` returns the legacy PRE-discount formula fare; its equality with 175.92 for this journey is incidental - the second discount is prevented by the explicit approved-final-fare branch, not by that equality; the 409 field of the same name is the post-discount calculated total (see the fare contract). (2) "All other pricing unchanged" excludes, on FijiDash, the Momi minibus catalogue change (79 -> 175.92) and the Momi minibus return review figures (292.45 etc. -> the approved 297 / 304 convention); verified cell by cell (`integration/scope-grid.test.mjs`). (3) "Rollback"/"old tabs": the old-tab exposure (old pages keep quoting and recording 157.92 until reload) is **not fixed** by anything in this candidate.

James's clarified decision: Nadi Airport -> Fiji Marriott Resort Momi Bay, **minibus**, **daytime one-way, no extras**: **FJ$175.92 is the FINAL fare, the standard discount already included. No further 10%. FJ$157.92 is not the intended final fare.** Production stays unchanged until James approves the exact release. Author-verified only (nothing independently reviewed yet). No deployment, migration, cache purge, booking edit or fuel change was made. Pricing freeze otherwise remains: no other fare, rule, extra, night, rounding, commission or fuel behaviour is changed.

## Exact candidates (three narrow branches; the held broad pricing candidate and Marau work are NOT included)

| Component | Branch | Commit | Built on (current production) |
|---|---|---|---|
| Worker | `ceo/momi-final-fare-worker` | `948a693` (+ this package and the integration tests in the branch head) | `0b961a4`, live as Worker version `7a32a034` |
| NAT page | `ceo/momi-final-fare-nat` | `154019d` | `c5ee3b1`, Pages deployment `8be05ec7` |
| FijiDash page | `ceo/momi-final-fare-fijidash` | `d3fdb99` | `8c6f920`, Pages deployment `8d1dc75d` |

Focused diffs: Worker `pricing.mjs` +18, `worker.js` +13/-3 (`git diff 0b961a4 948a693`); NAT `app.js` +31, Momi route page ±10, `index.html` cache key (`git diff c5ee3b1 154019d`); FijiDash `app.js` +45, Momi route page ±6, `index.html` cache key (`git diff 8c6f920 d3fdb99`).

## Where the extra discount was applied (traced, every place)

catalogue -> selection -> reference fare -> review -> submitted -> saved -> response -> alerts:

| # | Place | Behaviour before | Now |
|---|---|---|---|
| 1 | Catalogue `ROUTES_DATA` Momi minibus | NAT 175.92 (deployed); **FijiDash production still 79** (superseded) | both 175.92 |
| 2 | Page `calculateTotal` (selection, vehicle cards, confirmation, WhatsApp text, booking amount) | 175.92 less `round(10%)` = 157.92 | exact journey: subtotal 175.92, discount 0, final 175.92 (`approvedFinalFare`); everything else unchanged |
| 3 | Routes table cell (both sites) and FijiDash mobile route rows | struck-through 175.92 then 157.92 | one figure "FJ$175.92 final fare" |
| 4 | FijiDash review: `/reference-fare` returns the formula figure **before** discount (175.92) and the page then discounted it again | 157.92 at review | review total stays 175.92 (no second discount, no "price updated" note) |
| 5 | Worker `createBookingRecord`: formula 175.92 then `applyLoyaltyDiscount` | calculated 157.92; 175.92 only "kept in band" | the named approved final fare is the Worker's own figure for that journey: matched 175.92 (reason `approved_final_fare`, `pricing_version` records the id); 409 / legacy replacement use 175.92 |
| 6 | Alerts and driver broadcast | print the recorded amount | recorded 175.92 (no 157.92 anywhere in alert text; no FARE CHECK for a matched fare) |
| 7 | Momi route pages (table, visible FAQ, FAQ JSON-LD, price specification) | "175.92 -> 157.92", "before the booking discount" | "FJ$175.92 final fare (no further discount)"; 175.92 is never described as pre-discount; return 330 -> 297 unchanged |
| not touched | Worker `/reference-fare` and negotiation floor (pre-discount formula figure) | unchanged | unchanged; the FijiDash page no longer discounts it for this journey |

## Design (explicit, narrow, no inflated base, no global discount switch-off)

- `APPROVED_FINAL_FARES` (Worker `pricing.mjs`) names ONE approval, `MOMI_MARRIOTT_MINIBUS_ONE_WAY_DAY` = 175.92. The caller sends `approved_final_fare_id`; the Worker recognises it only when pickup zone Nadi Airport, destination zone Momi Bay, minibus, one-way, **daytime pickup (06:00-21:59)**, no child seat, no surfboard, no tour, no custom address all hold. Anything else (unknown id, a condition not met, no id) runs the unchanged formula + discount path.
- Pages compute the same final fare locally (`approvedFinalFareFor`) for the same conditions and send the id only then. The catalogue figure 175.92 is the published base; it is not inflated and the 10% discount is not disabled for any other fare.
- FijiDash only: the approved Momi minibus **return** figures (297 / 304) are kept at review instead of being replaced by the booking system's own return figure (292.45 / 300.45) - production FijiDash recorded 292.45 / 300.45 for them; NAT already produces 297 / 304. This aligns FijiDash to your approved figures and is flagged as a FijiDash behaviour change.

## Evidence (all author-run, isolated, outbound network denied)

Tests written first and shown red before the change: Worker 4 of 9 red, NAT 9 of 11 red, FijiDash 9 of 10 red (all green after).

| Suite | Result |
|---|---|
| Worker full suite (`node --test *.test.mjs *.test.js`) | **127 pass / 0 fail** (baseline 0b961a4: 118) incl. `approved-final-fare.test.mjs` (9) |
| NAT full suite | **150 pass / 0 fail** (baseline c5ee3b1: 139) incl. `momi-final-fare.test.js` (11) |
| FijiDash suites | **59 pass / 0 fail** (baseline 8c6f920: 49) incl. `momi-final-fare.test.mjs` (10) |
| Cross-component journey `integration/journey.test.mjs` (real page functions x real Worker, in-memory DB, every outbound call recorded and blocked) | **4 pass** |

Journey results (exact journey, 10:00, one-way, no extras; `selection / review / submitted -> saved`):

| Pages | Worker | Result |
|---|---|---|
| NAT candidate | candidate | 175.92 / 175.92 / 175.92 -> 175.92, decision matched (`approved_final_fare`), alert text 175.92, no FARE CHECK; response 175.92 |
| FijiDash candidate | candidate | 175.92 / reference fare 175.92 / review 175.92 / 175.92 -> 175.92, same |
| both candidates | **production Worker 0b961a4** (page deployed first) | submitted 175.92 -> saved 175.92, decision `kept_in_band` |
| **released** NAT c5ee3b1 / FijiDash 8c6f920 (old tab or not yet deployed) | candidate Worker | NAT 157.92 / 157.92 / 157.92; FijiDash selection 71 (superseded 79 catalogue), review 157.92; saved **157.92**, `matched` - old clients are not repriced and keep the superseded figure until they reload |
| candidates | candidate | return **297** and return + child seat **304** saved exactly (Worker figures 292.45 / 300.45 are in band and never substituted) |

Old clients, characterised: a legacy caller (no opt-in, no id) far from the fare is still replaced by the unchanged formula figure (157.92 for this journey) and the staff alert still carries the FARE CHECK marker; a same-reference replay returns the same booking and fare (no second booking; one short staff alert; a stale amount cannot change it). The in-memory harness stubs the admin-notification claim as always granted, so it cannot show production's suppression of the FULL admin alert on a replay; **read-only production data shows exactly one `admin_notification_sent` event for each of 185 bookings and no booking with more than one** (extracted 2026-10-05T10:51Z), but replay suppression in production remains unverified by test.

Itinerary changes invalidate accepted revised quotes (NAT, released logic, unchanged): `fareOverrideKey` covers vehicle, trip type, pickup/destination, dates and times, extras, passengers and bags; a changed itinerary drops the acceptance; the new `approvedFinalFareFor` also stops applying the moment any of those change (tested: night, seat, return, vehicle, destination). FijiDash production has no accepted-revised-quote mechanism (that is in the held candidate), so there is nothing to invalidate there.

Browser (real Chromium, 390x844, isolated server, candidate Worker, outbound blocked; no horizontal scroll): FijiDash: routes-table cell "FJ$175.92 final fare"; vehicle card FJ$175.92; review total FJ$175.92 with no discount row; reference fare 175.92; submitted 175.92 with the id; saved 175.92; staff alerts 175.92; return -> 297 (selection 330 -> 297, reference 325.45 fetched but not swapped in, decision `kept_in_band` against 292.45), return + seat -> 304. NAT: routes-table cell, vehicle card "FJ$175.92 final fare", confirmation total 175.92, "Fare saved: FJD 175.92", staff alerts 175.92, decision `matched / approved_final_fare`; Momi route page table row "FJ$175.92 final fare (no further discount)", return "FJ$330 -> FJ$297", no 157.92 on the page. Not done: physical-phone testing.

## Unresolved interactions (reported; nothing silently extended)

1. **One-way + child seat / surfboard are NOT approved** and keep the existing arithmetic: (175.92 + 8) less 10% = **165.92**, i.e. LESS than the approved extras-free 175.92 (surfboard 179.92). Both sites and the Worker agree; the anomaly is now visible.
2. **Night is NOT approved.** NAT quotes 193 (page modifier), the Worker formula says 190.10, and **FijiDash's live-fare review drops the night modifier and applies the normal discount: 157.92 - below the approved daytime 175.92** (before this change FijiDash night and day were both 157.92; now day is 175.92 and night is 157.92). This amplifies the existing night-pricing release blocker.
3. **Old tabs/clients** keep quoting and recording 157.92 until they reload (cache key bumped, no purge). Nothing reprices them; staff will see 157.92 on those bookings.
4. **Other Momi Bay hotels** in the same zone (not Marriott) are unaffected by design (the id is route-specific and the zone-level Worker cannot tell hotels apart without it): they remain at the formula + discount figure (157.92 for a minibus one-way).
5. **FijiDash return figures change** from 292.45 / 300.45 (what production recorded) to the approved 297 / 304 (above).
6. **General discount wording that now conflicts for this one fare:** NAT `index.html` lines 666 and 937 ("10% off automatically applied to bookings over FJ$50", "10% OFF every booking over FJ$50"); NAT `app.js` 507 and FijiDash `app.js` 1196 / `index.html` 781 (same banner text); "10% off applied" / "You save ... (10% off)" card text (not shown for the final fare); the "automatic 10% loyalty discount" copy on 21 FijiDash route pages and 1 NAT route page; and the Momi page statement "extras are added before the discount" (not true for the final fare, true for returns). None was rewritten (general copy is not part of the approved scope); the Momi pages carry the exception wording.
7. **Held broad pricing candidate** (`ceo/fijidash-pricing-preview-candidate`) conflicts with this change (it extends the Momi return convention to sedan/minivan, mirrors live fares at selection, and its catalogue edit re-adds the old discount reading). It must be rebased onto this change if it is ever released; it is untouched and on HOLD.
8. FijiDash booking-saved caption "Saved online - Fiji team confirms pickup" before submission is unchanged production wording (fixed only in the held candidate).

## Deployment order and verified rollback targets (nothing deployed; each step needs your explicit approval)

Verified read-only on 2026-10-05: live NAT `app.js` identical to `c5ee3b1` (key `20261005-momi-fare`); live FijiDash `app.js` identical to `8c6f920` (key `20260927-analytics-optional`); Worker version `7a32a034` (tag `0b961a4`) is the current deployment; the candidate Worker bundles (`wrangler deploy --dry-run`, 206 KiB). Re-run this drift check immediately before any release.

1. **Worker first** (additive and id-gated; the journey matrix proves old pages are unaffected and new pages also work against the old Worker, so the order is safe in either direction). Monitor read-only after.
2. NAT page (Pages `nadiairporttransfers`, source commit `154019d`, new key `20261005-momi-final-fare`).
3. FijiDash page (Pages `nadi-guest-widget-preview`, source commit `d3fdb99`, same key).

Rollback targets = the current production state: Worker **7a32a034** (`0b961a4`); NAT Pages **8be05ec7** (`c5ee3b1`); FijiDash Pages **8d1dc75d** (`8c6f920`). Rollback order: pages first, then the Worker. Further-back fallbacks recorded for completeness (they predate released quote-consent / formatting fixes and would remove them): Worker `8c1fa242` (`2125a34`), NAT `b0ab2505` (`fa9f2af`). A rollback only affects future quoting: saved bookings and their recorded amounts are not touched.

## Not done / limitations

No independent review; no physical-phone test; production replay suppression of the full admin alert untested by harness; the in-memory D1 stand-in is not the real database; the approved fare is hard-coded as one table entry (not the catalogue-led shared source, which is on HOLD); night and extras remain undecided (items 1-2).
