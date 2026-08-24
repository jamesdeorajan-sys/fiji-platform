# Live Deal Exchange — Integration Contract with PR #21 (Opportunity Pipeline)

Status: **DISABLED.** No code path in this branch calls into, imports from, or writes to any PR
#21 table or module. This document exists so the eventual integration is a deliberate, reviewed
step after PR #21 merges — not something either branch backs into by accident.

## Why this boundary exists

PR #21 (`ceo/vakaviti-deal-opportunity-pipeline`) and this branch
(`ceo/vakaviti-live-deal-exchange`) were both branched from production and built independently, in
parallel, on the CEO's explicit instruction that neither may duplicate the other's tables,
lifecycle, or admin surface. Two systems privately capturing "possible offers" would be a second
source of truth for the same commercial fact — exactly what this whole engagement has repeatedly
guarded against.

## Ownership (unchanged from the CEO's directive)

**PR #21 owns:**
- Private opportunity capture (`opportunities`, `opportunity_lifecycle_events`, `opportunity_provider_replies`)
- Provider outreach preparation and reply ingestion
- Opportunity lifecycle and its private admin console

**Live Deal Exchange owns:**
- Public multi-authority offers (`deal_exchange_offers`, `deal_exchange_evidence`, `deal_exchange_offer_history`)
- Comparison, trip-saving, revenue routing
- Public deal freshness and withdrawal

## The narrow contract (once PR #21 merges)

A PR #21 opportunity that a human governs into a `deal_offer_candidate` (via
`convertOpportunityToDealCandidate()`, the ONE function PR #21 exposes for this) is the sole
handoff point. This branch's eventual integration:

1. Reads `deal_offer_candidates` rows with `review_status = 'PUBLISHED'` (the same table and same
   status the existing, unmodified `autoPublishDealIfEligible()` path already uses) — never reads
   PR #21's private `opportunities` table directly.
2. Maps a published deal candidate into a `deal_exchange_offers` row via its OWN evidence
   resolution (`resolveEvidenceBundle()`), re-deriving public eligibility independently rather than
   trusting PR #21's internal state.
3. Never writes back into any PR #21 table. The relationship is strictly one-directional and
   read-only, and only at the `deal_offer_candidates` boundary that already exists today.

## What must happen before this is turned on

1. PR #21 is separately CEO-approved and merged to production.
2. This branch is rebased onto the post-merge production HEAD.
3. The exact shape of `deal_offer_candidates` as it exists after PR #21's merge is re-verified
   against this contract (field names, review_status values) — adapted if anything changed during
   PR #21's own review.
4. A separate, explicit CEO authorization to enable the integration.

Until all four steps happen, this file describes intent only.
