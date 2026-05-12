# Build Log — Fiji Tour Transfers Platform

> Chronological record of what's been shipped. Newest entries at the top.

---

## v0.10 — 28 April 2026 — Featured tours + searchable typeahead

**Cache version:** `?v=20260428a`

### Shipped
- ✅ Replaced 6 generic tours with 16 real featured tours from fijitourtransfers.com
- ✅ Each tour now uses real hero image (lazy-loaded), real pricing converted from AU$ to FJ$ (×1.45)
- ✅ Discount badges (15%, 25%, 30% OFF) match live site exactly
- ✅ Each tour card has a "↗" link to the live tour page on fijitourtransfers.com for full details
- ✅ Added "Browse all 174 tours" CTA at bottom of tours section
- ✅ **Typeahead search** added to both pickup and destination dropdowns
  - Filters across hotel name, area name, and group label
  - Press Enter to pick first match
  - Press Escape to close
  - Mobile-optimised panel (60vh, touch-scroll)
  - Underlying `<select>` kept functional so all existing code (resolveLocation, swapLocations, selectTour, bookRoute) works unchanged

### Why
- 110+ hotel options in plain `<select>` was unusable on mobile
- Tours data was drifting from main site; needed real prices and photos
- "Uber-like" promise required ability to find a hotel in 2 seconds

---

## v0.9 — 27 April 2026 — Bula success card + post-booking concierge pitch

**Cache version:** `?v=20260427e`

### Shipped
- ✅ After booking submission, the booking widget now closes entirely
- ✅ Replaced inline success step with celebration "Bula Vinaka!" card
- ✅ Card includes: hibiscus burst animation, personalised name greeting, booking ref
- ✅ Big WhatsApp button to send full booking
- ✅ "While you're in Fiji" section listing 8 concierge services (transfers, tours, supermarket, pharmacy, restaurants, hospital, ferry, domestic flights)
- ✅ "Save us on WhatsApp" CTA with pre-filled friendly message — gets the customer to ping us so we're in their chat list permanently
- ✅ Closing message: "We're the #1 team to reach out to during your Fiji stay"

### Why
- Original success step was buried inside the booking widget
- Customers booked → left → never came back
- Needed a strong post-purchase moment to convert one-off bookings into repeat customers

---

## v0.8 — 27 April 2026 — Order-value discount system

**Cache version:** `?v=20260427d`

### Shipped
- ✅ 10% automatic discount on all bookings over FJ$50
- ✅ Visible in 6 places: promo banner above routes table, inside booking widget pricing panel, vehicle cards (step 1), vehicle detail cards (step 2), confirmation card (step 4), WhatsApp message
- ✅ Routes table shows ~~original~~ **discounted** prices for all qualifying routes
- ✅ Threshold is strictly OVER FJ$50 (not ≥) to nudge short-trip customers to upgrade
- ✅ Discount updates live as customers toggle add-ons (child seat +FJ$8, surfboard +FJ$24)

### Why
- Direct user request: "create more conversion incentive"
- Acts as natural upsell mechanic (return trip, add-on, larger vehicle)

---

## v0.7 — 27 April 2026 — Routes table "Book →" auto-fill

**Cache version:** `?v=20260427c`

### Shipped
- ✅ Routes table "Book →" buttons now auto-fill the booking form (previously just scrolled)
- ✅ Each route mapped to a real `destValue` in the destination dropdown
- ✅ Auto-fills pickup as Nadi Airport, sets destination, defaults trip type to one-way
- ✅ Triggers price recalc, smooth scroll to booking form
- ✅ Green pulse animation on booking card so customer sees auto-fill happened

### Why
- Customers were clicking "Book" expecting form auto-fill
- Just scrolling them to a blank form was a UX failure

---

## v0.6 — 27 April 2026 — Capacity validation (pax + luggage)

**Cache version:** `?v=20260427b`

### Shipped
- ✅ Vehicle config now tracks `maxBags` separately from `maxPax`
- ✅ `vehicleFits()` checks BOTH passenger count AND luggage count
- ✅ `recommendedVehicle()` picks the smallest vehicle that fits both
- ✅ `changePax` AND `changeLuggage` trigger auto-upgrade if current vehicle too small
- ✅ Vehicle cards show "Up to 3 bags" / "Up to 7 bags" / "Up to 14 bags" capacity subtext
- ✅ Disabled cards show specific reason: "Too small for 6 pax" or "Not enough space for 10 bags"
- ✅ Multi-line alerts: "You have: 6 passengers (Sedan fits 3) and 10 bags (Sedan fits 3)"

### Why
- Customer test booking showed 3 pax + 10 bags going through as a sedan (impossible)
- Original validation only checked passenger count

---

## v0.5 — 27 April 2026 — Emoji rendering robustness

