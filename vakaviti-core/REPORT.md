# Issue #38 — R1/R2 Report: Normalize Three Transfer Storefronts + Vakaviti Fare Authority (Shadow Mode)

**Mode honored throughout: STRICT ISOLATED / READ-ONLY PRODUCTION MODE.** No DNS change. No Pages/Worker/D1/KV/R2 write to any of the three live properties. No customer-facing fare, booking flow, or frontend touched. No booking created on any storefront. All work lives on branch `vakaviti-core/r1-r2-shadow`, based off `origin/main`, never merged, never deployed. All three live storefronts remained online and bookable throughout (confirmed periodically via plain `GET` checks — 200 on all three at time of writing).

---

## 1. Architecture / inventory report — all three storefronts

Full detail in [`inventory/01-nadiairporttransfers.md`](inventory/01-nadiairporttransfers.md), [`inventory/02-book-fijidash.md`](inventory/02-book-fijidash.md), [`inventory/03-bookfijitransfers.md`](inventory/03-bookfijitransfers.md). Headline findings:

### 1.1 Storefronts 1 and 2 are already one system
`nadiairporttransfers.com` and `book.fijidash.com` are two public hostnames (`api.nadiairporttransfers.com`, `api.fijidash.com`) in front of **the literal same Worker** (`nadi-dispatch-api`), **the literal same D1 database** (`nadi-marketplace-db`), and **the literal same `bookings` table**. There is no technical separation today — a booking placed on either site is indistinguishable from the other in the data layer. This is good news for Issue #37's "one fare authority" goal (it's already true for 2 of 3 storefronts) and a real gap against its "BookingSource" goal (neither site tags which brand a booking came through).

### 1.2 Storefront 3 could not be fully mapped, and that is reported, not guessed
`bookfijitransfers.com` is confirmed (via direct, authoritative Cloudflare API query, not DNS inference) to belong to the same Cloudflare account as the other two. Beyond that, its hosting mechanism, source repository, data store, admin surface, and rollback target are all **UNKNOWN/REVIEW REQUIRED** — checked against all 67 Pages projects, all registered Worker Custom Domains, and all 5 GitHub repos under the org, with zero matches. Full detail and every avenue checked is in inventory doc 03. Its live behavior (quote/booking API contract, vehicle taxonomy, place taxonomy, attribution model) was still fully documented via black-box, read-only inspection of the live site and its own shipped JS bundle — Issue #38 doesn't require source access to complete R1, and this report doesn't treat "can't find the repo" as a reason to stop documenting what's observable.

**This is the single most important R1 finding for planning purposes:** you cannot roll back, redeploy, or safely modify `bookfijitransfers.com` today because no one on this side of the investigation knows where it lives. Recommend confirming this with whoever built it before any further R2/R3 work touches that storefront.

### 1.3 One number worth remembering
Storefronts 1/2's existing backend already IS the most architecturally mature of the three (versioned-ish pricing via `pricing_rules`, real distance via Google Maps, idempotency, admin queue). Storefront 3, despite being unmapped infrastructurally, has the **most mature request-level contract** — a locked, versioned quote (`pricingVersionId`, `expiresAt`), a first-class `attribution` object, a spam honeypot, and an explicit `consent` field. Issue #37's canonical `BookingSource` contract (below) is modeled on storefront 3's shape, not storefronts 1/2's, precisely because it's the best one that exists today.

---

## 2. Canonical contract specification

Full machine-readable spec: [`contracts/vakaviti-transfer-contracts.v1.schema.json`](contracts/vakaviti-transfer-contracts.v1.schema.json) (valid JSON Schema, `$id` versioned as v1).

Defines: `Place`, `Route`, `VehicleClass`, `QuoteRequest`, `QuoteResponse`, `BookingCreate`, `BookingResponse`, `BookingSource`, `Traveller`, `Flight`, `ReturnTrip` (+ `MultiLegJourney` reserved for Stage F), `OperatorPayout`, `RetailFare`, `StorefrontReference`, and the canonical `VK-XXXXXXXX` booking ID.

