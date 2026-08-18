# Vakaviti Stage 1 — Image Source Record

Every real photograph used on the Stage 1 marketplace is recorded here: local filename, original
source, photographer, license, retrieval date, intended use, and (as of 2026-08-19) explicit
PERMITTED USE / PROHIBITED USE boundaries. No API tokens or secrets are recorded in this file.
Generated/original assets (favicon, SVG fallbacks) are not third-party sourced and are not listed
here — only downloaded third-party photography.

Every image below was verified by opening its actual Unsplash source page (not trusting search
result grouping) and confirming both the stated location and the license line on that page before
downloading.

As of 2026-08-19, every assignment of a photo to a product or operator is made explicitly in
`src/index.ts`'s `PRODUCT_IMAGE_KEY` / `OPERATOR_IMAGE_KEY` maps — never inferred from a blind
product category. A product/operator with no entry in those maps intentionally renders the
premium branded fallback rather than an unreviewed or collision-prone guess. See
`ACCEPTANCE-MATRIX.md` for the live, per-page verification record of these assignments.

---

## `hero-fiji-leleuvia.webp`
- Source: Unsplash
- Photographer: Josaia Cakacaka ([@joecakacaka](https://unsplash.com/@joecakacaka))
- Original page: https://unsplash.com/photos/aerial-view-of-green-trees-beside-body-of-water-during-daytime-ax_K7Ts1k9E
- Location confirmed on source page: Leleuvia Island, Fiji (photographer's caption: "Leleuvia Island, Fiji. My homeland")
- License: Unsplash License (free to use, commercial and non-commercial, no permission required) — confirmed present on source page
- Retrieved: 2026-08-18
- Semantic key: `hero`
- Use: Homepage hero, 404 page, About page banner, homepage final-CTA background, base image for the composited Open Graph share image
- PERMITTED USE: General Fiji destination hero/brand imagery, anywhere the site needs an aspirational "Fiji" opening image not tied to a specific operator or product.
- PROHIBITED USE: Must never be captioned or implied as any specific operator's own premises, vehicle, or activity.
- Processing: resized to 1800px wide, converted to WebP (quality 82)

## `og-image.jpg`
- Derived from: `hero-fiji-leleuvia.webp` (same source/license/photographer as above)
- Processing: cropped to 1200×630 (standard OG image ratio), dark gradient overlay added for text legibility, composited with "Vakaviti" wordmark and tagline "Real Fiji. Local operators. Direct connection." (Vakaviti's own text, not part of the original photo)
- Use: `og:image` default for social/WhatsApp/Facebook share previews (product/operator pages override with their own resolved hero image, always via `absoluteImage()`)
- PERMITTED USE: Default site-wide social share card only.
- PROHIBITED USE: Not used as an in-page content image.

## `category-islands-ocean.webp`
- Source: Unsplash
- Photographer: Max ([@imcolourblind](https://unsplash.com/@imcolourblind))
- Original page: https://unsplash.com/photos/a-beach-with-blue-water-and-green-land-WZM9IcX5plw
- Location confirmed on source page: Fiji (caption: "drone photography, islands, fiji islands, and fiji in Fiji")
- License: Unsplash License — confirmed present on source page
- Retrieved: 2026-08-18
- Semantic key: `islands`
- Use: "Island experiences" homepage category card; Privacy/Contact page banners; Blue Lagoon's **Accommodation Enquiry** product (`PRODUCT_IMAGE_KEY['blue-lagoon-accommodation-enquiry']`)
- PERMITTED USE: Generic Fiji island/beach/ocean destination context — supports "island experience," "accommodation destination context," general Fiji landscape framing.
- PROHIBITED USE: Must never be captioned as a specific resort's actual room, building, grounds or interior. Must never be used for diving/underwater or dining/food context (those require their own distinct, verified photos — see below).
- Processing: resized to 1000px wide, converted to WebP (quality 80)

## `category-adventure.webp`
- Source: Unsplash
- Photographer: Nicolas Weldingh ([@nicolasweldingh](https://unsplash.com/@nicolasweldingh))
- Original page: https://unsplash.com/photos/white-and-blue-boat-on-ocean-Gg2VVz2ycAc
- Location confirmed on source page: Kuata, Fiji (caption: "Calm morning before diving")
- License: Unsplash License — confirmed present on source page
- Retrieved: 2026-08-18
- Semantic key: `yasawa_transfer`
- Use: "Adventure" homepage category card; Terms page banner; Blue Lagoon Beach Resort's operator hero/card (`OPERATOR_IMAGE_KEY`); Blue Lagoon's **Island Transfer Enquiry** product (`PRODUCT_IMAGE_KEY`)
- PERMITTED USE: Yasawa Islands destination/boat-transfer context — a boat departing Kuata genuinely supports "island transfer" and general Yasawa-region framing.
- PROHIBITED USE: Must never be captioned as Blue Lagoon Beach Resort's own boat, crew or specific transfer service — it depicts a different, unrelated Yasawa location (Kuata), not Nacula Island. Must never be used for diving/underwater, accommodation, dining or wedding context.
- Processing: resized to 1000px wide, converted to WebP (quality 80)

## `category-diving.webp`
- Source: Unsplash
- Photographer: Adam Young ([@hossua34](https://unsplash.com/@hossua34))
- Original page: https://unsplash.com/photos/crown-of-thorns-starfish-on-sandy-seabed-2QFN3UrGagY
- Location confirmed on source page: Warwick, Fiji (map marker "Warwick, Fiji"; caption "Crown of Thorns Starfish in Fiji")
- Published on Unsplash: 2026-08-07
- License: Unsplash License (free to use, commercial and non-commercial, no permission required) — confirmed present on source page
- Retrieved: 2026-08-19
- Semantic key: `diving`
- Use: Blue Lagoon's **Diving Enquiry** product only (`PRODUCT_IMAGE_KEY['blue-lagoon-diving-enquiry']`)
- PERMITTED USE: Underwater/marine Fiji context supporting a diving/snorkelling enquiry — genuinely an underwater seabed photo taken in Fiji.
- PROHIBITED USE: Must never be captioned as Blue Lagoon's own dive site, reef, instructor or equipment — it depicts a different, unrelated Fiji location (Warwick), not Nacula Island/Yasawa. Not to be reused for any non-diving/underwater context.
- Processing: downloaded at 2000px wide (`w=2000&q=85&fm=jpg&fit=max` via Unsplash's image API), resized to 1100px wide, converted to WebP (quality 82)

## `context-denarau-marina.webp`
- Source: Unsplash
- Photographer: Adam Young ([@hossua34](https://unsplash.com/@hossua34))
- Original page verified directly (not via search-tag grouping) — caption/location: Denarau Island Marina, Fiji
- License: Unsplash License (free to use, commercial and non-commercial, no permission required) — confirmed present on source page
- Published on Unsplash: 2026-06-14
- Retrieved: 2026-08-19
- Semantic key: `nadi_denarau`
- Use: Nadi Airport Transfers' operator hero/card (`OPERATOR_IMAGE_KEY`); Nadi Airport Transfers' **Private Fiji Transfer Enquiry** and **Private Hotel Transfer** products (`PRODUCT_IMAGE_KEY`) — destination-context tier (Nadi/Denarau region), not a claim to depict the specific vehicle or route
- PERMITTED USE: Nadi/Denarau region destination context for Nadi-based transport services.
- PROHIBITED USE: Must never be captioned or implied as Nadi Airport Transfers' own vehicle, driver, fleet or premises. Must never be used for accommodation, diving, dining or wedding context, or for any Yasawa/Blue Lagoon content.
- Processing: resized to 1100px wide, converted to WebP (quality 82)

## `context-arrival-sky.webp`
- Source: Unsplash
- Photographer: Josh Withers ([@joshwithers](https://unsplash.com/@joshwithers))
- Original page verified directly (not via search-tag grouping) — caption/location: Beachcomber Island, Fiji, aircraft on approach
- License: Unsplash License — confirmed present on source page
- Published on Unsplash: 2024-06-12
- Retrieved: 2026-08-19
- Semantic key: `airport_transfer`
- Use: "Transfers" homepage category card; Nadi Airport Transfers' three literal airport-route products — **Denarau to Nadi Airport Transfer**, **Nadi Airport to Denarau Transfer**, **Nadi Airport to Nadi Hotels Transfer** (`PRODUCT_IMAGE_KEY`)
- PERMITTED USE: Generic Fiji airport-arrival/flight context for products whose service is literally an airport-originating route.
- PROHIBITED USE: Must never be captioned as Nadi Airport Transfers' own aircraft, vehicle or driver. Must not be assigned to a product that is not genuinely an airport-route service (e.g. the broader "Private" transfer enquiries use `nadi_denarau` instead — see above).
- Processing: resized to 1100px wide, converted to WebP (quality 82)

---

## Rejected candidates (2026-08-19 round)

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
  for the `yasawa_transfer` semantic key instead.
- **Stock "wedding"/ceremony imagery for Blue Lagoon's Wedding Enquiry** — deliberately not
  sourced this round. Wedding/ceremony stock photography routinely features identifiable real
  people and specific named venues, both of which risk falsely implying an endorsement or a
  real event connection to Blue Lagoon Beach Resort. Left on the branded fallback rather than
  rushed; see `PRODUCT_IMAGE_KEY` comment in `src/index.ts`.
- **Stock "dining"/food imagery for Blue Lagoon's Dining & Meal Plan Enquiry** — deliberately
  not sourced this round, to avoid any photo that could be mistaken for the resort's actual
  food, table setting or dining room. Left on the branded fallback.

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
- **Blue Lagoon Dining & Meal Plan Enquiry, Blue Lagoon Wedding Enquiry** (2026-08-19) — see
  "Rejected candidates" above. Both intentionally show the branded fallback rather than a
  weak/risky substitute image.

## Operator/product imagery — explicit assignment record (2026-08-19)

No stock photography was assigned to Nadi Airport Transfers, Blue Lagoon Beach Resort, or any
of their products/services as their own `image_url`. `operators.image_url` and
`products.image_url` remain unset (`null`) for all current inventory in D1 — every image
currently shown for these operators/products comes from the explicit `PRODUCT_IMAGE_KEY` /
`OPERATOR_IMAGE_KEY` maps in `src/index.ts`, reviewed product-by-product rather than inferred
from category, per the standing rule never to imply a stock photograph depicts an operator's
actual vehicle, driver, staff, premises, dive site or activity until a real authorized photo is
supplied:

| Operator/product | slug | Semantic key | Asset |
|---|---|---|---|
| Nadi Airport Transfers (operator) | `nadi-airport-transfers` | `nadi_denarau` | context-denarau-marina.webp |
| Blue Lagoon Beach Resort (operator) | `blue-lagoon-beach-resort` | `yasawa_transfer` | category-adventure.webp |
| Accommodation Enquiry | `blue-lagoon-accommodation-enquiry` | `islands` | category-islands-ocean.webp |
| Diving Enquiry | `blue-lagoon-diving-enquiry` | `diving` | category-diving.webp |
| Island Transfer Enquiry | `blue-lagoon-island-transfer-enquiry` | `yasawa_transfer` | category-adventure.webp |
| Dining & Meal Plan Enquiry | `blue-lagoon-dining-enquiry` | *(none — branded fallback)* | — |
| Wedding Enquiry | `blue-lagoon-wedding-enquiry` | *(none — branded fallback)* | — |
| Denarau to Nadi Airport Transfer | `denarau-nadi-airport-transfer` | `airport_transfer` | context-arrival-sky.webp |
| Nadi Airport to Denarau Transfer | `nadi-airport-denarau-transfer` | `airport_transfer` | context-arrival-sky.webp |
| Nadi Airport to Nadi Hotels Transfer | `nadi-airport-nadi-hotels-transfer` | `airport_transfer` | context-arrival-sky.webp |
| Private Fiji Transfer Enquiry | `private-fiji-transfer-enquiry` | `nadi_denarau` | context-denarau-marina.webp |
| Private Hotel Transfer | `private-hotel-transfer` | `nadi_denarau` | context-denarau-marina.webp |

This is a deliberate reduction from the earlier category-blind mapping, which had collapsed all
5 Nadi Airport Transfers products onto one identical image and caused Blue Lagoon's Accommodation
and Diving products to look duplicated. See `ACCEPTANCE-MATRIX.md` for the live verification of
this table against the deployed site.
