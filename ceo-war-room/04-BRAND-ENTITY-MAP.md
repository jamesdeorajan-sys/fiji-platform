# BRAND / ENTITY MAP

Status: ACTIVE — RECONCILIATION IN PROGRESS
Last updated: 2026-08-15

Purpose: define how brands, marketplaces, operators, legal entities and technology systems relate so travellers, Google and AI systems receive one coherent explanation.

## Current CEO direction

| Brand/System | Proposed role | Must NOT be confused with | Evidence state |
|---|---|---|---|
| Vakaviti | Knowledge, verification, AI reasoning and trust infrastructure | Consumer booking marketplace or operator of every listed service | CEO DECISION |
| ComeToFiji | Traveller relationship, discovery, planning and demand orchestration | Transport fulfilment engine | CEO DECISION |
| Fiji Tour Transfers | Live tours + transfers commercial marketplace / transaction surface | Vakaviti itself | FACT + CEO DECISION |
| Nadi Airport Transfers | High-intent airport-transfer acquisition/commercial surface | Parent identity for every ecosystem property | CEO DECISION |
| Fiji Dash | Transport marketplace / driver / dispatch / fulfilment backbone candidate | Consumer content/knowledge authority | FACT lineage + CEO DECISION |
| Lagi | Conversational traveller interface / intent capture | Source of commercial truth | CEO DECISION |
| Specialist Fiji domains | Topic/destination/activity authority and acquisition nodes | Independent conflicting product/fare authorities | CEO DECISION |

## Relationship Model — Current Hypothesis

Vakaviti
→ supplies governed knowledge/trust/AI capabilities

ComeToFiji
→ owns broad traveller journey/discovery relationship
→ routes commercial intent to canonical products/transactions

Fiji Tour Transfers
→ sells tours/transfers and may host marketplace inventory

Nadi Airport Transfers
→ captures airport-transfer demand and directs it into canonical fare/booking flow

Fiji Dash
→ fulfils/dispatches transport and manages operational supply

Specialist domains
→ attract high-intent/topic-specific demand and reinforce canonical entities

## Mandatory Entity Questions Before Structured-Data Expansion
1. What legal entity or entities own/operate each brand?
2. Which entity holds relevant licences/insurance?
3. Which entity owns each Google Business Profile?
4. Which brand is seller of record for each product?
5. Which operator fulfils each product?
6. Which system is marketplace/publisher vs operator vs technology provider?
7. Which phone, email, address and social profiles are canonical per entity?
8. Which review corpus belongs to which entity/product?
9. Which brand names are aliases, DBAs or separate businesses?
10. Which relationships can be expressed safely through Organization/LocalBusiness/Service/Product structured data without overstating ownership or affiliation?

## Canonical Entity Record — target fields
- `entity_id`
- legal_name
- trading_names / aliases
- entity_type
- registration identifiers where appropriate
- licences/insurance evidence references
- canonical domain(s)
- canonical contact channels
- operating geography
- marketplace roles
- operator roles
- technology-provider roles
- parent/sub-organization relationships only where factually correct
- Google Business Profile IDs/URLs where available
- social profiles
- review sources
- evidence/provenance
- verified_at

## Rule
Do not use `sameAs`, parent/subOrganization or marketplace/operator structured-data relationships simply to create SEO association. Relationships must reflect verifiable real-world identity.
