# Build Log — vakaviti-root (vakaviti.ai static site)

> Chronological record of what's shipped to the vakaviti.ai static site specifically. Separate from `docs/BUILD_LOG.md`, which is scoped to the fijitourtransfers.com booking widget. Newest entries at the top.

---

## 2026-08-09 — Methodology page + AboutPage schema

**Branch:** `feature/methodology-page`
**Commit:** `8c596ca`
**Depends on:** the Organization `@id` (`https://vakaviti.ai/#organization`) established in the `/network` build above — already live in production.

### Shipped
- ✅ New page `methodology.html` (served at `/methodology`) — editorial and verification standards page, matches `network.html`'s design system exactly (same CSS variables/components)
- ✅ New `AboutPage` JSON-LD referencing the canonical Organization via `about`/`publisher` — no duplicate Organization block. `dateModified` set to the real publish date (2026-08-09), not a placeholder
- ✅ Added `/methodology` to `sitemap.xml`, same convention as every other page

### Corrected before shipping — real findings, not assumptions
Two sections of the original draft spec were checked against this repo's actual documented systems and found to overstate real process. Both were rewritten before shipping rather than published as drafted:
- **Operator Verification** — draft claimed an automated compliance system ("zone-manager process") cross-references operator claims against verifiable records, with ongoing re-checks and automatic removal on failure. `vakaviti-zone-manager` is actually a Cloudflare zone/DNS/SSL settings automation Worker (`docs/VAKAVITI-BRAIN.md`, Session 42) — unrelated to operator legitimacy. The real process (Session 55 writeup): operators apply via `join.vakaviti.ai` → `vakaviti-onboard` Worker → D1 `status='pending'` → a human on the team clicks a one-click activation link. Rewritten to describe this honestly as a human review step, not an automated licensing-verification system.
- **Pricing Accuracy** — draft claimed automated, scheduled collection from fuel-linked official sources with a human-approval gate. The real source of truth (`docs/PRICING_MODEL.md`) is a fixed, documented distance-tiered formula, manually updated whenever rates or competitor pricing shift. Rewritten to describe the real, documented-formula process.
- **Who's Behind This** — draft included a placeholder name ("Lipa") not confirmed by James. Corrected to the four confirmed real Fiji-based ops team members: Ben, Emma, Nia, Asilika.

### Not shipped (deliberately out of scope)
- "How we verify this" footer links from other content pages back to `/methodology` — flagged as its own future ticket, not built here.
- The "last reviewed" date is currently set manually on each edit. Whether to auto-pull it from the last-commit date instead is still an open decision — see PR for James's confirmation.

### Why
`/network` established who Vakaviti is; `/methodology` establishes why it should be trusted — the credibility counterpart, targeting the "is this a qualified, checkable source" signal for both human readers and AI citation engines.

---

## 2026-08-09 — Parent-entity `/network` page + canonical Organization schema

**Branch:** `feature/network-parent-entity-page`
**Commits:** `78ff764` (initial build), `5c8f435` (review fixes: description wording, sitemap entry, this log)
**PR:** [#9](https://github.com/jamesdeorajan-sys/fiji-platform/pull/9) — validated clean on schema.org's validator (0 errors, 0 warnings) and visually reviewed on the preview deployment before merge, approved by James

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
