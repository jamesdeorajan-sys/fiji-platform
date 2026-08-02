# Fare Service Phase 2 Implementation Plan

**Status:** Design only — do not implement, deploy, migrate, or treat as live. Fare Service Phase 2 is not authorized.
**Approval required:** James at every stage gate.
**Authority basis:** [AI authority contracts](FIJI_AI_AUTHORITY_CONTRACTS.md) and [ecosystem governance](FIJI_AI_ECOSYSTEM_GOVERNANCE.md).

## Objective and boundary

The future Fare Service would be the single deterministic pricing authority consumed by the booking site, Lagi, operator tools, and ComeToFiji. It replaces duplicate executable price truth with versioned rules, published fares, and immutable quote evidence. It does not own bookings, dispatch, or payments. Booking API publication is a blocking dependency.

This plan changes no runtime code or D1 schema, publishes no endpoint, and migrates no consumer. The first commercial release remains very small. WhatsApp remains a communication channel.

## Required product coverage

The model must explicitly support Nadi Airport→resort, resort→Nadi Airport, Nausori Airport routes, resort→resort, airport→activity, and activity→resort journeys; private and shared transfers; vehicle classes; night surcharges; extra stops; child-seat and service extras; tour add-ons; partner fares; discounts; promotions; and effective dates/version history. Settlement is in FJD. Later AUD, NZD, and USD values are display-only conversions using an approved timestamped rate; quotes and settlement retain FJD.

## Current-source discovery and migration

Before implementation, inventory every price, route, vehicle, surcharge, discount, promotion, rounding rule, fallback, and prompt. At minimum examine `ftt-booking-site/src/app.js` and `workers/chat-widget/worker.js`; their presence here identifies migration targets, not approved policy.

1. Record current source, runtime owner, consumer, currency, exceptions, and evidence.
2. Ask James to resolve conflicts and approve canonical policy.
3. Turn approved behavior into fixtures before changing either source.
4. Add the candidate authority in isolation and compare it with current behavior.
5. Migrate `ftt-booking-site/src/app.js` to consume authoritative results; remove its executable duplicate only after approved parity and canary evidence.
6. Migrate `workers/chat-widget/worker.js` so Lagi requests results and contains no price table, formula, or invented fallback.
7. Cut over operator tools and ComeToFiji individually, then prove no active duplicate pricing logic remains.

## Authoritative models

### Fare rules

A rule has immutable rule ID/version; draft/review/approval state; effective-from/to; canonical origin, destination, direction and journey type; private/shared product; vehicle class and capacity; base calculation in integer FJD cents; typed night, stop, child-seat/service, and tour adjustments; partner eligibility; discount/promotion predicates and stacking; tax/fee and rounding policy; precedence; public label/reason codes; and approval evidence. Unknown or over-capacity inputs return `NotPriced`, never an inferred mapping or combination.

### Published fares

A published fare is a read-optimized, effective-dated projection of an approved rule for eligible public or partner audiences. It identifies its rule version and publishing event. It is not independently editable and cannot expose confidential partner terms. Display currency contains rate source/time and is never settlement truth.

### Immutable quote snapshots

The Quote Service creates a snapshot only from a successful `PriceResult`. It retains normalized request, FJD line items and total, optional display conversion, calculation and rule-set IDs, terms, assumptions, inclusions/exclusions, expiry, traveler/lead reference where authorized, channel/actor, and superseding quote. Changed facts or expiry create a new quote; history is never overwritten.

## API contracts

- `POST /v1/prices:evaluate`: versioned `PriceRequest` → `PriceResult` or structured `NotPriced`.
- `GET /v1/published-fares`: authorized filters → audience-safe effective fares.
- `GET /v1/calculations/{id}`: authorized reproducibility/audit view.
- Rule mutation/publication endpoints are administrative, authenticated, idempotent, and separately authorized.
- Quote creation belongs to the Quote Service, not the Fare Service.

Requests contain canonical locations, service time, product/vehicle, party/luggage, extras, currency/display currency, partner/customer context, and promotion tokens. Results contain reconciled line items, FJD total, optional display amount, rule-set version, effective timestamp, calculation ID, assumptions, and reason codes.

Audit fields include schema version, request hash, calculation/rule IDs, actor/service identity, purpose, correlation/idempotency IDs, timestamps, source channel, decision reasons, approval/publish event, and redacted error metadata. Operational truth is D1-backed; schema changes require versioned migrations; implementation truth is in Git.

## Verification

- **Fixture tests:** every approved route/product/direction, boundary time/date, capacity, surcharge, extra, partner fare, promotion, rounding, FJD reconciliation, conversion display, and negative case.
- **Contract/property tests:** schema compatibility, authorization, idempotency, determinism, precedence, audit completeness, redaction, and total=line-items invariants.
- **Parity tests:** replay sanitized current cases against the candidate; classify every difference as approved correction, unsupported case, or defect. Never force silent parity.
- **Repository scans:** no executable fare values in Lagi prompts and no active migrated duplicate.

Failure modes include missing/ambiguous location, absent input, unsupported route/product, capacity breach, no effective rule, conflicting rules, expired/unauthorized promotion, unavailable conversion, dependency/timeout, and audit-write failure. Fail closed with stable reason codes or manual review. Never use AI-generated or stale hardcoded prices.

## Exact Phase 2 milestones and rollout

1. **M0 authorization:** James separately authorizes Phase 2 implementation; approve inventory scope, owners, privacy/threat model, success and rollback criteria.
2. **M1 policy inventory:** GitHub-reviewed source inventory and canonical policy decisions.
3. **M2 contracts and fixtures:** versioned schemas, rule model, migration design, and approved fixture corpus.
4. **M3 offline prototype:** isolated evaluator; unit, property, security, audit, and fixture evidence; no production traffic/data.
5. **M4 shadow:** separately approved sanitized shadow evaluations; measure mismatch, latency, `NotPriced`, and reconciliation without traveler display or mutation.
6. **M5 internal preview:** labeled staff-only comparison and issue disposition.
7. **M6 limited canary:** separately approved production deployment to one narrow route/product/surface behind flags.
8. **M7 progressive migration:** booking site, Lagi, operator tools, and ComeToFiji gated independently.
9. **M8 sole authority:** disable duplicate execution, prove inventory clean, retain approved rollback compatibility.

Architecture, implementation, verification, staging, and production are distinct approvals. Completion requires a GitHub-visible branch, commit, and PR.

## Rollback

Before each release retain the prior artifact, rule set, schemas, and feature-flag state; define alerts and decision owner; preserve readable quote snapshots; and rehearse rollback outside production. Rollback stops new affected evaluations, returns consumers to the last explicitly approved authoritative workflow, preserves evidence, and records the decision. If none is safe, report pricing unavailable and offer manual review. Freeze the failed version, reconcile affected quotes, notify owners, document the incident, and require a new gate.
