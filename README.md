# Fiji Platform — Build Repository

> All source code, configuration, and documentation for Fiji Tour Transfers' digital platform.
>
> **Brand:** Fiji Tour Transfers
> **Operator:** James Deorajan (solo operator, Australia-registered, Fiji-based ground operations)
> **Contact:** tourfijitours@gmail.com / WhatsApp +61 478 886 145

---

## What's in this repo

This repository is the source-of-truth backup for everything we've built. It exists so:

1. If Cloudflare ever goes down or we lose access, we can rebuild from these files
2. Every change to live systems is dated and explainable through git history
3. A future developer (or future James, six months from now) can read this and understand what's going on
4. We can roll back any deploy if something breaks

**What is NOT in this repo:** API keys, secrets, credentials, customer data. Those live in Cloudflare Workers' encrypted storage. If you ever see anything that looks like a secret in a file here, it's a bug — fix it.

---

## What's actually live

As of 6 May 2026, the following systems are live and serving real traffic:

| System | URL | What it does |
|---|---|---|
| **FTT Booking Site** | https://nadiairporttransfers.com | Customer-facing transfer booking widget + 22 hotel landing pages + chat AI |
| **Vakaviti** | https://vosavakaviti.com | Free Fijian language dictionary (160 words, SM-2 spaced repetition, XP system) + chat AI |
| **Vakaviti (preview URL)** | https://vakavitifijiandictionary.pages.dev | Same site, original Cloudflare Pages URL — kept as fallback |
| **Chat Worker** | https://fiji-chat-widget.helpronline.workers.dev | Backend powering the customer chat on both above sites |
| **Drafting Console** | https://fiji-drafting-console.helpronline.workers.dev | Internal tool for drafting WhatsApp replies (James-only) |

All systems are deployed via Cloudflare. Free tier across the board so far. Daily $50 cost cap on the chat AI.

---

## Repo structure

```
fiji-platform/
├── README.md                       ← this file
├── ftt-booking-site/
│   └── src/                        ← live FTT booking site (v0.17)
│       ├── index.html
│       ├── app.js                  ← booking widget logic
│       ├── styles.css
│       ├── chat-widget.js          ← floating customer chat
│       ├── sitemap.xml
│       ├── _headers, _redirects, wrangler.toml
│       ├── worker.js               ← Pages-attached worker (mostly stub)
│       └── transfer/               ← 22 hotel landing pages (SEO)
│
├── vakaviti/
│   └── src/                        ← live Vakaviti dictionary (v1.1)
│       ├── index.html              ← main app, AI footer disclosure included
│       ├── style.css
│       ├── app.js                  ← main app logic
│       ├── words.js                ← 160-word dictionary
│       ├── quiz.js, drill.js       ← learning mechanics
│       ├── xp.js, dashboard.js     ← XP/tier system (Vulagi → Turaga)
│       ├── phonetics.js, guide.js  ← phonetics practice + guide
│       ├── sponsors.js             ← dynamic sponsor display
│       ├── streak.js, pb.js        ← streak tracking, personal bests
│       ├── rankcard.js             ← shareable rank cards
│       ├── sponsor-admin.html      ← separate sponsor admin page
│       └── chat-widget.js          ← same widget as FTT, scoped origin
│
├── workers/
│   ├── chat-widget/
│   │   └── worker.js               ← serves both nadiairporttransfers.com + Vakaviti
│   └── drafting-console/
│       ├── worker.js               ← internal AI drafting backend
│       └── console.html            ← internal HTML interface (James only)
│
├── docs/                           ← strategic + reference documentation
│   ├── README.md                   ← project overview (older, FTT-focused)
│   ├── VISION.md                   ← what we're building, who we serve
│   ├── ROADMAP.md                  ← prioritised feature list
│   ├── BUILD_LOG.md                ← chronological history of shipped work
│   ├── STATUS.md                   ← snapshot at last known state
│   ├── PRICING_MODEL.md            ← pricing logic (NOTE: outdated, see "Known issues" below)
│   ├── HOTEL_DATABASE.md           ← all supported hotels
│   ├── TOUR_CATALOGUE.md           ← featured tour roster
│   ├── BRAND_GUIDELINES.md         ← brand consistency rules
│   ├── METRICS.md                  ← what we measure
│   ├── DEPLOYMENT.md               ← how to push to Cloudflare
│   └── INTEGRATION_BACKLOG.md      ← Stripe, hotel partners, etc — not yet built
│
└── archives/
    ├── ftt-booking-site-v0.17-20260505.zip   ← exact zip uploaded to Cloudflare
    └── vakaviti-v1.1-20260505.zip            ← exact zip uploaded to Cloudflare
```

---

## How the systems fit together

