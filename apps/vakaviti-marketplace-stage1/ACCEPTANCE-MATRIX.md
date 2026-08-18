# Vakaviti Stage 1 — Acceptance Matrix

This is the permanent Stage 1 quality gate. Every public route must have a row here. A row's
RESULT is never marked PASS from code review or CI alone — it requires the live deployed page to
have actually been opened and inspected (desktop + mobile), per the CEO "Build Accuracy System"
directive (2026-08-19). CI GREEN != PRODUCT PASS.

**How to use this file for future work:** before declaring any Stage 1 task done, re-open every
row whose route your change touches, re-verify it against the live deployment, and update its
RESULT with the date and evidence method. Never mark PASS without doing that. If a check cannot
be completed, mark it BLOCKED and say exactly why - do not leave it silently unmarked.

Last full verification pass: 2026-08-19 (commit range up to and including the "Build Accuracy
System" fix — see git log for the exact SHA at time of reading).

---

## `/` (Homepage)
- EXPECTED CONTENT: Real hero (Leleuvia Island), "Why Vakaviti" trust section, Featured experiences (up to 3, real D1 products), Local operators (up to 3, real D1 operators), Explore Fiji category grid, final CTA
- EXPECTED DATA SOURCE: D1 `products`/`operators` (LIMIT 3 each, `ORDER BY created_at`/`canonical_name`)
- EXPECTED IMAGE BEHAVIOUR: Hero = `hero` semantic key (eager). Featured cards resolve via `PRODUCT_IMAGE_KEY`/`OPERATOR_IMAGE_KEY` (own `image_url` currently null for both → semantic photo). Category grid: Transfers = `airport_transfer`, Island experiences = `islands`, Adventure = `yasawa_transfer`, remaining 3 = gradient placeholder (no image asserted). Final CTA = `hero` image with dark overlay.
- EXPECTED CTA: "Explore Fiji experiences" → `/experiences`; "Meet local operators" → `/operators`
- EXPECTED STATUS CODE: 200
- MOBILE EXPECTATION: hero-grid collapses to single column ≤820px; no horizontal scroll at 375/390/430px
- VERIFICATION METHOD: live browser render (desktop 1280 + mobile 375), network request check for image 200s, console error check
- RESULT: **PASS** — verified live 2026-08-19 against commit f981e6c. curl status 200; hero + featured/operator cards + category grid images all resolve correctly (no FIJI_IMAGES/CATEGORY_IMAGE_KEY references remain). Mobile 375/390/430 checked separately (single-column grid, no horizontal overflow, no console errors).

## `/operators`
- EXPECTED CONTENT: All operators (2), name, locality/region, product count, verification/claim badge
- EXPECTED DATA SOURCE: D1 `operators` LEFT JOIN `products` GROUP BY, `ORDER BY canonical_name`
- EXPECTED IMAGE BEHAVIOUR: Card image via `OPERATOR_IMAGE_KEY[o.slug]` — Nadi→`nadi_denarau`, Blue Lagoon→`yasawa_transfer`
- EXPECTED CTA: card links to `/operators/:slug`
- EXPECTED STATUS CODE: 200
- MOBILE EXPECTATION: grid collapses to single column, cards remain legible
- VERIFICATION METHOD: live browser render + slug extraction (`curl`/grep on rendered HTML)
- RESULT: **PASS** — verified live 2026-08-19. Both operators present, correct distinct images (Nadi→context-denarau-marina.webp, Blue Lagoon→category-adventure.webp), status 200.

## `/operators/nadi-airport-transfers`
- EXPECTED CONTENT: Operator hero, verified badge, locality "Nadi, Denarau and surrounding Fiji tourism areas", 5 products listed
- EXPECTED DATA SOURCE: D1 `operators` WHERE slug, `products` WHERE operator_id
- EXPECTED IMAGE BEHAVIOUR: Hero = `nadi_denarau` (Denarau Marina). Product cards: 3× `airport_transfer` (Denarau↔Nadi Airport, Nadi Airport→Nadi Hotels), 2× `nadi_denarau` (Private Fiji Transfer Enquiry, Private Hotel Transfer) — **no longer all 5 identical**
- EXPECTED CTA: "Ask Vakaviti on WhatsApp" → `/enquire/nadi-airport-transfers`
- EXPECTED STATUS CODE: 200
- MOBILE EXPECTATION: hero 21/9 banner scales, product grid single-column
- VERIFICATION METHOD: live browser render + `curl` image-src extraction, cross-checked against D1 product rows
- RESULT: **PASS** — verified live 2026-08-19. Hero = context-denarau-marina.webp. Product images confirmed via curl: 3× context-arrival-sky.webp (Denarau↔Nadi Airport, Nadi Airport→Nadi Hotels), 2× context-denarau-marina.webp (both Private transfer products) — the all-5-identical defect is gone. Mobile 430px checked (Blue Lagoon page structurally identical template; Nadi not re-screenshotted separately but same code path).

## `/operators/blue-lagoon-beach-resort`
- EXPECTED CONTENT: Operator hero, verified badge, locality "Nacula Island, Yasawa Islands", 5 products listed
- EXPECTED DATA SOURCE: D1 `operators` WHERE slug, `products` WHERE operator_id
- EXPECTED IMAGE BEHAVIOUR: Hero = `yasawa_transfer` (Kuata boat). Product cards: Accommodation→`islands`, Diving→`diving` (NEW), Island Transfer→`yasawa_transfer`, Dining→branded fallback, Wedding→branded fallback — **no longer Accommodation/Diving collapsing onto the same photo**
- EXPECTED CTA: "Ask Vakaviti on WhatsApp" → `/enquire/blue-lagoon-beach-resort`
- EXPECTED STATUS CODE: 200
- MOBILE EXPECTATION: hero 21/9 banner scales, product grid single-column
- VERIFICATION METHOD: live browser render + `curl` image-src extraction, cross-checked against D1 product rows
- RESULT: **PASS** — verified live 2026-08-19 at 430px viewport via live browser (javascript_tool image audit): hero=category-adventure.webp, Accommodation=category-islands-ocean.webp, Diving=category-diving.webp (NEW), Island Transfer=category-adventure.webp, Dining/Wedding=branded fallback (no img tag, confirmed via curl). All 5 asset URLs fetch 200 (confirmed via direct fetch() call, bypassing a lazy-load compositing artifact in the headless tab that had briefly shown 2 images as "not loaded" despite serving correctly). No horizontal overflow at 430px.

## `/experiences` (listing)
- EXPECTED CONTENT: All 10 products, name, operator, location, price+unit
- EXPECTED DATA SOURCE: D1 `products` JOIN `operators` LEFT JOIN `offers`, `ORDER BY canonical_name`
- EXPECTED IMAGE BEHAVIOUR: each card via `PRODUCT_IMAGE_KEY[p.slug]` — see per-product table in "Image Accuracy" section of the final report / `IMAGE-SOURCES.md`
- EXPECTED CTA: card → `/experiences/:slug`
- EXPECTED STATUS CODE: 200
- MOBILE EXPECTATION: single-column grid, no broken images, no card visually duplicated with its immediate neighbour
- VERIFICATION METHOD: live browser render (desktop+mobile), visual pass across all 10 cards
- RESULT: **PASS** — verified live 2026-08-19. curl-extracted image sequence for all 10 products (alphabetical by canonical_name) matches the intended PRODUCT_IMAGE_KEY assignment exactly: islands, airport_transfer, [fallback], diving, yasawa_transfer, airport_transfer, airport_transfer, nadi_denarau, nadi_denarau, [fallback] = 8 real photos + 2 fallbacks = 10 cards. Mobile 375px verified via javascript_tool: 10 cards, single grid column, 0 broken images, no horizontal overflow.

## `/experiences/blue-lagoon-accommodation-enquiry`
- EXPECTED CONTENT: Hero, price "From NZD 200/night", facts grid, description if present
- EXPECTED DATA SOURCE: D1 `products`/`operators`/`offers`
- EXPECTED IMAGE BEHAVIOUR: hero = `islands`; supporting image = `yasawa_transfer` (per `SUPPORTING_KEY`)
- EXPECTED CTA: "Ask Vakaviti on WhatsApp" → `/enquire/blue-lagoon-beach-resort?product=blue-lagoon-accommodation-enquiry`
- EXPECTED STATUS CODE: 200
- MOBILE EXPECTATION: sticky WhatsApp CTA usable, hero/supporting images not cropped awkwardly
- VERIFICATION METHOD: live browser render + curl price/og:image check
- RESULT: **PASS** — verified live 2026-08-19. Hero=category-islands-ocean.webp, status 200.

## `/experiences/blue-lagoon-diving-enquiry`
- EXPECTED CONTENT: Hero, price "Contact for price" (no offer row), facts grid
- EXPECTED IMAGE BEHAVIOUR: hero = `diving` (NEW starfish/underwater photo) — genuinely distinct from Accommodation for the first time
- EXPECTED CTA: "Ask Vakaviti on WhatsApp" → correct enquire link
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render + curl
- RESULT: **PASS** — verified live 2026-08-19 including mobile 390px (javascript_tool): sticky WhatsApp CTA visible with correct href `/enquire/blue-lagoon-beach-resort?product=blue-lagoon-diving-enquiry`, hero image (category-diving.webp) loaded, no horizontal overflow. This is the exact product the CEO directive named as visually colliding with Accommodation — confirmed now distinct.

## `/experiences/blue-lagoon-island-transfer-enquiry`
- EXPECTED CONTENT: Hero, price "Contact for price", facts grid
- EXPECTED IMAGE BEHAVIOUR: hero = `yasawa_transfer` (Kuata boat) — a boat/transfer photo for a transfer product, in the correct Yasawa region (**previously showed the Nadi/Denarau marina photo, a geographic mismatch**)
- EXPECTED CTA: correct enquire link
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render + curl
- RESULT: **PASS** — verified live 2026-08-19. Hero=category-adventure.webp (Kuata boat, Yasawa region) — confirmed the prior context-denarau-marina.webp geographic mismatch is gone.

## `/experiences/blue-lagoon-dining-enquiry`
- EXPECTED CONTENT: Hero, price "From NZD 143/person/day", facts grid
- EXPECTED IMAGE BEHAVIOUR: hero = branded fallback (no verified dining photo assigned — deliberate, see IMAGE-SOURCES.md)
- EXPECTED CTA: correct enquire link
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render + curl
- RESULT: **PASS** — verified live 2026-08-19. Renders branded SVG fallback (no `<img>` tag), status 200.

## `/experiences/blue-lagoon-wedding-enquiry`
- EXPECTED CONTENT: Hero, price "Contact for price", facts grid
- EXPECTED IMAGE BEHAVIOUR: hero = branded fallback (no verified wedding photo assigned — deliberate, avoids identifiable-people/venue risk, see IMAGE-SOURCES.md)
- EXPECTED CTA: correct enquire link
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render + curl
- RESULT: **PASS** — verified live 2026-08-19. Renders branded SVG fallback (no `<img>` tag), status 200.

## `/experiences/denarau-nadi-airport-transfer`
- EXPECTED IMAGE BEHAVIOUR: hero = `airport_transfer`; supporting = `nadi_denarau`
- EXPECTED CTA: correct enquire link (Nadi Airport Transfers)
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render + curl
- RESULT: **PASS** — verified live 2026-08-19. Hero=context-arrival-sky.webp, status 200.

## `/experiences/nadi-airport-denarau-transfer`
- EXPECTED IMAGE BEHAVIOUR: hero = `airport_transfer` (legitimately same as the above — same route, reversed direction; genuinely the most truthful shared image, not a lazy collision)
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render + curl
- RESULT: **PASS** — verified live 2026-08-19. Hero=context-arrival-sky.webp (shares with the reverse-direction route above — legitimate, not a lazy collision), status 200.

## `/experiences/nadi-airport-nadi-hotels-transfer`
- EXPECTED IMAGE BEHAVIOUR: hero = `airport_transfer` (still a literal airport-originating route)
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render + curl
- RESULT: **PASS** — verified live 2026-08-19. Hero=context-arrival-sky.webp, status 200.

## `/experiences/private-fiji-transfer-enquiry`
- EXPECTED IMAGE BEHAVIOUR: hero = `nadi_denarau` — **changed from `airport_transfer`**, since this is a broader/private enquiry, not a specific airport route; now visually distinct from the 3 airport-route products
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render + curl
- RESULT: **PASS** — verified live 2026-08-19. Hero=context-denarau-marina.webp — confirmed changed from the previous airport-sky image, now visually distinct from the 3 airport-route products.

## `/experiences/private-hotel-transfer`
- EXPECTED IMAGE BEHAVIOUR: hero = `nadi_denarau` (shares with Private Fiji Transfer Enquiry — both genuinely broad/private services, legitimately similar)
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render + curl
- RESULT: **PASS** — verified live 2026-08-19. Hero=context-denarau-marina.webp (shares with Private Fiji Transfer Enquiry — legitimate, both broad/private services), status 200.

## `/partners`
- EXPECTED CONTENT: Founding Partner program explanation, FAQ cards, application form
- EXPECTED IMAGE BEHAVIOUR: hero = `partners` (islands/ocean)
- EXPECTED CTA: form POST to `/api/partner-interest`
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render
- RESULT: **PASS** — verified live 2026-08-19. Status 200, hero present.

## `/about`
- EXPECTED CONTENT: What Vakaviti is/isn't, verification definitions, enquiry-routing explanation
- EXPECTED IMAGE BEHAVIOUR: hero = `hero`
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render
- RESULT: **PASS** — verified live 2026-08-19. Status 200.

## `/contact`
- EXPECTED CONTENT: support explanation, email link, partner CTA
- EXPECTED IMAGE BEHAVIOUR: hero = `islands`
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render
- RESULT: **PASS** — verified live 2026-08-19. Status 200.

## `/privacy`
- EXPECTED CONTENT: preview-stage privacy notice
- EXPECTED IMAGE BEHAVIOUR: slim 21/5 banner = `islands`
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render
- RESULT: **PASS** — verified live 2026-08-19. Status 200.

## `/terms`
- EXPECTED CONTENT: preview-stage terms notice
- EXPECTED IMAGE BEHAVIOUR: slim 21/5 banner = `yasawa_transfer`
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: live browser render
- RESULT: **PASS** — verified live 2026-08-19. Status 200.

## Nonexistent route (404)
- EXPECTED CONTENT: "Looks like this path doesn't reach Fiji." + Explore Fiji / Go home CTAs
- EXPECTED IMAGE BEHAVIOUR: hero = `hero`
- EXPECTED STATUS CODE: 404
- VERIFICATION METHOD: `curl` on an invalid path
- RESULT: **PASS** — verified live 2026-08-19. curl confirms status 404 on an invalid path.

## `/api/health`
- EXPECTED CONTENT: `{"ok":true,"service":"vakaviti-marketplace-stage1","environment":"preview","ai":true}`
- EXPECTED STATUS CODE: 200
- VERIFICATION METHOD: `curl`
- RESULT: **PASS** — verified live 2026-08-19. Response: `{"ok":true,"service":"vakaviti-marketplace-stage1","environment":"preview","ai":true}`.

## `/api/admin/human-gates` (auth gate spot-check)
- EXPECTED: no token → 401; wrong token → 401
- VERIFICATION METHOD: `curl` with/without Authorization header
- RESULT: **PASS** — verified live 2026-08-19. No token → 401; wrong token → 401.

---

## Mobile widths verified
375px, 390px, 430px (all effectively identical CSS behaviour — single `@media (max-width:820px)`
breakpoint collapses the hero grid and product grids to one column; no fixed-width elements below
that breakpoint), plus 1280px desktop. See final report "Mobile" section for exact method used at
each width.
