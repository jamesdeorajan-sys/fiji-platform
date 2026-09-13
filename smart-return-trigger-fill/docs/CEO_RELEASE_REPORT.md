# CEO Release Report — Smart Return / Trigger Fill Stage 1 (Shadow Mode)

Issue: #54 · Branch: `ceo/smart-return-trigger-fill-shadow` · Base commit:
`3f9db86475ebcd542a74c04237d01001b21fcca6` (origin/main)

**This report covers two rounds:** the original Stage 1 build (pushed at
commit `a63447ad76402d7ca8a66dd39d600f040e3ea9ed`) and the 2026-09-13
second-review fix pass (P0 matcher chronology correction, EARN/REDEEM
credit split, `booking_contact_ref`, geography re-labeling). Section
numbers match the original issue's requested deliverable list; each
section now reflects the current, corrected state.

## 1. Branch name

`ceo/smart-return-trigger-fill-shadow`

## 2. Base commit

`3f9db86475ebcd542a74c04237d01001b21fcca6` — `origin/main` at the time this
branch was cut. Round 1 was reviewed and pushed at commit `a63447a`. Round
2 (this fix pass) is additional commits on the same branch — see the
session report for the exact new HEAD SHA and diff-from-`a63447a`.

## 3. Exact files added/changed

Round 1 added 32 files. Round 2 adds 4 more (2 migrations, 2 test files)
and edits several existing ones — no file outside
`smart-return-trigger-fill/` is touched in either round.

**New in Round 2:**
```
smart-return-trigger-fill/migrations/0005_movement_duration_fields.sql
smart-return-trigger-fill/migrations/0006_booking_contact_ref.sql
smart-return-trigger-fill/test/matcher_chronology.test.js
smart-return-trigger-fill/test/pii_guard.test.js
```

**Edited in Round 2:** `src/model.js`, `src/matcher.js`, `src/pricing.js`,
`src/board.js`, `src/whatsapp_cards.js`, `src/geo_seed.js`,
`test/fixtures/synthetic_movements.js`, `test/pricing.test.js`,
`test/board.test.js`, `scripts/demo.js`, `docs/SAMPLE_SCENARIOS.md`,
`docs/SECURITY_PRIVACY_REVIEW.md`, this file.

**Unchanged since Round 1:** `README.md`, `package.json`, all of
`migrations/0001`–`0004`, `src/db.js`, `src/ledger.js`, `src/offers.js`,
`src/pipeline.js`, `src/route_price_truth.js`,
`docs/ROUTE_PRICE_TRUTH_CONTRACT.md`, `docs/ROLLBACK.md`,
`test/ledger_idempotency.test.js`, `test/offers_atomicity.test.js`,
`test/pipeline_safety.test.js`, `test/whatsapp_cards.test.js`,
`test/route_price_truth.test.js`.

## 4. Schema / migrations

Six plain-SQL migrations under `migrations/`, matching the repo's existing
convention (`nadi-marketplace/migrations/*.sql`):

- `0001_movements.sql` — the centralized movement ledger. `idempotency_key`
  is `UNIQUE` — atomic, idempotent ingestion at the database layer.
- `0002_smart_offers.sql` — trigger-fill offer table, `status`
  `CHECK`-constrained to the issue's state machine.
- `0003_route_price_truth.sql` — canonical route-price contract.
- `0004_experience_credit_eligibility.sql` — `issued` defaults to 0;
  nothing in this branch ever sets it to 1.
- **`0005_movement_duration_fields.sql`** (Round 2) — nullable
  `estimated_duration_minutes` / `planned_dropoff_datetime`. While both are
  null for a movement, every match computed against it as the source
  resolves `HOLD_UNKNOWN_TIMING` rather than a guessed verdict.
- **`0006_booking_contact_ref.sql`** (Round 2) — nullable opaque pointer
  back to the originating storefront's secure customer record. Never a
  name/phone/email — enforced in code, see §14.

**Not applied to any real D1 database.**

## 5. API / endpoints created

**None**, in either round. `src/board.js#buildSevenDayMovementBoard`
remains a plain function, not a deployed route.

## 6. Data model

`movements` -> `smart_offers` (FK) -> `route_price_truth` (keyed by zone
pair + vehicle class) -> `experience_credit_eligibility` (FK to both legs
of an itinerary). Round 2 adds `estimated_duration_minutes`,
`planned_dropoff_datetime`, and `booking_contact_ref` columns to
`movements`.

## 7. Matcher algorithm (corrected 2026-09-13)

`src/matcher.js#computeMatchCandidates` — deterministic, rule-based:
`EXACT_REVERSE` (95) > `NEARBY_REVERSE` (75) > `CORRIDOR` (55) >
`EXTENSION_CHAIN` (45).

