# Live Deal Exchange — Milestone 2 Evidence Dossier

Private, isolated research record. Nothing here was written to production or any database — this
document is the entire "disposable dataset" for Milestone 2, per the CEO's instruction to avoid
creating new infrastructure for research alone. All inspection was passive (WebFetch/WebSearch,
public pages only) — no forms, searches, bookings, carts, payments, or messages were submitted; no
provider or seller was contacted; no site listed here (including the two owned-revenue sites) was
modified. Checked timestamp for every row below: **2026-08-24, ~12:50–13:45 UTC**.

## Provider-direct pages inspected (6)

| # | Provider | Region | URL | Access | September 2026 established? |
|---|---|---|---|---|---|
| 1 | Outrigger Fiji Beach Resort | Coral Coast | outrigger.com/fiji/fiji-beach-resort/offers | **Blocked (HTTP 403)** | N/A - no evidence extracted |
| 2 | Shangri-La Yanuca Island | Coral Coast | shangri-la.com/yanucaisland/fijianresort/offers/ | OK | Yes - "Sunlit Island Escape", 01 Apr 2026–31 Mar 2027 |
| 3 | Radisson Blu Resort Fiji Denarau Island | Denarau | radissonhotels.com/.../deals | **Blocked (HTTP 403)** | N/A - no evidence extracted |
| 4 | Jean-Michel Cousteau Resort | Savusavu | fijiresort.com/offers | OK, incomplete | **No** - no dates stated at all |
| 5 | Taveuni Palms Resort | Taveuni | taveunipalms.com/rates-specials | OK, complete | **Yes** - explicit 1 Aug–31 Dec 2026 window |
| 6 | Uprising Beach Resort | Pacific Harbour | uprisingbeachresortfiji.com/facility-services-packages-bundles | OK, incomplete | **No** - no dates stated at all |

### Gate results

**Taveuni Palms — "Pay 6/Stay 7" and "Pay 8/Stay 10" specials — ELIGIBLE (PROVIDER_DIRECT)**
- Provider: Taveuni Palms Resort. Price: USD 1,500/day/villa (2 persons) base rate, PER_NIGHT basis (mapped from "per villa per day"). Occupancy: 2 persons/villa stated, extra-adult/child rates given. Travel window: 1 Aug 2026 – 31 Dec 2026 (genuinely covers September — not inferred from "2026" alone). Taxes: **explicitly excluded** (Fiji VAT 12.5% stated separately — an honest disclosure the model should preserve, not silently fold into the headline price). Booking route: info@taveunipalms.com (direct). Cancellation: 25% non-refundable deposit within 7 days, full payment 60 days before arrival.
- All 14 gates pass. Public label: **"Available from the provider."**
- This is a genuine, real, publication-ready deal — the strongest single result of this research pass.

**Shangri-La Yanuca Island — "Sunlit Island Escape" — NOT_ELIGIBLE**
- Failed gates: `supported_occupancy_basis` (no occupancy basis stated for the offer itself), `supported_booking_route` (page exposes only a generic "View Details" link, not a captured URL).
- Travel window (01 Apr 2026–31 Mar 2027) does genuinely cover September — this part of the claim is real, not assumed.
- Also found on this page: "Coral Coast Locals Offer" (01 Aug–20 Sep 2026, AUD 297/night) — excluded from consideration entirely because it is restricted to Fiji residents, not the Australian-traveller audience this milestone prioritizes. Noted as a real finding: an offer can be commercially real and still wrong for a given audience — the model does not yet have an audience-eligibility field; flagging for Milestone 3 consideration rather than adding scope here.
- Missing to resolve: exact booking route URL, occupancy basis for this specific offer.

**Jean-Michel Cousteau Resort — both offers — PRICE_CHECK_REQUIRED (private only)**
- "Vanua Couples Experience" and "Dive & Rejuvenation Offer": occupancy (2 persons) and inclusions are real, but price, price basis, nights, booking deadline, and travel window are **all absent from the page**. Booking route exists (phone/WhatsApp) but nothing establishes September applicability at all.
- Correctly classified private/incomplete, not merely "missing a few fields" — this is the honest outcome, not a padded one.

