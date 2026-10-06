# BRAND / ENTITY MAP

Status: ACTIVE — RECONCILIATION IN PROGRESS
Last updated: 2026-08-24 (CEO Final First-Party Answers — Tour Fiji Tours exclusion finalized, Bula Happiness ownership confirmed, Natadola WhatsApp groups confirmed intentional, Square merchant transition recorded)

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

## CEO-Directed Exclusions (added 2026-08-24, CEO Control-Plane Closure Decision; finalized 2026-08-24, CEO Final First-Party Answers)

The following are excluded from the active Vakaviti ecosystem by direct CEO
instruction. This closes the outstanding first-party ownership question —
**control/ownership does not override the exclusion**:

| Excluded entity | Classification |
|---|---|
| tourfijitours.com | `CEO_CONFIRMED_CONTROLLED`, `CEO_DIRECTED_EXCLUSION`, `DO_NOT_INCLUDE_IN_VAKAVITI`, `DO_NOT_IMPORT`, `DO_NOT_LINK_AS_SUPPLY`, `DO_NOT_TREAT_AS_ALIAS`, `DO_NOT_TREAT_AS_PARTNER`, `DO_NOT_TREAT_AS_FULFILMENT_OPERATOR` |
| tourfiji.tours | `CEO_DIRECTED_EXCLUSION`, `HISTORICAL_OR_LEGACY_REFERENCE_ONLY`, `DO_NOT_INCLUDE_IN_VAKAVITI` |
| Tour Fiji Tours (the trading/author identity itself) | `CEO_DIRECTED_EXCLUSION`, `DO_NOT_IMPORT`, `DO_NOT_LINK_AS_VAKAVITI_SUPPLY`, `DO_NOT_TREAT_AS_ALIAS`, `DO_NOT_TREAT_AS_PARTNER`, `DO_NOT_TREAT_AS_FULFILMENT_OPERATOR` |

This is a CEO business decision, made and confirmed with full knowledge
that tourfijitours.com is CEO-controlled — it does not depend on, and is
not overridden by, the separate finding of
`COMMON_ADMINISTRATIVE_CONTROL_EVIDENCED` /
`LEGAL_AND_COMMERCIAL_IDENTITY_UNRESOLVED` regarding fijitourtransfers.com.
Both classifications stand simultaneously: control is confirmed, and the
exclusion applies regardless.

Existing public occurrences (e.g. the `/author/infotourfiji-tours/`
byline appearing on fijitourtransfers.com and natadolabayhorseriding.com,
or Natadola's own links to tourfijitours.com) are preserved as historical
evidence and are NOT to be deleted or edited — the production freeze
applies, and no live site is touched by this decision. Any such existing
reference inside a Vakaviti/Fiji Dash-owned surface (none currently
identified) would be classified
`LEGACY_OR_CONFLICTING_REFERENCE_TO_EXCLUDED_IDENTITY` /
`REMEDIATION_DEFERRED` rather than acted on immediately.

### bulahappiness.com (updated 2026-08-24, CEO Final First-Party Answers)

| Field | Value |
|---|---|
| Ownership | `CEO_CONFIRMED_OWNED` |
| Current status | `OWNED_ECOSYSTEM_ASSET` |
| Dependency | `DEPENDENCY_ON_EXCLUDED_IDENTITY` (its current booking/deal links point to tourfijitours.com, a `CEO_DIRECTED_EXCLUSION`) |
| Integration | `DO_NOT_INTEGRATE_UNTIL_STRATEGY_AND_LINK_DESTINATIONS_ARE_RECONCILED` |

Preserved in `02-MASTER-ASSET-REGISTER.md` as an owned ecosystem asset. Do
not import its current products, deals, or commercial claims into
Vakaviti. Do not modify the live site during the production freeze.

### natadolabayhorseriding.com

Status: `CEO_CONFIRMED_OWNED`.

- Its link to Tour Fiji Tours / tourfijitours.com is preserved as
  historical evidence, not removed (see exclusion above).
- Unsupported or unlinked review ratings remain quarantined (see
  TRUTH-018).
- Currency-ambiguous prices ("$113"/"$400"/"$180" with no currency code)
  remain quarantined (see TRUTH-018).
- **The two public WhatsApp group-invitation links are CEO-confirmed
  intentional** (`CEO_CONFIRMED_INTENTIONAL_PUBLIC_LINKS`, 2026-08-24) —
  **not a defect.** However: do not copy these group links into Vakaviti;
  do not treat them as the Vakaviti enquiry route; Vakaviti must use its
  own attributed one-to-one human sales pathway; do not expose additional
  private contact information beyond what Natadola itself already
  publishes.

## Square Merchant Identity Transition (added 2026-08-24, CEO Final First-Party Answers)

| Field | Value |
|---|---|
| Status | `MERCHANT_IDENTITY_TRANSITION_IN_PROGRESS` |
| Target reconciliation date | `TARGET_RECONCILIATION_DATE = MID_SEPTEMBER_2026` |
| Current final identity | `CURRENT_FINAL_IDENTITY = NOT_YET_CONFIRMED` |

The Square merchant identity behind Fiji Tour Transfers' checkout is
currently being changed, expected updated mid-September 2026. **Until
verified:**
- Do not claim Vakaviti is the legal merchant of record for any
  transaction.
- Do not hard-code a legal entity into Vakaviti.
- Do not change terms, receipts, or structured data based on an
  assumption about the new identity.
- Preserve the existing live checkout as-is during the peak-period freeze
  — no code change to fijitourtransfers.com's checkout is authorized by
  this entry.

**Scheduled control-plane review — mid-September 2026.** See
`05-COMMERCIAL-TRUTH-REGISTER.md` TRUTH-019 for the dated review item and
its 10 required checks (current Square merchant/statement identity; legal
business/person receiving payment; receipt descriptor; terms-and-conditions
identity; refund responsibility; tax/invoice responsibility; currency and
settlement configuration; provider payout responsibility; alignment across
Fiji Tour Transfers, Vakaviti and Square; Commercial Truth Register
update).
