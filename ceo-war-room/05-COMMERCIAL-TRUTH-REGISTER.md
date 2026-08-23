# COMMERCIAL TRUTH REGISTER

Status: **CONTROL PLANE READY — COMMERCIAL CLAIMS QUARANTINED — VAKAVITI SUPPLY PHASE MAY PROCEED**
Last updated: 2026-08-24 (CEO Control-Plane Closure Decision — CEO-directed exclusions applied; phase closed)

## CEO Control-Plane Closure Decision (2026-08-24)

The control-plane and revenue-link-graph phase is accepted as substantially
complete. Per direct CEO instruction, **Tour Fiji Tours, tourfijitours.com,
and tourfiji.tours are excluded from the active Vakaviti ecosystem** —
`CEO_DIRECTED_EXCLUSION` / `DO_NOT_IMPORT` / `DO_NOT_LINK_AS_VAKAVITI_SUPPLY`
/ `DO_NOT_TREAT_AS_ALIAS` / `DO_NOT_TREAT_AS_PARTNER` /
`DO_NOT_TREAT_AS_FULFILMENT_OPERATOR` (full detail in
`04-BRAND-ENTITY-MAP.md`). This is a business decision, independent of the
unresolved `LEGAL_AND_COMMERCIAL_IDENTITY_UNRESOLVED` question below.

