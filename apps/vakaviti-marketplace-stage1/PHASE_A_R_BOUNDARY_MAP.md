# Phase A-R — Canonical Boundary Map, Schema Proposal, and Reuse Inventory

CEO directive: "PHASE A-R: CONSOLIDATE BEFORE INFRASTRUCTURE" (2026-08-29). Branch
`ceo/phase-a-r-consolidation`, based on `9c13f1c8b4ff37a9ba0c4c73beb5fecdf46034e2` (the real
production HEAD of `ceo/vakaviti-marketplace-stage1`, verified against the remote before branching).

This document is design only. No migration in this list has been applied to any database.

---

## 1. Canonical public-offer core — legacy-to-canonical boundary map

| Concept | Canonical (this phase forward) | Legacy (feeds in, cannot independently publish) |
|---|---|---|
| Public offer record | `deal_exchange_offers` | `deal_offer_candidates` |
| Evidence ledger | `deal_exchange_evidence` (append-only, DB-trigger-enforced) | `deal_change_events` (still used for its own review workflow, not extended further) |
| Publication gate | `evaluateOfferPublicationGates()` in `deal-exchange-model.ts` | `evaluateQualityGates()` / `evaluateDealAutoPublishGates()` in `deal-quality.ts` — reclassified below as **extraction-time filters**, not a second publication authority |
| Public listing decision column | `deal_exchange_offers.publication_decision` (`ELIGIBLE`/`NOT_ELIGIBLE`/`PRIVATE_ONLY`) — sole authoritative eligibility state | `deal_offer_candidates.review_status` — remains the legacy pipeline's own internal workflow state, never read by any new Phase A-R code as a publication authority |
| Enquiry/lead record | Read via `LeadRepository` adapters (`Stage1LeadAdapter` over `enquiries`, `DealExchangeLeadAdapter` over `deal_exchange_enquiries`) — see §3 | `deal_enquiries` (Class B public deals hub) is **out of scope this phase** — no adapter written for it yet; flagged in §3's migration proposal, not silently dropped |

**Precise rule enforced by this boundary:** `deal-quality.ts`'s gate functions may run against a
`deal_offer_candidates` row and produce `NEEDS_HUMAN_REVIEW` / a Class-B auto-publish attempt
exactly as they do today (unchanged, unmodified this phase) — but nothing in Phase A-R treats that
outcome as public-facing. A `deal_offer_candidates` row becomes publicly visible only by being
promoted into `deal_exchange_offers` and passing `evaluateOfferPublicationGates()` there. No fifth
offer schema is introduced; `source-family-model.ts` and `offer-workflow.ts` (§4, §9) are written
against `MaterialField`/`OfferGateResult` types imported from `deal-exchange-model.ts`, not against
new parallel types.

**PR #21 (`ceo/vakaviti-deal-opportunity-pipeline`) relationship — unchanged, not touched.**
`DEAL_EXCHANGE_PR21_INTEGRATION_PLAN.md` (already in this repo, predating this phase) already
specifies the correct reconciliation sequence: PR #21 finishes hardening → CEO approves it
separately → it merges to `ceo/vakaviti-marketplace-stage1` first → the Deal Exchange branch
rebases onto that. Phase A-R does not accelerate, duplicate, or assume any part of that sequence.
Every new Phase A-R file was checked (and is now regression-tested, `phase-a-r-invariants.test.ts`)
to contain zero references to `opportunit*` identifiers or tables.

---

## 2. Public presentation (derived, not stored)

`src/public-presentation.ts` — `derivePublicPresentation(offer, resolvedEvidence)`. No
`public_listing_class` column exists anywhere. `publication_decision` remains the sole authoritative
eligibility state; this function only decides *how* an `ELIGIBLE` offer is presented
(`PRICED_DEAL` vs. `SPECIAL`) or maps an undecided/contradicted state to `REVIEW_REQUIRED`. Public
copy constants: `SOURCE_CHECKED_LABEL = 'Source checked'`, `PRICE_ON_CONFIRMATION_LABEL = 'Price on
confirmation'`. 9 tests, all passing (`public-presentation.test.ts`).

---

## 3. Lead consolidation — read-only, no fourth pipeline

`src/lead-repository.ts` implements exactly what item 3 of the directive asks for and nothing more:
`LeadRepository` interface (two read methods, zero write methods — not "throws on write," structurally
absent), `Stage1LeadAdapter` (reads `enquiries`), `DealExchangeLeadAdapter` (reads
`deal_exchange_enquiries`), `CentralLeadView` (normalized read shape tagging `originSystem`/`originId`
— never a new identity), `CentralLeadInboxService` (`listCombined`/`findByOrigin` only). 8 tests,
all passing, including a structural test that neither the adapters nor the inbox service expose any
method matching `/write|insert|update|delete|assign|set|mutate|create|advance|transition/i`.

