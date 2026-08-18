# Vakaviti Stage 1 — Image Source Record

Every real photograph used on the Stage 1 marketplace is recorded here: local filename, original
source, photographer, license, retrieval date and intended use. No API tokens or secrets are
recorded in this file. Generated/original assets (favicon, SVG fallbacks) are not third-party
sourced and are not listed here — only downloaded third-party photography.

Every image below was verified by opening its actual Unsplash source page (not trusting search
result grouping) and confirming both the stated location and the license line on that page before
downloading.

---

## `hero-fiji-leleuvia.webp`
- Source: Unsplash
- Photographer: Josaia Cakacaka ([@joecakacaka](https://unsplash.com/@joecakacaka))
- Original page: https://unsplash.com/photos/aerial-view-of-green-trees-beside-body-of-water-during-daytime-ax_K7Ts1k9E
- Location confirmed on source page: Leleuvia Island, Fiji (photographer's caption: "Leleuvia Island, Fiji. My homeland")
- License: Unsplash License (free to use, commercial and non-commercial, no permission required) — confirmed present on source page
- Retrieved: 2026-08-18
- Use: Homepage hero, base image for the composited Open Graph share image
- Processing: resized to 1800px wide, converted to WebP (quality 82)

## `og-image.jpg`
- Derived from: `hero-fiji-leleuvia.webp` (same source/license/photographer as above)
- Processing: cropped to 1200×630 (standard OG image ratio), dark gradient overlay added for text legibility, composited with "Vakaviti" wordmark and tagline "Real Fiji. Local operators. Direct connection." (Vakaviti's own text, not part of the original photo)
- Use: `og:image` for social/WhatsApp/Facebook share previews

## `category-islands-ocean.webp`
- Source: Unsplash
- Photographer: Max ([@imcolourblind](https://unsplash.com/@imcolourblind))
- Original page: https://unsplash.com/photos/a-beach-with-blue-water-and-green-land-WZM9IcX5plw
- Location confirmed on source page: Fiji (caption: "drone photography, islands, fiji islands, and fiji in Fiji")
- License: Unsplash License — confirmed present on source page
- Retrieved: 2026-08-18
- Use: "Island experiences" category card, homepage Explore Fiji grid
- Processing: resized to 1000px wide, converted to WebP (quality 80)

## `category-adventure.webp`
- Source: Unsplash
- Photographer: Nicolas Weldingh ([@nicolasweldingh](https://unsplash.com/@nicolasweldingh))
- Original page: https://unsplash.com/photos/white-and-blue-boat-on-ocean-Gg2VVz2ycAc
- Location confirmed on source page: Kuata, Fiji (caption: "Calm morning before diving")
- License: Unsplash License — confirmed present on source page
- Retrieved: 2026-08-18
- Use: "Adventure" category card, homepage Explore Fiji grid
- Processing: resized to 1000px wide, converted to WebP (quality 80)

## `context-denarau-marina.webp`
- Source: Unsplash
- Photographer: Adam Young ([@hossua34](https://unsplash.com/@hossua34))
- Original page verified directly (not via search-tag grouping) — caption/location: Denarau Island Marina, Fiji
- License: Unsplash License (free to use, commercial and non-commercial, no permission required) — confirmed present on source page
- Published on Unsplash: 2026-06-14
- Retrieved: 2026-08-19
- Use: `nadi`/`denarau` context key in `FIJI_IMAGES` — Nadi Airport Transfers destination context (operator hero/card fallback), used only as generic Fiji/Denarau context, never captioned or implied as the operator's own vehicle, driver, staff or premises
- Processing: resized to 1100px wide, converted to WebP (quality 82)

## `context-arrival-sky.webp`
- Source: Unsplash
- Photographer: Josh Withers ([@joshwithers](https://unsplash.com/@joshwithers))
- Original page verified directly (not via search-tag grouping) — caption/location: Beachcomber Island, Fiji, aircraft on approach
- License: Unsplash License — confirmed present on source page
- Published on Unsplash: 2024-06-12
- Retrieved: 2026-08-19
- Use: `transfers`/`arrival` context key in `FIJI_IMAGES` — Transfers category card on the homepage Explore Fiji grid, and as generic arrival/transport context on product pages; never implies a specific vehicle, aircraft or operator
- Processing: resized to 1100px wide, converted to WebP (quality 82)

---

## Rejected candidates (this round, 2026-08-19)

- **"bird's-eye view of islands" (Denys Nevozhai)** — appeared under a "Fiji"-tagged search
  result, but its own source page states the actual location as Ao Nang, Krabi, Thailand.
  Rejected before download — exactly the failure mode the "always verify the actual source
  page, never trust search-tag grouping" rule exists to catch.
- **Sebastian Pena Lambarri aerial lagoon photo** — briefly considered from memory of an
  earlier browsing session, but re-verifying its actual current source page showed it is a
  Maldives photo, not Fiji. Rejected on re-verification; not used.
- **"Oarsman's Bay Lodge, Yasawa, Fiji"** — genuine Fiji/Yasawa location, but the photo's own
  caption names a specific competing resort property. Rejected to avoid any unintended
  association between Vakaviti's generic Yasawa context imagery and a named competitor
  business. The already-verified Kuata/Yasawa boat photo (`category-adventure.webp`) is reused
  for the `yasawa` context key instead.

## Categories intentionally left on the generated fallback (no image forced)

- **Waterfalls & Nature** — a targeted Unsplash search for "Fiji waterfall" returned only one
  free result, and its title/description did not actually match a waterfall — using it would
  have meant depending on a search-result thumbnail rather than verified source content, which
  is exactly what this task's sourcing rules prohibit.
- **Cultural experiences** — no image was sourced this round given the directive's explicit
  caution around identifiable people and false endorsement implication; left for a future,
  more careful pass rather than rushed.
- **Day tours** — no additional verified photo sourced this round; reuses the generated fallback
  for now rather than reusing an already-assigned photo out of context.

## Operator/product imagery

No stock photography was assigned to Nadi Airport Transfers, Blue Lagoon Beach Resort, or any
of their products/services. `operators.image_url` and `products.image_url` remain unset for all
current inventory — `resolveImage()` falls through to the relevant Fiji destination/category
context photo (Nadi Airport Transfers → `nadi`/Denarau context; Blue Lagoon Beach Resort →
`yasawa`/Kuata context, since it is in the Yasawa group), per the explicit instruction never to
imply a stock photograph depicts an operator's actual vehicle, driver, staff, premises or
activity until a real authorized photo is supplied.
