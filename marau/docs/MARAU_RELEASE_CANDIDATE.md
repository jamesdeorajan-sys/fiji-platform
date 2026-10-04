# Marau preview - RELEASE CANDIDATE 1 (closeout, 2026-10-04)

**Preview only. This is NOT a production release and requests none.** Rewards are OFF. Nothing is deployed to production; no production
migration, live message, real guest import or payment collection. Editions remain grouping + recipient preview. Issue #59 untouched.

## 1. What is fixed (exact)

| Item | Value |
|---|---|
| Repo / branch | `jamesdeorajan-sys/fiji-platform`, `ceo/marau-stage1-preview` (Marau under `marau/`) |
| **Code commit deployed** | `3362a27aeef8b6f3b97c29773b7a50839dfff9c9` |
| Git tag | `marau-preview-rc1` (on the commit that adds this document; **no code differs** from 3362a27 - verify: `git diff --stat 3362a27 marau-preview-rc1 -- marau/worker marau/migrations` is empty) |
| **Preview Worker version** | `496b4d98-f773-442b-b84d-104c7bfb6036` (`marau-stage1-preview.helpronline.workers.dev`) |
| Previous preview version (rollback target) | `a7ea41ba-4f9f-4050-a4ff-5954a958e09e` |
| Preview D1 | `marau-stage1-test-db` (`e0c81ade-dc9f-477f-b370-bd5fd85a4f1f`), isolated, synthetic rows only |
| Pre-0041 D1 Time Travel bookmark | `00000046-00000000-000050fa-db61bf90e7e88ef7a1b82e558bce046a` |
| Source | SYNTHETIC (`NADI_SOURCE_BASE_URL` unset). Nadi milestone38 NOT deployed. |
| Client code | `pages.js`, `guest_offers_client.js`, `staff_console.js` are **byte-identical to 939c281**, the build the full guest-browser run exercised |

### Migration list (applied to the PREVIEW D1 only; production: none)

| # | File | Nature | Rollback |
|---|---|---|---|
| 0035 | experience_offers | additive tables | Time Travel |
| 0036 | referral_rewards | additive + `ALTER ADD COLUMN leg_type` | Time Travel |
| 0037 | contact_and_consent | additive | Time Travel |
| 0038 | reward_integrity | adds `require_payment`, payment ledger, **rebuilds `marau_booking_adjustments`** (drops `UNIQUE(booking_id)`) | Time Travel only (the rebuild has no down-migration) |
| 0039 | contact_deliverability | additive (`marau_suppressions`) | Time Travel |
| 0040 | session_merge_support | additive (`marau_session_merges`) | Time Travel |
| 0041 | mirror_shape_and_relationship | two nullable columns (`leg_shape`, `relationship_basis`) | Previous Worker runs unchanged on the new schema; or Time Travel |

The upgrade path over a POPULATED database is a permanent test (`marau_migration_upgrade.test.mjs`, foreign keys enforced).

### Rollback procedure (preview; the same shape applies to any later environment)

1. Worker: `env -u CLOUDFLARE_API_TOKEN npx wrangler rollback a7ea41ba-4f9f-4050-a4ff-5954a958e09e --name marau-stage1-preview`
   (0041 is additive and nullable, so the previous Worker runs on the new schema).
2. Data: there are **no down-migrations**. To undo schema/data to before 0041:
   `env -u CLOUDFLARE_API_TOKEN npx wrangler d1 time-travel restore marau-stage1-test-db --bookmark=00000046-00000000-000050fa-db61bf90e7e88ef7a1b82e558bce046a`
   (everything written after that bookmark is lost - acceptable in the synthetic preview; in any real environment take a bookmark
   with `wrangler d1 time-travel info <db>` immediately BEFORE applying migrations and treat restore as a last resort).
3. Rewards are switched OFF with `POST /preview/admin/rewards/policy {"mode":"off"}` - a freeze, not a deletion (section 3.4).
4. Verify after any rollback with the acceptance commands below.

**Honest status of this procedure:** the command syntax was checked against `wrangler rollback --help` and `wrangler d1 time-travel restore --help`; the rollback and restore were **NOT executed** (doing so would discard the release candidate / its data). Treat it as documented, not rehearsed.

### Reproducible acceptance commands

