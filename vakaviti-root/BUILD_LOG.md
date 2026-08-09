# Build Log — vakaviti-root (vakaviti.ai static site)

> Chronological record of what's shipped to the vakaviti.ai static site specifically. Separate from `docs/BUILD_LOG.md`, which is scoped to the fijitourtransfers.com booking widget. Newest entries at the top.

---

## 2026-08-09 — New `/partners` recruitment page

**Branch:** `feature/partner-recruitment-page`
**Commit:** `908c233`
**Files:** `vakaviti-root/partners.html` (new), `vakaviti-root/sitemap.xml`

New page recruiting the next five islands (Samoa, Tonga, Vanuatu, Cook Islands, Solomon Islands) — both tour operators and prospective node leads. Reuses `hero-network-map.svg` as the hero visual, matches `network.html`/`methodology.html`'s design system exactly. `ContactPage` JSON-LD referencing the canonical Organization via `about` — no duplicate Organization block.

### Number corrected before shipping, not assumed
The spec said "confirm 29 verified partner operators is still current before using it." Checked `docs/VAKAVITI-BRAIN.md` and `docs/BUILD.md`: a real D1 audit (Session 57) found **30** active partners, explicitly noting "previous sessions carried '29' — use 30 going forward." Used 30, not the spec's draft figure.

### CTA destinations
- **Tour & Transfer Operators** — no new D1 table or Worker built (would need its own stop-and-confirm gate per ground rule 2, out of scope here). Interim: a real form (name, email, island/country — the 5 real islands, no Fiji sub-regions — business type, description) that composes a `mailto:` link to `helpronline@gmail.com` on submit via JS, rather than pretending a backend exists. Verified the URL-encoding logic produces a correctly formed `mailto:` string. Labeled honestly: "Opens your email client... nothing is submitted automatically" — no fake success state.
- **Become a Node Lead** — a direct `mailto:helpronline@gmail.com` inquiry link, not a form (deliberately higher-touch per the spec). **Flagging as a proposal, not a final decision, per the spec's own instruction:** no dedicated node-lead inquiry address exists yet; used the one real, confirmed-monitored address already behind every other partner conversation on this network (`JAMES_EMAIL`/`FROM_EMAIL` in `workers/vakaviti-onboard/worker.js`) rather than inventing a new `@vakaviti.ai` address that might not be provisioned or monitored.

### Cross-branch dependency — flagged, not silently shipped
This page links to `/methodology` twice (methodology reference, team credit). Checked directly: `feature/methodology-page` (commit `8c596ca`) was **never merged to `main`** — confirmed via `git cat-file -e main:vakaviti-root/methodology.html` failing. Both links will 404 in production until that branch also merges. Not fixing this by removing the links (the spec explicitly asks for them, and the content is genuinely on that page) — flagging for James to sequence the merges, or merge both together.

### What was deliberately not claimed
No island beyond Fiji is described as live or active. No fabricated testimonials, booking numbers, or timelines for any island beyond Fiji.

### Verified
- `ContactPage` JSON-LD valid, `about` correctly references `https://vakaviti.ai/#organization`
- Mobile (375px): single-column join-grid, hero map at full viewport width with native 1.870 aspect ratio preserved (no cropping), zero body-level horizontal overflow
- Desktop (1280px): 2-column join-grid
- Operator-interest form's `mailto:` composition logic verified correct (tested with sample field values, confirmed proper URL-encoding)
- Node-lead `mailto:` link verified correctly formed
- `/partners` added to `sitemap.xml`, same convention as every other page

---

## 2026-08-09 — Fixed Tonga label/badge collision on the hero SVG map

**Branch:** `feature/homepage-visual-refresh` (same branch, follow-up commit)
**Commit:** `94bcfef`
**File:** `vakaviti-root/hero-network-map.svg` only

James caught this on live review: Tonga's label was partially obscured by the "VAKAVITI NETWORK HQ" badge beneath the Fiji marker. Verified with a bounding-box script rather than eyeballing a fix — computed each label/marker/badge's approximate glyph box (character-width estimate, cap-height/descender per font-size) and checked every pairwise overlap:

- **Confirmed root cause #1:** Tonga's label (centered at x=470.3, y=362, font-size 30 — "Tonga" has a descending 'g') had a glyph box overlapping the badge rect (`x:[270.5,480.5], y:[316,350]`) by roughly 54×10 units.
- **Confirmed root cause #2, worse than reported:** the script also found the badge's own text, "VAKAVITI NETWORK HQ," overlapping the **Tonga marker circle itself** (~16×13 units) — because the badge is painted after the satellite-markers group in the SVG's document order, it would have visually sat on top of and partially hidden Tonga's marker dot, not just crowded its label.