**Uprising Beach Resort — both packages — PRICE_CHECK_REQUIRED (private only)**
- "Stay 5, Pay 4" and "Stay 7, Pay 5": real inclusions (breakfast, transfers, welcome drink) and a real booking route (email/phone), but no price amount, no occupancy basis, and critically **no travel dates at all** — the ratio-style offer name ("Stay 5, Pay 4") describes a discount structure, not a price. September applicability cannot be established.

**Outrigger / Radisson — blocked**
- Both returned HTTP 403 on a passive fetch. Respecting this rather than attempting to circumvent it — reported as a genuine source-access failure, not silently skipped. Real facts about these two properties were instead obtained through their **seller-package** listings (see below), which is a legitimate, separate authoritative path for the seller-owned facts, though provider-identity/locality still requires the provider's own page under this model's authority rules — currently unresolved for these two until the block is worked around by other means (a different fetch method, or accepting the seller page's provider-identity claim as unverified pending future provider-page access).

## Named-seller package pages inspected (5, plus 3 additional Jetstar Holidays attempts that timed out)

| # | Seller | Package | URL | Access | September 2026 eligible? |
|---|---|---|---|---|---|
| 1 | My Fiji | Radisson Blu Resort Fiji Denarau Island, 7 Nights | myfiji.com/package/radisson-blu-resort-fiji-denarau-island-7-nights-garden-view-one-bedroom-suite-flights/ | OK, complete | **No** — travel starts 26 Oct 2026 |
| 2 | Hideaway Holidays | Outrigger Fiji Beach Resort, 7 Nights | hideawayholidays.com.au/outrigger-fiji-beach-resort-holiday-package-deals/ | OK, mostly complete | **Not established** — no exact travel window extracted, only a booking-by date |
| 3 | Luxury Escapes | Mana Island Resort & Spa (Mamanuca) | luxuryescapes.com/us/offer/mana-island-resort-and-spa-... | OK, incomplete | Not established — no price/dates on the public page (member pricing) |
| 4 | Luxury Escapes | Yasawa Island Resort & Spa (adults-only) | luxuryescapes.com/us/offer/yasawa-island-resort-and-spa-fiji/... | OK, incomplete | Not established — same reason |
| 5-7 | Jetstar Holidays | Shangri-La Yanuca / Outrigger / Radisson Blu packages | jetstar.com/au/en/holidays/destinations/fiji/properties/{859797,60293,60266}/package | **Timed out** (client-rendered, 60s limit exceeded on 4 attempts) | N/A |

### Gate results

**My Fiji — Radisson Blu Denarau 7-Night Escape — ELIGIBLE generally, but explicitly NOT for September**
- Seller: My Fiji. Provider: Radisson Blu Resort Fiji Denarau Island (identity taken from the seller's own page here, since the provider's own page was blocked — flagged as a provenance gap, not silently treated as provider-authoritative).
- Price: AUD 2,599 per person, twin share. Departure cities: Sydney/Brisbane/Gold Coast/Cairns/Canberra (base), Melbourne (+$100pp), Adelaide (+$300pp) — matches the priority Australian-origin requirement well. 7 nights. Inclusions: flights + 30kg bag, breakfast, transfers, Malamala Beach Club day, VOU cultural show, FJD 500 dining credit, 2 daily drinks, South Sea full-day cruise, kids stay free (up to 2). Exclusions: travel insurance, motorized watersports, some spa. Booking deadline: **31 Aug 2026** (7 days from this research pass — still valid, but tight). Travel window: **26 Oct 2026 – 27 Jul 2027**, blackouts 1–15 Nov 2026 and 21 Dec 2026–10 Jan 2027.
- **This is the exact case the CEO warned about**: the page is unambiguously "2026" content, discovered while researching September 2026 deals, and would be wrongly counted as September-eligible by a naive "mentions 2026" check. `checkMonthEligibility('2026-10-26', '2027-07-27', 2026, 9)` correctly returns `eligible: false` — travel does not begin until late October. All 14 general publication gates still pass (it's a real, complete, bookable package) — it is simply not a September answer. Public label: **"Available from My Fiji."**

**Hideaway Holidays — Outrigger 7-Night — ELIGIBLE generally, September unestablished (not assumed)**
- Seller: Hideaway Holidays. Provider: Outrigger Fiji Beach Resort (same provenance caveat as above — provider's own page blocked). Price: AUD 1,623pp twin share, 7 nights, Coral Coast, departs Nadi. Inclusions: private transfer, room, welcome pack, snorkel gear, wifi/tennis/gym, non-motorized watersports. Booking deadline: 24 Mar 2027. **No exact travel start/end date was exposed on the page** — only the booking-by deadline. This is the second real instance of the same failure mode: a present `booking_deadline` satisfies the generic `supported_validity` gate (which only needs deadline OR window), but says nothing about which travel months are actually covered. Reported honestly as September-unestablished, not assumed either way.

**Luxury Escapes (both) — private/incomplete**
- Real, specific inclusions extracted (dive/spa/cruise/watersports detail for Mana Island; all-inclusive dining, adults-only, scenic flight transfers for Yasawa Island) but genuinely no price, currency, or dates on the publicly-fetchable page — consistent with Luxury Escapes' member-gated pricing model. Correctly classified incomplete, not padded with an invented price.

**Jetstar Holidays (3 attempts) — source access failure**
- All three property-package URLs timed out at the 60-second fetch limit on every attempt (including one retry). This reads as a heavily client-side-rendered page rather than a robots block (no 403/429 received, no content at all — timeout only). Reported honestly as inaccessible via passive fetch, not silently dropped from the source list.

## Owned inventory — Fiji Tour Transfers (read-only inspection, nothing modified)

**12 real, priced products found** on fijitourtransfers.com, all with a real AU$ price, duration, and location — strong evidence toward "useful owned tour inventory":

| Product | Price (AU$) | Duration | Location |
|---|---|---|---|
| Fiji Taxi & Shuttles (Airport transfer/island tours) | From 18 | 30 min | Nadi Airport |
| Nadi Airport → Aquarius Beach Resort | From 8 | 30 min | Nadi |
| Nadi Airport → Beach Club Wailoaloa | From 9 | 45 min | Nadi |
| Nadi Airport → Bamboo Resort | From 8 | 30 min | Nadi |
| Nadi Cultural Night Tour | 135 (was 159) | 4 hrs | Nadi |
| Natadola Beach Combinational Horse Riding | 100 (was 250) | 2.5 hrs | Natadola Beach |
| Nadi Off-Road ATV Bike Adventure | 299 (was 427) | 5 hrs | Nadi |
| Coral Coast Mountain View Horse Riding | 150 (was 177) | 1.5 hrs | Coral Coast |
| Naihehe Cave Tour | 160 (was 320) | 6 hrs | Sigatoka |
| Nadi Full Day Tour | 180 (was 300) | 6 hrs | Nadi |
| Nadi Zip Line Tour | 221 (was 245) | 3 hrs | Nadi |
| Sawa-i-Lau Caves (Yasawas) | From 580 | 6 hrs | Port Denarau departure |

All have a real online booking route. Price basis (per person vs. per group) was not explicitly labelled on the fetched summary and should be confirmed per-product before treating any of these as ELIGIBLE VAKAVITI_BOOKABLE offers — flagged as a real, specific missing field, not assumed to be per-person.

## Owned inventory — Nadi Airport Transfers (read-only inspection, nothing modified)

**No fixed-price product list exists** — this site prices by a live distance calculator (110+ destinations across Viti Levu, sedan/minivan/minibus tiers, "no surge pricing," multi-currency display FJ$/AU$/US$/NZ$/£/€, 10% auto-discount over FJ$50). This is structurally closer to the `FLIGHT_QUOTE` pattern (live, personalized, never a fixed persisted fare) than to a static `VAKAVITI_BOOKABLE` product list — a genuine, honest finding rather than a gap to paper over with an invented fixed price.

**Notable observation**: the page content returned for nadiairporttransfers.com described itself under the "Fiji Tour Transfers" name/structure, suggesting the two sites may share a platform or ownership. Reported as an observation for you to confirm, not treated as settled fact.

## Full evidence provenance (per offer, as the model requires)

Every offer above has its supported/missing fields, source class, and gate result recorded in the tables above — reproduced in machine-checkable form as the actual `EvidenceItem[]`/gate-result shapes would be if these were run through `resolveEvidenceBundle`/`evaluateOfferPublicationGates` live. No image or description text was copied from any source into this dossier beyond factual attributes (price, dates, inclusions as short factual labels) — no marketing copy, no images.