```bash
cd marau
node --test test/*.test.mjs                                   # LOCAL: 358 tests (includes real wrangler dry-run bundling + real-contract against the Nadi worktree)
(cd ../smart-return-trigger-fill && node --test test/*.test.js)   # LOCAL: engine, 247 tests (untouched)
node scripts/hosted_revenue_journey.mjs https://marau-stage1-preview.helpronline.workers.dev <MARAU_ADMIN_TEST_TOKEN from wrangler.toml>   # HOSTED SYNTHETIC: 47 checks
node scripts/hosted_browser_seed.mjs https://marau-stage1-preview.helpronline.workers.dev <same token>  # seeds synthetic data for the phone walkthrough
env -u CLOUDFLARE_API_TOKEN npx wrangler deploy --dry-run --outdir ../.dry   # bundle check (also run inside the test suite)
```

## 2. Evidence, by class (nothing here is independently verified)

| Class | Result | Notes |
|---|---|---|
| LOCAL, AUTHOR-RUN | Marau **358/358**; engine **247/247**; Nadi attempt-identity 17/17 (last run earlier; Nadi untouched) | `node:sqlite`, default-deny network. Concurrency = gated interleavings + single-statement atomicity, not true parallelism |
| HOSTED SYNTHETIC | `scripts/hosted_revenue_journey.mjs` **47/47** on 496b4d98 (`docs/evidence/hosted_journey_rc1_496b4d98.json`) | An earlier attempt on 109b397f hit transient `wrangler` connectivity failures (reported, retried; 47/47 on the retry and again on 496b4d98). Return legs are a stated DB fixture |
| BROWSER (embedded pane, 375x812) | Full guest journey on a7ea41ba (client code identical to RC); RC smoke only this round: trip renders, rewards-OFF wording shown | Offline was simulated; clipboard was denied by that browser. See `MARAU_REWARD_INTEGRITY_ROUND.md` |
| PHYSICAL PHONE | **NONE COLLECTED.** Camera QR scan, real iOS/Android behaviour, separate-device referral | `MARAU_PHONE_WALKTHROUGH.md` is the procedure; its result table is empty until James runs it |

## 3. Closeout answers

### 3.1 Refund before payment - reproduced, fixed, and which orderings are supported

Reproduced (red, `docs/evidence/closeout_RED_baseline_939c281.txt`): a refund delivered before its payment record was **rejected** with
`REFUND_EXCEEDS_PAYMENT`, i.e. the refund was LOST (the caller would have to remember and resend it). Now both events are always stored; bounds
are on GROSS totals; the response and staff view carry `reconciliation`: `none` | `matched` | `refund_awaiting_payment_record`.
Any recorded refund reverses the credit immediately (even before its payment is recorded); the late payment record then reconciles to `matched`
and never resurrects the credit.

| Ordering | Supported? | Result |
|---|---|---|
| paid, then refunded | yes | credit reversed; if already applied, flagged `reversal_pending_staff` (never a silent fare change) |
| refunded, then paid (refund delivered first) | **yes (new)** | refund kept, `refund_awaiting_payment_record` -> `matched`; credit stays reversed |
| exact replay of any event (same `event_key`) | yes | no-op, original operator reported |
| same `event_key`, different content | refused `EVENT_KEY_REUSED` | |
| cancel, then payment recorded | yes | payment kept, credit stays reversed |
| payment, then cancel | yes | credit reversed |
| partial payment, then rest | yes | qualifies only when paid in full (if policy requires it) |
| refund (cumulative) greater than the purchase total | refused `REFUND_EXCEEDS_TOTAL` | |
| payments (gross) greater than the total | refused `OVERPAYMENT` | a re-payment after a refund must be a NEW purchase |
| evidence on a request that was never confirmed (`requested`/`declined`/`expired`) | refused `REQUEST_NOT_PAYABLE` | |
| deleting/voiding an event | **not supported** | the ledger is append-only; there is no correction path yet |
| a PARTIAL refund | supported, **conservative** | any refund reverses the whole credit (a commercial decision to revisit) |

### 3.2 Late writes and recovery (no further guest interaction)

Reproduced (3 red interleavings, forced with a statement gate): a cancellation/refund landing **after** the qualification facts were read but **before**
the credit INSERT/promotion produced a credit that was `earned` (redeemable) for an ineligible purchase. Fixes:
- the credit INSERT, the pending->earned promotion and the apply INSERT each re-check **inside the same SQL statement** that the purchase is still
  `confirmed/fulfilled` and has **no refund**; a late write can therefore not create or promote a redeemable credit, nor apply one;
- creation is always `pending`; promotion is a separate guarded statement driven by the credit's own stored terms;
- an idempotent sweep (`reconcileApplications`) reverses any credit whose purchase is ineligible, releases credits from cancelled returns, and promotes
  credits whose stored terms are now met. It runs on **every staff credit list, every apply, every offers report, and every guest trip/referral read**.
