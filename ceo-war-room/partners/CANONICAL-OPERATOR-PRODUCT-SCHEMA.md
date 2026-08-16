# VAKAVITI CANONICAL OPERATOR + PRODUCT SCHEMA

Status: PHASE-1 IMPLEMENTATION CONTRACT
Date: 2026-08-17
Production effect: NONE

## Objective
Create one canonical vocabulary for collecting, verifying, distributing and monetising Fiji tours, activities and ground transport without creating another competing booking database.

## Core entities

### Operator
- operator_id (immutable Vakaviti ID)
- legal_name
- trading_name
- entity_type
- registration identifiers (verification-restricted)
- primary_contact (private)
- public_contact
- website
- social_profiles
- physical/service locations
- verification_status
- verification_evidence_ids
- fulfilment_status
- payout_profile_id (private reference)
- source_refs[]
- first_seen_at
- last_verified_at

### Product / Experience
- product_id (immutable Vakaviti ID)
- operator_id
- canonical_name
- category
- subcategory
- destination_ids[]
- meeting_point / pickup model
- duration
- inclusions[]
- exclusions[]
- suitability / restrictions
- capacity model
- cancellation_policy_id
- media_refs[]
- source_refs[]
- verification_status
- last_verified_at

### Offer
Commercial facts are versioned and never inferred from descriptive copy.
- offer_id
- product_id
- price_type (per_person/per_vehicle/per_group/etc.)
- currency
- amount
- child/youth/senior variants where verified
- validity window
- availability_method
- booking_url
- booking_authority
- seller_of_record
- operator_direct flag (evidence required)
- cancellation_policy_id
- source_ref
- verified_at
- effective_from
- effective_to

### Destination / POI
- destination_id
- canonical_name
- aliases[]
- type
- region
- locality
- coordinates (verified source)
- source_refs[]

### Transport Attachment
- attachment_id
- product_id
- origin/destination entity IDs
- transport_required/recommended/included
- route_id where known
- pickup notes
- fare authority reference
- quote-required flag

### Verification Evidence
- evidence_id
- subject_type/operator/product/offer/claim
- subject_id
- evidence_type
- source
- collected_at
- reviewed_at
- reviewer
- expiry/recheck_at
- status
- notes

### Source Record
Every AI-collected fact must retain provenance.
- source_ref
- source_type (official_site/social/directory/government/marketplace/operator_submission/etc.)
- url_or_internal_ref
- collected_at
- extraction_method
- confidence
- raw_claim
- normalized_candidate_value

## Verification states
DISCOVERED -> ENRICHED -> OPERATOR_CONTACTED -> OPERATOR_CONFIRMED -> EVIDENCE_REVIEWED -> VAKAVITI_VERIFIED -> SUSPENDED/EXPIRED

AI may advance records through DISCOVERED and ENRICHED only. It may prepare evidence for review but may not grant VAKAVITI_VERIFIED.

## Product readiness states
CANDIDATE -> STRUCTURED -> COMMERCIAL_FACTS_PENDING -> BOOKING_PATH_VERIFIED -> DISTRIBUTION_READY -> LIVE -> PAUSED

## Non-negotiable semantics
- operator rating != product rating
- third-party review != Vakaviti verified-traveller review
- list price != discounted price
- per-person price != per-vehicle price
- booking request != confirmed booking
- operator-direct inventory requires evidence of the primary booking relationship
- AI-extracted price is a candidate fact, never canonical until verified

## Google Things to do readiness
The internal model must be capable of producing, after approval and mapping, a Google-ready product feed containing accurate product identity, landing/booking URL, location/POI relationship, price/currency, inventory semantics and official/operator-direct classification only where evidence permits.

Do not mark third-party marketplace inventory as operator-direct merely because the operator is local.

## Initial collection objective
1. Extract/deduplicate existing Book Fiji Tours inventory into candidate entities.
2. Map products to probable operators without asserting ownership until evidenced.
3. Score Western Fiji operators for Founding 100 recruitment.
4. Identify products with transport attachment potential.
5. Human-review top 25 candidates.
6. Recruit 10–20; success is measured by operators receiving completed bookings, not signups.

## Implementation principle
This schema is a canonical identity/evidence layer. Existing transaction systems remain in place until Booking Authority reconciliation explicitly changes them.
