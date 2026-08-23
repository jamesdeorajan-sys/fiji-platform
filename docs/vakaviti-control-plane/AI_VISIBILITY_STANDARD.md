# AI Visibility Standard

Applies to every indexable provider, product, or deal page across the
ecosystem (Vakaviti, Fiji Tour Transfers, Nadi Airport Transfers, ComeToFiji,
and all microsites). Written against real defects found during this
addendum's `fijitourtransfers.com` audit — each requirement below exists
because a violation of it was directly observed.

## Requirements

1. **Unique canonical URL.** Every page self-references its own canonical
   tag. *(Confirmed correctly implemented on the one FTT product page
   checked; confirmed MISSING on nadiairporttransfers.com's homepage — see
   `REVENUE_LINK_REGISTRY.json` NAT-CTA-001.)*
2. **Server-rendered factual content.** Price, availability, and structured
   data must be present in the initial HTML response, not injected only by
   client-side JavaScript after load.
3. **Single clear H1** per page.
4. **Title and description based on supported facts only** — no superlative
   claims ("largest," "best") without a cited source.
5. **Structured data limited to what's supported**: `Organization`,
   `LocalBusiness`, `Product`, `Offer`, `BreadcrumbList` only where the
   underlying fact is real and verifiable. Do not add `AggregateRating`,
   `Review`, or licensing/certification schema without an evidence
   reference.
6. **Visible content must match structured data, exactly.** *(Directly
   violated today: fijitourtransfers.com's structured data claims
   `currenciesAccepted: "FJD, AUD, NZD, USD"` while every visible price on
   every page checked shows AUD only.)*
7. **Current price and currency** shown in both the visible UI and any
   `Offer`/`Product` structured data, and they must agree.
8. **`validFrom`/`validThrough`** stated wherever a time-limited price or
   discount is shown. *(Currently absent on FTT's discount badges — no
   expiry is shown or encoded anywhere for any "-X%" badge observed.)*
9. **Availability state** (`InStock`/`SoldOut`/`PreOrder` or an honest
   equivalent) reflecting a real, checked condition — never a default
   "always available" placeholder presented as fact.
10. **Region/locality relationships** correctly scoped (`areaServed`,
    `address`) and internally consistent. *(Directly violated today: three
    different postal addresses for the same `Organization` across one
    site's own footer and structured data.)*
11. **Official provider/source relationship** stated only where real — never
    a `sameAs`/parent-organization link asserted for SEO benefit alone (this
    exact rule already exists in `ceo-war-room/04-BRAND-ENTITY-MAP.md` and
    is restated here for the page-level standard).
12. **Last-checked timestamp** visible or embedded wherever a fact could go
    stale (price, availability, contact details).
13. **Meaningful internal links** — a product page should link to its real
    parent category/location page and back, not only to generic navigation.
14. **Sitemap inclusion** for every indexable page, and the sitemap itself
    must be reachable and correctly formed. *(Confirmed correct on
    nadiairporttransfers.com's sitemap.xml in E3E — 23 URLs, matching the
    live page count exactly. Confirmed BROKEN on that same domain's
    `robots.txt`, which returns the homepage instead of a robots file — see
    E3E Phase 4.)*
15. **Mobile performance** — no horizontal overflow, functional layout at
    320–414px, verified live (established methodology, see E3B–E3D mobile
    QA passes on the proposed Nadi rebuild).
16. **No fabricated reviews, ratings, discounts, or scarcity claims.**
    *(Multiple live violations found on fijitourtransfers.com this pass —
    see `ftt_evidence_reconciliation` in the registry: unsourced discount
    percentages, unsourced per-product review counts, an unsourced "Fiji's
    largest" superlative.)*
17. **No unsupported "AI recommended," safety, insurance, or verification
    claims.** *(Matches existing `ceo-war-room/05-COMMERCIAL-TRUTH-REGISTER.md`
    TRUTH-006 exactly — "Licensed Local Guides" on fijitourtransfers.com is
    exactly this category of claim, currently unsupported.)*

## How this standard is meant to be used

This is a checklist for any page *before* it is published or updated, and a
re-check list for any existing page being brought into the Vakaviti-governed
graph. It does not, by itself, authorize importing any fact from
`fijitourtransfers.com` or any other external site into Vakaviti's own
structured data — that import decision is separate and requires the source
evidence to clear `NEEDS_SOURCE`/`CONTRADICTORY` status first (see the
Commercial Truth Register's existing evidence-envelope requirement).