**Unreconciled commercial claims below block only those individual claims
and records.** They do NOT block independent Vakaviti supply research,
evidence-backed provider/product candidates, qualifying source-evidenced
deals, mobile/UX preparation, or search-readiness preparation. This
register does not gate the Vakaviti supply activation phase — it gates
only the specific quarantined facts listed in the table.

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
| TRUTH-009 | fijitourtransfers.com business address | Footer text shows 'Nausori, Fiji' and, elsewhere, '113 Rouse Rd, Rouse Hill NSW 2155, Australia'; the same page's own JSON-LD Organization/Place block shows street number '74', postcode NSW 2763 (Riverstone) — three mutually inconsistent values for one Organization | QUARANTINED — CONTRADICTORY, directly observed 2026-08-23 | P1 trust | Obtain the single correct registered/operating address from a first-party source before any address fact from this domain is treated as canonical anywhere, including Vakaviti |
| TRUTH-010 | fijitourtransfers.com currency semantics | Visible product pricing shown exclusively in AU$ on every listing checked; the same pages' structured data (`currenciesAccepted`) claims "FJD, AUD, NZD, USD" | QUARANTINED — CONTRADICTORY, directly observed 2026-08-23 | P0 commercial | Confirm which currencies are actually accepted at checkout before any FTT price is compared, converted, or displayed alongside Vakaviti/NAT prices |
| TRUTH-011 | fijitourtransfers.com discount badges | Per-tour "-X%" badges (e.g. -60% on Natadola Beach Combinational Horse Riding, AU$250 struck through to "From AU$100") with no visible or structured `validFrom`/`validThrough` and no price-history evidence | QUARANTINED — NEEDS_SOURCE | P1 trust | Confirm the struck-through price was ever a real transacted/listed price, not an anchor set alongside the sale price from day one, before treating any FTT "from" price as canonical |
| TRUTH-012 | fijitourtransfers.com per-product review counts | Individual product pages display specific star ratings and review counts (e.g. "4.9 (7 Reviews)") with no link to, or corroboration from, an independent review platform (Google, TripAdvisor) | QUARANTINED — NEEDS_SOURCE | P1 trust | Verify counts against an independent review source before importing any rating/review figure from this domain |
| TRUTH-013 | fijitourtransfers.com licensing/superlative claims | Homepage states "Licensed Local Guides" with no licence number or issuing authority shown; TravelAgency structured data claims "Fiji's largest tour and transfer booking platform... Zero commission... Direct Fijian operator pricing... Free hotel transfers included with every tour" with no supporting evidence on-page | QUARANTINED — NEEDS_SOURCE, overlaps TRUTH-006 | P0/P1 trust | Do not repeat, syndicate, or imply endorsement of any licensing or superlative claim from this domain until an evidence source is attached |
| TRUTH-014 | fijitourtransfers.com mixed-itinerary product page (Jewels of Fiji tour) | The same product page's "Included/Excluded" copy describes a boat ride, waterfall swim, bamboo rafting, village visit and buffet lunch, while its own FAQ block on the identical page describes a different itinerary (Nadi Town market, Garden of the Sleeping Giant, Sigatoka Sand Dunes, Beqa Island firewalking, Navua River canoe tour, Mamanuca snorkelling) | QUARANTINED — CONTRADICTORY, directly observed 2026-08-23, live checkout active on this page (WooCommerce+Square) | P0 trust/commercial | Determine which itinerary (if either, as written) is the real product before this page's content is treated as a source of fact anywhere; likely a templating/content-population defect, not assessed here as intentional |
| TRUTH-015 | fijitourtransfers.com product-page structured-data price conflict | The Jewels of Fiji product page carries two different Offer prices in its own JSON-LD: a Service block at AUD 155 (duplicated ~14 times, a templating artifact) and a Product block at AUD 259 (matching the visible price, but branded "Tour Fiji" with URLs on tourstransfers.hostmejames.online / tourfiji.tours, not fijitourtransfers.com) | QUARANTINED — CONTRADICTORY, directly observed 2026-08-24 | P1 trust | Do not treat either structured-data price as authoritative independent of the visible page price; resolve which template/plugin is producing the duplicate blocks |
| TRUTH-016 | ComeToFiji.com repeats FTT's unverified commercial claim | ComeToFiji's own Organization structured data states it is "funneling tour and transfer bookings to Fiji Tour Transfers - zero commission, direct Fijian operator pricing" - repeating fijitourtransfers.com's own unverified TRUTH-013 claim as ComeToFiji's own structured fact | QUARANTINED — NEEDS_SOURCE, directly observed 2026-08-24 | P1 trust | Do not treat "zero commission" as verified anywhere in the ecosystem, including on ComeToFiji, until first-party evidence is supplied |
| TRUTH-017 | natadolabayhorseriding.com public WhatsApp group invite links | Two distinct `chat.whatsapp.com` GROUP invite links (not 1:1 contact links) are exposed directly in site navigation, alongside the usual `wa.me` contact number | QUARANTINED — UNKNOWN risk, directly observed 2026-08-24 | P1 trust/privacy | Confirm whether these are intended to be public before treating them as an authorized/managed customer channel; a public group-invite link lets anyone join and see other members, unlike a 1:1 `wa.me` link |
| TRUTH-018 | natadolabayhorseriding.com repeated reviews and price-currency ambiguity | The same two customer reviews appear verbatim, repeated 3 times each, in the page's own review carousel; displayed tour prices ($113, $400, $180) show no currency code or symbol beyond a bare "$" | QUARANTINED — NEEDS_SOURCE, directly observed 2026-08-24 | P1 trust | Do not import review counts or "$" prices from this domain until review authenticity and currency are independently confirmed |

## Note on TRUTH-009 through TRUTH-018 (added 2026-08-24, extended 2026-08-24 CEO Final Reconciliation)

TRUTH-009 through TRUTH-015 were added following a read-only inspection of fijitourtransfers.com.
TRUTH-016 through TRUTH-018 were added following read-only inspection of cometofiji.com and
natadolabayhorseriding.com per the CEO Final Reconciliation directive. All describe the current
state of **third-party-operated, publicly reachable pages** as observed. No claim is made here
about intent, and no legal or reputational conclusion is drawn — the register's job is only to
prevent an unverified external fact from silently becoming a Vakaviti-side fact. **None of
TRUTH-009 through TRUTH-018 may be imported into Vakaviti (as displayed content, structured data,
or comparison data) until reconciled per the canonical fact envelope below.** Separately, see
`04-BRAND-ENTITY-MAP.md` and the `REVENUE_LINK_REGISTRY.json` `entity_identity_findings` section
for the related — and explicitly distinct — question of *who controls* these domains: that
evidence supports `COMMON_ADMINISTRATIVE_CONTROL_EVIDENCED` only, never
`LEGAL_AND_COMMERCIAL_IDENTITY_UNRESOLVED`'s resolution, and is not a finding about the truth or
falsity of any domain's own commercial claims.

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
