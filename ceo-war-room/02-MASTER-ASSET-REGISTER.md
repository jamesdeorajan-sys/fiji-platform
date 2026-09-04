# MASTER ASSET REGISTER

Status: ACTIVE — RECONCILIATION IN PROGRESS
Last updated: 2026-08-24 (CEO Final First-Party Answers — Natadola and Bula Happiness ownership confirmed; Tour Fiji Tours exclusion noted)

Evidence labels: FACT / CEO DECISION / HYPOTHESIS / OPEN QUESTION.
Do not treat a Git reference as proof that a service is currently live.

| Asset | Role | Platform / host | Git relationship | Production evidence | Commercial role | Proposed tier | Key reconciliation required |
|---|---|---|---|---|---|---|---|
| FijiTourTransfers.com | Tours + transfers marketplace | WordPress / Hostinger | Separate from core Cloudflare app; historical FTT artifacts/docs exist in HQ | FACT: owner confirms live real-time booking platform; public commercial pages exist | Transaction / inventory | A | Payment path, booking states, WP IDs, analytics/GSC/GBP, margins, product catalogue |
| NadiAirportTransfers.com | Airport-transfer acquisition + booking | Cloudflare-oriented estate; exact live resource mapping pending | Related code/docs in HQ | FACT: public route/booking surfaces observed | High-intent transfer acquisition | A | Exact deployed commit/project, booking storage, pricing authority, analytics/GSC/GBP |
| FijiDash.com / book.fijidash.com | Transport marketplace/operations | Cloudflare-oriented; exact live resource mapping pending | FACT: Nadi Marketplace lineage; substantial unique branch history | FACT: owner supplied live booking URL | Operations / fulfilment candidate | A | Exact branch/deployment, DB bindings, production authority, payment/booking boundary |
| ComeToFiji.com | Traveller relationship/discovery | OPEN QUESTION | Referenced by ecosystem; not proven as separately accessible Git repo through current installation | FACT: owner identifies as flagship live/build asset | Discovery / demand / relationship | A candidate | Host/deploy source, analytics/GSC, commercial integrations, canonical entity usage |
| Vakaviti.ai | Knowledge / AI / trust | Cloudflare-oriented ecosystem; exact production mapping pending | Extensive HQ governance/knowledge documents | FACT/HIGH CONFIDENCE strategic asset; live deployment mapping pending | Intelligence / truth | A strategic | Production resources, APIs, knowledge provenance, graph implementation |
| Lagi / lagi.vakaviti.ai | Traveller AI interface | Cloudflare-oriented; exact live mapping pending | Referenced historically in ecosystem | FACT: owner previously supplied live URLs | Intent / conversational demand | A/B candidate | Current deployment, usage, analytics, conversion path, knowledge source |
| Natadola Bay Horse Riding (natadolabayhorseriding.com) | Specialist experience property | CEO_CONFIRMED_OWNED (2026-08-24); WordPress, host TBD | Not in any Git branch checked | FACT: live site inspected 2026-08-24; own booking catalogue + own Nadi-airport-transfer catalogue | Long-tail authority + experience acquisition | B/A candidate | Quarantined: link to CEO_DIRECTED_EXCLUSION identity (tourfijitours.com), unsupported ratings, currency-ambiguous prices, two public WhatsApp group-invite links (CEO_CONFIRMED_INTENTIONAL_PUBLIC_LINKS, 2026-08-24 — not a defect, but not to be copied into Vakaviti or used as its enquiry route). See TRUTH-017/018. |
| Bula Happiness (bulahappiness.com) | Specialist experience property, linked from Natadola | CEO_CONFIRMED_OWNED (2026-08-24); host TBD | Not in any Git branch checked | FACT: linked once from natadolabayhorseriding.com ("Creating Bula Happiness At Natadola"); not independently crawled beyond that link | Unresolved pending strategy reconciliation | Pending — `OWNED_ECOSYSTEM_ASSET` | `DEPENDENCY_ON_EXCLUDED_IDENTITY` (its current booking/deal links point to tourfijitours.com, a CEO_DIRECTED_EXCLUSION) — `DO_NOT_INTEGRATE_UNTIL_STRATEGY_AND_LINK_DESTINATIONS_ARE_RECONCILED`. Do not import its current products, deals, or commercial claims into Vakaviti. Do not modify the live site during the production freeze. |
| fijiboundless repo | Secondary Fiji repository | GitHub | FACT: accessible installed repository | Live role OPEN QUESTION | Unknown | Pending | Inventory contents and relation to production estate |
| V2 architecture | Reference implementation | Git branch/code | FACT: formal architecture decisions and isolated engines found | Not production authority by CEO decision | Engineering reference | Internal | Harvest useful primitives only |
| Standalone Booking API | Reference service boundary | Git branch/code | FACT: separate experiment found | Not production authority by CEO decision | Engineering reference | Internal | Harvest patterns selectively |
| 50+ Fiji-related domains | Distributed acquisition/authority estate | Mixed/unknown | Some referenced in Git; many not yet reconciled | FACT from owner that portfolio exists; individual live status pending | Distribution / authority | A/B/C/D pending | Full domain list, DNS/host, traffic, rankings, revenue, purpose, duplicates |

## Excluded, not an asset (recorded for completeness — not part of the tiered inventory above)

**Tour Fiji Tours / tourfijitours.com / tourfiji.tours** — CEO-confirmed
controlled (tourfijitours.com: `CEO_CONFIRMED_CONTROLLED`) but explicitly
excluded from the active Vakaviti ecosystem by CEO decision
(`CEO_DIRECTED_EXCLUSION` on both domains; tourfiji.tours additionally
`HISTORICAL_OR_LEGACY_REFERENCE_ONLY`). **Control/ownership does not
override the exclusion.** Not listed as a tiered asset above and not to be
included in Vakaviti in any capacity. Full detail in
`04-BRAND-ENTITY-MAP.md`.

## Tier Definitions
- **Tier A — Revenue engine:** proven or high-confidence commercial intent/transactions. Protect and optimise.
- **Tier B — Authority engine:** meaningful niche knowledge, ranking, backlinks or topical authority feeding Tier A.
- **Tier C — Strategic defensive:** worthwhile ownership/indexing but low current investment priority.
- **Tier D — Dormant/duplicate/contaminated:** preserve ownership/history where appropriate; no meaningful spend until evidence changes.

## Required fields before an asset is considered reconciled
- canonical asset ID
- domain/subdomain
- legal/brand/operator relationship
- owner
- production status
- platform/host
- repository + branch/commit where applicable
- deployment/project identifier
- databases/storage
- payments
- booking authority
- fare authority
- analytics
- Search Console
- Google Business Profile relationship
- traffic
- leads/quotes/bookings
- revenue
- contribution evidence
- dependencies
- backup/rollback
- commercial tier
- last verified timestamp
