# FijiDash pricing candidate: review package for independent review (preview-only, NOT approved for release)

> **HOLD - PRICING FREEZE (James, 2026-10-05).** Production prices and pricing rules stay unchanged; the held candidate is not to be deployed; no further fare decisions are requested for now. Kept for reference only; see `HOLD.md`.

> **Terminology (read this first).** *Quoted* = the total a page shows the guest (selection, review). *Submitted* = the amount sent in the booking request. *Saved / recorded* = the amount stored in a booking record; in these documents always an in-memory record in the isolated harness, never a production booking. *Provider-accepted* = a notification (for example WhatsApp) accepted by the provider: none was sent in any run (all outbound was blocked), and a recorded booking is not evidence of provider acceptance. *Paid* = money received: this flow collects no payment (the guest pays the driver directly), so nothing here is, or implies, a payment. Where older wording says "charged" it is read as "quoted and recorded", never "paid"; numbers and results are unchanged.

Branch `ceo/fijidash-pricing-preview-candidate`, built on FijiDash production `8c6f920`. Everything below is **author-verified** (run by the author in an isolated harness) until independently checked. No deployment is approved. Nothing here touched production data: production access was read-only `SELECT --command` on non-PII pricing tables and the booking-count monitor, plus `wrangler deployments list`.

## Release blockers (short list)

| # | Blocker | Needs |
|---|---|---|
| B1 | **Night pricing.** FijiDash (production AND candidate) save the day fare at night on every live-fare route (the reference fare has no night component) while the page and FAQ say a 20% night surcharge applies; the return pickup time is ignored by client and Worker; inside the candidate Momi one-way at night is 157.92 but Momi return at night is 355. See `NIGHT.md`. | James's decision; then a change + re-test |
| B2 | **Advertised prices disagree with the candidate booking tool.** 191 of 248 items (route-page tables, "From FJ$" titles, llms.txt) are UNRESOLVED; the candidate shows the live fare at selection, so releasing it widens the visible gap between the pages and the booking tool. See `ADVERTISED-PRICES-AUDIT.md`. | James's price decisions (D2/D6 in `RECONCILIATION.md`); no replacement figures were invented |
| B3 | **Worker formula is not commercially approved** beyond the Momi minibus base and the Momi return convention. The candidate displays the Worker's figure at selection on every other eligible route (production code already quotes it at review). | James's sign-off per route or in general |
| B4 | **Silent repricing remains for callers without the opt-in** (FijiDash production until this candidate ships, any cached or third-party caller): an out-of-band amount is still replaced (5 -> 47.87). See `scope-paths.test.mjs`. | Release order: candidate first, then check for other callers |
| B5 | **No independent review, no physical-phone test** of this candidate. | Codex review; phone test |
| B6 | **Tanoa International has no server pricing rule** (Worker trusts the client amount). | James's decision on the price |

Not blockers but stated: departures, custom addresses, tours and boats are saved as the client sent them (`not_fully_server_verified`, never repriced or refused) - an existing trust gap, unchanged; the "Night surcharge applied" label is unchanged.

## What was done for each of the seven requested checks

