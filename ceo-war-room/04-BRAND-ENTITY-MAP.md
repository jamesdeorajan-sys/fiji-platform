# BRAND / ENTITY MAP

Status: ACTIVE — RECONCILIATION IN PROGRESS
Last updated: 2026-08-24 (added CEO-directed exclusions: Tour Fiji Tours / tourfijitours.com / tourfiji.tours; bulahappiness.com and Natadola classifications)

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

## CEO-Directed Exclusions (added 2026-08-24, CEO Control-Plane Closure Decision)

The following are excluded from the active Vakaviti ecosystem by direct CEO
instruction, independent of and prior to any further identity
reconciliation:

| Excluded entity | Classification |
|---|---|
| Tour Fiji Tours | `CEO_DIRECTED_EXCLUSION` |
| tourfijitours.com | `CEO_DIRECTED_EXCLUSION` |
| tourfiji.tours | `CEO_DIRECTED_EXCLUSION` |

Each carries all of: `DO_NOT_IMPORT`, `DO_NOT_LINK_AS_VAKAVITI_SUPPLY`,
`DO_NOT_TREAT_AS_ALIAS`, `DO_NOT_TREAT_AS_PARTNER`,
`DO_NOT_TREAT_AS_FULFILMENT_OPERATOR`. This is a CEO business decision, not
a finding about whether these domains are legally the same entity as
fijitourtransfers.com — the `COMMON_ADMINISTRATIVE_CONTROL_EVIDENCED` /
`LEGAL_AND_COMMERCIAL_IDENTITY_UNRESOLVED` classification on that separate
question is unchanged and unresolved. The exclusion applies regardless of
how that question is eventually answered.

Existing public occurrences (e.g. the `/author/infotourfiji-tours/`
byline appearing on fijitourtransfers.com and natadolabayhorseriding.com,
or Natadola's own links to tourfijitours.com) are preserved as historical
evidence and are NOT to be deleted or edited — the production freeze
applies, and no live site is touched by this decision. Any such existing
reference inside a Vakaviti/Fiji Dash-owned surface (none currently
identified) would be classified
`LEGACY_OR_CONFLICTING_REFERENCE_TO_EXCLUDED_IDENTITY` /
`REMEDIATION_DEFERRED` rather than acted on immediately.

### bulahappiness.com

| Field | Value |
|---|---|
| Ownership | `OWNERSHIP_NEEDS_CEO_CONFIRMATION` |
| Dependency | `DEPENDENCY_ON_EXCLUDED_IDENTITY` (its booking/deal links point to tourfijitours.com) |
| Integration | `DO_NOT_INTEGRATE` |

No product, offer, or claim from bulahappiness.com may be imported into
Vakaviti while this classification stands.

### natadolabayhorseriding.com

Status: `CEO_CONFIRMED_OWNED`.

Quarantined pending further evidence (site not modified):
- Its links to Tour Fiji Tours / tourfijitours.com (see exclusion above —
  the link itself is preserved as historical evidence, not removed).
- Unsupported or unlinked review ratings (see TRUTH-018).
- Currency-ambiguous prices ("$113"/"$400"/"$180" with no currency code,
  see TRUTH-018).
- The two public WhatsApp group-invitation links (see TRUTH-017) — pending
  CEO confirmation of whether these are intended to be public.
