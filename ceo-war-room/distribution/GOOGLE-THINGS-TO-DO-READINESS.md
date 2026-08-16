# GOOGLE THINGS TO DO READINESS

Status: PRE-INTEGRATION READINESS
Date: 2026-08-17
Production effect: NONE

## CEO objective
Prepare Vakaviti/Book Fiji Tours inventory to be technically and commercially clean enough for Google Things to do distribution without prematurely claiming direct/operator-official status.

## Current Google requirements relevant to strategy
- Product information is supplied through a Things to do product feed.
- Google supports free listings and Travel campaigns for tours/activities.
- Google strongly recommends reservation systems representing fewer than 100 operators use an approved connectivity partner rather than direct integration.
- Direct integration requires approval/onboarding and development requirements.
- Official/operator-direct eligibility depends on a legitimate primary booking relationship and landing/booking-page evidence; third-party marketplace inventory generally does not qualify merely because it sells a local operator's product.
- Feed quality and price accuracy matter.

## Phase gates
### Gate A — Internal readiness
- canonical operator IDs
- canonical product IDs
- POI/location mapping
- evidence-backed prices/currencies/units
- explicit seller/booking authority
- stable product landing pages
- booking URLs verified
- cancellation/policy truth
- source provenance
- freshness/recheck process

### Gate B — First network proof
- 10–20 recruited operators
- real bookable products
- completed-booking evidence
- low commercial-truth conflict rate
- measured price accuracy
- reliable landing/booking paths

### Gate C — Connectivity provider
Evaluate approved connectivity providers and select based on API/feed fit, commercial terms, support for operator-direct semantics, reporting and Fiji coverage.

### Gate D — Direct/connectivity-partner evaluation
Only after network scale/quality warrants it, evaluate Google Partner Intake/direct integration or Vakaviti connectivity-partner status.

## Book Fiji Tours implication
Book Fiji Tours is the consumer marketplace surface, not automatically the official site for every underlying operator. Products must carry an explicit relationship type:
- VAKAVITI_MARKETPLACE
- OPERATOR_DIRECT_AUTHORISED
- ATTRACTION_OFFICIAL_AUTHORISED
- OWNED_OPERATED

Only evidence-backed relationship types may map to Google official/operator-direct inventory fields.

## Landing-page standard
Each distribution-ready product needs a stable product-specific or appropriate operator-ticket overview landing page with key commercial information available without forcing the traveller to hunt through unrelated pages.

## Measurement
Track Google referral -> landing -> quote/booking request -> confirmed booking -> completed -> contribution with persistent attribution.

## CEO rule
Google distribution is amplification. Do not amplify inventory whose price, operator identity, booking relationship or landing path is unresolved.
