# Vakaviti.ai — Platform Build Log
**Fiji's AI Tourism Partner Network**
Last updated: 24 May 2026 — Session 28

---

## Platform Overview

| Item | Detail |
|---|---|
| Cloudflare Account | 595101df2c562b3c65595420d43f9fe1 |
| D1 Database | vakaviti-kb (e697a253-e5fc-4201-939c-9aaeca6c5278) |
| GitHub Repo | github.com/jamesdeorajan-sys/fiji-platform |
| AI Model | claude-sonnet-4-6 |
| Lagi Capability Score | 94% (29/31 tests) |
| Total Monthly Visits | 20,000+ across all partner sites |

---

## Workers (15 live)

| Worker | URL | Version | Purpose |
|---|---|---|---|
| fiji-chat-widget | fiji-chat-widget.helpronline.workers.dev | v54 | Lagi AI concierge — all chat |
| vakaviti-reviews | vakaviti-reviews.helpronline.workers.dev | v4 | Review ingestion + operator response + admin |
| vakaviti-reviews-scheduler | vakaviti-reviews-scheduler.helpronline.workers.dev | v1 | Auto-publish cron (hourly: 0 * * * *) |
| vakaviti-leads-v2 | vakaviti-leads-v2.helpronline.workers.dev | v2 | Lead storage + crypto review token generation |
| vakaviti-leads | vakaviti-leads.helpronline.workers.dev | v1 | Legacy lead handler |
| vakaviti-dashboard-api | vakaviti-dashboard-api.helpronline.workers.dev | v1 | Partner dashboard auth + data |
| vakaviti-config | vakaviti-config.helpronline.workers.dev | v1 | Widget config from D1 |
| vakaviti-events | vakaviti-events.helpronline.workers.dev | v1 | Analytics beacon |
| vakaviti-onboard | vakaviti-onboard.helpronline.workers.dev | v1 | Partner self-registration |
| vakaviti-whatsapp | — | v5 | WhatsApp Business API |
| vakaviti-ingest-bl | — | v1 | Blue Lagoon KB ingest |
| vakaviti-join | — | v1 | Join page handler |
| vakaviti-dashboard-api | — | v1 | Dashboard API |
| fijitourtransfers-guides | — | v1 | FTT guides |
| fiji-drafting-console | — | v1 | Internal drafting tool |

---

## Cloudflare Pages (live)

| Project | URL | Notes |
|---|---|---|
| vakaviti-reviews-feed | vakaviti-reviews-feed.pages.dev | Public reviews feed |
| vakaviti-reviews-submit | vakaviti-reviews-submit.pages.dev | submit.html + respond.html + reviews-admin |
| lagi-capability-test | lagi-capability-test.pages.dev | 30-test capability suite |
| vakaviti-bluelagoon | vakaviti-bluelagoon.pages.dev | Blue Lagoon demo |
| vakaviti-palms-denarau | vakaviti-palms-denarau.pages.dev | Palms demo |
| vakaviti-nadi-transfers | vakaviti-nadi-transfers.pages.dev | Nadi Transfers demo |
| vakaviti-tourfiji | vakaviti-tourfiji.pages.dev | Tour Fiji demo |
| vakaviti-sofitel | vakaviti-sofitel.pages.dev | Sofitel demo |
| vakaviti-lagi-public | lagi.vakaviti.ai | Public Lagi interface |
| vakaviti-dashboard | dashboard.vakaviti.ai | Partner dashboard |
| vakaviti-join-page | join.vakaviti.ai | Partner join page |
| vakavitiai | vakaviti.ai | Main site |
| fttlandingpage | nadiairporttransfers.com | FTT booking site |
| vakaviti-privacy | vakaviti-privacy.pages.dev | Privacy policy |

---

## D1 Database — vakaviti-kb

### Tables

| Table | Purpose | Notes |
|---|---|---|
| partners | Partner registry | 15+ active partners |
| embed_config | Widget config per site_id | theme, greeting, intents |
| leads | All leads + cross-referrals | auto-captured from Lagi conversations |
| reviews | Vakaviti Reviews | 4 total — 2 published, 2 pending |
| kb_chunks | Knowledge base manifest | 51 verified chunks |
| partner_referrals | Cross-referral routing | 6 active referral rules |
| conversation_events | Analytics + self-learning | message, open, security_flag events |
| contact_channels | Partner notification channels | email, webhook, whatsapp |
| deals | Live deals engine | 5 active deals |
| knowledge_queue | Self-learning queue | ingested from conversations |
| knowledge_items | Verified KB items | growing via Layer 4 |
| question_clusters | Intent clustering | — |

