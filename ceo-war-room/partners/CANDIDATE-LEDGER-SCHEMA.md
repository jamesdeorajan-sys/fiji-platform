# FOUNDING 100 — CANDIDATE LEDGER SCHEMA

Status: ACTIVE COLLECTION CONTRACT
Date: 2026-08-17

Purpose: allow AI to collect and rank Fiji supply quickly without confusing public claims with verified truth.

## Candidate record
- candidate_id
- discovered_name
- canonical_operator_id (nullable until resolved)
- candidate_type: operator | attraction | guide | transport | activity | community_experience
- category[]
- primary_location
- service_area[]
- website_url
- social_urls[]
- phone_candidate
- email_candidate
- booking_url_candidate
- source_records[]
- discovered_products[]
- review_sources[]
- claimed_prices[]
- pickup_claim
- transport_need
- legal_entity_candidate
- verification_state
- duplicate_cluster_id
- evidence_completeness_score
- commercial_demand_score
- transport_attach_score
- digital_gap_score
- strategic_fit_score
- onboarding_effort_score
- risk_score
- priority_score
- outreach_state
- operator_response_state
- last_researched_at
- next_action

## Evidence rule
Every extracted fact must carry:
- source URL/reference
- extracted_at
- raw claim/value
- confidence
- verification state

AI extraction never changes verification_state to VERIFIED.

## Initial priority formula
Priority is directional, not accounting truth:
(demand × strategic_fit × transport_attach × digital_gap × evidence_completeness) / (onboarding_effort × risk)

Human CEO/partner review may override scoring where trust, safety, uniqueness or strategic density requires it.

## Founding 100 funnel states
DISCOVERED
→ ENRICHED
→ DUPLICATE_RESOLVED
→ QUALIFIED
→ SHORTLISTED
→ OUTREACH_READY
→ CONTACTED
→ RESPONDED
→ COMMERCIAL_REVIEW
→ VERIFICATION_PENDING
→ VERIFIED
→ BOOKABLE
→ FIRST_BOOKING
→ FIRST_COMPLETED_BOOKING
→ ACTIVE_PARTNER

Terminal/hold states:
DUPLICATE | NOT_FIT | DECLINED | UNRESPONSIVE | RISK_HOLD | DORMANT

## CEO success definition
Do not report success from DISCOVERED or CONTACTED counts. Partner-network success begins when operators reach FIRST_COMPLETED_BOOKING and Vakaviti can measure partner GMV and contribution.
