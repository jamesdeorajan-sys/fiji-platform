# COMMERCIAL TRUTH REGISTER

Status: ACTIVE — READ-ONLY RECONCILIATION
Last updated: 2026-08-15

Purpose: identify facts that must have one authority and prevent cross-surface drift.
No value in this register should be pushed to production until its evidence and authority are verified.

| Truth ID | Subject | Observed representations | State | Risk | Required resolution |
|---|---|---|---|---|---|
| TRUTH-001 | Child-seat price/policy | NAT comparison surface observed as Free; NAT FAQ/booking observed as FJ$8; FTT listing observed as AU$10 | CONFLICT — requires verification | P0 trust/commercial | Determine canonical policy, pricing unit/currency, effective date and source; map all consumers |
| TRUTH-002 | Booking semantics | NAT uses booking-request language while historical KPI language uses confirmed bookings | CONFLICT OF SEMANTICS | P0 measurement | Define canonical lifecycle and event meanings; prevent request from counting as confirmed |
| TRUTH-003 | FTT operator vs marketplace identity | FTT marketplace listings can identify Nadi Airport Transfers as owner/operator | NEEDS ENTITY MAPPING | P1 authority | Establish canonical marketplace, operator, fulfiller and legal-entity relationships |
| TRUTH-004 | Review counts/levels | Marketplace/seller/product review counts may differ | NEEDS SEMANTIC MAPPING | P1 trust | Separate operator rating, seller rating and product rating; preserve source and verified-purchase status |
| TRUTH-005 | Price units | FTT may expose AU$ starting prices while NAT exposes FJ$ vehicle prices | NEEDS SEMANTIC MAPPING | P0 commercial | Identify per-person/per-vehicle/list/discount/currency semantics before comparison or syndication |
| TRUTH-006 | Business trust claims | Ownership, licensing, insurance, years operating and review claims appear on public surfaces | UNVERIFIED IN WAR ROOM | P0/P1 trust | Attach evidence source, verified date, expiry/recheck cadence and authorised wording |
| TRUTH-007 | Route facts | Distance/duration/prices appear on route pages and may exist in multiple code/data stores | DUPLICATION RISK | P1 | Assign canonical route IDs and sources for geo facts and fares |
| TRUTH-008 | Product identity | Similar tours/transfers can exist in WordPress, Git catalogues, ComeToFiji and specialist sites | DUPLICATION RISK | P1 | Establish canonical product/experience IDs and map external/local IDs |

## Required canonical fact envelope
Every governed fact should ultimately support:
- `truth_id`
- `entity_id`
- `field`
- `canonical_value`
- `unit/currency`
- `scope`
- `source`
- `evidence_reference`
- `verified_at`
- `verified_by`
- `effective_from`
- `expires_or_recheck_at`
- `version`
- `consumers`
- `conflict_status`

## Principle
**Facts have one authority. Experiences may have many perspectives.**

Prices, booking states, availability, route identities and operational policies are governed facts. Traveller opinions and experience reports are perspectives and must retain attribution/provenance.