Limits, stated plainly: there is **no timer**. If nobody reads, nothing is swept - but nothing is redeemable either, because apply re-checks atomically.
The staff follow-up queue (`/preview/admin/follow-ups`) does not itself sweep, so it can list an "earned credit" until the next sweeping read; apply is safe regardless.
Tested: orphan refund row (hook never ran), cancelled-by-raw-update purchase, lost promotion hook - all recovered by a staff read with no guest action.

### 3.3 Return mirror vs representative source shapes (source facts first)

The real source (`nadi-dispatch-api`) records zones, pickup date/time, and for a **round trip the return as fields on the SAME booking**
(`return_date`, `return_time`, `return_pickup_location`, `trip_type`). It has **no field linking two bookings**. Therefore direction is never evidence of a
round-trip relationship. The classifier (`worker/leg_type.js`) now reports an explicit shape; mirrored rows carry `leg_type` + `leg_shape`.

| Source shape | leg_type / shape | Credit | Status |
|---|---|---|---|
| Arrival and return held in ONE booking | `round_trip` / `round_trip_single_booking` | **refused** `UNSUPPORTED_SHAPE` (one combined fare; cannot discount "just the return") | **UNSUPPORTED**, reported |
| Standalone hotel-to-airport departure | `departure` / `standalone_departure` | only with explicit staff confirmation (`relationship_confirmed: true`), recorded as `relationship_basis = staff_confirmed_departure`; else `RELATIONSHIP_NOT_CONFIRMED` | supported, gated |
| Return leg explicitly linked to its original booking | classified as a standalone departure; any link-looking field is **ignored** | as above | **UNSUPPORTED** - the source has no such field; a link would need a source change |
| Return declared by the guest in Marau's own form | `return` / (none) | applies as before; `relationship_basis = declared_return_leg` | supported |
| One-way arrival | `arrival` / `one_way_arrival` | not a credit target | n/a |
| Airport-to-airport, or neither end an airport | `other` | refused `UNSUPPORTED_SHAPE` | unsupported |
| Missing/blank location | `unclassified` / `missing_or_ambiguous_location`; the sync refuses to mirror a row with no zone | refused | unsupported, fail closed |
| Source reader does not provide the itinerary fields at all | `unclassified` / `itinerary_fields_not_provided` (a round trip cannot be ruled out) | refused | unsupported, fail closed |
| Missing or unparseable pickup date/time | **not mirrored** (`MISSING_OR_INVALID_PICKUP_DATETIME`) | n/a | refused |

**Consequence for production:** the real-source *reader* (still unbuilt) MUST return `return_date`, `return_time`, `return_pickup_location` and `trip_type`
(null when absent) or every mirrored row will classify as `unclassified` and be ineligible. A source change would be needed for explicit linking.
This supersedes the earlier statement that any "return" direction was eligible.

### 3.4 Policy change vs existing pending credits (defined, tested)

Every credit stores a `policy_snapshot` at creation. **Its purpose: it is the promise.** It alone decides whether THAT credit is earned (stage, payment
requirement) and its `amount_cents` never changes. A later policy edit affects NEW credits only; it can neither loosen nor tighten an existing
credit's terms (tested both ways; a snapshot predating payment evidence has no `require_payment` key and keeps its fulfilled-only promise). Min-purchase
and cap are creation-time conditions and do not void an existing credit. The ONE live switch is `mode`: **OFF freezes** earning, promotion and
application (`REWARDS_OFF`) without deleting or reversing anything and resumes under the stored terms when switched back on. A cancellation or refund
always reverses, even while OFF. `GET /preview/admin/rewards/policy` returns this as `policy_change_note`. Live mode remains un-settable via the API.

### 3.5 Editions, and the next commercial milestone

Editions are **grouping + Fiji-time slot logic + recipient preview only** (test: no `scheduled` export, no cron). No notification is operating.
**Next commercial milestone (recorded, NOT started):** delivery of editions and the human-team workflow - who sends, over which channel, from which
number; template/consent text approval; the named staff rota for confirmations, payments evidence and follow-ups; suppression handling in practice;
service levels for "request -> human confirmation". It needs James's decisions (below) before any engineering.

## 4. Still open before ANY production request

Deploy Nadi milestone38; build the real-source reader (with the itinerary fields); production Marau resources and migrations 0035-0041;
mirror rows `test_data = 0` and a live-reward decision; physical-phone evidence; James's commercial decisions (reward terms, partial-refund rule,
who records payment evidence, forfeited remainder, wa.me, consent wording, supplier verification, follow-up ownership).
The shared-admin-token limitation is unchanged: the operator at the source is `service-asserted`, not an authenticated person.