1. **Momi return, explicitly.** Candidate selection = review = submitted = saved: one-way 157.92, return 297, return + child seat 304. The Worker's 292.45 / 300.45 are reported (Worker-calculated column), not substituted; the Worker keeps the shown amounts as in-band. Implemented as a scoped exception (`PAGE_RETURN_CONVENTION_DESTS = MARRIOTT_MOMI`, return trips only) so Momi return keeps the page's existing convention; every other route is unchanged. Same figures read in a real browser. Production-code FijiDash (as run in the isolated harness and browser) quotes at review, submits and records the Worker figures (292.45 / 300.45) for Momi return. `momi-return.test.mjs` (5 tests).
2. **Snapshot refreshed read-only (2026-10-05 05:08 UTC):** zones 19, pricing rules 15, airport distances 15, fuel index (id 1, multiplier 1, FJ$3.39/L) compared field by field with the 27 September snapshot: **zero differences**, so nothing needed re-running for data changes (the full reconciliation was re-run anyway on the final code). Live Worker still `7a32a034` (deployed 2026-10-05 03:06 UTC). New fixture `test-fixtures/pricing-snapshot-2026-10-05.json`.
3. **"840 of 840" investigated.** `AUDIT-selection-vs-review.md`: definitions, same vehicle/itinerary/extras/discount/currency, raw `calculateTotal` objects for six rows, distributions. It is true but overstated: 840 combinations differ at all (cents included); 790 by more than FJ$1, 392 by more than FJ$20, 142 by more than 20%; in the 210 day/no-extras base cases 185 differ by more than FJ$1. Lookup failures are a separate variant (selection = review by construction), and the only unpriceable route (Tanoa International, 24 rows) is excluded from the denominator and counted separately.
4. **Night reproduced** with the actual client and Worker together at 21:59 / 22:00 / 05:59 / 06:00 and with different outbound and return times: `NIGHT.md` (table), `night-boundaries.test.mjs` (5 tests). No rule changed.
5. **Asynchronous quote safety** (`quote-safety-async.test.mjs`, 8 tests, real Worker where a booking is involved): stale selection lookups (previous destination, previous trip type), stale review lookups (an earlier render; **a trip changed after Back without re-entering the review step - this was a real bug, fixed**), stale PRICE_MISMATCH (itinerary, vehicle, trip type changes), a write that succeeds after the itinerary was edited, repeated revised quotes (original shown total never overwritten), manual retry after both replies lost, and retry after a lost reply to the accepted revised price. **Double taps** were found to be a real hazard in the browser (a late third tap accepted a revised price unread) and fixed with a 1.5 s accept cooldown; re-run in the browser: taps at 0/0/40/340 ms produce exactly one 409 and no booking, and a double tap after the cooldown produces exactly one booking.
6. **Scope boundaries** (`scope-paths.test.mjs`, 7 tests): departures and custom addresses, tours and boats keep their behaviour; none is repriced or refused; fixed zone-pairs with the opt-in are refused out of band; the one remaining silent-repricing path is a caller without the opt-in (B4). Page-level: the override never applies to tours, and live fares are never applied to custom addresses, boats, non-airport pickups, quote-priced or unresolved-zone routes.
7. **Advertised prices** audited in `ADVERTISED-PRICES-AUDIT.md` (+ `advertised_audit.json`): both sites' route pages, "From FJ$" titles and llms.txt compared with each site's own booking tool; 191 UNRESOLVED of 248 (FijiDash pages 129/147, llms.txt 18/19, NAT pages 29/82 including route pages whose destination is not in the NAT booking tool or has no booking link). Marked unresolved; no replacement figures invented; no page changed.

## Preserved reliability protections (unchanged and re-tested)

Analytics-optional guard (6 tests), 15 s `bookingRequest` timeout, same-reference retry, `resultKind: 'unknown'` honest wording, idempotent replay (17 + 26 + 22 held tests, updated only where a scope guard had to acknowledge the deliberate changes). Production `8c6f920` source is read from git for comparisons; the released NAT Momi fixes (`c5ee3b1`, Worker `0b961a4`) are vendored unedited as fixtures.

## Reproduce

```
cd ftt-booking-site
for f in *.test.js *.test.mjs; do node --test $f; done      # 119 tests, no network
node reconciliation/recon.mjs <outDir>                      # 4,296-row reconciliation
node reconciliation/night.mjs <outDir>                      # night boundary / return-time table
node reconciliation/audit_selection_review.mjs <outDir>     # the 840 audit
node reconciliation/advertised_audit.mjs <outDir>           # advertised-price audit
node reconciliation/browser/server.mjs src "" 8941          # isolated browser server (then see BROWSER-EVIDENCE.md)
```
Test inputs: `test-fixtures/worker-deployed-7a32a034.mjs` (dry-run bundle of the production Worker), `pricing-snapshot-2026-10-05.json` (read-only production snapshot), `nat-site-c5ee3b1/` (released NAT page source). Requires `git` (production `8c6f920` is read via `git show`) and Node 20+.

## Limitations (stated, not hidden)

Arrival direction only in the reconciliation tables; departures/boats/custom/tours are covered by the scope tests, not by fare tables. Surfboard extra not tabulated. Hosted Cloudflare behaviour, real Meta/WhatsApp, and physical devices were not exercised. The Worker rig is an in-memory D1 stand-in (verified against the real Worker code, not the real database). Chromium retries a POST on a destroyed socket, so lost replies are simulated page-side. Nothing here proves production behaviour after a future Worker change: re-run the drift check before any release.

Note: a Windows checkout with core.autocrlf=true is handled (tests normalise line endings); Node 20+ and git are required.

## Pricing-policy decision table

`POLICY-DECISION-TABLE.md` (+ `policy_catalogue_vs_worker.csv`, script `reconciliation/policy_table.mjs`): catalogue vs Worker for every disputed route, night options with day / night-arrival / night-return / both-night totals, exact return / rounding / extras treatment, Tanoa options, and the advertised-price corrections each option requires. A decision aid only: no fare invented, fuel untouched, production on HOLD.

`CATALOGUE-LED-IMPLEMENTATION-PLAN.md`: plan only (one shared pricing source, a short exception list, phased gates, rollback). Nothing implemented.