Fixed both, verified together (not sequentially, since narrowing the badge for reason #2 could have reopened reason #1 or vice versa):
- Moved Tonga's label from y=362 to y=390 — 18.4 units clear below the badge's bottom edge
- Shortened the badge text from "VAKAVITI NETWORK HQ" to "VAKAVITI HQ" and narrowed the badge rect from 210 to 130 units wide (still centered under Fiji) — its right edge now sits 18.8 units clear of Tonga's marker

Re-ran the full pairwise check (7 labels × each other, badge rect × every label, badge rect × every marker, badge text × every marker, every label × every foreign marker) after the fix: zero overlaps anywhere on the map. Since the hero image scales as `width:100%; height:auto` with matching intrinsic dimensions (no distortion), this is a single fix valid at every render width by construction — a viewBox-space collision (or its absence) doesn't change between mobile and desktop, only the pixel scale does.

**Accessibility ask (alt text):** already in place, no change needed. `index.html`'s hero `<img>` already carries `alt="Map of the South Pacific showing Fiji as the Vakaviti network hub, connected by route lines to Samoa, Tonga, Vanuatu, the Cook Islands, and the Solomon Islands"`, added during the original SVG integration — verified present and matching the requested content before reporting this as done rather than assuming.

---

## 2026-08-09 — Removed the redundant "Wider Network" journey-strip section

**Branch:** `feature/homepage-visual-refresh` (same branch, follow-up commit)
**Commit:** `74fd449`

James caught this on live review of the preview: the "THE WIDER NETWORK — One Standard, Across the Pacific" section (a plain circles-and-a-line CSS strip, shipped in the `8ac41ca` entry below as the original spec's optional "simple visual journey" element) duplicated the same fact the new hero SVG map now shows more accurately — Fiji plus the same five satellite islands — just with no hub emphasis, no real projected positions, and plain outline circles instead of labeled markers.

Removed entirely: the `<div class="section-label">The Wider Network</div>` block through the `.journey-strip` `<div>` (`index.html`), plus its CSS (`.network-teaser`, `.journey-strip`, `.journey-stop`, `.journey-dot`, `.journey-label` and their `.is-live` variants).

**Supporting evidence for the removal, not the sole reason:** the strip's markup did list all 6 islands correctly (verified directly against the committed HTML — `Fiji, Samoa, Tonga, Vanuatu, Cook Islands, Solomon Islands` were all present in the DOM). What James saw as only 4 visible was consistent with the stale-preview issue investigated separately (an old commit-specific Cloudflare Pages URL, not the branch tip) — worth correcting for the record, since the real reason for removal is redundancy against the more accurate hero map, not a missing-island bug in the strip itself.

**"See the full network" link:** not lost. `index.html`'s footer already links to `/network` independently (`<a href="/network">The Network</a>`, present since the original `/network` build) — no replacement link needed.

### Verified
- `.journey-strip` and all related CSS confirmed gone from the DOM/stylesheet
- Footer `/network` link confirmed still present
- Hero SVG and all 6 guide-card Unsplash images confirmed unaffected
- Organization JSON-LD re-confirmed byte-identical to `main`

---

## 2026-08-09 — Hero replaced with a custom SVG network map

**Branch:** `feature/homepage-visual-refresh` (same branch, follow-up commit to the homepage visual refresh below)
**Commit:** `da973a7`
**Files:** `vakaviti-root/hero-network-map.svg` (new), `vakaviti-root/index.html` (hero markup + CSS), `vakaviti-root/images.js` (hero entry removed — no longer applicable)

James decided the hero should be a custom SVG map of the South Pacific — Fiji as the network hub with routes radiating to the five satellite islands — instead of the Unsplash lagoon photo shipped in the entry below. Reviewed and approved as a standalone graphic before integration, per his explicit request.

### Coordinate / projection methodology
Real approximate capital/main-hub coordinates were used, not decorative placement:

| Island | Reference point | Lat | Lon |
|---|---|---|---|
| Fiji | Suva | 18.14°S | 178.44°E |
| Vanuatu | Port Vila | 17.73°S | 168.32°E |
| Solomon Islands | Honiara | 9.43°S | 159.95°E |
| Tonga | Nuku'alofa | 21.14°S | 175.20°W |
| Samoa | Apia | 13.83°S | 171.76°W |
| Cook Islands | Rarotonga | 21.21°S | 159.78°W |

This cluster straddles the International Date Line, so longitude was **unwrapped** before projecting (the three western-hemisphere islands had 360° added to their longitude — e.g. Tonga's -175.20° became 184.80°) so the whole group plots as one continuous band instead of splitting across the ±180° seam. Both axes then use **one uniform scale** (degrees-of-longitude adjusted by cos(mean latitude) to correct for meridian convergence at this latitude, same px-per-degree as the latitude axis) — so relative distances and directions stay geographically honest rather than being stretched to fit a nicer shape. James explicitly confirmed to leave the resulting layout as-is even where it produces visually close lines (Solomon Islands/Vanuatu run near-parallel from Fiji, because they genuinely are close together relative to the other three) — accuracy over tidiness.

### Why it's a stacked block, not a `background-image` (a real adaptation, flagging it)
The original homepage refresh (entry below) used a full-bleed `background-size: cover` photo with a heavy dark scrim so white headline text stayed legible over arbitrary tropical photography. That treatment is actively wrong for a labeled informational graphic: `cover` **crops** whatever doesn't fit the container's aspect ratio, which for a mobile portrait-ish hero would have sliced off the map's leftmost/rightmost content — i.e. Solomon Islands and Cook Islands, the two edge markers, could have disappeared entirely on a phone. And a heavy scrim strong enough for photo-text legibility would dim the map's own labels enough to defeat the entire point of building it.

Fixed by restructuring the hero into two stacked (non-overlapping) blocks: the headline/CTA text first, then the map as a full-width `<img>` below it using natural `height: auto` (not `object-fit` or `background-size` tricks) — this makes zero cropping a mathematical guarantee of the layout, not something that needs runtime verification, and the map is never dimmed by anything since nothing sits on top of it. Capped at `max-width: 1100px` centered so it doesn't become absurdly tall on very wide desktop screens.

### Verified
- SVG structurally checked: 6 markers present (5 satellite circles + Fiji hub), 7 text labels (5 islands + "FIJI" + "VAKAVITI NETWORK HQ")
- Organization JSON-LD in `index.html`'s `<head>` re-confirmed byte-identical to `main`
- At 375px: image renders at full viewport width (375px), height auto-scales to preserve the SVG's native 1.87:1 aspect ratio exactly (rendered aspect 1.870 vs. native 1.867) — confirms the complete map, not a cropped portion, is what's visible
- At 1280px: image caps at 1100px max-width, centered, aspect ratio still preserved
- All 6 guide-card Unsplash images confirmed still loading and unaffected — only the hero's image source changed
- Zero console errors at either width

### Known gap
Full-page visual screenshots weren't possible this session (Browser pane screenshot tool broken all session — confirmed via repeated retries and no local headless-browser fallback available in this environment). The SVG graphic itself *was* visually rendered and reviewed by James via the `show_widget` preview tool before integration; the page-level integration was verified via computed styles, DOM structure, and native/rendered aspect-ratio comparison instead of a literal screenshot. Recommend a manual look at the preview URL before merge.

---

## 2026-08-09 — Homepage visual refresh (mobile-first, photography-led)

**Branch:** `feature/homepage-visual-refresh`
**Commit:** `8ac41ca`
**Does not touch:** `/network`, `/methodology`, or the Organization JSON-LD in `index.html`'s `<head>` — confirmed byte-identical to `main` before and after this build.

### ⚠️ PLACEHOLDER IMAGERY — NOT A FINISHED STATE
Every photo on the homepage is a real, properly-licensed Unsplash photo (sourced via Unsplash's site, not scraped from fiji.travel or anywhere else, each one individually verified for license/attribution via its own photo page metadata) — but these are **placeholders pending real partner/operator photography**, per James's explicit decision. Follow-up task: replace every entry in `vakaviti-root/images.js` with real photos once available. Photo credits:
- ~~Hero — "Overwater bungalows and turquoise lagoon in Nadi, Fiji," Irvin Liang (@il07)~~ **SUPERSEDED same day** — the hero is now a custom SVG network map, not a photo. See the entry above this one.
- Nadi Airport Transfers card — Hieu (@thehncreative) *(generic airport/plane photo — no literal Nadi airport photo exists on Unsplash; not claimed as Nadi in the alt text)*
- Where to Stay card — "Beachfront resort bungalow in Fiji," Josaia Cakacaka (@joecakacaka)
- Horse Riding card — Carolin Thiergart (@carolinthiergart) *(Zeeland, Netherlands — generic illustrative photo, no false Fiji claim in alt text)*
- Visa, Entry & Money card — "Passport and travel documents," Spencer Davis (@spencerdavis)
- Culture, Kava & Language card — "Coastal village scene in Fiji," Savir C (@savir21)
- Weather & Best Time card — "Beach sunset in Nadi, Fiji," Timothy Ah Koy (@timothyfiji)

All references live in one file, `vakaviti-root/images.js` — swapping in a real photo later means replacing one `url`/`alt`/`credit` per key, no markup changes needed.

### Shipped
- ✅ New `vakaviti-root/images.js` — centralized image config (see above) — guide-card photography only; the hero's image was superseded same day, see entry above
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
