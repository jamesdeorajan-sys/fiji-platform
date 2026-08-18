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

---

## Categories intentionally left on the generated fallback (no image forced)

- **Transfers** — no verified genuine Fiji airport/road/arrival photo was found; forcing a
  mismatched or unverified photo would violate the "do not fabricate context" instruction.
  Also: per the operator-specific rule, no stock image may ever be captioned or implied as
  Nadi Airport Transfers' own vehicle/driver/fleet.
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

No stock photography was assigned to Nadi Airport Transfers or any of its products/services.
`operators.image_url` and `products.image_url` remain unset for all current inventory — the
premium generated Vakaviti fallback continues to render for the operator card, operator hero,
and every product card/detail page, per the explicit instruction not to imply a stock photograph
depicts this operator's actual vehicle, driver, staff or fleet until a real authorized photo is
supplied.
