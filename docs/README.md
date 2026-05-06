# Fiji Tour Transfers — AI-Driven Booking Platform

> Building the #1 online guest experience in Fiji.

## What this is

An Uber-like, AI-driven booking platform for ground transfers, tours, and on-island concierge services across Fiji. Built to be the single most useful tool a tourist can have during their Fiji stay — from airport pickup to pharmacy run to sunset cruise booking.

**Live site:** https://fijitourtransfers.com
**Booking widget (this project):** Cloudflare Pages deployment
**Brand:** Fiji Tour Transfers
**WhatsApp:** +61 478 886 145
**Email:** info@tourfiji.tours

## Core promise

> "One message. We sort it."

We are on the ground in Fiji, online throughout every guest's stay, ready to deliver any transfer, tour, or errand — from picking up a prescription to organising a private island sailing cruise. We are the #1 team to reach out to during a Fiji holiday.

## Tech stack

- **Frontend:** Vanilla HTML / CSS / JavaScript (no framework — fast, portable, deployable anywhere)
- **Hosting:** Cloudflare Pages (CDN, fast global delivery, free tier)
- **Booking flow:** Multi-step wizard with WhatsApp handoff
- **Pricing engine:** Tiered FJD calculator, road-distance estimation, real-time discount logic
- **Communication:** WhatsApp Click-to-Chat with pre-filled booking details
- **Data:** Static JSON (110+ hotels, 35 routes, 16 featured tours) — synced manually with main site

## Why we win

1. **Real-time price visibility** — no hidden fees, customer sees price before committing
2. **Hotel typeahead** — 110+ hotels searchable in under 2 seconds
3. **10% loyalty discount** on all bookings over FJ$50, applied automatically
4. **Bula success card** — converts the booking moment into ongoing customer relationship
5. **Capacity-aware vehicle suggestions** — we won't let a customer book the wrong vehicle
6. **WhatsApp-first** — Fijian travellers prefer messaging over forms; we meet them there
7. **Live concierge** — beyond transfers: pharmacy, supermarket, tours, medical runs

## Project structure

```
fiji-platform-project/
├── README.md                       ← this file
├── VISION.md                       ← product vision, target customer, competitive position
├── ROADMAP.md                      ← prioritised feature list & build sequencing
├── BUILD_LOG.md                    ← chronological history of what we've shipped
├── METRICS.md                      ← what we measure & how we know we're winning
├── PRICING_MODEL.md                ← tiered FJD calculator logic (single source of truth)
├── HOTEL_DATABASE.md               ← curated list of all 110+ supported pickup/destination locations
├── TOUR_CATALOGUE.md               ← featured tour roster and live-site sync notes
├── BRAND_GUIDELINES.md             ← brand consistency rules (logo, voice, naming)
├── DEPLOYMENT.md                   ← how to push to Cloudflare Pages
├── INTEGRATION_BACKLOG.md          ← Stripe, WordPress sync, analytics — not-yet-built features
└── src/                            ← actual deployable site (current build)
    ├── index.html
    ├── app.js
    ├── styles.css
    ├── _headers
    ├── _redirects
    ├── wrangler.toml
    └── worker.js
```

## How we work

1. **Iterative builds.** Every change ships as a fresh `.zip` ready to drop into Cloudflare Pages.
2. **Cache-busted.** Every build bumps `?v=YYYYMMDDx` query strings so customers always see the latest.
3. **Test before celebrating.** Every change should be tested through a real booking on the deployed URL.
4. **One source of truth.** The pricing model, hotel list, and tour catalogue all live in this project — anything that drifts from these docs is a bug.

## Current status

See `BUILD_LOG.md` for what's shipped, `ROADMAP.md` for what's next.

## Contact

Project owner: Fiji Tour Transfers team
WhatsApp: +61 478 886 145