Design decisions worth flagging explicitly:
- **`StorefrontReference` is additive, not a replacement.** Every storefront's existing reference format (`FD-XXXXXX` today, whatever storefront 3 turns out to use) is preserved verbatim forever. `VK-...` is issued *alongside* it, never instead of it — matches Issue #37's explicit "staff must be able to search by either" requirement.
- **`ReturnTrip.returnDiscountModel` is an enum, deliberately.** Storefronts 1/2 use a 1.85× return multiplier; storefront 3 advertises a flat 5% second-leg discount. These produce **different prices for the same physical return trip** — the contract makes this an explicit, named field rather than silently assuming one canonical return formula, because assuming one would be a guess.
- **`OperatorPayout` and `RetailFare` are separate types, never merged**, per Issue #37's core commercial rule. No code in this deliverable ever puts a payout figure anywhere a guest-facing response could pick it up.
- **`VehicleClass` includes `suv_people_mover` even though no live storefront has one today.** Reserved because Issue #38's own test-corpus spec requires testing it — the contract shouldn't lag behind the acceptance criteria that reference it.

---

## 3. Mapping tables

- [`mappings/vehicle-class-mapping.json`](mappings/vehicle-class-mapping.json) — every storefront's vehicle string → canonical `vehicleClassId`, with an explicit `unmapped` list (storefront 3's `vehicleId` field shape is genuinely unconfirmed — see below).
- [`mappings/place-route-mapping.json`](mappings/place-route-mapping.json) — storefront 3's 16 `destinationId` slugs → the canonical route anchors already used by storefronts 1/2's `zones` table, plus 3 explicit `review_required` entries for real ambiguities found (a many-to-one Wailoaloa/Nadi grouping, the Denarau-corridor promo price, and a Natadola double-resort grouping that turned out fine on inspection).

**Nothing in either file was invented.** Every mapped value was read directly from a live API response, a live page's rendered option list, or a shipped JS bundle. Every ambiguity found a real, specific reason to be uncertain, listed alongside the mapping rather than resolved silently.

---

## 4. Isolated Vakaviti Fare Authority (shadow mode) — implementation

Code: [`fare-authority/fare-authority.js`](fare-authority/fare-authority.js) + [`fare-authority/pricing-rules.snapshot.json`](fare-authority/pricing-rules.snapshot.json). Pure Node, zero Cloudflare runtime dependency, zero network calls, zero writes anywhere but a local JSONL file. Never deployed; not wired into any live request path.

**It reuses the real, currently-live nadi-dispatch-api pricing formula as its v1 baseline** (tiered distance/flagfall rates read directly from production `pricing_rules`, current `fuel_index` multiplier, night surcharge, return multiplier) rather than inventing a new model — directly matches Issue #37's own guidance to start from FijiDash's backend since it's "already closest to the target architecture."

**Verified byte-exact against 10 independently-captured live production values** before being trusted for any comparison work (Denarau/Sigatoka/Sonaisali/Natadola/Suva/Momi Bay/Pacific Harbour/Wailoaloa across sedan/minivan/minibus) — all 10 matched to the cent. One real bug was found and fixed during this verification, not hidden: the module initially applied nadi-dispatch-api's "10% off over $50" discount unconditionally, which does **not** match how the live `/reference-fare` endpoint actually behaves (that endpoint returns the pre-discount figure; the discount is applied later, elsewhere in the storefront's own flow). Fixed by making the discount step explicit and opt-in (`applyOver50Discount`), documented in the code with the exact evidence that found it. This is exactly the kind of thing R2's shadow-mode design exists to catch — even reusing "the same" formula, an assumption about *when* a rule applies was wrong until checked against a real number.

---

## 5. Shadow comparison store and results

