# Build Log — vakaviti-root (vakaviti.ai static site)

> Chronological record of what's shipped to the vakaviti.ai static site specifically. Separate from `docs/BUILD_LOG.md`, which is scoped to the fijitourtransfers.com booking widget. Newest entries at the top.

---

## 2026-08-09 — Homepage visual refresh (mobile-first, photography-led)

**Branch:** `feature/homepage-visual-refresh`
**Commit:** (pending)
**Does not touch:** `/network`, `/methodology`, or the Organization JSON-LD in `index.html`'s `<head>` — confirmed byte-identical to `main` before and after this build.

### ⚠️ PLACEHOLDER IMAGERY — NOT A FINISHED STATE
Every photo on the homepage is a real, properly-licensed Unsplash photo (sourced via Unsplash's site, not scraped from fiji.travel or anywhere else, each one individually verified for license/attribution via its own photo page metadata) — but these are **placeholders pending real partner/operator photography**, per James's explicit decision. Follow-up task: replace every entry in `vakaviti-root/images.js` with real photos once available. Photo credits:
- Hero — "Overwater bungalows and turquoise lagoon in Nadi, Fiji," Irvin Liang (@il07)
- Nadi Airport Transfers card — Hieu (@thehncreative) *(generic airport/plane photo — no literal Nadi airport photo exists on Unsplash; not claimed as Nadi in the alt text)*
- Where to Stay card — "Beachfront resort bungalow in Fiji," Josaia Cakacaka (@joecakacaka)
- Horse Riding card — Carolin Thiergart (@carolinthiergart) *(Zeeland, Netherlands — generic illustrative photo, no false Fiji claim in alt text)*
- Visa, Entry & Money card — "Passport and travel documents," Spencer Davis (@spencerdavis)
- Culture, Kava & Language card — "Coastal village scene in Fiji," Savir C (@savir21)
- Weather & Best Time card — "Beach sunset in Nadi, Fiji," Timothy Ah Koy (@timothyfiji)

All references live in one file, `vakaviti-root/images.js` — swapping in a real photo later means replacing one `url`/`alt`/`credit` per key, no markup changes needed.

### Shipped
- ✅ New `vakaviti-root/images.js` — centralized image config (see above)
- ✅ Full-bleed photography hero with dark-teal gradient overlay (keeps brand palette legible over any photo), same serif headline treatment and CTA colors as before
- ✅ Guide card grid upgraded with real card images + location tag pills, same 6 existing guides
- ✅ New "Explore by Interest" section — filterable (All/Culture/Adventure/Practical) horizontally-swipeable carousel, reusing the same 6 guides under interest framing rather than inventing new content (site only has 6 pieces of guide content; a literal "Food & Drink" category from the original fiji.travel-inspired brief was dropped rather than faked, since no such guide exists)
- ✅ New schematic "network reach" journey strip (Fiji → Samoa → Tonga → Vanuatu → Cook Islands → Solomon Islands) — CSS only, no map imagery, linking to `/network`
- ✅ Rebuilt hero/grid/carousel CSS mobile-first: base styles are phone-sized, `min-width` media queries scale up to tablet/desktop (previous pattern was desktop-first with a `max-width` override — flagged and corrected per this spec's explicit requirement)
- ✅ Touch targets: all buttons/tabs ≥40px, primary CTAs 48px min-height
- ✅ Verified via computed-style + functional checks at 375px, 390px, and 1280px: single-column grid → 3-column, stacked hero CTAs → row, carousel `scrollWidth` > `clientWidth` (confirms real horizontal scroll), filter click correctly shows/hides tagged cards, all 7 images load (200, non-broken), zero console errors, zero unwanted body-level horizontal overflow at 375px

### Known gap this session
Screenshot capture was broken in this session's Browser pane tooling (pane not compositing frames, confirmed via repeated retries across fresh tabs — an environment issue, not a content issue). Verification was done via computed styles, network requests, and DOM inspection instead of visual screenshots. Recommend a quick manual look at the preview URL before merge.

### Why
`/network` established who Vakaviti is, `/methodology` established why it should be trusted; this pass makes the homepage itself look and feel like a real, considered product rather than a plain-HTML placeholder — borrowing proven mobile travel-site UX patterns (photography hero, card grid, filterable carousel) while keeping Vakaviti's own dark-teal/serif/green identity distinct from the sites it borrowed structure from.

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
