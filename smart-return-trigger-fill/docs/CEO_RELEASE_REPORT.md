# CEO Release Report — Smart Return / Trigger Fill Stage 1 (Shadow Mode)

Issue: #54 · Branch: `ceo/smart-return-trigger-fill-shadow` · Base commit:
`3f9db86475ebcd542a74c04237d01001b21fcca6` (origin/main)

## 1. Branch name

`ceo/smart-return-trigger-fill-shadow`

## 2. Base commit

`3f9db86475ebcd542a74c04237d01001b21fcca6` — `origin/main` at the time this
branch was cut ("docs: start SEO and AI revenue optimisation sprint").
Branch created with `git checkout -b ceo/smart-return-trigger-fill-shadow
origin/main` — not based on the working tree's checked-out branch
(`nadi-legacy-rescue-pearl-marina`), to guarantee a clean, current,
production-tracking baseline.

**Not yet pushed to origin.** Local commit is ready; pushing a branch is
treated as a visible, shared-state action and is being held for your
explicit go-ahead, consistent with how every other step in this session
has been gated.

## 3. Exact files added/changed

All 30 files are new; nothing outside `smart-return-trigger-fill/` was
touched.

```
smart-return-trigger-fill/README.md
smart-return-trigger-fill/package.json
smart-return-trigger-fill/migrations/0001_movements.sql
smart-return-trigger-fill/migrations/0002_smart_offers.sql
smart-return-trigger-fill/migrations/0003_route_price_truth.sql
smart-return-trigger-fill/migrations/0004_experience_credit_eligibility.sql
smart-return-trigger-fill/src/model.js
smart-return-trigger-fill/src/db.js
smart-return-trigger-fill/src/geo_seed.js
smart-return-trigger-fill/src/ledger.js
smart-return-trigger-fill/src/matcher.js
smart-return-trigger-fill/src/pricing.js
smart-return-trigger-fill/src/offers.js
smart-return-trigger-fill/src/pipeline.js
smart-return-trigger-fill/src/whatsapp_cards.js
smart-return-trigger-fill/src/route_price_truth.js
smart-return-trigger-fill/src/board.js
smart-return-trigger-fill/scripts/demo.js
smart-return-trigger-fill/test/fixtures/synthetic_movements.js
smart-return-trigger-fill/test/ledger_idempotency.test.js
smart-return-trigger-fill/test/matcher.test.js
smart-return-trigger-fill/test/pricing.test.js
smart-return-trigger-fill/test/offers_atomicity.test.js
smart-return-trigger-fill/test/pipeline_safety.test.js
smart-return-trigger-fill/test/board.test.js
smart-return-trigger-fill/test/whatsapp_cards.test.js
smart-return-trigger-fill/test/route_price_truth.test.js
smart-return-trigger-fill/docs/ROUTE_PRICE_TRUTH_CONTRACT.md
smart-return-trigger-fill/docs/ROLLBACK.md
smart-return-trigger-fill/docs/SECURITY_PRIVACY_REVIEW.md
smart-return-trigger-fill/docs/SAMPLE_SCENARIOS.md
```

## 4. Schema / migrations

Four plain-SQL migrations under `migrations/`, matching the repo's existing
convention (`nadi-marketplace/migrations/*.sql`, applied via `ALTER
TABLE`/`CREATE TABLE`, no ORM):

- `0001_movements.sql` — the centralized movement ledger, all 22 fields
  from the issue's spec plus `test_data`/`created_at`/`updated_at`.
  `idempotency_key` is `UNIQUE` — this is what makes ingestion atomic and
  idempotent at the database layer, not just in application code.
- `0002_smart_offers.sql` — the trigger-fill offer table, `status` is
  `CHECK`-constrained to the exact state machine from the issue.
- `0003_route_price_truth.sql` — the canonical route-price contract, one
  row per `(origin_zone, destination_zone, vehicle_class)`.
- `0004_experience_credit_eligibility.sql` — AU$50 credit eligibility
  record; `issued` defaults to 0 and nothing in this branch ever sets it to
  1.

**Not applied to any real D1 database.** These are ready for a Stage 2
`wrangler d1 execute` against a dedicated database once you approve that
step — no D1 resource was created or touched by this branch.

## 5. API / endpoints created

**None.** Per the issue's non-goals ("no new website," implicitly no new
public surface either), everything in `src/` is a plain function, not an
HTTP handler. `src/board.js#buildSevenDayMovementBoard` is the
"admin/preview endpoint" the issue asks for, but it's exposed today as a
callable function + `scripts/demo.js`, not a deployed route — wiring it
behind an actual Worker route is a Stage 2 decision since it would create a
new reachable surface.