**P0 fix:** chronological feasibility no longer uses a raw
`|pickup - pickup|` gap. It now requires
`sourcePickup + sourceEstimatedDuration + turnaroundBuffer <= candidatePickup`
(`src/model.js#estimateSourceCompletionMs`), computed **only from the
source movement's own known duration** — never from placeholder
geography. Three outcomes: `OK` (candidate strictly after source
completion + 45 min buffer), `INFEASIBLE` (candidate at, before, or too
soon after completion — identical/overlapping/earlier all fall here), or
`UNKNOWN` (source duration not known — the matcher will not guess).
`candidate.time_compatible` is now `true | false | null`, not just a
boolean, so "unknown" is never silently coerced to a guess either way.

Feasibility precedence: vehicle mismatch or chronologically `INFEASIBLE`
-> `FEASIBILITY.INFEASIBLE`; chronologically `UNKNOWN` ->
`FEASIBILITY.HOLD_UNKNOWN_TIMING` (new); economics unknown ->
`HOLD_UNKNOWN_ECONOMICS`; otherwise `FEASIBLE`.

`findMultiLegChains` uses the identical completion-based check for every
hop — a leg with unknown duration is never chained through.

Regression tests for the exact scenarios called out in the review:
earlier reverse leg (`INFEASIBLE`), later reverse leg (`FEASIBLE`),
identical/overlapping time (`INFEASIBLE`), unknown duration
(`HOLD_UNKNOWN_TIMING`), and the literal "NAN -> Suva then Suva -> NAN too
early" / "realistic later pickup" pair — all in
`test/matcher_chronology.test.js` (9 tests). Real output showing the fix
in effect against the synthetic pool is in `docs/SAMPLE_SCENARIOS.md`
Scenario 6.

`src/geo_seed.js` is now explicitly re-scoped in its header comment: it
influences match-type *classification* and the non-binding "empty km"
hint only — it has never been able to determine chronological feasibility,
and Round 2 makes that separation explicit and permanent in the code
comments, per the "keep placeholder geography disabled for real matching"
instruction.

## 8. Pricing guardrails

`src/pricing.js#enforceFloor` is unchanged and still the single place the
floor hard-rule is enforced (unknown floor -> `HOLD_UNKNOWN_FLOOR`;
below-floor -> `CLAMPED_TO_FLOOR`, flagged, never silently returned).

**Policy fix (2026-09-13): EARN and REDEEM are now separate functions.**

- `earnExperienceCreditEligibility({ outboundMovement, returnMovement, nowIso })`
  — EARN has **no transfer-spend threshold at all**. Earning 2x AU$25
  credits is purely a function of RETURN_LOCK eligibility (both legs
  booked, first travel >=7 days ahead).
- `redeemExperienceCredit({ tourBooking, minSpendThreshold })` — REDEEM
  checks a **separate FijiTourTransfers tour booking's own spend**
  (`tourBooking.tourSpend`) against a threshold that now defaults to
  **AU$100/credit** (`DEFAULT_MIN_TOUR_SPEND_PER_CREDIT` in `model.js`),
  overridable per product via `tourBooking.productMinSpendOverride`. It
  never looks at transfer `customer_price` — there is no code path left
  that could conflate the two, since the function doesn't take a movement
  at all, only a `tourBooking` object.
- No live issuance or redemption exists in Stage 1 either way — both
  functions are pure eligibility checks for review.

## 9. Atomic hold design

Unchanged from Round 1 — compare-and-swap on offer status, proven by
`test/offers_atomicity.test.js`. `releaseHold` (HELD -> ACTIVE) remains
the one addition beyond the issue's literal diagram, needed so a timed-out
hold doesn't strand inventory.

## 10. 7-day movement board preview

`src/board.js#buildSevenDayMovementBoard`. Round 2 change: the
`experienceCreditEligible` field is renamed `experienceCreditEarned` and
now reflects EARN only (no spend threshold applied on the board, since the
board has no tour-booking data source — REDEEM is evaluated separately,
against real FTT tour bookings, once that data exists). The
`minSpendThreshold` parameter was removed from the board's function
signature entirely, since it no longer has anything to apply it to.

## 11. Sample synthetic match scenarios

`docs/SAMPLE_SCENARIOS.md`, regenerated after the Round 2 fix. Now
includes six scenarios plus the multi-leg chain, using real
`node scripts/demo.js` output — notably Scenario 2 (the same exact-reverse
pair gives a different answer depending on which side is the "source",
because only the source's own known duration matters) and Scenario 6 (the
literal chronologically-impossible case the review caught, now correctly
`INFEASIBLE` instead of accepted).

## 12. Tests and results

**76 tests, `node --test test/*.test.js`, 76 passing, 0 failing** (up from
47 in Round 1), zero external dependencies. New in Round 2:

| Invariant | Test file |
|---|---|
| Earlier/identical/overlapping candidate is INFEASIBLE, never guessed feasible | `matcher_chronology.test.js` (9 tests) |
| Unknown source duration -> HOLD_UNKNOWN_TIMING, never guessed | `matcher_chronology.test.js` |
| `planned_dropoff_datetime` takes precedence over `estimated_duration_minutes` | `matcher_chronology.test.js` |
| Ingestion rejects any of 12 direct-PII field names outright | `pii_guard.test.js` |
| `booking_contact_ref` rejected if it looks like an email/phone | `pii_guard.test.js` |
| EARN has no spend threshold; REDEEM never uses combined transfer price | `pricing.test.js` |
| REDEEM defaults to AU$100/credit, product-overridable | `pricing.test.js` |
| Board's `experienceCreditEarned` reflects EARN only | `board.test.js` |

All Round 1 invariant coverage (idempotency, atomic offer hold, floor
enforcement, matcher/WhatsApp outage safety, route-price-truth validation)
still passes unchanged.

## 13. Rollback plan

Unchanged, see `docs/ROLLBACK.md` — delete the branch; nothing live exists
to roll back. Round 2's two new migrations extend the same
`DROP TABLE IF EXISTS movements` cleanup (columns, not new tables) if ever
applied to a real D1.

## 14. Security/privacy review (updated 2026-09-13)

`docs/SECURITY_PRIVACY_REVIEW.md`. Headline change: the customer-contact
open question from Round 1 is now answered and enforced in code —
`booking_contact_ref` is the only permitted pointer to a customer, and
`normalizeMovementInput` throws outright if the raw payload carries any of
12 direct-PII field names (name/email/phone/WhatsApp variants), or if
`booking_contact_ref` itself looks like an email or phone number. See
`test/pii_guard.test.js` (12+ tests).

## 15. What is still UNKNOWN

- **Real geography** — still a placeholder, still explicitly disabled for
  real matching (re-confirmed and re-documented in `geo_seed.js`'s header
  per the 2026-09-13 instruction). Nothing changed here except making the
  "classification only, never feasibility" boundary explicit in code
  comments.
- **Board window vs. ledger completeness** — unchanged from Round 1 (see
  `docs/SAMPLE_SCENARIOS.md` final section).
- **Multi-leg chain time bound** — still no maximum gap between legs
  (any forward gap >=45 min qualifies, given known durations); an ops call,
  not invented here.
- **`MIN_TURNAROUND_MINUTES = 45`** — still a placeholder pending ops
  confirmation.
- **New in Round 2: source trip durations are almost never known yet.**
  Since no real storefront supplies `estimated_duration_minutes` or
  `planned_dropoff_datetime` today, most real ingested movements will
  resolve `HOLD_UNKNOWN_TIMING` in practice until that data starts
  flowing — this is the deliberately conservative consequence of "don't
  guess," not a bug. Worth knowing before expecting the matcher to
  surface many `FEASIBLE` results against real data on day one.

## 16. Exact items that require CEO policy input

1. ~~AU$50 Experience Credit spend threshold~~ — **RESOLVED 2026-09-13**:
   EARN has no threshold; REDEEM defaults to AU$100/credit against a
   separate tour booking, product-overridable.
2. ~~Customer-contact mechanism~~ — **RESOLVED 2026-09-13**:
   `booking_contact_ref`, opaque only, enforced in code.
3. **Real ops geography** (distances, turnaround minutes, corridor
   definitions) — still needed before any Stage 2 rollout. Not resolved.
4. **Whether the 7-day board's matching pool should look slightly beyond
   the display window** — still open (§15).
5. **New: source trip duration data source.** Who/what will actually
   supply `estimated_duration_minutes` or `planned_dropoff_datetime` per
   booking — the storefront at ingestion time, or a verified route-duration
   table once one exists? Not decided; Stage 1 accepts either but produces
   neither.

## 17. Preview/deployment evidence

Unchanged — none exists or was created; still not applicable to this
issue's shadow-data-model scope. Evidence remains the passing test suite
and the demo output in `docs/SAMPLE_SCENARIOS.md`.

## 18. GO / HOLD recommendation for next stage

**GO** for CEO review of the corrected branch. **HOLD**, unchanged:

- HOLD on applying the migrations to a real D1 database.
- HOLD on wiring any storefront to read `route_price_truth`.
- HOLD on exposing `board.js` as a live HTTP endpoint.
- HOLD on any live AU$50 credit issuance or redemption.
- HOLD on enabling real/live shadow ingestion until verified Fiji
  geography replaces the placeholder seed (explicit 2026-09-13
  instruction).

Nothing in this branch, as of either round, changes any live fare,
booking flow, or DNS record.
