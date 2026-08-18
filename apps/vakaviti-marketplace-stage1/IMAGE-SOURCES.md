# Vakaviti Stage 1 — Image Intelligence Manifest

This file is the single structured source of truth for every real photograph used on the Stage 1
marketplace (its filename remains `IMAGE-SOURCES.md` for continuity with existing references in
`STAGE1-RECOVERY.md` and code comments — it now serves as the full "Image Intelligence Manifest"
required by the 2026-08-19 Visual Truth Correction Pass). No API tokens or secrets are recorded
here. Generated/original assets (favicon, SVG fallbacks) are not third-party sourced and are not
listed — only downloaded third-party photography.

**Sourcing discipline:** every image below was verified by opening its own source page directly
(never trusting search-result grouping or tag association) and confirming its stated location and
license line before downloading.

**Traveller Expectation Test (added 2026-08-19):** an image being technically "Fiji" and
"license-clear" is not sufficient to assign it to a product. Before assignment, ask: *if a
traveller saw only this image and the product title, would it strengthen their understanding of
and desire to enquire about this exact experience?* If no, it does not get assigned — the product
renders the branded fallback instead. See `src/index.ts`'s `PRODUCT_IMAGE_KEY` for where this was
applied to retire a prior weak assignment.

---

## Asset manifest

Each entry: asset · source · photographer/owner · license · retrieval date · verified location ·
region · subjects · allowed use cases · prohibited use cases · confidence.