## 6. Data model

See `migrations/0001_movements.sql` for the authoritative shape. Summary:
`movements` (the ledger) -> `smart_offers` (trigger-fill inventory,
FK to `movements.movement_id`) -> `route_price_truth` (keyed by zone pair +
vehicle class, not FK'd to movements) -> `experience_credit_eligibility`
(FK to both legs of an itinerary in `movements`).

## 7. Matcher algorithm

`src/matcher.js#computeMatchCandidates` — deterministic, rule-based, in
this priority order: `EXACT_REVERSE` (score 95) > `NEARBY_REVERSE` (75) >
`CORRIDOR` (55) > `EXTENSION_CHAIN` (45), each reduced for time or vehicle
incompatibility and capped at 0–100. Every candidate carries a feasibility
verdict: `FEASIBLE` only when both the candidate movement's timing/vehicle
line up AND the *subject* movement has known `operator_payout` +
`absolute_floor`; otherwise `HOLD_UNKNOWN_ECONOMICS` (or `INFEASIBLE` for a
hard timing/vehicle mismatch). `src/matcher.js#findMultiLegChains` does a
deterministic DFS for 3+ leg same-vehicle-class chains, forward-in-time
only (a bug I caught and fixed during testing — see §15). All geography
(`src/geo_seed.js`) is explicitly labeled placeholder/unverified, seeded
only to make the fixtures self-consistent, not asserted as real Fiji
distances.

## 8. Pricing guardrails

`src/pricing.js`. The two hard rules from the issue are enforced in one
place, `enforceFloor`, used by every fare-computing function:

- Floor unknown -> `HOLD_UNKNOWN_FLOOR`, price `null`. Never guessed.
- Candidate below a *known* floor -> `CLAMPED_TO_FLOOR`, price = floor,
  explicitly flagged (not silently accepted — a computed price undercutting
  the floor usually signals bad upstream data).
- RETURN_LOCK requires both legs booked >=7 days before first travel,
  evaluated against **booking time**, not "today" (see §15 for why that
  distinction matters).
- AU$50 Experience Credit is wired to a `minSpendThreshold` that is
  currently `null` everywhere it's called from `board.js` — it resolves
  `POLICY_UNCONFIGURED` until you set a real number (§16).

## 9. Atomic hold design

`src/offers.js` + `src/db.js#casOfferStatus`. Every offer-status change is
one conditional write keyed on the *current* status:

- Memory store (used by all 47 tests): `if (existing.status !==
  expectedStatus) return {success:false}` before mutating.
- Real D1 (`createD1Store`, written but unused in this branch): `UPDATE
  smart_offers SET status=? ... WHERE offer_id=? AND status=?`, success
  determined by `result.meta.changes === 1`.

Two callers racing for the same `offer_id` can only ever have one succeed
— proven in `test/offers_atomicity.test.js` (hold-twice, fill-twice,
expired-offer-cannot-be-held, hold-then-release-then-rehold).

I added one state transition beyond the issue's literal diagram:
`releaseHold` (HELD -> ACTIVE). Without it, a hold that times out or gets
cancelled would strand that vehicle/time slot permanently in `HELD` with no
path back to `ACTIVE`. Flagging this explicitly since it's a deliberate,
necessary addition, not scope creep.

## 10. 7-day movement board preview

`src/board.js#buildSevenDayMovementBoard`, exercised in
`test/board.test.js` and `scripts/demo.js`. Read-only, no writes. Returns
confirmed movements, predicted empty legs, unmatched movements, corridor
opportunities, return-lock-eligible itineraries, AU$50-credit-eligible
itineraries, possible Smart Fill specials, and totals for predicted empty
km / estimated recoverable revenue — both totals explicitly `0`/unverified
unless backed by real data, never fabricated (see the demo output in
`docs/SAMPLE_SCENARIOS.md`).

## 11. Sample synthetic match scenarios

`docs/SAMPLE_SCENARIOS.md` — five real scenarios captured from an actual
`node scripts/demo.js` run against the synthetic fixtures: exact-reverse ->
RETURN_LOCK, unknown-economics -> HOLD despite a strong match, corridor
match -> LIVE_FILL, genuinely-unmatched -> HOLD, and a 3-leg vehicle chain.
Also documents a real limitation the demo run surfaced (§15).

## 12. Tests and results

47 tests, `node --test test/*.test.js`, **47 passing, 0 failing**, zero
external dependencies (Node's built-in `node:test` + `node:assert`).
Coverage by safety invariant from the issue:

| Invariant | Test file |
|---|---|
| Idempotent booking writes | `ledger_idempotency.test.js` |
| Offer cannot be sold twice / vehicle-slot not double-allocated | `offers_atomicity.test.js` |
| Offer hold is atomic | `offers_atomicity.test.js` |
| Expired offer cannot be booked | `offers_atomicity.test.js` |
| Unknown price floor returns HOLD | `pricing.test.js` |
| Matcher outage doesn't stop booking flow | `pipeline_safety.test.js` |
| WhatsApp/card failure can't invalidate a saved booking | `pipeline_safety.test.js` |
| Deterministic match scoring/feasibility | `matcher.test.js` |
| Route-price-truth shape/floor validation | `route_price_truth.test.js` |
| 7-day board correctness incl. booking-time-based eligibility | `board.test.js` |
| Ops cards never fabricate a verified figure | `whatsapp_cards.test.js` |

## 13. Rollback plan

`docs/ROLLBACK.md`. Today: delete the branch, nothing else exists to roll
back. Post-Stage-2 (if migrations are ever applied to a real D1): four
`DROP TABLE IF EXISTS` statements in FK-safe order.

## 14. Security/privacy review

`docs/SECURITY_PRIVACY_REVIEW.md`. Headline points: the ledger schema
carries no name/email/phone by design (open question, see §16); every test
fixture is `test_data: true` and `model.js` refuses to default that field;
no code path in this branch performs any outbound network call
(WhatsApp cards are strings only).

## 15. What is still UNKNOWN

- **Real geography.** `src/geo_seed.js` zone-adjacency/distance data is a
  placeholder sized for the test fixtures, not verified Fiji road
  distances/times. Every figure derived from it is tagged
  `verified: false` and excluded from revenue totals.
- **Board window vs. ledger completeness.** The 7-day board only matches
  movements against other movements *inside the same visible window* — a
  real reverse leg one day past the window boundary won't be surfaced as a
  match on that day's board (demonstrated with real fixture data in
  `docs/SAMPLE_SCENARIOS.md`, final section). Whether the board should
  widen its matching pool beyond the display window is a product decision,
  not made here.
- **Multi-leg chain time bound.** Chains currently have no maximum gap
  between legs (any forward-in-time gap >=45 min qualifies) — I fixed a
  real bug where chains could match backward in time, but didn't impose an
  upper bound since that's an ops call, not a code default I should invent.
- **`MIN_TURNAROUND_MINUTES = 45`** (`src/geo_seed.js`) is a placeholder,
  not an ops-confirmed value.

## 16. Exact items that require CEO policy input

1. **AU$50 Experience Credit minimum spend / margin threshold** —
   `minSpendThreshold` is `null` everywhere; the credit can never be
   eligible until you set a real number. This was explicit in the issue
   ("exact minimum spend / product-margin rule configurable") and I did
   not invent one.
2. **Customer-contact mechanism for ops.** The ledger deliberately holds no
   PII. When a human needs to reach a customer for a match/hold, is that
   always a lookup back into the originating storefront by
   `booking_reference`, or should some contact detail be added to this
   ledger later? Stage 1 assumes the former.
3. **Real ops geography** (distances, turnaround minutes) to replace the
   placeholder seed before any Stage 2 rollout.
4. **Whether the 7-day board's matching pool should look slightly beyond
   the display window** to catch near-boundary reverse legs (see §15).

## 17. Preview/deployment evidence

**None, and none was created** — this issue's Stage 1 scope is a shadow
data model/logic foundation, not a UI or deployed service, so there is no
preview URL to show. Evidence of correctness instead: the 47/47 passing
test run and the `scripts/demo.js` output captured verbatim in
`docs/SAMPLE_SCENARIOS.md`. If you'd like an actual Worker-backed preview
of `board.js` as a read-only JSON endpoint (still shadow-mode, no writes to
anything live), that's a small, separate follow-up I can scope on request
— not bundled into this branch per the "isolated branch only" instruction.

## 18. GO / HOLD recommendation for next stage

**GO** for CEO review of this branch as-is (schema, matcher, pricing
guardrails, atomic offer/ledger safety, 7-day board, tests). **HOLD** on
anything beyond that:

- HOLD on applying the migrations to a real D1 database until you say so.
- HOLD on wiring any storefront to read `route_price_truth`.
- HOLD on exposing `board.js` as a live HTTP endpoint.
- HOLD on setting `minSpendThreshold` / issuing any AU$50 credit.

Nothing in this branch, if merged as-is, changes any live fare, booking
flow, or DNS record — the only way it becomes load-bearing is a separate,
explicit next step you approve.
