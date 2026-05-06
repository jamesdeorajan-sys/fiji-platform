# Documentation

Strategic and reference documentation for the Fiji platform.

## What's where

### Strategic
- `VISION.md` — what we're building, who we serve, what we believe
- `ROADMAP.md` — prioritised feature list (NOW / NEXT / SOON / LATER)
- `STATUS.md` — snapshot of current state (last known)
- `BRAND_GUIDELINES.md` — brand consistency rules

### Reference data
- `PRICING_MODEL.md` — pricing logic. **WARNING: Outdated as of 6 May 2026.** Real prices are in `../ftt-booking-site/src/app.js` and `../workers/chat-widget/worker.js`.
- `HOTEL_DATABASE.md` — all supported pickup/destination locations
- `TOUR_CATALOGUE.md` — featured tours

### Operational
- `BUILD_LOG.md` — chronological history of shipped work (last entry: 28 April 2026, predates the AI work)
- `DEPLOYMENT.md` — how to push to Cloudflare
- `METRICS.md` — what we measure
- `INTEGRATION_BACKLOG.md` — Stripe, hotel partners, etc — future work

### Project overview
- `README.md` — older project README (mostly accurate but predates AI infrastructure)

## Notes on staleness

These files were written before the AI chat widget, drafting console, and Vakaviti integration were built. Some details are outdated. The single most authoritative source for "what's currently live" is the root `README.md` of this repo (one level up from this folder).

When updating documentation:
- If something is wrong, fix it
- If something is outdated, mark it `[OUTDATED]` rather than deleting (history matters)
- Date your updates inline so future readers know when claims were verified

## Recommended reading order for someone new

1. Root `README.md` (one level up) — what's live and how it fits together
2. `VISION.md` — the why
3. `ROADMAP.md` — the priorities
4. `BUILD_LOG.md` — the history
5. Whatever specific file matches the task at hand