Full log (31 records, real data, regenerate anytime with `node test-corpus/run-corpus.js`): [`shadow-log/shadow-comparisons.jsonl`](shadow-log/shadow-comparisons.jsonl). Every record carries all fields Issue #38 requires: timestamp, storefront, raw + canonical origin/destination, vehicle class, both fares, absolute + percentage variance, pricing rule used, distance, confidence, mismatch classification, diagnostic reason.

### 5.1 Storefronts 1/2 control check
2 records, both `exact_match` (0.00 variance) — expected and confirmed, since they're the same backend. Included specifically to prove the shadow methodology produces a clean zero when there's genuinely nothing to find, not just to produce interesting-looking variance.

### 5.2 Storefront 3 vs. the Vakaviti shadow authority (9 routes × 3 vehicles = 27 records)

| Classification | Count | What it means here |
|---|---|---|
| `rounding_only` | 5 | Denarau-corridor minivan/minibus — within ~1%, no action needed |
| `discount_promotion_difference` | 1 | Port Denarau sedan ($39) — matches the site's own advertised launch special exactly |
| `route_mapping_mismatch` | 1 | Wailoaloa/Nadi sedan (+28.5%) — bft's corridor groups more area than nadi-dispatch's single-point zone; plausible, not confirmed |
| `unknown_manual_review` | 20 | See below |

**The 20 `unknown_manual_review` rows are the real finding of this whole exercise**, and they're not random noise — they form a clear pattern:

| Route | Sedan variance | Direction |
|---|---|---|
| Denarau (Hilton) | +2.4% | bft higher |
| Sonaisali | −12.5% | bft **lower** |
| Coral Coast | +14.8% | bft higher |
| Natadola | +18.4% | bft higher |
| Momi Bay | +26.2% | bft higher |
| Pacific Harbour | +35.2% | bft higher |
| Suva | +4.5% | bft higher |

**With one exception (Sonaisali), bft's fare is higher than the shadow authority's computed fare, and the gap grows roughly with distance/remoteness** — Pacific Harbour (the most remote route tested) has the largest gap at 35–40% across all three vehicle classes. This is exactly the shape you'd expect from Issue #37's own described architecture: storefront 3 is the "marketplace / overflow network," meaning its retail price on longer/harder-to-service routes may legitimately embed a real supplier-payout-plus-margin structure that storefronts 1/2's in-house-fleet distance formula was never designed to reflect. **This report does not claim that's confirmed** — it's a pattern consistent with the stated business model, not a verified cause, which is exactly why every one of these rows is honestly logged as `unknown_manual_review` rather than force-fit into a category the data doesn't actually prove. Sonaisali running the other direction (bft cheaper) doesn't fit that story and is worth a specific look.

**One borderline case flagged for judgment, not silently resolved either way:** Denarau/Hilton sedan is only $1.13 (2.4%) off — almost certainly the same kind of noise as the 5 `rounding_only` rows next to it, but it landed 13 cents outside this report's conservative $1.00 rounding threshold. Recommend treating it as rounding, but it's shown as `unknown_manual_review` in the raw log rather than adjusted after the fact to look cleaner.

### 5.3 Return trips
One comparison logged for the return-trip *model* mismatch itself (see contracts §2) rather than a live number: storefronts 1/2 use a 1.85× multiplier, storefront 3 advertises a flat 5% second-leg discount. **These will not produce the same return-trip price for an equivalent route even if the one-way legs matched exactly.** This is a real product-parity question for Issue #37 Stage C (canonical booking core), not a data bug — flagged as its own row rather than buried in a generic "mismatch."

### 5.4 Custom/unmapped address
Storefronts 1/2 support one (`POST /quote`, geocoded). Storefront 3's shipped bundle shows no equivalent field at all — its destination list is closed/curated. Logged as a **capability gap**, not a fare variance, since there's no bft number to compare against.

### 5.5 Boat
No boat fare is exposed anywhere in storefront 3's tested quote responses. Storefronts 1/2 support boat but exclude it from `/reference-fare`/`/negotiate` by design (third-party bundled price). Net: **boat cannot be shadow-compared across all three today** — there is no authoritative "boat retail fare" anywhere yet, on any storefront, to be the source of truth.