**Not adapted this phase:** `deal_enquiries` (the Class B public-deals-hub enquiry table, which the
existing codebase's own comments already flag as having "no qualified flag and no booking/outcome
column"). Adding a third adapter for it is mechanical but was left out to keep this phase's diff
focused on the two systems named in the directive; it is the first item to add before the future
migration below is ever executed, so its rows are not silently excluded from the eventual canonical
table.

### Future canonical-lead migration proposal (NOT implemented this phase)

- **Target database decision.** Recommend the `leads` table lives in Stage 1's own D1
  (`vakaviti-marketplace-stage1-db`) rather than a new database — both source systems already share
  this database today (Deal Exchange's production DB is currently separate, `vakaviti-live-deal-exchange-db`,
  which raises a genuine cross-D1 question, below).
- **Historical backfill.** One-time, idempotent (`INSERT OR IGNORE` keyed by a deterministic
  `origin_system:origin_id` composite id) copy of every existing `enquiries` and
  `deal_exchange_enquiries` row into `leads`, preserving `created_at` and mapping status through the
  same tables already in `lead-repository.ts`. Never deletes the source rows.
- **Dual-write avoidance.** During any transition window, only ONE system writes at a time per
  lead: the originating system continues to own writes for leads it created; `leads` is
  updated by a single, idempotent projection step (not by making both the old and new code paths
  write independently, which risks divergence). The cleanest option is to keep the existing systems
  as the write path indefinitely and treat `leads` as a materialized, rebuildable read-projection —
  deferring true single-write-path cutover to a later, separately-authorized decision.
- **Cutover.** Only after (a) the third adapter (`deal_enquiries`) exists and is tested, (b) the
  backfill has run and been reconciled (row counts match source tables exactly), (c) the
  `HUMAN_ASSIGNED`-onward states (`QUALIFIED`/`QUOTE_REQUIRED`/.../`BOOKED`/`LOST`/`EXPIRED`) have a
  decided home — since none of the three existing tables has these states today, they cannot be
  "cut over" from anywhere; they are genuinely new columns/workflow that must be designed with a
  human owner before `leads` becomes a write target for anything past `WHATSAPP_OPENED`.
- **Rollback.** Because `leads` is proposed as a read-projection with no independent write path
  during the transition, rollback is trivial: stop populating it, keep reading the three original
  tables via the adapters that already exist today. No data migration needs to be undone.
- **Retention and privacy.** `visitor_details` (name/contact as volunteered, `consent_given_at`)
  should inherit the shorter of any retention rule already applying to the two source systems — this
  needs a decision from whoever owns Vakaviti's privacy posture, not assumed here.
- **Cross-D1 limitation (the real blocker).** `enquiries` lives in `vakaviti-marketplace-stage1-db`;
  `deal_exchange_enquiries` lives in `vakaviti-live-deal-exchange-db` — two **separate D1 databases**.
  D1 has no cross-database JOIN or foreign key. A single canonical `leads` table can only live in one
  of them, meaning the backfill/projection step for whichever system isn't co-located must run as an
  application-level read-then-write (already how `CentralLeadInboxService` works), never a SQL-level
  migration across databases. This is the single largest reason this migration is proposed
  separately rather than folded into Phase A-R.

---

## 4. Source-family model — schema proposal, not applied

`src/source-family-model.ts` defines the `SourceFamily` type and the one load-bearing function,
`isPathAuthorized()`, tested to prove the directive's exact requirement: an empty
`allowedPathPatterns` list authorizes nothing (domain approval alone never opens every path), an
`excludedPathPatterns` match always wins even against a broader allowed pattern, and unmatched paths
are rejected by default. 5 tests, all passing.

**Proposed table** (illustrative DDL, not migrated):

```sql
CREATE TABLE offer_source_families (
  id TEXT PRIMARY KEY,
  legal_provider_or_seller_identity TEXT NOT NULL,
  approved_domain TEXT NOT NULL,
  allowed_path_patterns TEXT NOT NULL,   -- JSON array
  excluded_path_patterns TEXT NOT NULL,  -- JSON array
  authoritative_fields TEXT NOT NULL,    -- JSON array of MaterialField values
  extraction_profile TEXT NOT NULL CHECK (extraction_profile IN ('STANDARD_HTML','JS_RENDERED','FEED_XML','FEED_JSON')),
  currency_expectations TEXT NOT NULL,   -- JSON array of ISO 4217 codes
  permitted_page_types TEXT NOT NULL,    -- JSON array
  recheck_schedule_hours INTEGER NOT NULL,
  rate_limit_per_hour INTEGER NOT NULL,
  robots_access_policy TEXT NOT NULL CHECK (robots_access_policy IN ('ROBOTS_TXT_HONORED','EXPLICIT_PERMISSION_ON_FILE')),
  trust_score INTEGER NOT NULL DEFAULT 50,
  approval_actor_id TEXT NOT NULL,
  approval_evidence_url TEXT,
  approved_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Relationship to today's `deal_sources`: `offer_source_families` is additive and generalizes it (one
family can cover many `deal_sources.source_url` rows under one approval); existing `deal_sources`
rows are not renamed or dropped, and `deal-agent.ts`'s scanning loop needs no change until a
migration actually introduces this table — this phase changes zero runtime behavior.

---

## 5. Discovery channels — implemented interfaces

`src/discovery-providers.ts` — all six required provider interfaces
(`SearchDiscoveryProvider`/`SitemapDiscoveryProvider`/`CategoryPageDiscoveryProvider`/`FeedDiscoveryProvider`/`ExistingSourceDiscoveryProvider`/`HumanSubmissionDiscoveryProvider`),
each returning `DiscoveredCandidateUrl[]` via the mandatory `sanitizeDiscoveredCandidate()` chokepoint,
which copies exactly `url`/`discoveredVia` and hard-codes `authority: 'DISCOVERY_ONLY'` — a
misbehaving provider implementation that tries to smuggle a price/date field through has it silently
stripped. 6 tests, all passing, including one that proves a provider claiming `authority:
'AUTHORITATIVE'` is overridden back to `'DISCOVERY_ONLY'`.

---

## 6. Corrected authority matrix

`src/authority-model.ts`. Corrects the original pre-implementation report, which listed RESTORE as a
single human-owned action in the Human Review Queue section without also stating the automated
clean-revalidation path explicitly — that ambiguity is now resolved into two distinct, independently
tested functions.

| Transition | Who may perform it | Function |
|---|---|---|
| Global kill switch (any state change) | Authenticated human only — no exception | `setGlobalKillSwitch()` |
| Source pause (APPROVED → PAUSED) | OperationsSupervisor agent OR authenticated human | `pauseSource()` |
| Source approval (→ APPROVED, from any prior state) | Authenticated human only — no agent type, ever | `approveSource()` |
| Offer quarantine (PUBLISHED → QUARANTINED) | The deterministic rule engine, but *only* for `EXPIRY`/`MATERIAL_CHANGE` reason codes, OR an authenticated human for any reason code | `quarantineOffer()` |
| Offer/source restore, human path | Authenticated human only | `restoreByHuman()` |
| Offer/source restore, automated path | The deterministic rule engine only, and only when handed a `CleanRevalidationResult` proving every gate re-passed with fresh (non-carried-over) evidence — a partial pass throws | `restoreViaCleanRevalidation()` |

Every function returns a `StateTransitionRecord` carrying `actorType`, `actorId`, `reasonCode`,
`evidence`, `priorState`, `nextState`, `timestamp` — one uniform audit shape across all five
transition kinds. 17 tests, all passing.

---

## 7. Evidence storage — minimal by default, R2 as optional escalation

`src/evidence-model.ts`. `DefaultEvidenceRecord` has no field that could hold full HTML, a
screenshot, or an image — not merely "usually empty," structurally absent from the type and proven
by a test asserting the exact key set the builder produces. `MAX_EXCERPT_CHARS = 240` is enforced by
`buildDefaultEvidenceRecord()`, not just documented. `EvidenceEscalation` (the R2 path) is a
separate type nothing in the default pipeline ever constructs; `requestEvidenceEscalation()` is the
only way to create one and requires a non-empty reason. 5 tests, all passing.

---

## 8. Reuse / deprecation inventory

| Function / module | Disposition | Regression guard protecting it |
|---|---|---|
| `safeFetchSource()` (deal-agent.ts) | **Reused unchanged** — becomes the concrete implementation behind `offer-workflow.ts`'s `FetchPort` in Phase B | none new needed; existing SSRF checks are exercised as-is |
| `extractOfferFacts()` / `ai.ts`'s `enrichCandidate()` | **Reused unchanged**, wrapped by `ExtractionPort` | `phase-a-r-invariants.test.ts`: `ai.ts` imports neither `authority-model.ts` nor `offer-workflow.ts` |
| `canonicalizeUrl()`, `computeDealIdentity()`, `diffMaterialFacts()` (deal-quality.ts / deal-exchange-model.ts) | **Reused unchanged**, wrapped by `NormalizerPort`/`DeduplicatorPort` | existing `deal-exchange-model.test.ts` |
| `evaluateOfferPublicationGates()` | **Reused unchanged**, wrapped by `RuleEnginePort`; remains the only function that sets `publication_decision` | existing tests + this phase's `derivePublicPresentation()` never overrides it |
| `evaluateQualityGates()` / `evaluateDealAutoPublishGates()` | **Reclassified, not rewritten** — extraction-time filters for the legacy candidate pipeline (§1), not a second publication authority for the canonical core | `regression-guards.mjs` (pre-existing, 25+ checks already covering this file) |
| `validateBookingRoute()` | **Reused unchanged** — the workflow's eventual publish step must call it before any `PUBLISHED`/`ELIGIBLE` transition, exactly as `deal-exchange-model.ts` already does | existing `booking-route-safety` guard already in `regression-guards.mjs` |
| `detectPromptInjection()` | **Reused unchanged**, called inside `RuleEnginePort` implementations in Phase B | existing tests |
| `recoverStuckRuns()` / `recoverStuckSprints()` watchdog pattern | **Reused as the model**, not the code — Phase B's Workflow-based orchestration replaces the cron-loop watchdog entirely, but the "recover, don't silently leave RUNNING" discipline carries forward | migration 0019's own documented incident is the cautionary spec |
| `deal_offer_candidates` review_status enum | **Kept as-is**, scope narrowed (§1) — not deprecated, not extended | none new; its own existing endpoints in `deals.ts` are untouched |
| A hypothetical new `public_listing_class` column | **Deprecated before it existed** — explicitly rejected in favor of the derived function (§2), per the directive | `public-presentation.test.ts` proves no DB access occurs in `derivePublicPresentation()` (pure function signature itself is the guard) |
| `enquiries` / `deal_exchange_enquiries` as write systems | **Kept as the sole write paths**, indefinitely — see §3's migration proposal for the only path by which this would ever change | `lead-repository.test.ts`'s structural no-write-method tests |

No mature safety logic was rewritten. Every new module in this phase is additive and calls into, or
is designed to be called by, the existing functions above rather than reimplementing them.

---

## 9. Proposed Phase B Cloudflare resources and estimated operating limits

Not provisioned this phase. For the CEO's Phase B authorization decision:

| Resource | Proposed name | Notes |
|---|---|---|
| Queue | `offer-discovery-jobs` | fan-out from the six discovery providers |
| Queue | `offer-fetch-extract-jobs` | consumes `runOfferWorkflow()` |
| Queue | `offer-recheck-jobs` | consumes `runRecheckWorkflow()` |
| DLQ | `offer-discovery-jobs-dlq`, `offer-fetch-extract-jobs-dlq`, `offer-recheck-jobs-dlq` | one per queue, per §7 of the original report |
| Workflow | `OfferFetchExtractWorkflow` | wraps `runOfferWorkflow()`'s steps as durable, independently-retryable Workflow steps |
| R2 bucket | `vakaviti-offer-evidence-escalations` | **only** for `EvidenceEscalation` objects — never the default pipeline |
| D1 (new tables only, on the existing `vakaviti-marketplace-stage1-db`) | `offer_source_families` | per §4; no new database, no new binding beyond the existing `DB` |

Estimated operating limits (conservative, matching the existing `MAX_SOURCES_PER_ACTIVATION=3`
philosophy): queue `max_batch_size` ≤ 5, `max_retries` = 3 before DLQ, per-source
`rate_limit_per_hour` starting at 30 (existing `deal_sources` backoff formula reused unchanged),
Workers AI calls capped at 1 extraction attempt per candidate (no ensemble/retry-on-disagreement in
the first Phase B cut).

---

## 10. Test summary

19 test files, 269 tests, 0 failures. `npx tsc -p tsconfig.json` clean. `npm run guard:regression`:
1 pre-existing failure unrelated to this phase (see Phase A-R return, item 10 — a missing
`commercial_status='ACTIVE'` filter in the PR #29 WhatsApp-open route, confirmed present on the
unmodified production checkout before Phase A-R began, flagged separately, not fixed here to avoid
scope creep into an unrelated route).