### Views

| View | Purpose |
|---|---|
| partner_review_stats | Aggregated avg_rating, total_reviews, cultural_score per partner |

### Indexes (reviews table)

- `idx_reviews_partner_published` — partner page render
- `idx_reviews_status_created` — master feed
- `idx_reviews_partner_rating` — sort by stars
- `idx_reviews_cultural_score` — Vakavanua leaderboard
- `idx_reviews_token_partner` — duplicate detection

---

## Lagi Intelligence — fiji-chat-widget v54

### Architecture

| Layer | Purpose |
|---|---|
| Layer 1 — Soul | Lagi character, voice, lead capture rules |
| Layer 2 — Partner Context | Partner name, category, region, live review metrics |
| Layer 3 — Network Intelligence | Cross-referral routing, partner directory |
| Layer 4 — Fijian Language | Dictionary vectors, cultural teaching |

### Capabilities

| Feature | Status |
|---|---|
| RAG — 449+ Vectorize vectors | ✅ Live |
| Intent detection — 12 intents | ✅ Live |
| Cross-referral engine | ✅ Live |
| Lead capture — auto (phone/email detection) | ✅ Live |
| Heat scoring — 4 tiers | ✅ Live |
| Deals engine — 5 live deals | ✅ Live |
| Itinerary builder — email on lead capture | ✅ Live |
| Self-learning loop — every conversation → Vectorize | ✅ Live |
| WhatsApp Business API | ✅ Live (Meta App ID: 1700903951357623) |
| Prompt injection security | ✅ Blocked + logged |
| Rate limiting | ✅ 200 msg/IP/hour |
| **Live review metrics injection (v54)** | ✅ Live — parallel D1 query via Promise.all |
| Capability test score | **94% (29/31)** |

### v54 Review Metrics Feature

```
getPartnerReviewStats() → queries partner_review_stats D1 view
formatReviewStats()     → formats for system prompt injection
Promise.all([RAG, partnerLookup, deals, reviewStats])
→ all parallel, zero latency cost
→ Lagi quotes: avg_rating, total_reviews, vakavanua_certified
```

**Example output:**
> "Blue Lagoon Beach Resort holds a perfect 5-star average across 2 verified Vakaviti reviews — both awarded Vakavanua Certified status for cultural respect."

---

## Vakaviti Reviews V1 — Complete

### Pipeline

```
Traveller submits via submit.html
        ↓
POST /review → D1 insert (status: pending)
        ↓
Team notified via SendGrid
        ↓
Operator notified → respond.html link in email
        ↓
Operator responds via respond.html
        ↓
Status: conciliating
        ↓
48hr deadline → auto-published (scheduler)
OR team publishes via reviews-admin dashboard
        ↓
Published review appears on vakaviti-reviews-feed.pages.dev
        ↓
Lagi quotes live metrics in conversations
```

### Pages

| URL | Purpose |
|---|---|
| vakaviti-reviews-submit.pages.dev/submit.html | Traveller submission — 3-step, zero friction |
| vakaviti-reviews-submit.pages.dev/respond.html | Operator response — loads via ?review_id=&partner_id=&token= |
| vakaviti-reviews-submit.pages.dev/reviews-admin | Admin dashboard — password: vakaviti-admin-2026 |
| vakaviti-reviews-feed.pages.dev | Public feed — filter by rating, Vakavanua Certified |

### Worker Endpoints — vakaviti-reviews v4

| Method | Path | Purpose |
|---|---|---|
| GET | /health | Health check |
| POST | /review | Submit new review |
| GET | /review/lookup | Fetch review for respond form |
| POST | /review/respond | Operator submits response |
| GET | /reviews-admin | Fetch all reviews for dashboard |
| POST | /reviews-admin/update | Approve / reject / change visibility |

### Admin Actions

- ✅ Publish now
- ❌ Reject
- 🌐 Make response public
- 🔒 Make response private
- 📋 Copy operator respond link
- 🔗 Copy review ID

---

## vakaviti-leads-v2 — Booking-to-Review Pipeline

**URL:** vakaviti-leads-v2.helpronline.workers.dev

**Review seeding intents:** `transfer`, `activity`