---

## 6. Unexplained fare variance list (for CEO/ops review)

In priority order:

1. **Pacific Harbour, all 3 vehicles, +23% to +40%** — largest and most consistent gap found. Worth confirming with whoever set bft's fixed fares whether this reflects real marketplace payout economics for that corridor or a stale/never-updated fixed price.
2. **Sonaisali, all 3 vehicles, consistently ~−10% to −12.5%** (bft cheaper) — the one route where bft undercuts the shadow authority; doesn't fit the "further = pricier" pattern seen elsewhere, worth a specific look.
3. **Momi Bay sedan (+26.2%) vs. Momi Bay minivan (+1.1%)** — a large spread between vehicle classes on the *same* route is unusual; worth checking whether bft's sedan fixed-fare for this corridor was set correctly.
4. Everything else in the `unknown_manual_review` bucket is directionally consistent with #1 and not separately alarming, but is preserved unfiltered in the log for whoever wants to check.

---

## 7. Recommendation for first storefront cutover

**Do not start a Fare-Authority cutover with storefront 3.** Its hosting is unlocated, so Issue #36's mandatory "known rollback target" gate cannot be satisfied for it yet — this is a hard blocker, not a preference.

**Storefronts 1 and 2 are the correct place to start Stage B**, exactly as Issue #37 anticipated ("start with FijiDash because its backend is already closest to the target architecture") — and this pass confirms it's even truer than assumed, since they're already one backend. The real Stage-B work for these two is narrow and low-risk:
1. Add a `storefront_id`/`BookingSource` column to the shared `bookings` table (additive, nullable — matches Issue #36 rule 5) so the one shared queue can finally tell the two brands apart.
2. Formalize the existing `pricing_rules` logic behind the versioned contract in this report (`fare-authority.js` is a ready-to-adapt starting point — it already IS that logic, just running outside the Worker today).
3. Only once (1) and (2) are proven in an isolated preview should a real shadow-mode Worker be deployed *alongside* (not replacing) `nadi-dispatch-api`'s own pricing — logging comparisons the same way this report's local script did, but continuously, on real traffic.

Storefront 3 becomes a candidate for Stage B only after its infrastructure is located and a rollback target exists — recommend that as the very next, separate, narrowly-scoped task.

## 8. Rollback/cutover plan for the recommended first storefront

Nothing here is executed — this is the plan for if/when Stage B is separately authorized:
- **Preserve first:** snapshot current `nadi-dispatch-api` version id and `nadi-marketplace-db` schema before any change (same discipline as the Issue #34/PR #35 release this session already demonstrated end-to-end).
- **Migration:** one additive migration, nullable `storefront_id` column + index, no destructive change, applied to an isolated preview D1 first.
- **Shadow Worker:** a genuinely separate Worker (own name, own D1 binding or read-only access to a preview copy), never in the request path of a real booking, logging comparisons to its own D1 table (or R2/KV) rather than the local file this report used.
- **Gate before any real cutover:** run the shadow Worker against real live traffic for an agreed observation window, review variance the same way §5–§6 did here, get explicit sign-off, only then consider having `nadi-dispatch-api` actually call the new authority instead of its inline formula — behind a flag, reversible in one deploy.
- **Rollback:** identical mechanism already proven in the Issue #34 release — `wrangler rollback --version-id <prior>` for the Worker; the migration's additivity means no schema rollback is ever required.

## 9. Explicit STOP

**No production change has been made.** No DNS, Pages, Worker, D1, KV, R2, customer-facing fare, or booking flow was touched on any of the three live storefronts. This branch (`vakaviti-core/r1-r2-shadow`) has not been pushed or opened as a PR, pending your review of this report.

**Returning this report for CEO approval before any further R3/Stage-B work begins**, per Issue #38's release gate.
