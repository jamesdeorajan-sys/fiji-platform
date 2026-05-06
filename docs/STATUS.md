# Project Status — Snapshot at 28 April 2026

> Quick at-a-glance status. Read this first when returning to the project.

## Current build version

**v0.10** — `?v=20260428a`

Latest deliverable: `fiji-transfers-cloudflare.zip`

## What works right now

✅ 4-step booking wizard (Journey → Vehicle → Details → Confirm)
✅ Real-time FJD pricing with tiered tapered model
✅ 110+ hotels with searchable typeahead dropdown
✅ 60+ pickup locations (airports, terminals, major hotels)
✅ Custom address option with zone-based pricing fallback
✅ 35-row routes table with auto-fill "Book →" buttons
✅ Capacity validation (passengers + luggage, recommended vehicle)
✅ 16 featured tours with real images and live links to fijitourtransfers.com
✅ 10% discount on bookings over FJ$50, visible in 6 places
✅ Tour-to-form auto-fill via "Book this tour →"
✅ WhatsApp confirmation with full booking details (emoji-resilient)
✅ Bula success card with concierge-positioning post-booking
✅ Schema markup (TaxiService, FAQPage, LocalBusiness)
✅ Mobile-optimised throughout

## What's not yet built

❌ Stripe payment (still WhatsApp-only confirmation)
❌ Live tour catalogue sync (manual updates only)
❌ Returning-customer profile
❌ Hotel partner integration
❌ AI WhatsApp concierge
❌ Email confirmation system
❌ Driver mobile app
❌ Analytics / metrics dashboard
❌ Returning-customer phone-based profile

## Critical issues to address

1. **Brand consistency** — WordPress site shows 4 different brand identities. Highest-priority non-build fix. See `BRAND_GUIDELINES.md`.

2. **End-to-end QA** — v0.10 has shipped many features rapidly. Need a real-world QA pass on mobile.

3. **No analytics** — Currently flying blind on conversion rates. Need to enable Cloudflare Web Analytics at minimum.

## What to do next (suggested order)

### This week
1. Fix WordPress brand inconsistencies (logo, footer, email)
2. Deploy v0.10 to Cloudflare Pages
3. Test 5 booking scenarios on mobile
4. Enable Cloudflare Web Analytics

### Next 2 weeks
5. Stripe pay-now integration (biggest conversion lever)
6. Email confirmation system

### Next month
7. Hotel partner pilot (negotiate Hilton Denarau)
8. Returning-customer profile
9. Live tour catalogue sync (Option B: weekly tours.json)

## How to find things

- **What we've shipped:** `BUILD_LOG.md`
- **What we plan to ship:** `ROADMAP.md`
- **What we've thought about but not committed to:** `INTEGRATION_BACKLOG.md`
- **How prices are calculated:** `PRICING_MODEL.md`
- **Which hotels we support:** `HOTEL_DATABASE.md`
- **Which tours we feature:** `TOUR_CATALOGUE.md`
- **Brand rules:** `BRAND_GUIDELINES.md`
- **How to deploy:** `DEPLOYMENT.md`
- **What we measure:** `METRICS.md`

## Project team

- **Owner:** Fiji Tour Transfers (you)
- **Build assistant:** Claude (this conversation)
- **Drivers / ground team:** Ben + Fiji-based crew (mentioned in earlier strategic work)