### `hero-fiji-leleuvia.webp`
- Source: Unsplash — https://unsplash.com/photos/aerial-view-of-green-trees-beside-body-of-water-during-daytime-ax_K7Ts1k9E
- Photographer: Josaia Cakacaka ([@joecakacaka](https://unsplash.com/@joecakacaka))
- License: Unsplash License (free, commercial use, no attribution required)
- Retrieved: 2026-08-18
- Verified location: Leleuvia Island, Fiji (photographer's own caption: "Leleuvia Island, Fiji. My homeland")
- Region: Leleuvia Island (Lomaiviti)
- Subjects: island, aerial, ocean, green-water, general-fiji
- Allowed use cases: site-wide hero/brand imagery, homepage, 404, About page, final-CTA background
- Prohibited use cases: implying it depicts any specific operator's premises, vehicle or activity
- Confidence: HIGH (explicit photographer caption names the exact island)

### `og-image.jpg`
- Derived from: `hero-fiji-leleuvia.webp` (same source/license/photographer)
- Processing: cropped 1200×630, dark gradient overlay, composited with Vakaviti's own wordmark/tagline text (not part of the original photo)
- Subjects: brand, general-fiji
- Allowed use cases: default `og:image` for social/WhatsApp/Facebook share previews only
- Prohibited use cases: in-page content image
- Confidence: HIGH

### `category-islands-ocean.webp`
- Source: Unsplash — https://unsplash.com/photos/a-beach-with-blue-water-and-green-land-WZM9IcX5plw
- Photographer: Max ([@imcolourblind](https://unsplash.com/@imcolourblind))
- License: Unsplash License
- Retrieved: 2026-08-18
- Verified location: Fiji (caption: "drone photography, islands, fiji islands, and fiji in Fiji")
- Region: unspecified Fiji island group
- Subjects: island, ocean, beach, aerial, general-fiji
- Allowed use cases: "Island experiences" homepage category card; Privacy/Contact banners; general destination-beach context
- Prohibited use cases: accommodation interior/room implication, diving, dining, culture
- Confidence: MEDIUM (no named specific island, but explicitly geotagged "Fiji" by photographer)

### `category-adventure.webp`
- Source: Unsplash — https://unsplash.com/photos/white-and-blue-boat-on-ocean-Gg2VVz2ycAc
- Photographer: Nicolas Weldingh ([@nicolasweldingh](https://unsplash.com/@nicolasweldingh))
- License: Unsplash License
- Retrieved: 2026-08-18
- Verified location: Kuata, Fiji (caption: "Calm morning before diving")
- Region: Kuata Island, Yasawa Islands
- Subjects: boat, island, yasawa, water-transfer, adventure
- Allowed use cases: "Adventure" homepage category card; Blue Lagoon Beach Resort's operator hero/card; Blue Lagoon's **Island Transfer Enquiry** product
- Prohibited use cases: must never be captioned as Blue Lagoon's own boat/crew/transfer (this is Kuata, a different Yasawa island from Blue Lagoon's Nacula Island); not for diving/underwater, accommodation, dining or wedding
- Confidence: HIGH (named island, explicit boat/water context)

### `category-diving.webp`
- Source: Unsplash — https://unsplash.com/photos/crown-of-thorns-starfish-on-sandy-seabed-2QFN3UrGagY
- Photographer: Adam Young ([@hossua34](https://unsplash.com/@hossua34))
- License: Unsplash License
- Retrieved: 2026-08-19
- Verified location: Warwick, Fiji (map marker; caption "Crown of Thorns Starfish in Fiji")
- Region: Warwick (Coral Coast area)
- Subjects: underwater, seabed, marine-life, diving, snorkelling
- Allowed use cases: Blue Lagoon's **Diving Enquiry** product only
- Prohibited use cases: must never be captioned as Blue Lagoon's own dive site/reef/instructor (Warwick is a different Fiji location from Nacula Island/Yasawa); not for any non-diving context
- Confidence: MEDIUM-HIGH (genuine Fiji underwater location, but depicts a static seabed subject rather than an active dive scene — reconfirmed 2026-08-19 as still the best available verified option after a repeat search found nothing stronger)

### `context-denarau-marina.webp`
- Source: Unsplash (direct source-page verification, not search-tag grouping)
- Photographer: Adam Young ([@hossua34](https://unsplash.com/@hossua34))
- License: Unsplash License
- Published on Unsplash: 2026-06-14 · Retrieved: 2026-08-19
- Verified location: Denarau Island Marina, Fiji
- Region: Denarau, Nadi
- Subjects: marina, boat, denarau, nadi
- Allowed use cases: Nadi Airport Transfers' operator hero/card (destination context only); any future genuinely marina/boat-transfer product
- Prohibited use cases: **as of 2026-08-19, removed from every Nadi Airport Transfers PRODUCT** — none of the 5 current products involve marina or boat transport, and a marina photo may not stand in for generic road transfers (this was a defect fixed in the Visual Truth Correction Pass). Must never imply the operator's own vehicle/premises.
- Confidence: HIGH (named marina, explicit Unsplash location tag)

### `context-arrival-sky.webp`
- Source: Unsplash — sourced 2026-08-19 round
- Photographer: Josh Withers ([@joshwithers](https://unsplash.com/@joshwithers))
- License: Unsplash License
- Published on Unsplash: 2024-06-12 · Retrieved: 2026-08-19
- Verified location: Beachcomber Island, Fiji (aircraft on approach)
- Region: Mamanuca Islands
- Subjects: sky, flight, aircraft, general-fiji
- Allowed use cases: none currently assigned
- Prohibited use cases: **RETIRED from active assignment 2026-08-19.** It was the "Transfers" category image and all 3 airport-route products' image, and failed the CEO's live inspection — it reads as a generic sky/sunset photo rather than communicating ground transport, and its reuse across 3 products was flagged as repetitive/dominant. Asset kept on disk (not deleted) in case a future genuinely flight/arrival-themed product needs it, but it must not be reused for "transfer" or "transport" semantics without a fresh product-by-product justification.
- Confidence: HIGH on location, LOW on fitness-for-purpose (this is the actual lesson of this correction pass — geographic/license accuracy alone does not make an image the *right* image)

### `category-wedding.webp` — NEW 2026-08-19
- Source: Pexels — https://www.pexels.com/photo/wedding-arch-situated-on-the-beach-26088007/
- Photographer: Josh Withers (same photographer as `context-arrival-sky.webp`, shooting on Pexels under the same name)
- License: Pexels License (free for commercial and personal use, no attribution required; identifiable people may not be shown in a bad light or used to imply endorsement — not applicable here, no people are depicted)
- Retrieved: 2026-08-19
- Verified location: Nadi, Western Division, Fiji (page states "Free to use / Nadi, Western Division, Fiji")
- Region: Nadi
- Subjects: wedding, beach, ceremony, arch, romance, no-people
- Allowed use cases: Blue Lagoon's **Wedding Enquiry** product only
- Prohibited use cases: must never be captioned as Blue Lagoon's own ceremony/venue/staging (this is a Nadi-area beach, not Nacula Island/Yasawa) — used purely as generic "Fiji beach wedding" mood/context
- Confidence: HIGH (named location, no identifiable people, part of a consistent multi-photo Nadi wedding-photography set by the same photographer — several sibling images in the same batch corroborate the location)

### `context-road-transfer.webp` — NEW 2026-08-19
- Source: Pexels — https://www.pexels.com/photo/cars-on-road-9464930/
- Photographer: YAWALO by Fonnzzzy
- License: Pexels License
- Retrieved: 2026-08-19
- Verified location: Suva, Central Division, Fiji
- Region: Suva (Viti Levu, opposite side of the island from Nadi)
- Subjects: road, vehicle, cars, street, transportation, general-fiji
- Allowed use cases: general Fiji road/ground-transport context for transfer products where no more specific photo exists. **Must not be captioned as depicting Nadi, Denarau, or the specific route named by the product** — Suva and Nadi are different cities on Viti Levu, and this photo must only ever imply "Fiji road transport," never a specific location within Fiji.
- Prohibited use cases: must never be captioned as Nadi Airport Transfers' own vehicle/driver/fleet
- Confidence: MEDIUM (genuine Fiji road/vehicle subject — the strongest available match to the "GOOD: vehicle, road/arrival context" standard after an extensive search of both Unsplash and Pexels for Nadi/airport-specific imagery found only geographic mismatches — see Rejected Candidates below — but the specific city (Suva) does not match the operator's own service area (Nadi/Denarau), so it is used as generic transport-subject context only, never location-specific)

### `category-accommodation.webp` — NEW 2026-08-19
- Source: Pexels — https://www.pexels.com/photo/tropical-poolside-oasis-at-fiji-resort-34721541/
- Photographer: Navi Prasad
- License: Pexels License
- Retrieved: 2026-08-19
- Verified location: Fiji (page states "Free to use / Fiji"; tags include "Fijian Resort", "Fiji Tourism")
- Region: unspecified Fiji resort
- Subjects: resort, pool, accommodation, poolside, general-fiji
- Allowed use cases: Blue Lagoon's **Accommodation Enquiry** product only
- Prohibited use cases: must never be captioned as Blue Lagoon Beach Resort's own pool/room/property — it is a different, unnamed Fiji resort, used purely as generic "island accommodation experience" context
- Confidence: MEDIUM-HIGH (verified Fiji location and explicit "resort" subject, but the specific property is not named/identifiable, which is actually the safer outcome here)

### `category-daytour.webp` — NEW 2026-08-19
- Source: Pexels — https://www.pexels.com/photo/tranquil-beach-at-sunrise-with-boats-in-fiji-33732029/
- Photographer: Mark Direen
- License: Pexels License
- Retrieved: 2026-08-19
- Verified location: Fiji; tags include "Kuata Island" (same island as `category-adventure.webp`)
- Region: Kuata Island, Yasawa Islands
- Subjects: beach, boat, sunrise, island, day-tour, adventure
- Allowed use cases: "Day tours" homepage category card
- Prohibited use cases: must not be implied as a specific operator's own boat/tour
- Confidence: HIGH (named island, boat/beach subject matches "day tour" framing directly)

---

## Rejected candidates

### 2026-08-19 round (Visual Truth Correction Pass)
- **"Airplane landing at the airport with buildings and grass" (Hieu, @thehncreative, Unsplash)** — a genuine Fiji Airways aircraft, but the photo's own location tag is Dallas Fort Worth International Airport, TX, USA. Rejected — geographic mismatch (plane livery ≠ photo location).
- **"A commercial airplane landing with its gear down" (same photographer)** — same Fiji Airways aircraft, this time tagged San Francisco International Airport, CA, USA. Rejected for the same reason. This photographer plane-spots Fiji Airways aircraft internationally, not in Fiji itself.
- **"Fiji Airways Airbus A350 in Clear Blue Sky" (Pexels)** — no location metadata given at all (unlike every accepted candidate, which states "Free to use / [Place]"). Rejected — cannot confirm it was taken in Fiji.
- **"A couple of red trucks driving down a muddy road" (Nem Malosi, Unsplash)** — genuine Fiji location (Korovisilou, Fiji), but the caption describes a construction/farm-road site visit with visible workers ("A team of man during a site visit"). Rejected — wrong subject (not passenger transport) and identifiable-people risk.
- **"Entrance to Outdoor Restaurant at Sunset" (Ahmet Kurt, Pexels)** — appeared in a "Fiji restaurant" search but carries no location tag and no "Fiji" mention anywhere on its page. Rejected — unverified location despite the search match, exactly the failure mode the sourcing discipline exists to catch.
- **"Beachfront Dining at Sunset with Candlelight Ambiance" (Tomi Saputra, Pexels)** — same issue, no location tag, appeared only via generic "dining"/"resort" tag overlap. Rejected.
- No further genuine Fiji-located dining/food photo was found after searching Unsplash ("fiji food", "fiji resort dining") and Pexels ("fiji food", "fiji resort dining", "fiji restaurant") — every result was either a different country (Philippines, Nairobi) or carried no confirmed location. **Dining & Meal Plan Enquiry remains on the branded fallback.**
- No genuine Fiji waterfall photo exists in either library's current inventory — searched "fiji waterfall" (Pexels: all results were Bali, Mexico, Philippines, Guatemala, Turkey), and the specific named Fiji waterfalls surfaced by Unsplash's own related-search suggestions (Nasesele Waterfall, Vuadomo Waterfall, Colo-i-Suva Forest Park) returned zero actual photos when searched directly. **Waterfalls & nature category remains on the branded gradient fallback.**
- No genuine, safe Fiji village/cultural-architecture photo was found — "fiji village" search on Pexels returned Nepal, unlocated "tribal houses," and otherwise only beach/resort photos incidentally tagged "village." Combined with the standing caution around identifiable people and false endorsement in cultural imagery, **Cultural experiences remains on the branded gradient fallback.**

### Earlier rounds (kept for history)
- **"bird's-eye view of islands" (Denys Nevozhai)** — tagged "Fiji" in search but its own page states Ao Nang, Krabi, Thailand. Rejected.
- **Sebastian Pena Lambarri aerial lagoon photo** — misremembered as Fiji; re-verification showed Maldives. Rejected.
- **"Oarsman's Bay Lodge, Yasawa, Fiji"** — genuine Fiji/Yasawa location, but names a specific competing resort property. Rejected to avoid implying association with a named competitor.

---

## Product/operator image assignment record (current as of 2026-08-19)

Every assignment below is made explicitly in `src/index.ts`'s `PRODUCT_IMAGE_KEY` /
`OPERATOR_IMAGE_KEY` maps — never inferred from category. `operators.image_url` and
`products.image_url` remain `null` (unset) for all current D1 inventory; no operator has
supplied their own authorized photo yet.

| Operator/product | slug | Asset | Rationale |
|---|---|---|---|
| Nadi Airport Transfers (operator) | `nadi-airport-transfers` | context-denarau-marina.webp | Nadi/Denarau destination context for the operator card/hero (not a product-level claim) |
| Blue Lagoon Beach Resort (operator) | `blue-lagoon-beach-resort` | category-adventure.webp | Yasawa boat/destination context for the operator card/hero |
| Accommodation Enquiry | `blue-lagoon-accommodation-enquiry` | category-accommodation.webp | Resort/pool photo directly supports "accommodation" understanding — upgraded 2026-08-19 from the generic beach photo |
| Diving Enquiry | `blue-lagoon-diving-enquiry` | category-diving.webp | Genuine Fiji underwater/seabed subject |
| Island Transfer Enquiry | `blue-lagoon-island-transfer-enquiry` | category-adventure.webp | Boat departing a Yasawa island — literal match for "island transfer" |
| Wedding Enquiry | `blue-lagoon-wedding-enquiry` | category-wedding.webp | NEW — beach ceremony arch/chairs, no people, resolves the prior fallback gap |
| Dining & Meal Plan Enquiry | `blue-lagoon-dining-enquiry` | *(branded fallback)* | No verified Fiji dining photo found — see Rejected Candidates |
| Denarau to Nadi Airport Transfer | `denarau-nadi-airport-transfer` | context-road-transfer.webp | Real road/vehicle subject in Fiji, replacing the retired sky photo |
| Nadi Airport to Denarau Transfer | `nadi-airport-denarau-transfer` | context-road-transfer.webp | Same physical route, opposite direction — legitimate share, not a lazy collision |
| Nadi Airport to Nadi Hotels Transfer | `nadi-airport-nadi-hotels-transfer` | *(branded fallback)* | Deliberately not a 3rd share of context-road-transfer.webp — "stop repetitive image assignment" |
| Private Fiji Transfer Enquiry | `private-fiji-transfer-enquiry` | *(branded fallback)* | No distinct photo available; marina photo explicitly prohibited (no boat involved) |
| Private Hotel Transfer | `private-hotel-transfer` | *(branded fallback)* | Same reasoning as above |

## Explore Fiji category grid (all 6 categories, 2026-08-19)

| Category | Asset | Status |
|---|---|---|
| Transfers | context-road-transfer.webp | Real photo |
| Island experiences | category-islands-ocean.webp | Real photo |
| Adventure | category-adventure.webp | Real photo |
| Day tours | category-daytour.webp | Real photo (NEW) |
| Waterfalls & nature | *(branded gradient fallback)* | Intentional — no verified photo found |
| Cultural experiences | *(branded gradient fallback)* | Intentional — no verified photo found, plus identifiable-people caution |