**Cache version:** `?v=20260427b`

### Shipped
- ✅ `stripEmoji()` helper using comprehensive Unicode ranges (1F000-1FFFF, 2600-27BF, 2300-23FF, plus ZWJs and variation selectors)
- ✅ Removed trailing emojis from vehicle names ("Private Sedan 🚗" → "Private Sedan")
- ✅ Defensive `stripEmoji()` calls in `buildConfirmation` and `buildWhatsAppURL`
- ✅ Cache headers loosened from `immutable` to `max-age=3600, must-revalidate`
- ✅ Cache-busting query strings added to CSS and JS

### Why
- WhatsApp messages were showing `�` characters when forwarded to email/CRM
- Browsers were caching old code aggressively, ignoring deploys

---

## v0.4 — 26 April 2026 — Massive hotel/destination expansion

**Cache version:** `?v=20260427a`

### Shipped
- ✅ Destination dropdown expanded from ~30 to 110+ named locations across 13 optgroups
- ✅ Pickup dropdown expanded from 4 to 60+ options (so guests can book return from any major resort)
- ✅ Routes table grew from 24 rows to 35 with hotel-specific entries
- ✅ Adaptive road multiplier: 1.55× for short trips ramping to 1.70× for 100km+ (matches Viti Levu's curving Queens Road)
- ✅ Piecewise drive-time formula: 40 km/h first 10km (city), 60 km/h next 30km (sugar belt), 75 km/h after that (open highway)
- ✅ Mamanuca + Yasawa boat-pickup destinations (all routed via Port Denarau)

### Why
- Real Fiji booking requires hotel-by-hotel pickup precision
- Single-area pricing (e.g. "Denarau" generic) lost trust
- Drive times needed to match Google Maps reality

---

## v0.3 — 26 April 2026 — Real Fiji market FJD pricing

**Cache version:** `?v=20260427`

### Shipped
- ✅ Researched live competitor pricing (Hot Fiji Deals, Welcome Pickups, TTF, Epic Transfers, fijislands.com)
- ✅ Built tiered FJD pricing model: high $/km on short trips, lower $/km on long trips
- ✅ Pricing constants: Sedan base FJ$25 + zone-based per-km, Minivan FJ$35 base, Minibus FJ$50 base
- ✅ Custom location feature: customer types address + picks zone for pricing estimate
- ✅ Calculator deliberately produces lower estimate than published table (good will)
- ✅ FAQ + schema markup all aligned to new prices

### Why
- Previous AUD-based pricing was too high for long-distance routes (Suva would have been FJ$900+)
- Fiji market reality requires non-linear pricing

---

## v0.2 — 26 April 2026 — Custom location + tour-to-form auto-fill

### Shipped
- ✅ "📍 Other / not listed" option in both dropdowns
- ✅ Reveals custom panel: free-text address + zone dropdown (carries lat/lng for pricing)
- ✅ Tour cards "Book this tour →" auto-fills pickup, destination, trip type, passengers, notes
- ✅ Tour banner injected into booking form when tour is selected
- ✅ Smart asymmetric swap (Coral Coast hotel as pickup → falls back to Custom Pickup)

---

## v0.1 — 25 April 2026 — Initial Cloudflare Pages build

### Shipped
- ✅ 4-step booking wizard (Journey → Vehicle → Details → Confirm)
- ✅ Haversine distance pricing
- ✅ 50+ hotel coordinates
- ✅ Trip type (one-way / return)
- ✅ Pax + luggage counters
- ✅ Vehicle selection (Sedan / Minivan / Minibus)
- ✅ Add-ons (lei, child seat, supermarket stop, surfboard)
- ✅ Form validation
- ✅ WhatsApp confirmation with pre-filled booking
- ✅ Schema markup (TaxiService, FAQPage, LocalBusiness)

---

## How to read this log

Each entry shows what was shipped, when, and why. When you're trying to remember "did we already do X?" — search this file. When you're explaining the platform to someone new, this is the chronology.

When something gets reverted or replaced, leave the original entry intact and add a note — never delete history.
| 2026-05-13 | Session 4 | Palms demo fixed & deployed. WhatsApp button rendering fixed (markdown → green button). Worker v7 deployed with clean WhatsApp buttons. Cross-referral engine tested — Palms → Nadi Transfers firing correctly. Partner onboarding form live at vakaviti-join-page.pages.dev. Partner dashboard live at vakaviti-dashboard.pages.dev with login, leads, stats, settings. D1 contact_email column added. SendGrid configured. vakaviti.ai domain added to Cloudflare — awaiting nameserver propagation. |
| Partner Onboarding | vakaviti-join-page.pages.dev | ✅ Live |
| Partner Dashboard  | vakaviti-dashboard.pages.dev | ✅ Live |