**Flow:**
```
Lead received (transfer/activity intent)
        ↓
generateReviewToken() → crypto.getRandomValues(32 bytes) + SHA-256 HMAC
        ↓
seedPendingReview() → inserts into reviews table (null rating/text)
        ↓
buildReviewUrl() → pre-filled submit link with partner_id + token
        ↓
Partner notification email → includes review follow-up URL
        ↓
Response: { ok, lead_id, score, review_token, review_id, review_url, review_seeded: true }
```

**Bindings:**
- DB → vakaviti-kb
- SENDGRID_API_KEY → secret
- REVIEW_BASE_URL → https://vakaviti-reviews-submit.pages.dev

---

## Live Partner Sites with Lagi Installed

| Domain | Monthly Visits | Site ID | Status |
|---|---|---|---|
| fijitourtransfers.com | 8,960 | op_fijitourtransfers_001 | ✅ Live |
| nadiairporttransfers.com | 2,740 | op_nadi_001 | ✅ Live |
| guidefiji.com | 2,130 | op_guidefiji_001 | ✅ Live |
| fijithingstodo.com | 1,560 | op_fijithingstodo_001 | ✅ Live |
| bestfijitours.com | 1,280 | op_bestfijitours_001 | ✅ Live |
| vosavakaviti.com | 921 | op_vosavakaviti_001 | ✅ Live |
| vakaviti.ai | 786 | platform | ✅ Live |
| tourfijitours.com | — | op_tourfijitours_001 | ✅ Live |
| fijihomestayz.com | 1,170 | — | ⏳ Pending install |
| realfiji.tours | 1,080 | — | ⏳ Pending install |
| fijiepictours.com | 986 | — | ⏳ Pending install |
| fijitours.online | 967 | — | ⏳ Pending install |
| fijidaytours.com.au | 756 | — | ⏳ Pending install |
| bookfijitours.com.au | 632 | — | ⏳ Pending install |

---

## Security

| Item | Status |
|---|---|
| ANTHROPIC_API_KEY | ✅ Fresh key `vakaviti-worker` — auto-reload billing ON |
| SENDGRID_API_KEY | ✅ Rotated to `vakaviti-ai-v2` across all Workers |
| Master bypass code | ✅ Removed Session 5 |
| Prompt injection | ✅ Blocked + logged (17 attempts at Blue Lagoon) |
| Rate limiting | ✅ 200 msg/IP/hour |
| API keys in browser | ✅ Never — all through Workers |

---

## Pending — Next Sessions

### 🔴 URGENT

**WordPress fijitourtransfers.com — conversion emergency**
- `moment is not defined` + `Unexpected end of input` JS crash blocking all bookings
- 4,000+ Meta Ad visitors, zero conversions since May 1
- Hotfix ready — vanilla JS date handlers (Asset 1) + Lagi widget 30s delay (Asset 2)
- Notification channel fixed in D1 ✅
- **Action:** Log into WP Admin → Code Snippets → paste hotfix

**nadiairporttransfers.com app.js fix**
- ftt-booking-site/src/app.js on GitHub
- Replace all `FijiTransfers` → `Nadi Airport Transfers`
- Replace all `61478886145` (AU number) → Fiji number

### 🟡 Medium

- Add `reviews.vakaviti.ai` custom domain to vakaviti-reviews-feed Pages project
- Fix submit form root URL — rename to index.html (serves at /)
- Connect operator respond URL into team notification email automatically
- Install Lagi on 6 pending sites (fijihomestayz, realfiji.tours, fijiepictours, fijitours.online, fijidaytours, bookfijitours)
- Redeploy lagi-capability-test with fixed test logic (2 tests have wrong check conditions)

### 🟢 Low

- Tourism Fiji endorsement outreach
- Stripe integration for partner billing
- GitHub → Cloudflare Pages auto-deploy (eliminate zip uploads)
- Partner [slug].astro dynamic review pages

---

## Session Log

| Session | Date | Key Build |
|---|---|---|
| 1–5 | May 2026 | Platform foundation, D1 schema, fiji-chat-widget v1 |
| 6–10 | May 2026 | RAG vectors, partner KB, Fijian dictionary |
| 11–15 | May 2026 | Lead capture, heat scoring, cross-referral engine |
| 16–20 | May 2026 | WhatsApp API, deals engine, self-learning Layer 4 |
| 21–25 | May 2026 | Partner demo pages, dashboard, knowledge extract |
| 26 | May 2026 | Capability test suite — 94% score |
| 27 | 24 May 2026 | HTTP 500 fixed (credits depleted), API key rotated, auto-reload billing |
| 28 | 24 May 2026 | Vakaviti Reviews V1 complete, vakaviti-leads-v2, fiji-chat-widget v54 |
