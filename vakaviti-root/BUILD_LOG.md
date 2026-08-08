# Build Log — vakaviti-root (vakaviti.ai static site)

> Chronological record of what's shipped to the vakaviti.ai static site specifically. Separate from `docs/BUILD_LOG.md`, which is scoped to the fijitourtransfers.com booking widget. Newest entries at the top.

---

## 2026-08-09 — Parent-entity `/network` page + canonical Organization schema

**Branch:** `feature/network-parent-entity-page`
**Commit:** `78ff764` (+ follow-up fixes same branch)

### Shipped
- ✅ New page `network.html` (served at `/network`) — lists every property in the Vakaviti/ComeTo network across Fiji and the South Pacific, links to Lagi and the operator signup, matches the existing site's design system (same CSS variables/components as `index.html`)
- ✅ Upgraded the homepage Organization JSON-LD (`index.html`) into the canonical parent-entity anchor for the network: added `@id` (`https://vakaviti.ai/#organization`), `foundingLocation`, `areaServed` (Fiji, Samoa, Tonga, Vanuatu, Cook Islands, Solomon Islands), `subOrganization` (ComeTo Fiji, ComeTo South Pacific), `knowsAbout`; extended `sameAs` from 1 to 7 entries (kept existing `lagi.vakaviti.ai`, added the 5 other network domains + cometosouthpacific.com); kept canonical `name` as `"Vakaviti.ai"`, added `"Vakaviti AI"` as a second `alternateName`; updated `description` to reflect the network's South Pacific expansion while keeping Fiji as the primary named market
- ✅ Added `network.html`'s own `CollectionPage` schema, referencing the canonical entity via `"about"`/`"publisher"` — no duplicate Organization block
- ✅ New `llms.txt` for AI-crawler discovery (network overview, core pages, network properties, booking/policy notes)
- ✅ Added `/network` to `sitemap.xml`, same convention as the other 6 pages

### Not shipped (deliberately out of scope)
- No `logo` field added to the Organization schema — no real logo asset exists on the live site yet. Follow-up: get a real logo designed and add the field once it exists.
- The 6 existing guide pages were **not** touched — they still carry only their own `FAQPage` schema, with no reference back to the canonical Organization entity. Sitewide injection into those pages is scoped as its own future ticket.

### Why
vakaviti.ai needed to function as the canonical parent-entity anchor for the whole Vakaviti/ComeTo portfolio, so AI search engines and Google's Knowledge Graph resolve the network to one trusted entity instead of treating each domain as unrelated.