```
┌────────────────────────────┐         ┌────────────────────────────┐
│  nadiairporttransfers.com  │         │      vosavakaviti.com      │
│  (FTT booking site)        │         │      (Vakaviti app)        │
│                            │         │                            │
│  - Booking widget          │         │  - Fijian dictionary       │
│  - 22 hotel SEO pages      │         │  - Quizzes, XP, prizes     │
│  - Chat widget ────────────┼────┐    │  - Chat widget ────────────┼───┐
└────────────────────────────┘    │    └────────────────────────────┘   │
                                  │                                     │
                                  │   ┌──────────────────────────────┐  │
                                  └──►│  fiji-chat-widget Worker     │◄─┘
                                      │                              │
                                      │  - Shared system prompt      │
                                      │  - $50/day cost cap          │
                                      │  - KV: daily token tracking  │
                                      │  - Origin allowlist:         │
                                      │    nadiairporttransfers.com  │
                                      │    vosavakaviti.com          │
                                      │    vakavitifijiandictionary  │
                                      │    .pages.dev                │
                                      └──────────────┬───────────────┘
                                                     │
                                                     ▼
                                      ┌──────────────────────────────┐
                                      │  Anthropic API               │
                                      │  Model: claude-sonnet-4-5    │
                                      │  Account: tourfijitours@     │
                                      └──────────────────────────────┘

┌──────────────────────────────────┐  ┌──────────────────────────────┐
│  fiji-drafting-console (James)   │  │  Anthropic API               │
│                                  │─►│  (same account as above)     │
│  - WhatsApp draft generation     │  └──────────────────────────────┘
│  - James-only (no auth, just URL)│
│  - Returns structured JSON       │
└──────────────────────────────────┘
```

---

## Critical operational facts

### Cloudflare account: `helpronline` (Helpronline@gmail.com)

- All Workers live here
- All Pages projects live here
- Cloudflare Registrar holds: `vosavakaviti.com`
- KV namespace: `CHAT_USAGE` (used by chat Worker for daily token tracking)
- Secrets stored: `ANTHROPIC_API_KEY` (in both Workers, same key)

### Anthropic account

- Login: `tourfijitours@gmail.com` (separate from Helpronline Cloudflare login)
- Tier 1, organization "Fiji Tour Transfers"
- Credits: $5.50 purchased 4 May 2026 (~$0.75 used as of 6 May 2026)
- Auto-reload: DISABLED (deliberate — manual refills keep cost surprises away)
- One API key in use: `fiji-drafting-console` (despite the name, it powers BOTH Workers)

### Search engines

- Google Search Console verified for: `nadiairporttransfers.com`, `vosavakaviti.com`
- Bing Webmaster Tools imported via GSC for both
- Sitemap submitted for FTT site (23 URLs)
- Sitemap NOT yet submitted for Vakaviti — TODO

### Pricing data

The chat AI's pricing data lives inside `workers/chat-widget/worker.js` in the system prompt. It must match what the booking widget computes. **As of 6 May 2026, these are aligned.**

`docs/PRICING_MODEL.md` is OUTDATED and does not match either the chat AI or the booking widget. It needs updating.

---

## Known issues / TODO at time of repo creation

These are the things actively known to need attention (not "things we might want to build" — those are in `docs/ROADMAP.md`):

1. **`docs/PRICING_MODEL.md` is outdated.** Real prices live in `ftt-booking-site/src/app.js` and `workers/chat-widget/worker.js`. Update the doc to match.
2. **No `sitemap.xml` for Vakaviti.** Single-page app, but a sitemap helps Google understand `https://vosavakaviti.com/` is the canonical URL (vs the older `pages.dev` URL).
3. **"500+ five-star reviews" claim** on FTT homepage hasn't been verified. Australian Consumer Law treats this as a representation. Check actual review counts before any further SEO promotion.
4. **22 hotel landing pages have `[NEEDS YOUR INPUT]` placeholders.** Real driver-perspective content (gate codes, drop-off zones, after-hours notes) needs writing.
5. **8+ Cloudflare projects exist that aren't accounted for in this repo** — including a typo'd `ransfersnadidenarau` and several mystery landing-page experiments. Worth auditing.
6. **Browser TTS audio in Vakaviti** sounds robotic for Fijian words. The credibility unlock is real native-speaker audio recordings (160 short clips). Non-trivial but transformative.
7. **No `TODAY.md` / `WEEKLY.md` daily/weekly habit yet.** Will be added when ready.

---

## How to deploy

**For non-technical understanding:** Each "site" lives in a folder here. To update the live site, you zip up that folder's `src/` directory and upload the zip to Cloudflare Pages. See `docs/DEPLOYMENT.md` for detailed steps.

**Worker deploys:** Open the corresponding Worker in Cloudflare's dashboard, click "Edit Code," paste in the updated `worker.js` from this repo, click "Deploy."

**Cache versions:** When deploying the FTT site, bump the cache version in `index.html` (look for `?v=YYYYMMDDx` in the script/link tags). Pattern: `?v=20260505a` for first deploy of 5 May 2026, `b` for second, etc.

---

## How this repo gets maintained

**The discipline that keeps this repo useful:**

- Every Cloudflare deploy → commit the corresponding files to the repo with a meaningful message
- Major changes → bump version numbers in this README and in `docs/BUILD_LOG.md`
- New live URLs → add to the "What's actually live" table above
- Closed issues → remove from the "Known issues" section above

**The discipline that destroys repos:** committing things "for now" without explanation, letting the repo drift from what's actually deployed, leaving stale TODOs forever.

If a file in this repo doesn't match what's actually live, the file in this repo is wrong — fix it.

---

## License

Private repository. All rights reserved by Fiji Tour Transfers / James Deorajan.

---

*Repository created 6 May 2026. Last updated: 6 May 2026.*
