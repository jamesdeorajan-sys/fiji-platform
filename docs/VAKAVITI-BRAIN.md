# VAKAVITI-BRAIN.md
# James Richardson — CEO Intelligence File
# Fetched by Claude at the start of every session
# Updated by Claude at the end of every session
# Last updated: Session 56 — 2026-07-09/10

---

## 1. WHO WE ARE

**Company:** Vakaviti.ai — Fiji's AI Tourism Partner Network
**Mission:** Build Fiji's most powerful AI tourism platform
**Stage:** POST-LAUNCH. July 1 2026 public + partner launch date has passed. Platform is live. Focus shifts to growth, partner expansion, and open priority items.
**Founded by:** James Richardson — CEO
**WhatsApp:** +61 478 886 145
**Email:** helpronline@gmail.com
**GitHub:** github.com/jamesdeorajan-sys/fiji-platform
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1
**Operating entity:** AJ Group Enterprises Pty Ltd
**Ground ops:** Ben (Fiji) — company registration for Fiji Tourism Guide Ltd

---

## 1.5 RELATED PROJECT — Come to Fiji (separate repo)

**Repo:** github.com/jamesdeorajan-sys/come-to-fiji (private) — own `BUILD.md` in that repo is the source of truth for this project specifically, not this file.

**What it is:** Standalone Next.js flight-search + trip-planner site at `cometofiji.com`. Not part of the core Lagi/Worker platform, but part of the same revenue funnel — it funnels tour/transfer bookings directly into `fijitourtransfers.com`, one of this network's own 50+ partner sites.

**Status as of 2026-07-07 (9 build sessions):** Live, SSL, custom domain connected. Fixed a critical bug where all 14 API routes were dead code (built as classic Cloudflare Pages Functions but the site builds via `@cloudflare/next-on-pages`, which ignores that convention entirely — converted all 14 to real Next.js Route Handlers). Real tour/transfer inventory (51 tours, 20 transfers) synced from `fijitourtransfers.com`'s WooCommerce Store API. Real live flight pricing via Duffel, with correct multi-passenger pricing (adults/children/infants) verified across flights, tours, and transfers. Full AI-visibility infrastructure built and submitted to Google Search Console + Bing (llms.txt, robots.txt, server-rendered JSON-LD schema, real D1-backed sitemap) — same pattern as this network's other 39 properties.

**Known open items (non-blocking):** hotel pricing has no provider (Hotellook was shut down by Travelpayouts); no flight-booking checkout flow yet (Duffel Links exists but costs A$149/mo — deferred, plan is to deep-link out to a booking site instead since flights aren't the margin driver here, tours/transfers are); a couple of small DNS/linking cleanups queued.

**Why this matters to Vakaviti:** same partner network, same operator (James), same Anthropic/Claude-assisted build pattern — worth checking in on periodically from this side, since its health directly affects `fijitourtransfers.com` booking volume.

**Registered in the Vakaviti network as a real partner (7 July 2026, Session 52 of this repo):** cometofiji.com is no longer just "related" — it is now partner #51+ in the same `partners`/`embed_config`/`knowledge_items` system every other operator uses, with real D1 rows, no cometofiji-specific special-casing anywhere in the Worker.

- **`partner_id` = `site_id` = `op_cometofiji_001`** — the exact value the come-to-fiji Next.js app should use for its own widget embed: `<script src="https://widget.vakaviti.ai/widget.js" data-site-id="op_cometofiji_001" defer></script>`. This is the value to hand to the come-to-fiji repo's own Claude Code session for Brief 2 (the embed side, built in that repo, not this one).
- Contact on file: AJ Group Enterprises Pty Ltd, `helpronline@gmail.com` (same operating entity as `op_fijitourtransfers_001`). No WhatsApp number — self-serve website, contact channel is email only.
- 6 `knowledge_items` seeded (AI itinerary planning, live flight comparison, Budget/Best Value/Premium trip-cost tiers) — verified live via `/knowledge-list`.
- A new `flights` intent was added to Lagi's `detectIntent()` specifically so this partner has a collision-free routing category (existing `pricing`/`booking` intents were too broad and shared by every partner).
- Found and fixed a real pre-existing gap: the public `lagi.vakaviti.ai` page's referral button was hardcoded to 5 partner names (not D1-driven), and zero `partner_referrals` rows existed for the public page at all. A generalized fix (D1 lookup first, hardcoded fallback unchanged, plus a website-link button type for partners without WhatsApp) was deployed live by James via the Cloudflare dashboard and verified end-to-end — a plain flight-price question on the public page now correctly returns `referral_btn: {"url":"https://cometofiji.com","label":"Visit Come to Fiji"}`. Full detail, including the 6th fix needed (a missed `BOOKING_INTENTS` allow-list entry), in `docs/BUILD.md` Session 52.
- Known follow-up, not yet done: individual partner-embedded widgets (e.g. Nadi Airport Transfers) still have no cross-referral path to cometofiji.com — would need explicit `partner_referrals` rows from each partner's own `site_id`, a separate larger task.


---

## 2. PLATFORM STATE — CURRENT AS OF SESSION 50

### 🆕 NEW THIS SESSION — Vakaviti Vanua environmental platform built from scratch — government + WRFL pitch ready to deploy

**Context:** James asked for a review of OCRRA.org (Onondaga County Resource Recovery Agency, Syracuse NY) as a design reference for a new Fiji environmental/recycling initiative. This became a full research, design, and build session that produced a genuinely deployable government proposal and a targeted partner pitch — an entirely new initiative sitting alongside the tourism platform, built on the same Vakaviti.ai brand and Lagi AI infrastructure.

**What was built — two deployment-ready HTML files:**

1. **`vanua.vakaviti.ai/index.html`** — full government proposal site (9 sections, ~960 lines). Styled with a distinct civic reef-green palette deliberately different from Vakaviti's tourism warmth. Sections: The Moment (current Fiji environmental policy context), The Proposal (four-pillar framework), The Engine (why incentives > information), The AI Layer (how Lagi works operationally for all four stakeholders), First Partner (WRFL case), Why Vakaviti.ai, Preview (interactive demo), Phased Rollout, Next Steps. Deployed via Cloudflare Pages to `vanua.vakaviti.ai`, same deploy pattern as all other properties. Includes `_headers` (full security header set: CSP, X-Frame-Options, HSTS), `robots.txt` set to `Disallow: /` — intentionally private since this is a specific pitch to a specific audience, not a public marketing page yet.

2. **`vanua.vakaviti.ai/wrfl-pitch.html`** — standalone WRFL partner pitch document. Emailable link (`vanua.vakaviti.ai/wrfl-pitch`) designed to be sent directly to Amitesh Deo (CEO, WRFL / Founder, PRF). Opens with the 32-year track record as genuine recognition, not flattery. Names specific data that disappears from WRFL's operations every day — things Amitesh already knows from experience. Shows the exact WhatsApp CPR transaction flow (CPR-047 → Lagi Vanua → 5 simultaneous outputs). Makes the pilot ask minimal: one bin, 60 days, no cost to WRFL. Frames the CDR Managing Agency appointment as the strategic prize.

**Research depth — what was confirmed as real:**

- **Fiji's national recycling rate: 0.2%.** Confirmed — Fiji recycled just 477 tonnes out of ~200,000 tonnes generated in 2024. The rate has been stuck for 5 years. 72.4% goes to landfill.
- **Naboro landfill: already at capacity.** Suva's only sanitary landfill, confirmed over capacity and requiring urgent expansion.
- **The CDR pilot is already live.** PM Rabuka announced in March 2026 that the container deposit pilot is running in Suva, Sigatoka, and Lautoka. Legal framework exists since 2011 (Environment Management Container Deposit Regulations). Managing Agency has never been formally appointed — that appointment is pending.
- **WRFL is the real ground operator.** Waste Recyclers Fiji Limited (WRFL) — CEO Amitesh Deo, also founder of Pacific Recycling Foundation (PRF). HQ: Lot 1 Koronivia Road, Nausori. Suva branch: Lot 26 Wailada Subdivision, Lami. Operating since 1994 (32nd anniversary May 4, 2026). Fiji's only multi-stream recycling company. Currently running a USAID-funded I-Recycle Hub pilot in Suva City in partnership with PRF, Suva City Council, and Fiji Development Bank — 5 bins in high-occupancy locations, material transported to Lami yard and shipped to overseas partners.
- **The CPR terminology matters.** PRF deliberately renamed "informal waste pickers" to "Collection Pillars of Recycling" (CPRs) — a formal advocacy position, not casual language. Using this correctly signals to Amitesh Deo that Vakaviti has actually done the homework.
- **Samabula composting already processes 1 tonne/day of market waste.** Suva City Council's own facility, built with Japanese government support. SCC has stated they want to expand it to satellite markets. This is where the organic waste reduction opportunity sits — the facility exists, it just needs coordination at scale.
- **International frameworks Fiji is already inside:** SWAP2 (2025–2028, SPREP-delivered, Agence Française de Développement-funded), Cleaner Pacific strategy (21 Pacific nations), ISLANDS Pacific GEF initiative (14-nation marine litter/e-waste programme), ANZPAC Circular Pacific Plastics Project (already running Phase 2 at a Suva church via SPREP/Australian Government funding).
- **Comparable deposit returns for context:** Lithuania 34% → 92% PET in 2 years after introducing DRS. South Korea 23.7% → 59.1% over 17 years. Western Australia 34% → 65%+ after 4 years of Containers for Change. Austria hit 81.5% in its first year (2025).
- **Financing pathways already exist:** Fiji's 2017 Sovereign Green Bond, Blue Bond pathway, Climate Change Act 2021 create a route to GCF/GEF/ADB concessional finance — this is a bankable digital-infrastructure investment, not a budget line item.
- **Minister name confirmed Session 51.** Hon. Lynda Tabuya is the current Minister for Information, Environment and Climate Change, per the PM's official 16 Dec 2025 cabinet reshuffle (effective 19 Jan 2026). Mosese Bulitavu held the role before that date, then moved to Rural and Maritime Development and Disaster Management — resolving the earlier conflicting-source confusion. See Section 3 P4.

**The core proposition — what Vakaviti Vanua actually is:**

Not a new idea. The missing digital layer between three things already moving in parallel:
1. WRFL/PRF already collecting and running I-Recycle Hubs in Suva — but no digital tracking of what's collected where, by whom, at what volume.
2. The Government's container deposit pilot already live in Suva — but no citizen-facing tool connecting residents to where to return containers.
3. An active network of Collection Pillars of Recycling already doing the physical work — but informally, invisibly, without any dignity of record.

Lagi Vanua's superpower: one verified WhatsApp transaction (CPR-047 / Flagstaff Market / PET / 12kg) generates outputs for 5 stakeholders simultaneously: citizen receipt, CPR contribution record, WRFL collection log, USAID grant report line, government dashboard increment. None of that requires building anything new — the WhatsApp integration, AI verification, D1 logging, multi-stakeholder notification infrastructure is already running in production across 29 tourism partners. Environmental data is a new knowledge domain for the same live engine.

**Approach to WRFL contact:** WRFL's 32nd anniversary was May 4, 2026. Opening with congratulations before anything about the proposal is the right first move. The pitch link is `vanua.vakaviti.ai/wrfl-pitch` — send via WhatsApp or email to Amitesh Deo once deployed.

**What Vakaviti Vanua is NOT:**
- It does not collect waste, run facilities, or pay CPRs — WRFL does that.
- It does not compete with Mission Pacific / Coca-Cola Amatil Fiji's existing cash-for-recyclables programme — it digitizes and verifies it.
- It is not building a government agency or taking on the CDR Managing Agency role itself — it provides the verified transaction layer that whoever becomes the Managing Agency needs.

**Files deployed to `vanua.vakaviti.ai`:** `index.html`, `wrfl-pitch.html`, `_headers`, `robots.txt`. GitHub source: not yet pushed to `fiji-platform` repo — lives only in the Cloudflare Pages deploy. **Worth adding `docs/vanua/` subfolder in the repo in a future session as the initiative grows.**

---

### Session 49 (2026-06-30) — tourfijitours.com AI-visibility audit + fixes, survived a real site crash mid-session

**What happened:** Extended the same AI-visibility audit pattern used on fijitourtransfers.com (Session 46) to tourfijitours.com (op_tourfiji_001), via Claude Code (desktop app) connected over the WordPress REST API using a dedicated Application Password user (`ai-audit`). Audit found a much bigger gap than fijitourtransfers.com had: **zero JSON-LD schema anywhere on the site** (no Organization/LocalBusiness/Product/Tour/WebSite), no llms.txt (route 404'd to the homepage instead), robots.txt missing 4 explicit AI-crawler entries (still allowed via the wildcard `*` rule, but not explicit), and a stale sitemap (April vs real content updated June 28).

**Fixed and verified live:**
- Sitewide `TravelAgency` JSON-LD schema (Code Snippets ID 6) using real business data: Tour Fiji Tours, +61478886145, info@tourfiji.tours, 113 Rouse Rd Rouse Hill NSW 2155 AU.
- `Product`/`TouristTrip` dual-type JSON-LD schema (Code Snippets ID 7) on every WooCommerce tour page, pulling each tour's real title/price/description/availability dynamically.
- `llms.txt` listing all 71 real tours with real AUD pricing.
- 4 missing robots.txt entries: Claude-SearchBot, Google-Extended, FacebookBot, meta-externalagent.
- WooCommerce products were not included in Rank Math's XML sitemap (`product-sitemap.xml` was empty) — toggled on.

**Key technical finding, twice:** Rank Math intercepts both the `/llms.txt` and `/robots.txt` routes directly at a level that a WordPress filter-hook snippet cannot override (confirmed for llms.txt via 4 different filter hooks, all ineffective; confirmed for robots.txt via Rank Math's own "locked, file present" UI message). The fix that worked for both: a one-time "run once" PHP snippet that uses `file_put_contents()` to write the desired content directly to the physical file at `ABSPATH`, then immediately deletes itself. This is now the established pattern for any future Rank Math route override on this network — filter hooks don't work, direct file writes do.

**🔴 Real incident — site went down (500 on every page) mid-fix:** A leftover temp diagnostic snippet (Code Snippets ID 12, a `register_rest_route` endpoint meant to be deleted earlier in the session — the delete call had returned 500 and silently failed to actually delete it) caused a PHP fatal error platform-wide. Root cause is believed to be `register_rest_route` running at the wrong WordPress lifecycle hook colliding with another route, though not confirmed with full certainty since the crash made further live debugging impossible. **Recovery, fully successful, no data loss:**
1. Hostinger hPanel → File Manager → renamed the `code-snippets` plugin folder to `code-snippets-disabled` → site back up immediately.
2. phpMyAdmin → `UPDATE wp_snippets SET active = 0;` (found the correct database among 6 on the shared hosting account by reading `DB_NAME` out of `wp-config.php` first — multiple sites share this Hostinger account with randomly-named databases).
3. Renamed the plugin folder back to `code-snippets` — site stayed up, since every snippet was now inactive at the DB level even with the plugin itself active again.
4. Reactivated only the two known-good schema snippets (6 and 7) one at a time, fetching the homepage + a tour page after each to confirm 200s before proceeding.
5. Deleted/trashed the junk and one-time snippets (5, 8, 9, 10, 11, 12, 13) — Code Snippets' REST API soft-deletes (returns 204 but keeps the row inactive) rather than hard-deleting; left as-is since inactive is functionally harmless.

**Bonus find while investigating, unrelated to the crash:** Found 2 stale/wrong schema blocks live on tourfijitours.com, in a completely different plugin than expected — **WPCode (Insert Headers and Footers)**, not Code Snippets. ID 16062 was fijitourtransfers.com's own `TravelAgency` schema (wrong site entirely — FAQPage + ItemList blocks all pointing at the wrong domain). ID 15972 was an older, superseded `TouristInformationCenter` schema for tourfijitours.com itself, now redundant since Code Snippet 6 replaced it. Both trashed via WPCode's UI; confirmed via page-source search that zero "fijitourtransfers" references remain anywhere on tourfijitours.com. **Learned: tourfijitours.com runs both Code Snippets and WPCode simultaneously, doing overlapping jobs** — worth checking both on any future audit of this site, not just the obvious one.

**Access discipline held throughout:** `ai-audit` was elevated to Administrator twice (once for the fix pass, once for the stale-schema investigation) since Code Snippets/Rank Math write operations require `manage_options`, which the REST API enforces even for an authenticated Application Password user with no role. Reverted to Subscriber immediately after each use — same one-token-one-use discipline already established for GitHub PATs.

**🔧 Real platform-wide risk flag, not specific to this site:** A custom `register_rest_route` added via the Code Snippets plugin is a confirmed single point of total-site-failure risk. Going forward on any WordPress partner site: avoid persistent custom REST routes via Code Snippets; prefer the "run once, write what's needed, delete the snippet immediately" pattern that successfully fixed llms.txt and robots.txt here. If a persistent diagnostic/log endpoint is ever genuinely needed, build it as its own properly-scoped plugin file, not a Code Snippets entry.

**999999 master OTP bypass code (P8, flagged since Session 5) — investigated, not yet found.** Searched the live GitHub source of `workers/chat-widget/worker.js`, `workers/vakaviti-leads-v2/worker.js`, and `ftt-booking-site/src/*` directly — no match for "999999", "otp", "bypass", or "master" anywhere in any of them (only false-positive CSS `z-index: 999999` hits). This strongly suggests the OTP/master-code login logic lives in a Worker that was **never pushed to GitHub at all** — the same kind of backup gap that hit chat-widget for 19 sessions before Session 46 fixed it. Most likely candidates, never directly confirmed: partner dashboard auth, or join.vakaviti.ai onboarding. **Needs James to identify which live Worker actually has this logic** before it can be pulled, reviewed, and fixed — can't be found by searching code that was never backed up.

**Unblocked Claude Code on James's laptop, no admin rights required.** James's Windows laptop has no admin access, which initially blocked Claude Code's "Git is required for local sessions" requirement (the standard Git for Windows installer needs admin/UAC). Fixed with: PortableGit (the official `PortableGit-x.x.x-64-bit.7z.exe` self-extracting archive from the git-for-windows GitHub releases page — no installer, no admin, no registry changes) extracted to `C:\Users\James\PortableGit`, plus a **User-level** (not System-level — critically, this doesn't need admin) environment variable `CLAUDE_CODE_GIT_BASH_PATH` pointing at `C:\Users\James\PortableGit\bin\bash.exe`. A full laptop restart was needed for Claude Code to pick up the new variable (just quitting/reopening the app wasn't enough). This unblocks using Claude Code itself for live site work (REST API calls, file edits) going forward, not just this chat interface, which has no live network access to external sites at all.

---

### Session 48 (2026-06-26) — DiscoverFiji.ai fully migrated into the Vakaviti.ai/Lagi ecosystem, AI-visibility infrastructure built, content scaling started

**Biggest decision of the session:** discovered that "DiscoverFiji.ai" / "Discover Fiji" is a genuinely contested name — it collides with Tourism Fiji's own government tagline, with Rosie Travel Group's discoverfiji.com (a 50-year incumbent, airport-distributed printed guide since 2019, relaunched as a full booking platform Sept 2025), and with at least two other unrelated operators (Discover My Fiji, discoverfiji.com.au). Decided to fold the whole initiative into the Vakaviti.ai/Lagi brand instead of fighting for a name that's structurally hard to ever own. This was the right call given Vakaviti.ai already has zero naming collisions and is the established platform brand.

**What changed as a result:**
- New domain: **discover.vakaviti.ai** (subdomain, CNAME in Cloudflare DNS, "DNS only"/grey cloud since it points to Vercel) — added to the existing Vercel project alongside `discoverfiji.vercel.app`. Confirmed: `discoverfiji.ai` itself was **never actually connected** to the Vercel project at all (only ever existed as the default `.vercel.app` URL) — so there's nothing live to redirect away from yet; if James registers/reconnects `discoverfiji.ai` later, a 301/308 redirect to `discover.vakaviti.ai` via Vercel's Domains "Redirect to Another Domain" option is the next step (NOT YET DONE).
- All on-page "DiscoverFiji.ai" branding removed from the codebase — homepage footer/heading, destination page back-link/footer/meta-title fallback, layout.tsx metadata. Now reads "Lagi by Vakaviti.ai" / "Lagi — Fiji's AI travel guide" / "Powered by Vakaviti.ai" throughout. Canonical domain set to discover.vakaviti.ai.
- **Dropped Supabase + OpenAI entirely**, migrated to a dedicated Cloudflare D1 database: **discoverfiji-content** (ID `2414dae8-f76f-4e18-877e-031a9d42fca4`). Deliberately a *separate* D1 database from `vakaviti-kb` — keeps this site's content fully isolated from the live, revenue-critical partner/lead data, while staying 100% Cloudflare (no new vendor). Schema: destinations, tours, resorts, partners, reviews, blog_articles (6 tables). Since Vercel can't use D1's native Worker bindings, built `src/lib/d1.ts` — a server-only client that calls D1's REST API over `fetch()`, the same pattern the Lagi chat proxy already uses.
- **Built the first real destination page template** (`/destinations/[slug]`) — proven end-to-end with Yasawa Islands + the real, live Sawa-I-Lau Caves tour. This one template now serves every future destination page.
- **Built full AI-visibility infrastructure from scratch** — this app had none of it before this session, unlike the rest of the platform: `robots.ts` (AI crawler allow-list matching fijitourtransfers.com/GEO microsites — GPTBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Bingbot, Google-Extended, FacebookBot, meta-externalagent, Applebot), `sitemap.ts` (dynamic, queries D1 for every published destination — scales automatically, zero per-page maintenance), `llms.txt` route. Added JSON-LD schema directly into the destination template (`buildSchema()`): TouristDestination + Product/Offer per tour + BreadcrumbList.
- **Found and fixed a real bug**: D1's `datetime('now')` produces SQLite's native format (space-separated, no timezone), which isn't valid ISO 8601 for a sitemap's `<lastmod>` tag. Google Search Console correctly flagged "Invalid date" on first submission. Fixed via a `toIsoDate()` conversion in `sitemap.ts`.
- **Submitted to Google Search Console and Bing Webmaster Tools.** GSC: confirmed `vakaviti.ai`'s existing Domain property auto-covers the new subdomain (no new verification needed), sitemap submitted. Bing: imported from GSC in one step, zero errors, IndexNow available in the same dashboard but **not yet configured** (key file not built/pushed).
- **Content build started**: 6 destinations live (Yasawa Islands, Nadi, Natadola Beach, Sigatoka, Coral Coast, Port Denarau), 18 real tours total, all pulled from the live fijitourtransfers.com catalogue (real prices, durations, booking URLs — none invented). Nadi alone now has 12 tours/transfers, a genuinely comprehensive hub. Real seed SQL committed to `d1/seed/` in the discoverfiji repo (batches 1 and 2 pushed; **batches 3 and 4 seed files built locally but not yet pushed to GitHub** — data is live in D1, just missing from repo history, low-priority cleanup).
- **Hit a real data-availability wall**: fijitourtransfers.com's tour search/listing widget is JavaScript/AJAX-rendered — neither paginated archive URLs (`/tours/page/2/`, etc., which return page 1's content regardless of page number) nor location taxonomy archives (`/st_location/suva/`, which return zero tour cards) can be scraped for the remaining ~90 of 108 real tours. **Recommended path: James exports the full product list from WooCommerce admin (Products → Export → CSV) — not yet done.** Until then, further content growth is incremental/manual (homepage tour cards are the only server-rendered source found).
- **Learned a D1 console quirk (twice)**: the Cloudflare dashboard's D1 Console query box is genuinely single-line input — pasting SQL containing literal embedded newlines (e.g. multi-paragraph body text) breaks it ("Requests without any query are not supported"). Fix: use `char(10) || char(10)` concatenation for paragraph breaks instead of literal line breaks, and always verify generated SQL is truly one physical line before handing it to James to paste. Documented in seed file comments for future sessions.

### 🟡 SCOPED BUT NOT STARTED — agentic upgrade for Lagi
James raised that "agentic AI" is the current industry conversation and felt Lagi was falling behind. Did a real scoping pass rather than rushing a build: defined agentic AI precisely (goal-directed, decomposition, real actions, error recovery, persistent memory, knows its limits), assessed Lagi honestly against it (currently a single-shot RAG concierge — strong, but not agentic by any of those six properties), and scoped a bounded, low-risk upgrade: one new tool (`lookup_tours`-style structured query, not vector search) plus a capped tool-call loop (max ~3 iterations) so Lagi can verify real data instead of trusting semantic similarity, and can chain several lookups together for multi-day itinerary requests. **Deliberately deferred building this** — it touches the live Worker serving 29 partners and deserves a focused session, not split attention with content work. Investigated `vakaviti-kb`'s actual schema (via `sqlite_master` query) to find ground truth: **confirmed there is no dedicated `tours` table** — closest structured data is the `deals` table (real price/currency/category/deal_url/valid_until/active, but scoped to promotional deals, not a full catalogue). Recommended the tool query `discoverfiji-content`'s `tours` table instead (cleaner schema, reached via D1 REST API so no Worker binding/redeploy risk) — but flagged that **breadth is the real bottleneck regardless of data source**, since neither table has more than ~20 rows yet. Conclusion: keep growing destination/tour content first (serves this AND the long-term vision below); build the tool-call loop once there's real breadth to query. **Nothing built yet — this is a clean starting brief for next session.**

### 🎯 LONG-TERM VISION (stated explicitly this session)
James's framing: **"Become the Tripadvisor + Expedia + ChatGPT of Fiji."** Answer every possible Fiji travel question, generate personalized itineraries, convert visitors into transfer/tour bookings for Fiji Tour Transfers. Targets: #1 ranking Fiji tourism website globally, #1 AI travel platform for Fiji, thousands of monthly bookings.
Honest breakdown given to James:
- **Tripadvisor (breadth/trust):** needs hundreds of real pages — months-to-years of genuine content work, no shortcut. Reviews system already exists from earlier sessions; needs volume.
- **Expedia (booking conversion):** already structurally in place (direct booking links, zero commission) — explicitly **not** recommended to chase the literal Expedia marketplace/aggregator model, since that would dilute the zero-commission differentiator. This is a conversion-rate problem now, not a build problem.
- **ChatGPT (comprehensive AI):** strongest near-term lever — compounds fastest of the three, directly served by the agentic upgrade scoped above plus continued knowledge growth.
**Key insight:** content breadth (the same `tours`/`destinations` table) is the lever that serves all three pillars simultaneously — this is now the explicit shared priority across DiscoverFiji.ai content work and the future Lagi agentic upgrade.

- **Critical architecture decision: no separate AI brain.** DiscoverFiji.ai's chat proxies server-side to the existing Lagi Worker (fiji-chat-widget) in public mode (site_id: 'lagi_public') — inherits RAG search, heat scoring, D1 lead capture, partner routing, and WhatsApp/email notify automatically, zero rebuilt logic. Rejected the spec's original "own OpenAI chatbot + own vector DB" approach after confirming Cloudflare Vectorize has 10M-vector headroom (Jan 2026 increase) — a second brain would only fragment the same learning signal Lagi already compounds across 29+ partners, not accelerate it.
- **Real bug found and fixed during build:** the Worker's `isAllowedOrigin` check (inside `handleChat`) isn't real browser CORS — it's a manual origin allow-list checked first thing, and it rejects requests with no Origin header at all, which is what a bare server-side `fetch()` sends by default. First live test returned a swallowed 403. Fixed by explicitly setting `Origin: https://vakaviti.ai` on the proxy's server-side fetch call (accurate, not a spoof — DiscoverFiji.ai is part of that network now). **Verified end-to-end with a real conversation:** honeymoon query correctly routed to Blue Lagoon Beach Resort with real live pricing, correct Fijian voice, and the lead-capture flow firing as designed.
- **Booking model:** no separate payment processing — quotes/itineraries hand off to fijitourtransfers.com's existing WooCommerce checkout, same pattern as Lagi's referral buttons elsewhere.
- **Strategic implication:** the Lagi page-awareness bug (top finding, Session 46) is now more urgent, not less — DiscoverFiji.ai shares the exact same brain, so that bug now risks two public-facing surfaces instead of one.
- **Not yet done:** Supabase/OpenAI accounts (James hasn't set these up yet — needed for the content tables: destinations, tours, resorts, reviews, blog_articles, NOT needed for chat, which already works with zero keys), domain DNS connection, the actual 500 destination pages, and the `/knowledge-add` content-ingestion pipeline (with a recommended human-review step before ingestion, since that endpoint has no auth and feeds the same authoritative knowledge base every partner relies on).
- Full detail in Section 21.

### 🔴 TOP FINDING SESSION 46 (still unresolved) — Lagi has no page-level awareness
Live-tested Lagi on a real fijitourtransfers.com tour page (Sawa-I-Lau Caves). Asked "Is this suitable for kids?" — Lagi answered confidently and in detail about the **Cultural Night Tour** (fire dance, lovo feast, specific pricing) — a completely different tour. Root cause confirmed by reading the live Worker source: the embed widget only ever sends `site_id` (identifies the whole site/partner) and never any tour- or page-level identifier. The system prompt has no mechanism to know which of the ~108 tour pages a visitor is actually viewing — it falls back to whatever scores highest in RAG vector search, regardless of page context. **This is a real customer-trust risk, not a cosmetic issue** — a family could book expecting a fire dance and get a cave swim, or vice versa. Fix requires changes to both the embed snippet (pass a page/tour identifier) and the Worker's system-prompt logic (ground answers in that identifier). This is a Vakaviti.ai platform fix, not a WordPress fix. **Top priority for Session 47.**

### 🟢 RESOLVED THIS SESSION — Worker GitHub backup (P1, 19 sessions unresolved)
Root cause was worse than "stale": the GitHub copy wasn't an old version of the real Worker — it was a **completely different single-site draft** (CORS-locked to nadiairporttransfers.com only, refused all bookings, $50/day cost cap, no D1 multi-partner routing). Pulled the real live v57 source directly from James via the Cloudflare dashboard. Found a genuine syntax bug in the pasted source — unescaped nested backticks inside the `WIDGET_V2_JS` template literal (5 instances), almost certainly a copy-paste artifact rather than a live bug, since the Worker demonstrably works. Fixed all 5 with mechanical backslash-escapes (zero logic changes), verified with `node --check`, committed to `workers/chat-widget/worker.js` via a fine-grained PAT, and **independently re-fetched and re-verified from GitHub** (1,875 lines, correct v57 header, passes syntax check). This is now a genuine, restorable backup for the first time in the platform's history.

### 🟢 RESOLVED THIS SESSION — Checkout failure check (P2)
The `sentinel_errors` entry ("checkout payment failed" on fijitourtransfers.com/checkout/, dated 2026-05-24) was tested with a real live booking end-to-end: order received, confirmation email sent correctly. **Checkout is working today.** Note: this created a real test order in live WooCommerce (Pravin Deorajan, $8, Nadi Airport to Aquarius Beach Resort) — James to confirm no real payment was charged and cancel/delete the order so it doesn't sit as a phantom booking or trigger a real driver dispatch.

### 🟢 RESOLVED THIS SESSION — fijitourtransfers.com AI-visibility audit
Carried-forward tasks from BRAIN.md said llms.txt was missing and schema wasn't added — **both were wrong, Praveen had already completed this work, it just was never confirmed back.** Live-audited all four AI-visibility pillars:
- **robots.txt** — live, comprehensive AI crawler allow-list (GPTBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Bingbot, Google-Extended, FacebookBot, meta-externalagent, Applebot)
- **llms.txt** — live, high quality: real tour catalogue, current pricing, June 2026 deals
- **sitemap.xml / sitemap_index.xml** — live via Rank Math, current as of June 19
- **JSON-LD schema** — live; Rich Results Test went from 5 to 6 valid items after fixes below

### 🔧 Schema and data-quality fixes made this session (fijitourtransfers.com)
1. Fixed a real brand-name typo in Rank Math (Website Name + Person/Organization Name read "fijitourstransfers.com" — extra "s" — corrected to "fijitourtransfers.com"). This was directly causing a brand mismatch in the live `og:site_name` meta tag, confirmed via direct page fetch before and after.
2. Added a missing `image` field to the main TravelAgency JSON-LD schema block (WPCode snippet 19594, Site Wide Header).
3. Found and deactivated a duplicate Local Business schema entity — a second, separate JS-injected schema block (WPCode snippet 19019, named "Jason") was firing alongside the real one, telling AI systems there were two different businesses at the same URL. It also contained unedited placeholder social links (`facebook.com/yourprofile`). Deactivated; needs a final re-test on Rich Results Test to confirm the duplicate is gone.
4. Fixed three broken WhatsApp links on the homepage — were pointing to a malformed `google.com/search?q=https://wa.me/YOUR_WHATSAPP_NUMBER_HERE` URL (classic copy-paste-from-Gmail-warning-page accident). Corrected to the real working number already used elsewhere on the page.
5. Fixed a "Port Denaru" → "Port Denarau" typo in a live page H1.

### 🔴 New issues found, not yet fixed (fijitourtransfers.com)
- **Hidden text / Google spam-policy risk:** a long, genuinely well-written homepage text section is hidden from visitors via Elementor's responsive-visibility toggles (Hide on Desktop/Laptop/Tablet/Mobile all on) but fully present in raw HTML — textbook "hidden text," which Google's spam policies explicitly flag and which can trigger a manual action against the *whole site*, not just this page. Since robots.txt explicitly invites Googlebot, this is a real Google-ranking risk, not just an AI-search one. Email brief sent to Praveen (madasanipraveen@gmail.com) via Gmail draft — recommends converting to a visible accordion/FAQ section (reusing the FAQ schema pattern already proven on the page) rather than just unhiding as a wall of text. 24-hour validation requested. **Confirm James actually sent the draft.**
- **Unsourced 3rd Organization schema entity** — has a wrong business address (NSW postcode 2763 — doesn't match the real Rouse Hill 2155 address) and an invalid country code (`"Australia"` instead of ISO `"AU"`). Ruled out as sources this session: WooCommerce store settings (empty), Rank Math Local SEO address fields (empty), and the "Jason" snippet (different content entirely, already handled). Source still unknown — needs a fresh hunt, likely another WPCode snippet with a generic "Untitled Snippet" name.
- **Cross-brand bleed pattern, confirmed sitewide (not isolated):** Both the homepage and individual tour pages (e.g. Sawa-I-Lau) show "Tour Fiji Tours" as Author/Owner on Fiji Tour Transfers content. The Rank Math "Legal Name" field also holds an email address (`info@tourfiji.tours`) belonging to the other brand. May be an intentional shared content pool between the two related brands (both run by the same WhatsApp/contact info) — but worth a clear decision either way for AI-citation consistency before launch.
- **Possible pricing outlier:** "Nadi Airport to Tanoa Hotel (Novotel Nadi)" transfer shows AU$61 vs AU$5–10 for every comparable route on the same page. Not confirmed wrong, but worth a manual check.
- **Minor:** dead footer link ("Blogs" → literal `#`), a duplicated code block in the location-redirect JS snippet (harmless), and a sitewide pattern where Cloudflare email obfuscation means no AI system can ever read a real contact email from visible page text anywhere on the site (informational — may be a deliberate spam-protection tradeoff, not necessarily a bug).
- **Verified NOT a problem:** "Bulabard Resort" tour listing checked against external sources (Tripadvisor, Expedia, Facebook) — it's a real Wailoaloa hotel, not fabricated content. Worth recording so this doesn't get re-flagged and re-investigated next session.

### Live Systems
| System | Status |
|---|---|
| Lagi chat Worker | **v57 — 1,875 lines — LIVE.** GitHub backup FIXED this session — genuine, restorable, syntax-validated copy now exists for the first time. |
| fiji-chat-widget Worker | v57 — both Anthropic calls routing through AI Gateway (lines 874 + 1767) — **confirmed has NO page/tour-level awareness, see top finding above** |
| widget.vakaviti.ai | Live |
| lagi.vakaviti.ai | v4 LIVE — 98/100 mobile, 99/100 desktop. Missing meta description fix still unconfirmed deployed (carried from Session 45) |
| vakaviti.ai | Live, Git-connected, no redirect (Session 45 fix holding) |
| fijitourtransfers.com | **Deep-audited this session.** AI-visibility foundation (robots/llms/sitemap/schema) all confirmed live and mostly high quality. Checkout confirmed working. Several real but non-launch-blocking content/schema issues found and partially fixed — see above. |
| tourfijitours.com | **🆕 Deep-audited and fixed Session 49.** Had zero JSON-LD schema, no llms.txt, missing robots.txt entries, stale sitemap — all fixed and verified live. Survived a real mid-session crash (bad Code Snippets REST route) cleanly, no data loss. Stale wrong-site (fijitourtransfers.com) schema found and removed. |
| nadiairporttransfers.com | Live — 500+ reviews — long-standing `app.js` brand/phone bug still unresolved since Session 22 |
| D1 vakaviti-kb | 21 tables, unchanged this session |
| vakaviti-ai-gateway | LIVE |
| vakaviti-zone-manager | v3 LIVE |

### Worker Version History
| Version | Lines | Key changes |
|---|---|---|
| v54 | 1,731 | Review metrics, RAG improvements |
| v55 | 1,748 | Lead Capture Superpower |
| v56 | 1,861 | D1 routing, WhatsApp notify, Fiji heat signals |
| **v57** | **1,875** | **CURRENT — WhatsApp dual-notify fixed. GitHub backup now genuinely matches live source for the first time (Session 46) — previously the backup was a different, single-site draft Worker, not just an old version.** |

---

## 3. TOP PRIORITIES — SESSION 51

> Claude: read this section first. Platform is now POST-LAUNCH (July 1 passed). Priorities shift from launch blockers to growth and open technical debt.

**P25 — ✅ RESOLVED Session 55 — self-serve partner onboarding for lagi.vakaviti.ai**
- Turned out to already be ~80% built and unknown to this priority list: `join.vakaviti.ai` → `vakaviti-onboard` Worker has existed since Session 28 (24 May), never tracked in Git, never verified end-to-end. Verified with a real dummy submission that it silently failed — new partners inserted as `status='pending'` with no non-technical activation path, and never got a `contact_channels` row at all (same gap Session 52 fixed for cometofiji.com, this Worker predates that fix). Root-caused from the real source (now tracked at `workers/vakaviti-onboard/worker.js`) and fixed: added `contact_channels` inserts, added a one-click `GET /activate` link (email → click → live, no SQL). Verified live in production with three real dummy submissions and a real lead POST. Full writeup: BUILD.md Session 55.
- This unblocks P23 (expanding partner_referrals to the other 29+ partners) and P26 (hardcoded-listings gap) — genuinely the critical path item, now actually clear.

**P26 — ✅ RESOLVED Session 56, merged and verified live in production — migrate lagi.vakaviti.ai's hardcoded directory to real D1 data**
- Built `workers/vakaviti-directory/worker.js` (new, standalone, read-only — never touches the protected Worker or `DEAL_TRIGGERS`), wired the PWA's Categories view to it. Real design decision confirmed with James rather than picked silently: every active partner shows a simple card immediately; richer cards (price, featured badge) only when a real `deals` row exists, never fabricated; ratings only from real `partner_review_stats`. Four rounds of real bugs found by testing against the actual 29-partner dataset, not local mocks — see BUILD.md Session 56 for the full account (dropped deals on shared names, an uninformative generic "Other" bucket for legacy category/region values, `partner_id` never actually being used for matching despite existing, and a partner with 3 real deals losing 2 of them to a one-deal-per-partner cap).
- **James's independent post-signoff verification caught two more real gaps before merge** — an overstated "fixed" claim about the Cultural Night Tour URL (true only for the new Categories tab, not stated precisely enough the first time) and a 4th test partner still live when asked for final confirmation. Both corrected. `git merge --no-ff` to `main`, pushed, auto-deploy confirmed live within seconds, re-verified against actual production (not just the preview): 31 real listings, zero test partners, real browser check on `lagi.vakaviti.ai` itself showing correct rendering with zero console errors.
- **Two named follow-ups, explicitly deferred, not silently dropped** — see Known Issues: (1) a category-mapping bug (deal's own category should win over the partner's general one when both exist; James's explicit call to log rather than fix this session), (2) Home page and Categories tab are now two coexisting, unreconciled data sources — Home still 100% hardcoded, Categories real D1 data — needs a future decision to migrate or retire Home's listings content.
- Related cleanup, still deferred: unify `LISTINGS` (frontend) and the protected `DEAL_TRIGGERS` array — `vakaviti-directory` is now the real data source either should eventually migrate onto, but that's a separate, higher-risk task since `DEAL_TRIGGERS` lives inside protected core.
- Found and fixed a real, pre-existing bug independent of this task: the Nadi Cultural Night Tour URL hardcoded since Session 53 had a typo (`nadiculturealnighttour.com`) and has been a dead link in production — confirmed via DNS resolution failure. **Only fixed in the new Categories tab** (reads the correct `partners.website_url` automatically) — the same broken URL is still live in 5 other hardcoded places on the Home page (JSON-LD schema, mobile deals chip, specials-grid, Fiji Experiences panel) and in `DEAL_TRIGGERS`, none of which this session touched.

**P27 — Decide Yasawa Islands region-taxonomy gap**
- Quick decision, not urgent. See Known Issues.

**P28 — 🟡 Researched Session 54, requirements confirmed Session 55 — WhatsApp Catalog integration for partners**
- WhatsApp Business's native Catalog feature (up to 500 products/services, images, price, description, browsable directly inside a chat thread) requires ZERO payment integration — fits the "we will not take any payments" decision exactly. Confirms two earlier decisions were right for reasons not fully visible at the time: native WhatsApp Pay only operates in India/Brazil/Mexico/Indonesia — not Fiji — so "no payments" wasn't just a policy choice, in-chat native payment literally isn't available in this market yet regardless.
- Session 55 confirmed exact technical requirements: Meta Commerce Manager catalog linked to the WABA, a product feed (id/title/description/availability/price/currency/link/image_link/brand per item), Meta display-name business verification (2-14 days). Correctly did NOT start writing sync code — the real listings data (P26) is still hardcoded HTML, so a catalog sync would just be a second hand-maintained data source, the exact anti-pattern P25/P26 exist to eliminate.
- **Blocked on a real, non-code step:** Meta Business verification + Commerce Manager catalog creation both need James's direct access to Meta Business Suite — no API/CLI path from a coding session, same shape as the Session 53 Cloudflare Pages "Connect" button.

**P29 — 🆕 Realistic "Revenue Agent": intent-based lead detection**
- From reviewing an external "AI operating system" proposal (Session 54) — most of that document specs enterprise multi-agent architecture (Chief Orchestrator, formal Agent Registry) that's a genuine mismatch for a solo-founder + session-based build cadence, and was NOT adopted. But one idea from it is genuinely valuable in realistic form: extend Lagi's existing `intent` field/detection logic (already real in worker.js) to specifically flag transfer/booking intent, log it to a simple table, and send James a daily digest of hot leads. Not a new "agent" — a small extension of what already exists. Directly operationalizes revenue-bias CTA logic (own properties prioritized where honestly applicable) discussed in the same session.

**Known-good AEO/schema findings to apply to any future Answer Engine work (P26/Group Intelligence Phase 3), from Session 54 research:**
- Four-layer schema stack (foundation: Organization/WebSite/WebPage/BreadcrumbList; content: Article/FAQPage/HowTo; authority: Person/AggregateRating/Review; business: LocalBusiness/Service/Offer) shows meaningfully higher AI-citation rates than FAQPage schema alone — current AI-visibility work across the network only used the content layer, missing authority and business layers entirely.
- Explicitly allow `OAI-SearchBot` in robots.txt (distinct from `GPTBot` — easy to miss, matters specifically for ChatGPT Search citation).
- Set realistic expectations: ~93% of AI search sessions end without a click — value is mostly brand-authority/citation, not raw traffic. Measure by citation rate and conversion quality of what traffic does arrive, not volume.
- Content-generation safety rule (from reviewing the same external proposal): AI-drafted answer content should be reviewed by a human before publishing, at least initially — auto-published thin content actively hurts AI citation rates per current research, not just a stylistic preference.

**P1 — ~~Lagi has no page/tour-level awareness~~ RESOLVED Session 51, verified live**
- Fixed: widget now sends `page_url`/`page_title`/`page_heading` with every message; Worker grounds the system prompt to the exact page. Verified live on fijitourtransfers.com/Sawa-I-Lau — Lagi now answers about the correct tour and honestly declines to guess on details it lacks, instead of describing an unrelated tour.
- Still the prompt-level fix, not the structural one — once P3 (WooCommerce export) lands and a real tours table exists, upgrade to matching `page_url` directly against a tour record for higher precision.

**P1b — 🆕 widget.vakaviti.ai was never routed to the fiji-chat-widget Worker — RESOLVED Session 51**
- Root cause of why the page-awareness fix didn't reach production on first deploy attempt. `widget.vakaviti.ai` is a CNAME to a separate Cloudflare Pages project, `vakaviti-widget`, whose Git connection is disconnected (dashboard shows "Connect" not "Connected"). Last real deploy before Session 51: **25 May 2026**, six weeks stale. Fixed via manual direct-upload redeploy.
- **Open follow-up:** decide whether to reconnect `vakaviti-widget`'s Git integration, or eliminate the duplication entirely by pointing `widget.vakaviti.ai` directly at the Worker's own `/widget.js` route — one source of truth instead of two.

**P1c — 🆕 6 latent escaping bugs in the widget script — RESOLVED Session 51**
- Present since at least the Session 46 "verified restorable" GitHub backup, never introduced by Session 51's changes. Never caught because verification only ever used `node --check` (validates parseability, not execution). Broke: config-fetch URL construction, theme-color CSS injection, brand/WhatsApp link rendering, the bold-markdown formatter (misparsed by browsers as a JSDoc comment — ate a function call, threw on first render, caused a fully blank chat panel), and the lead-form/greeting apostrophes and line breaks.
- **New standing rule:** any future edit touching `WIDGET_V2_JS` must be verified by actual execution (extract the served client string, run it standalone), not `node --check` alone.

**P1d — 🆕 Phase 1 superpowers upgrade: harvest on-page FAQ/highlights content into grounding — RESOLVED Session 51**
- Extends P1's page-title grounding with real published content: FAQPage JSON-LD if present, else a heading-based scan for FAQ/Highlights/Included-Excluded/Itinerary sections, else meta description. Capped at 2000 chars for token cost control across 50+ partners.
- Two bugs caught by testing against the real live page rather than trusting syntax checks alone: (1) first version only scanned `h2/h3/h4`, missed the real page's `h5` FAQ questions — broadened to `h1`-`h6`; (2) the fix then stopped at *any* heading, breaking immediately since a question's own heading is the next sibling after the FAQ section heading — fixed to only stop at a heading of equal-or-higher level than the section anchor, verified via mock-DOM simulation of the actual page structure.
- Verified live on the same Sawa-I-Lau page: the kids-suitability question now returns real, specific detail (swimming ability needed for the underwater passage, open-water crossings can get choppy) instead of the honest-but-generic fallback.
- **Deep-revise pass (same session) caught two more bugs before they'd have quietly degraded results across the whole network:**
  1. **`innerText` → `textContent` fix.** The content-grabbing line used `innerText`, which returns empty for anything CSS-hidden — and FAQ accordions (the standard pattern on tourism sites, including every page tested) hide their answer text with `display:none` until clicked. This meant the harvest would capture the *question* but silently drop the *answer* on essentially every partner page, every time, since accordions load collapsed by default. Proved the bug was real with a mock collapsed-accordion test before fixing, then confirmed live on the Nadi Cultural Night Tour page with a genuinely untouched, still-collapsed "Is this tour suitable for children?" accordion — Lagi correctly surfaced the hidden answer (evening timing, safety/supervision, pricing) that `innerText` would have missed entirely.
  2. **Cached page context per page load.** The full FAQ/JSON-LD scan was re-running on every message in a conversation, not just once — wasted DOM work multiplied by conversation length, across every widget, every page, network-wide. Now computed once and cached in a module-level variable.
- **Not yet spot-checked:** James should verify the synthesized answer's accuracy against what Fiji Tour Transfers actually publishes (e.g. any specific minimum age), since this is now synthesized rather than quoted verbatim.

**P22 — 🆕 seo-visibility-audit Worker built + full network audit run — Session 51**
- New standalone Worker (`workers/seo-visibility-audit/worker.js`), separate from `fiji-chat-widget`, zero risk to production chat. Audits AI-crawler access (robots.txt), llms.txt presence, and FAQ schema coverage across all 10 owned properties + 29 active partners, using each site's sitemap.xml to discover pages (no tours table dependency). Batched design (5 domains per call, results in D1 `seo_audit_findings` table) after an unbatched first attempt silently hung — likely hit Cloudflare's subrequest/time limits with 1,500+ fetches in one request.
- **Verified baseline score (fresh run, 2026-07-05 16:48-16:51 UTC):** 39/39 domains reachable, 39/39 not blocking AI crawlers (post-fix), 33/38 have llms.txt (87%, excluding the external Accor/Sofitel page), 14/38 have live FAQ schema (37%).
- **Two real D1 data-quality bugs found and fixed** (not infrastructure failures): `nadiculturealnighttour.com` was a typo for `nadiculturalnighttour.com` (op_culturalnight_001); `smugglerscove.com.fj` was missing the required `www` for SSL to validate (op_smugglers_001). Both corrected directly in the `partners.website_url` column. Lesson: what looked like a ~10% network outage was 100% data-entry error, not real downtime — worth a lightweight URL-validation check at partner record creation/edit time going forward.
- **`fijihomestayz.com` was actively blocking AI crawlers** — a deliberate Cloudflare zone setting ("Block AI training bots" + robots.txt configured to match), not a WordPress issue. Fixed by switching both to "Do not block" / "Disable robots.txt configuration," matching the pattern on other properties.
- **`fijibula.com`**: 2 pages with real FAQ content, no schema. Verified real page content directly (avoided fabricating schema from a competitor's similar-sounding page after initial searches returned the wrong site). JSON-LD built and committed to `pending-uploads/fijibula-faq-schema.html` — not yet added to the live WordPress page, needs manual insertion or partner access.
- **`www.bluelagoonresortfiji.com`** and **`tourfiji.tours`**: missing llms.txt. Generic templates drafted and committed to `pending-uploads/` — flagged as generic (not built from verified specific site content like the Fiji Bula schema was) and worth a quick manual review/customization before upload.
- **Two items needing partner-side follow-up, not fixable from our side:** `fiji679.com` returned the same 530 error on two independent checks hours apart — no longer treatable as a transient blip, worth raising with that operator directly. `thepalmsdenarau.com` (403 on robots.txt) and the corrected `www.smugglerscove.com.fj` (403 after the D1 fix) both look like bot-protection/WAF rules on partner-controlled infrastructure — worth flagging to those operators, not something to change from our end.
- **Recent, important context on FAQ schema's actual value**: Google fully retired FAQ rich results (the visible SERP dropdown) on 7 May 2026 for all sites — this happened after Claude's training cutoff and was confirmed via live search this session. Schema still functions as a comprehension aid for Google's own systems and remains crawlable by Bing/PerplexityBot/RAG crawlers, but the underlying visible content is the actual driver of AI citation, not the schema wrapper alone. Recalibrates expectations for future schema-coverage work — worth prioritizing genuine content quality over blanket schema rollout.

**P2 — Build the scoped Lagi agentic tool-call loop (fully scoped in Session 48, zero code written yet)**
- Scoped: one new structured `lookup_tours` tool, max ~3-iteration loop, queries `discoverfiji-content` D1 tours table via REST API (no Worker binding/redeploy risk). Deliberately bounded upgrade.
- Breadth bottleneck still applies — do the WooCommerce CSV export (P3) first so there's real data to query.

**P3 — Get WooCommerce CSV export from James, grow discover.vakaviti.ai content**
- fijitourtransfers.com has ~108 real tours. Only ~20 are in discoverfiji-content D1 so far. JS/AJAX rendering blocks scraping. James needs to export from WooCommerce admin → Products → Export → CSV. One export unlocks the rest of the content build.

**P4 — ~~Confirm current Environment Minister name~~ RESOLVED Session 51**
- Confirmed: **Hon. Lynda Tabuya**, Minister for Information, Environment and Climate Change. Sourced from the PM's own official cabinet reshuffle statement (16 Dec 2025, effective 19 Jan 2026), cross-confirmed by multiple independent April/May 2026 news sources. The conflicting name (Mosese Bulitavu) was accurate pre-reshuffle — he held Environment & Climate Change until 19 Jan 2026, then moved to Minister for Rural and Maritime Development and Disaster Management. Address the Vanua pitch to Hon. Lynda Tabuya.

**P5 — Deploy vanua.vakaviti.ai and send WRFL pitch to Amitesh Deo**
- 🆕 Session 50. The zip (`vanua-vakaviti-deploy.zip`) is ready. Deploy via Cloudflare Pages → project name `vakaviti-vanua` → custom domain `vanua.vakaviti.ai`. Then send `vanua.vakaviti.ai/wrfl-pitch` link to WRFL CEO Amitesh Deo. Opening: congratulate on WRFL's 32 years before pitching anything. Admin@wasterecyclers.com.fj / clint@wasterecyclers.com.fj.

**P6 — Connect discoverfiji.ai → discover.vakaviti.ai redirect (NOT YET DONE)**
- Vercel project supports "Redirect to Another Domain" in the Domains panel — 301/308 to discover.vakaviti.ai. Note: discoverfiji.ai was never actually connected to Vercel — only the default .vercel.app URL was live. Register/connect first if needed.

**P7 — Set up IndexNow for discover.vakaviti.ai**
- Key file not built or pushed. Low effort, useful for Bing freshness signalling.

**P8 — Remove the 999999 master OTP bypass code**
- Flagged since Session 5. Searched chat-widget, leads-v2, ftt-booking-site in Session 49 — NOT found. Likely in a Worker never pushed to GitHub. **James needs to identify which live Worker has the OTP/master-code login logic** — partner dashboard or join.vakaviti.ai onboarding are the top candidates.

**P9 — WhatsApp permanent business number**
- Still on Meta test number. Needs real verified business number before serious partner/customer comms scale.

**P10 — ~~Cancel the test WooCommerce booking~~ RESOLVED Session 51**
- Confirmed cancelled by James.

**P11 — Push Vakaviti Vanua source to GitHub**
- 🆕 Session 50. Currently only in Cloudflare Pages deploy, not version-controlled. Add `docs/vanua/` subfolder in `fiji-platform` repo with both HTML files for backup and version history.

**P12 — Confirm lagi.vakaviti.ai meta description deployed**
**P13 — Resolve cross-brand Author/Legal Name bleed (Tour Fiji Tours ↔ Fiji Tour Transfers)**
**P14 — Re-verify Local Business schema duplicate is actually gone (fijitourtransfers.com)**
**P15 — Verify pricing outlier on fijitourtransfers.com (Tanoa Hotel transfer AU$61)**
**P16 — Continue Lagi Knowledge Hub, partner agreement doc, Google Business Profile**
**P17 — Minor fijitourtransfers.com cleanup (dead Blogs footer link, low urgency)**
**P18 — Audit remaining ~68 of 75 Workers & Pages projects**
**P19 — Apply AI-visibility fix pattern (schema/llms.txt/robots.txt/sitemap) to other partner sites**
**P20 — Avoid persistent custom REST routes via Code Snippets on any WordPress partner site (confirmed crash risk — Session 49)**
**P21 — Push batch 3 + 4 seed SQL files to discoverfiji GitHub repo (data is live in D1, just missing from repo history)**

---

**P23 — 🆕 Expand cometofiji.com partner-referral to the other 29+ partner-embedded widgets**
- Session 52 registered cometofiji.com as a real generic partner and verified the referral path works from the *public* lagi.vakaviti.ai page. The 29+ partner-embedded widgets (Nadi Airport Transfers, etc.) don't yet have this route — needs an explicit `partner_referrals` row per partner's own `site_id`.
- Deliberately deferred rather than expanded same-session as the first working case (Session 52 rule: verify the mechanism on one real case with small blast radius before scaling to every live partner). Now that it's verified end-to-end, this is ready to pick up.
- While doing this, also fix the underlying keyword-matching fallback fragility if scope allows (see Known Issues) — not required to complete P23, but the natural moment to address it since you'll already be in this code.

**P24 — 🆕 `/config` endpoint missing `contact_email` in its SELECT**
- One-line SQL fix. Network-wide — affects every partner's widget, not just one. Missing button (Email quick-action), not a broken function — low urgency, easy win whenever picked up.

---

## 4. STRATEGIC BETS

**The big bet:** Vakaviti.ai — Fiji's AI tourism intelligence network. Zero commission entry strategy.

**Revenue confirmed:** $13,747 AUD in 2 months (last verified Session 35, not re-checked since).

**July 1 launch:** PASSED. Platform is live.

**Competitive moat:** Fiji knowledge graph + operator network + cultural authenticity. NOT model weights.

> Every build decision must serve revenue. Move fast. Be #1.

**New strategic arm — Session 50:** Vakaviti Vanua. An AI-powered national environmental/recycling network for Fiji, built on the same Lagi infrastructure. Government-facing initiative targeting the Ministry of Environment & Climate Change and a first partner conversation with WRFL (Waste Recyclers Fiji Limited). Not a tourism play — a civic/government play that makes the Vakaviti.ai brand and Lagi infrastructure relevant at national policy level, independent of tourism revenue cycles.

**Lagi page-awareness gap is a moat risk:** if AI assistants can't reliably answer page-specific questions correctly, that undermines the "ChatGPT of Fiji" positioning. Fixing this is as strategically important as the GEO/schema work that drives traffic to these pages.

---

## 5. LAGI — PROTECTED CORE

| Parameter | Value |
|---|---|
| Worker | fiji-chat-widget **v57**, 1,905 lines (was 1,875 — Session 51 P1 fix) |
| GitHub backup | **FIXED Session 46, then found to still have 6 latent escaping bugs — all fixed Session 51** |
| Lagi page | lagi-v4 — deployed 2026-06-17 |
| Speed | 98/100 mobile · 99/100 desktop · Sydney |
| Vectorize | ~440+ live vectors |
| AI Gateway | vakaviti-ai-gateway — ACTIVE |
| Page/tour awareness | **FIXED Session 51, verified live — see Section 3 P1** |
| Widget script source of truth | **fiji-platform repo now tracks BOTH `workers/chat-widget/worker.js` (Worker) AND `pages/vakaviti-widget/widget.js` (what widget.vakaviti.ai actually serves) — see Section 3 P1b** |

**NEVER replace whole Worker file. Surgical edits only via find-and-replace.**

---

## 6–14. [UNCHANGED FROM SESSION 45 — AI Gateway, Zone Manager, AI Visibility stack, transfer prices, lead management, partner intelligence, SendGrid, join.vakaviti.ai, fijitourtransfers.com Praveen brief]

Not re-verified this session except where explicitly noted above. Refer to Session 45 BRAIN.md content for full detail on these systems — no changes found or made.

---

## 15. DECISIONS LOG

| Session | Decision | Reasoning |
|---|---|---|
| 46 | Pivoted a planned "AI-visibility audit" of fijitourtransfers.com into a much deeper live-testing session, including actually using Lagi as a real visitor would | Surface-level checks (robots.txt, schema validators) can't catch behavioral bugs. The page-awareness bug was only found by actually chatting with Lagi on a real tour page — a lesson for how future audits should be structured. |
| 46 | Did not attempt to fix the Lagi page-awareness bug same-session | It requires changes to both the embed snippet and Worker system-prompt logic across potentially every partner site, not just fijitourtransfers.com. Needed the GitHub backup fixed first so any Worker edit has a safe rollback path — sequencing risk-reduction before the actual fix. |
| 46 | Fixed the Worker GitHub backup via mechanical escape-character correction only, not a rewrite | The pasted source had a real syntax bug (unescaped nested template-literal backticks) but the live Worker demonstrably works, so the bug was almost certainly a copy-paste artifact. Fixed only the escaping, verified with `node --check`, changed zero logic — minimizes risk of accidentally "fixing" something that wasn't actually broken in production. |
| 46 | Recommended revoking the GitHub PAT after use rather than reusing the same token indefinitely | Token was shared via a WhatsApp screenshot into this chat — two extra exposure points beyond necessary. Standard credential hygiene, not a sign anything was compromised. |
| 47 | Pursued DiscoverFiji.ai as a real separate build (new stack, new brand), not a fold-in to Vakaviti.ai or a parked idea | James's explicit call after reviewing the strategic-overlap analysis. Domain owned, no accounts existed yet — genuine greenfield. |
| 47 | Rejected the original spec's "own OpenAI chatbot + own vector DB" in favor of proxying to the existing Lagi Worker | Verified Cloudflare Vectorize's actual capacity (10M vectors/index, Jan 2026) before deciding — confirmed no real scale ceiling existed to justify a second brain. A second system would fragment learning signal, not accelerate growth. James's framing: "Lagi is our main superpower" — extend it, don't duplicate it. |
| 47 | Kept Supabase for content tables (destinations, tours, resorts, reviews, blog_articles) even though leads/quotes/conversations got removed | Content/CMS data is a legitimately different concern from the AI brain — no fragmentation risk there, just a database for page content. |
| 47 | Booking handoff goes to fijitourtransfers.com's existing WooCommerce checkout, not a new Stripe/PayPal integration | James's explicit choice — avoids rebuilding a second payment system for no benefit. |
| 47 | Set an explicit `Origin: https://vakaviti.ai` header on the server-side Lagi proxy call rather than modifying the Worker's ALLOWED_ORIGINS list | Unblocks DiscoverFiji.ai today with zero changes to the shared, live Worker. Adding `discoverfiji.ai` properly to ALLOWED_ORIGINS remains a cleaner long-term fix, noted as optional follow-up, not done this session. |
| 48 | Abandoned "DiscoverFiji.ai" / "Discover Fiji" as the consumer brand, folded the initiative into Vakaviti.ai/Lagi instead | Research surfaced that "Discover Fiji" collides with Tourism Fiji's own government tagline and a 50-year incumbent (Rosie Travel Group's discoverfiji.com, airport-distributed since 2019). Vakaviti.ai has zero such collisions and is already the established platform brand — fighting for a structurally hard-to-own name made no sense once the alternative was this clean. |
| 48 | Used a subdomain (discover.vakaviti.ai) rather than a path-based route (vakaviti.ai/discover) for the migrated site | Path-based routing would need a Cloudflare Worker reverse-proxying every request to Vercel (vakaviti.ai root is a separate Cloudflare Pages deployment) — real infrastructure to build. A subdomain gets nearly the same domain-authority consolidation via a single CNAME, using the exact pattern already proven on lagi.vakaviti.ai and join.vakaviti.ai. |
| 48 | Dropped Supabase + OpenAI in favor of a dedicated D1 database (discoverfiji-content), reached via D1's REST API rather than a native Worker binding | Keeps the whole platform on Cloudflare (no new vendor) without touching the live Worker's bindings/config — Vercel can't use native D1 bindings anyway, so the REST API was already the only path. A *separate* database from vakaviti-kb (not the same one) keeps this site's content fully isolated from live revenue-critical partner/lead data. |
| 48 | Built all four AI-visibility pieces (robots.txt, sitemap.xml, llms.txt, JSON-LD schema) before scaling content, not after | All four apply automatically to every future page via the shared destination-page template — building them now is far cheaper than retrofitting hundreds of pages later. Matches the lesson from auditing fijitourtransfers.com in Session 46 (AI-visibility infra should be foundational, not bolted on). |
| 48 | Deferred building the Lagi agentic tool-call loop despite scoping it fully | It touches the live Worker serving 29 partners and deserves a focused session, not split attention alongside content work. Also genuinely blocked on breadth — confirmed via schema inspection that neither candidate data source (`deals` in vakaviti-kb, `tours` in discoverfiji-content) has enough rows yet for the tool to meaningfully outperform RAG. Building the plumbing before the data existed would have been premature. |
| 48 | Recommended against pursuing a literal Expedia-style marketplace/aggregator model, even though James's stated long-term vision explicitly named Expedia | The real differentiator already in place is direct-to-operator, zero-commission booking — Expedia's actual model (aggregating competitors, taking a 15–25% cut) would dilute that, not strengthen it. Reframed the goal as "best direct booking conversion," not "build a comparison marketplace." |

---

## 16. KNOWN ISSUES

| Issue | Priority | Status |
|---|---|---|
| WhatsApp is rolling out usernames + a business-scoped user ID (BSUID) in 2026 to eventually replace phone numbers as the customer identifier | **NEW Session 54, forward-looking, not urgent yet** | If Lagi's attribution/lead-tracking currently keys off phone number as the primary identifier, this will silently break for any customer who adopts a username (webhook payloads won't always include a phone number). Fix: store BSUID alongside phone number now, before rollout is widespread — cheap now, expensive to retrofit later. |
| Unconfirmed: does Lagi's WhatsApp flow disclose to customers that they're chatting with an automated assistant? | **NEW Session 54, needs verification, not confirmed either way** | Meta's WhatsApp Business Platform terms require this disclosure. Genuinely don't know current state — check before assuming compliant. |
| lagi.vakaviti.ai's Categories directory was 100% hardcoded HTML/JS | **RESOLVED Session 56, merged and verified live in production** | Migrated to real D1 data via `vakaviti-directory` — see Section 3 P26, BUILD.md Session 56. The Home page's Hot Deals/Partner Offers/Fiji Experiences panels and the protected `DEAL_TRIGGERS` keyword array are still hardcoded — deliberately out of scope this session, see the "Tour Fiji Tours duplicate", "DEAL_TRIGGERS unification", "category-mismatch", and "Home/Categories dual source" rows. |
| Two real `partners` rows share the exact name "Tour Fiji Tours" (`op_tourfiji_001`, website tourfiji.tours; `op_tourfijitours_001`, website tourfijitours.com) | **NEW Session 56, flagged not resolved** | Found while building `vakaviti-directory` — a shared-name deal can only deterministically attach to one of them. Needs a decision from James: separate legitimate registrations, or an accidental duplicate from an earlier session. |
| `DEAL_TRIGGERS` (protected Worker) and `LISTINGS`/the new `vakaviti-directory` data source are still three separate, unreconciled representations of partner listings | **Ongoing since Session 53, real data source now exists as of Session 56** | `vakaviti-directory` is now the real, live data source either should eventually migrate onto — but touching `DEAL_TRIGGERS` means editing protected core, so this is deliberately a separate, higher-risk task, not attempted this session per the explicit brief instruction. |
| `vakaviti-directory`'s category field always prefers a matched partner's general category over the deal's own more specific one (e.g. Nadi Cultural Night Tour shows "Day Tours & Island Trips" instead of "Cultural Experiences") | **NEW Session 56, named follow-up, James's explicit call to defer rather than fix immediately** | In `listingFromDeal()`, `category: p ? mapCategory(p.category) : ...` always wins when a partner match exists. Small, contained fix (add `'cultural'` to `CATEGORY_MAP`, prefer `d.category` when present) — recommended fixing same-session, but deliberately deferred given how many verification rounds the branch had already been through. |
| Home page (`view-home`) and the Categories tab are now two coexisting, unreconciled listings sources | **NEW Session 56, explicit future decision point, not a bug** | Home still renders 100% hardcoded Session 53 content (including the still-broken Cultural Night Tour URL); Categories renders live D1 data via `vakaviti-directory`. Deliberate, contained scope choice for Session 56 — "one source of truth" isn't achieved yet. A future session needs to either migrate Home onto the same real data source or explicitly decide to retire Home's redundant listings content in favor of Categories. |
| `vakaviti-onboard` Worker existed for 6+ weeks (since Session 28) completely unknown to this priority list, untracked in Git, and silently non-functional (new partners never activated, never got lead-notification channels) | **RESOLVED Session 55** | Root-caused and fixed — see Section 3 P25, BUILD.md Session 55. Worth remembering as a process lesson: always check for existing untracked infrastructure (`docs/BUILD (2).md`'s old Worker registry table caught this) before assuming something needs building from scratch. |
| Blue Lagoon Beach Resort is tagged "Yasawa Islands," which isn't in the agreed region taxonomy (7 primary + 8 secondary) | **Session 53, still flagged not formally resolved as of Session 56** | Still an honest extra chip. Session 56 found the onboarding form's own region dropdown already includes both "Yasawa Islands" and "Mamanuca Islands" as real options (neither in the agreed taxonomy either) — self-serve partners can already select them, so this gap is now backed by real, growing data, not just Blue Lagoon's one-off tag. Still needs James's decision: formally extend the taxonomy, or fold under an existing region. |
| Cloudflare Web Analytics beacon on lagi.vakaviti.ai has a literal placeholder token (`"token": "REPLACE_WITH_CF_ANALYTICS_TOKEN"`) | **NEW Session 53** | Found during PWA source review. Means zero analytics have ever been collected on this page. Needs a real token from the Cloudflare Web Analytics dashboard — can't be fixed by Claude Code alone. |
| `/config` endpoint never SELECTs `contact_email` from D1 | **NEW Session 52** | Network-wide gap, not partner-specific — no partner's widget can show its "Email" quick-action button even when a real email is on file. One-line SQL fix, low urgency (missing button, not broken function). See Section 3 P24. |
| Keyword-matching fallback in cross-partner referral routing can misattribute leads for any partner whose name contains a common conversational word (e.g. "fiji") | **NEW Session 52, flagged not fixed** | Only avoided for cometofiji.com specifically by giving it explicit `partner_referrals` rows (Step 1 lookup, never falls through to the fragile fallback). The underlying fallback logic itself is unchanged and shared by all 29+ partners. See Section 3 P23. |
| Other 29+ partner-embedded widgets (e.g. Nadi Airport Transfers) have no cross-referral path to cometofiji.com | **NEW Session 52** | Only the public lagi.vakaviti.ai page routes to cometofiji.com so far. Needs explicit `partner_referrals` rows per partner's own site_id — deliberately deferred to its own session rather than expanding same-session as the first working case. See Section 3 P23. |
| discoverfiji.ai DNS not connected to Vercel | ~~P2~~ **SUPERSEDED Session 48** | discoverfiji.ai was never actually added to the Vercel project at all (only existed as default vercel.app URL). Live domain is now discover.vakaviti.ai (subdomain, connected and working). discoverfiji.ai redirect is now P4 (Section 3), low urgency since nothing currently points there. |
| Supabase/OpenAI accounts not yet created for DiscoverFiji.ai | ~~P2~~ **RESOLVED Session 48 (dropped, not built)** | Migrated to a dedicated D1 database (discoverfiji-content) instead, reached via D1 REST API. No Supabase/OpenAI accounts needed — neither vendor is used anywhere in this codebase anymore. |
| DiscoverFiji.ai's 500 destination pages + Lagi knowledge-ingestion pipeline not started | **IN PROGRESS Session 48** | 6 of ~500 destination pages live (18 real tours), template proven and AI-visibility infrastructure complete. Knowledge-ingestion pipeline into Lagi's `/knowledge-add` still not started — needs the human-review step designed first. |
| Worker's `isAllowedOrigin` check has no real CORS enforcement, just a manual header check that silently 403s on missing Origin | P3 — Session 47 | Not a bug exactly, but a sharp edge — any future server-side integration will hit this same trap unless documented. Now documented in discoverfiji repo's route.ts comments. |
| Lagi has no page/tour-level awareness — gives wrong answers about specific tours | ~~P1~~ **RESOLVED Session 51** | Fixed and verified live on fijitourtransfers.com. See Section 3 P1. |
| widget.vakaviti.ai was routed to a stale, Git-disconnected Pages project instead of the live Worker | ~~P1b~~ **RESOLVED Session 51** | 6 weeks stale (last deploy 25 May 2026). Fixed via manual redeploy. Open follow-up: fix routing permanently — see Section 3 P1b. |
| 6 latent escaping bugs in the widget script (config-fetch, theme CSS, brand/WhatsApp rendering, bold-markdown regex, lead-form/greeting apostrophes) | ~~P1c~~ **RESOLVED Session 51** | Present since at least Session 46, never caught by `node --check`. See Section 3 P1c for the new standing verification rule. |
| Lagi is not agentic — single-shot RAG only, no tool-calling, no persistent memory | **NEW Session 48, scoped not built** | Full scoping done: one bounded tool-call loop (max ~3 iterations) against structured ground truth. Confirmed vakaviti-kb has no dedicated tours table (closest is `deals`, deals-only). Blocked on content breadth more than engineering effort — see Section 3 P2. |
| fijitourtransfers.com's tour catalogue can't be scraped beyond the homepage's hardcoded cards | **NEW Session 48** | Confirmed: tour search/listing widget is JS/AJAX-rendered. Paginated archive URLs return page-1 content regardless of page number; location taxonomy pages return zero tour cards. Only path to the remaining ~90 of 108 real tours is a WooCommerce CSV export from James — see Section 3 P3. |
| discoverfiji repo seed files (batches 3 and 4) not pushed to GitHub | **NEW Session 48, low priority** | Data is live in discoverfiji-content D1 (run directly via console), but `004_batch3...` and `005_batch4...` seed SQL files only exist locally — never committed. See Section 3 P6. |
| 3rd Organization schema entity has wrong address (NSW 2763) | P2 | Source hunt continues — WooCommerce, Rank Math, "Jason" snippet all ruled out |
| 999999 master OTP bypass code | P1 | Still not confirmed removed — flagged Session 5, now 42 sessions later |
| Test booking created during checkout verification needs cancelling | ~~P1~~ **RESOLVED Session 51** | Confirmed cancelled by James. |
| Praveen "hidden text" brief sent — needs confirmation + 24hr follow-up | P1 — Session 46 | Gmail draft created, not confirmed sent yet |
| Cross-brand Author/Legal-Name bleed (Tour Fiji Tours ↔ Fiji Tour Transfers) | P2 — Session 46 | Confirmed sitewide pattern, needs a decision not just a fix |
| Local Business schema duplicate fix not re-verified | P2 — Session 46 | "Jason" snippet deactivated but Rich Results Test not re-run after |
| Worker GitHub backup stale/wrong | ~~P1~~ **RESOLVED Session 46** | Was a different single-site draft Worker entirely, not just old. Fixed, verified. |
| Checkout failure on fijitourtransfers.com | ~~P1~~ **RESOLVED Session 46** | Tested live, working. Real test order needs cleanup (see above). |
| fijitourtransfers.com llms.txt/schema "missing" | ~~P2~~ **RESOLVED Session 46 (was already done, just unconfirmed)** | Praveen had completed this; BRAIN.md notes were simply never updated to reflect it |
| WhatsApp permanent business number | P1 | Still on Meta test number, unresolved |
| lagi.vakaviti.ai meta description | P2 | Still unconfirmed deployed, carried multiple sessions |
| Pricing outlier — Tanoa Hotel transfer AU$61 | P2 — Session 46 | Not confirmed wrong, needs a manual check |
| Dead "Blogs" footer link on fijitourtransfers.com | P3 — Session 46 | Cosmetic |
| Cloudflare email obfuscation hides contact email from all AI/crawlers sitewide | P3 — Session 46 | Informational — may be intentional tradeoff |
| nadiairporttransfers.com app.js brand/phone bug | P2 | Unresolved since Session 22 |
| No partner agreements | P2 | Unchanged from Session 45 |
| ~68 of 75 Workers & Pages projects unaudited | P2 | Unchanged from Session 45 |

---

## 17. CEO IDEAS INBOX

| Date | Idea | Category | Status |
|---|---|---|---|
| 2026-06-23 | Pass page/tour context from embed snippet into Lagi's request so it can ground answers correctly per-page | infrastructure | **NEW Session 46 — now P1, see Section 3** |
| 2026-06-23 | Audit Author/Legal Name field consistency across both tourfijitours.com and fijitourtransfers.com as a deliberate brand-architecture decision, not page-by-page firefighting | strategy | inbox |
| 2026-06-23 | Build a lightweight per-page schema/FAQ auto-generator for the ~108 tour pages — each already has real per-tour FAQ content not yet wrapped in FAQPage schema; could multiply AI-citable surface area significantly | seo | inbox |
| (carried) | Automate the Cloudflare Pages Git-connect step via API | infrastructure | inbox |
| (carried) | Extend vakaviti-zone-manager to auto-audit backlink + llms.txt compliance | infrastructure | inbox |
| (carried) | Connect James's 7,300+ Facebook followers directly into Lagi/GEO content funnel | growth | inbox |

### CEO STRATEGIC NORTH STAR
"We must not be seen as the leader — we must BE the leader in AI tourism development in Fiji."

---

## 18. SESSION HISTORY

### Session 56 — 2026-07-09/10 — P26: migrated lagi.vakaviti.ai's directory to real D1 data, on a preview branch, closing the loop Session 55 opened

**Directly continues Session 55**: P25 made self-serve onboarding actually work, but new partners
still had nowhere to appear — this session built that. Checked real schema completeness first
(as instructed): confirmed `partners` has no price/badge/rating/image columns, found two more real
pre-existing data sources not previously tracked (`deals` — hand-curated marketing content, only
5 rows; `partner_review_stats` — real ratings, fed by a separate untracked `vakaviti-reviews`
Worker). Presented the real design choice to James rather than picking silently: simple cards for
every active partner immediately, richer cards only when a real `deals` row exists, ratings only
when real reviews exist — confirmed, not assumed.

Built `workers/vakaviti-directory/worker.js` (new, standalone, read-only, never touches protected
core), wired the PWA's Categories view to it. **Four rounds of real bugs, each found by testing
against the actual production dataset rather than trusting the code because it ran without
errors**: deals silently dropped when two shared a partner name; most of the 29 real partners
falling into an uninformative "Other" category/region bucket; `partner_id` existing in the schema
but never actually used for matching (a real, confirmed data duplicate — two partner rows both
named "Tour Fiji Tours" — needed it); and a partner with 3 real deals losing 2 of them to a
one-deal-per-partner design cap, fixed by moving to one-listing-per-deal, which turned out to
match the *original* Session 53 design more faithfully than the intermediate versions did.

James caught two real gaps in the backfill/cleanup process directly: a `partner_id = NULL`
oversight on deals where the real ID was already known, and — critically — asked for an explicit,
audited confirmation (not just a re-paste) of every D1 table three test partners could have
touched before running cleanup, which surfaced one genuinely missed table (`knowledge_queue`,
written by `/knowledge-add` alongside `knowledge_items`, missed in the first pass).

**Verified live, full loop, not claimed**: real `POST /onboard` submission → real one-click
`/activate` → confirmed correctly rendering in the actual PWA preview, filtered under the right
region chip, zero console errors, DOM count matching fetched data exactly. Confirmed no regression
across all 9 previously-hardcoded listings once the backfill landed. Found and fixed one more real,
pre-existing bug along the way: the Session 53 hardcoded Cultural Night Tour URL had a typo and has
been a dead link in production this whole time — the new data-driven directory fixes this
automatically by reading the correct `partners.website_url`.

**Correctly not touched**: `DEAL_TRIGGERS` (protected core) — flagged only, per the brief's
explicit instruction. Not merged to `main` yet — on branch `p26-directory-data`, awaiting James's
review, same safety rule as Session 53 (production auto-deploys on merge). Full writeup: BUILD.md
Session 56.

### Session 55 — 2026-07-09/10 — Found P25 (self-serve onboarding) was already half-built and silently broken; fixed it. P28 (WhatsApp Catalog) researched, correctly not built yet.

**Task 1 brief assumed self-serve partner onboarding needed building from scratch — checked first,
found otherwise.** `join.vakaviti.ai` → `vakaviti-onboard` Worker had existed since Session 28
(6+ weeks), unknown to P25, untracked in Git. Verified with a real dummy submission that it
silently failed end-to-end: new partners inserted as `status='pending'` with no non-technical
activation path, and no `contact_channels` row at all (the same lead-notification gap Session 52
already fixed once for cometofiji.com — this Worker predates that fix). Got the real source from
James (first attempt pulled the wrong dashboard page — a Pages project, not the Worker — corrected
by asking for the specific Workers editor path), root-caused precisely, and shipped a surgical,
additive-only fix: `contact_channels` inserts (own try/catch, can't break the working parts), and
a one-click `GET /activate` link in the notification email so activation is "click a link," not
"write SQL." Required one new secret (`ADMIN_TOKEN`), which James added via the dashboard.

**Verified live in production, not just claimed** — three real dummy submissions were needed
because the first two verification attempts were honestly wrong and corrected rather than
glossed over: submission 1 (pre-fix) confirmed the original bug; submission 2 (post-deploy) proved
the fix works (`pending` → real `/activate` link → `/config` now returns full partner data) and
exercised a real `/lead` POST; checking whether `contact_channels` itself wrote correctly required
Cloudflare Observability log inspection, and the first two attempts at that pointed at the wrong
log row (an old pre-fix request, caught by cross-checking its `cf-ray` ID against the original
curl response) — resolved by running a third, precisely `cf-ray`-tagged submission instead of
relying on eyeballed timestamps. Confirmed clean: correct deployed `scriptVersion`, `200` status,
no error logged.

**Task 2 (WhatsApp Catalog, P28) researched, correctly not implemented yet.** Confirmed exact 2026
requirements (Commerce Manager catalog, product feed schema, Meta business verification) — zero
payment integration, matching the "no payments" decision exactly, and confirming WhatsApp Pay
doesn't operate in Fiji regardless. Did not write sync code: doing so against still-hardcoded
listings (P26, unresolved) would just create a second hand-maintained data source — the exact
problem P25/P26 exist to solve. Also blocked on a real non-code step only James can do: Meta
Business verification + Commerce Manager catalog creation.

**Process lesson worth carrying forward:** `docs/BUILD (2).md` — an old, easy-to-overlook file —
turned out to hold the only record of `vakaviti-onboard`'s existence. Worth a habit: grep old/
stray docs for a Worker's name before assuming a priority-list gap means nothing was ever built.

Full writeup: BUILD.md Session 55.

### Session 54 — 2026-07-09 — Strategic review/research, no code changes
**Deep cross-check of "what's the best way forward for Lagi" before committing to further build — deliberately a research/planning session, not a build session, at James's explicit request to verify all better AI-driven approaches were considered first.**

Reviewed three separate strategic proposals in sequence: (1) applying the Gojek/Grab super-app pattern to Fiji (concluded: apply the *pattern*, not the *product* — Lagi shouldn't compete with existing local ride-hailing incumbents like CANGO, and James explicitly reversed an earlier payment-layer direction — "we will not take any payments"); (2) a "Group Intelligence System" proposal (Question Database → Demand Dashboard → Answer Engine → Fiji Brain) — found to be ~60-70% already built as Lagi's existing Layer 4 self-learning loop (`knowledge_queue`/`knowledge_items`), verified against the real schema rather than assumed; (3) an external "AI Destination Operating System" document proposing 10 build priorities including a formal Agent Registry and Chief Orchestrator Agent — assessed as architecturally premature for a solo-founder + session-based build cadence, with only one idea (a realistic "Revenue Agent" via intent detection) adopted in simplified form.

**Additional research performed specifically to answer "have all better AI-driven approaches been considered" before finalizing:** current (2026) Answer Engine Optimization / Generative Engine Optimization best practice (validated the existing Phase 3 answer-page structure, added the missing schema layers — see Section 3); single-destination/small-island AI tourism platform landscape (found no direct comparable exists — combined with industry data showing 72% of destination professionals feel ill-equipped to adopt AI tools at all, confirms Lagi is genuinely ahead of the field, not behind an established playbook); WhatsApp Business commerce capabilities specifically (found WhatsApp Catalog — native, free, zero payment integration required — as a genuinely new, high-value, low-effort addition; confirmed native WhatsApp Pay doesn't operate in Fiji's market at all, meaning the "no payments" decision was also technically correct, not just a policy choice; found a real forward-looking risk in WhatsApp's 2026 username/BSUID rollout worth noting now — see Known Issues).

**Net result:** the priority sequence from Session 53 (P25 self-serve onboarding → P26 D1 migration → Group Intelligence phases) holds, with three additions — P28 (WhatsApp Catalog, build alongside P25), P29 (realistic Revenue Agent via intent detection), and a documented AEO schema/safety checklist for whenever Phase 3 (Answer Engine) work actually starts. No code was touched this session — purely research and priority-setting, correctly kept separate from execution.

### Session 53 — 2026-07-09 — CLOSED
**Closed a real standing gap (lagi.vakaviti.ai had zero Git history, ever), then built and shipped a genuine installable PWA rebuild of lagi.vakaviti.ai — verified live, then honestly scorecarded against the Gojek/Grab strategic review from earlier this session.**

**Part 1 — Git pipeline for lagi.vakaviti.ai, finally.** `vakaviti-lagi-public` (the Cloudflare Pages project behind `lagi.vakaviti.ai`) had never been connected to any repo — every prior change was a manual dashboard upload, meaning no version history existed for this page at all. Fixed properly, not shortcut: fetched the real raw served HTML directly via curl (not a rendered/stripped summary), checked it against a full content checklist from an independent fetch, committed it as `docs/lagi-public-live-backup/index.html` with a `.gitattributes` LF pin (Windows `autocrlf` would otherwise silently drift future checkouts from the original bytes), then connected the Cloudflare Pages project to this repo via the dashboard. Verified end-to-end post-connect: byte-identical content, full interactive re-test (chat, WhatsApp button, external partner links), and a real device check on James's phone for mobile layout (tool-based viewport resizing proved unreliable — flagged honestly rather than faked, same discipline as Session 10's come-to-fiji work).

**Part 2 — Full PWA/app-shell rebuild, on a branch, safely.** Since Part 1 now means any push to `main` auto-deploys to production instantly (previously a manual, deliberate step), all rebuild work happened on a `pwa-rebuild` branch with its own Cloudflare Pages preview URL — confirmed production was never touched mid-build by diffing it against the preview. Delivered: real PWA fundamentals (manifest, service worker, installable icon set), a persistent bottom-nav app shell (Home/Categories/Ask Lagi/Saved), a region × category directory replacing the old single scrolling feed, in-app detail screens that demote the external "Book direct" link to a secondary action, and all six supporting features agreed earlier (WhatsApp handoff status text, honest non-fabricated ratings, party-size stepper, opt-in geolocation, honestly-detected push support, non-monetary visitor stamps). Protected Worker code and nearly all existing JS functions verified byte-identical via direct diff — only `heroAsk`/`heroSearch` were adapted, and only to call the new view-switcher instead of `scrollIntoView`.

**Real findings surfaced, not silently patched:** (1) the entire listings directory is 100% hardcoded HTML/JS — no D1 or partner-API call exists anywhere on this page, the same shape as Session 52's `partner_referrals` gap, and the real reason partner #10 still can't be added without a code session; (2) Blue Lagoon Beach Resort sits in the Yasawa Islands, outside the agreed region taxonomy — added as an honest extra chip rather than mis-tagged; (3) the Cloudflare Analytics beacon has sat with a literal placeholder token this whole time — zero analytics ever collected on this page, found incidentally during source review.

**Merged and verified live**, with one genuinely useful process note: post-merge, an independent re-fetch (via a different tool than the one used to verify the merge itself) showed stale pre-PWA content twice in a row, while Claude Code's own fresh `curl` showed the new content correctly with exact byte/line evidence. Rather than trust either tool blindly, the tie-break was a fresh incognito load on James's actual phone — confirmed the new app shell was genuinely live, and the conflicting fetch was a caching artifact of the *verification* tool, not a real deployment problem. Worth remembering: when two verification methods disagree, a real device beats both.

**Honest scorecard against the Gojek/Grab strategic review (same session, earlier):** most individual front-end features from that review shipped (directory, detail screens, party-size filtering, location-aware discovery, ratings, non-monetary loyalty, push, status tracking). Correctly NOT built: any payment/wallet feature (James explicitly reversed this mid-session — "we will not take any payments"), CANGO ground-transport partnership (explicitly not the aim), food delivery/courier (out of scope from the start). **Not yet built, and the actual next critical-path item:** the centerpiece strategic goal itself — self-serve partner onboarding at scale, real D1-backed listings, and automated dispatch to partners. Tonight built the front door (the PWA experience); the engine room (P25/P26 above) is the next real session, and it's backend/data work, not front-end polish.

### Session 52 — 2026-07-07/08 — CLOSED
**Registered cometofiji.com as a real, generic Vakaviti partner; made Lagi the centralized concierge for it in both directions; found and fixed three separate real bugs along the way.**

**Context:** James's `come-to-fiji` project (separate repo, own D1, cometofiji.com — a flight-search/AI-itinerary site funneling bookings into fijitourtransfers.com) had spent this same overall session going from broken (dead API routes, $0 pricing everywhere) to genuinely functional (real tour/transfer sync, real Duffel flight pricing, full AI-visibility stack). Once that was solid, James raised a bigger strategic idea — a "Fiji Brain™" concept — which correctly resolved to: this belongs at the Lagi/platform level, not duplicated inside one funnel site, since Lagi already has the real infrastructure (self-learning RAG loop, knowledge-gap detection, per-partner scoping) this concept needs. That reframing is what produced this session's actual scope: make cometofiji.com a first-class partner in the existing system, both as something Lagi can recommend outward, and as a site that has Lagi embedded on it.

**Validated Lagi's real capabilities directly from `workers/chat-widget/worker.js` before building anything** (not from BUILD.md's summary of them) — confirmed real RAG retrieval via Vectorize, a genuine Layer 4 self-learning loop (every conversation's Q&A gets embedded into Vectorize AND written to a `knowledge_items` D1 table), a `knowledge_queue` gap-detection mechanism (`avg_rag_score`, `asked_count`), and per-partner `coverage_score`/`use_count` tracking. Also confirmed directly: **Come to Fiji and Lagi were, until this session, two fully separate systems** — different D1 databases, zero data flow either direction — despite sharing an owner.

**What got built, registered, and verified live:**
1. `cometofiji.com` registered as partner `op_cometofiji_001` in the real `partners`/`embed_config`/`contact_channels` tables (schema read first, not guessed) — no special-casing anywhere in the Worker, same generic mechanism every other operator uses.
2. 6 real `knowledge_items` seeded describing what it does and when to recommend it (flight price comparison, full AI itinerary planning, budget/value/premium trip-cost tiers) — verified present via `/knowledge-list`.
3. A new `flights` intent added to `detectIntent()` — existing `pricing`/`booking` intents were too broad and already shared by every partner, would have caused collisions.
4. **Found and fixed a real pre-existing gap** (not introduced this session): the public lagi.vakaviti.ai page's referral button was hardcoded to 5 specific partner names/numbers directly in JS, not D1-driven, and had zero `partner_referrals` rows at all. Generalized it: D1 lookup first (works for any partner, any button type — including a new website-link type for partners without WhatsApp, like this one), hardcoded 5-name logic left untouched as the fallback only when no D1 row exists. James deployed the fix live via the Cloudflare dashboard (Ctrl+H find/replace, since this touches a live Worker serving 29+ real partners) after explicit confirmation, then a 6th fix was found and needed — a missed `BOOKING_INTENTS` allow-list entry — before `intent: "flights"` correctly routed end-to-end.
5. **Found and fixed a second real gap while implementing #4**: the keyword-matching fallback used when no explicit `partner_referrals` row exists matches partner name-words against conversation text — for a partner literally named "Fiji" content, on a Fiji-only platform, "fiji" appears in nearly every conversation, which would have caused broad misattribution. Fixed by giving cometofiji.com explicit `partner_referrals` rows so it's always found via the reliable Step 1 D1 lookup, never falling through to that fallback. **The underlying fallback logic itself is unchanged and still shared by all 29+ partners** — flagged as a distinct follow-up (P23/Known Issues) since "fiji" is very unlikely to be the only partner name capable of colliding with common conversation words as the network grows.
6. Verified end-to-end, not just claimed: a plain flight-price question on the public page correctly returns `referral_btn: {"url":"https://cometofiji.com","label":"Visit Come to Fiji"}`.
7. **On the come-to-fiji side:** removed the site's old homegrown `ChatWidget.tsx`/`/api/chat` (calling OpenAI directly) and replaced it with the standard Lagi embed in `src/app/layout.tsx`, using site_id `op_cometofiji_001` — matching the exact pattern every other partner site uses. **This also fixed a live, real bug as a side effect**: that old widget's `OPENAI_API_KEY` had never been set, so it was leaking the literal error text `"OPENAI_API_KEY not set..."` directly to any real visitor who clicked it. Verified in a real browser (not just curl) that Lagi now renders, greets, and holds a grounded conversation referencing Come to Fiji's actual features.
8. **Found and fixed a third real gap during that same verification**: `cometofiji.com` wasn't in the chat Worker's CORS allow-list — would have made the widget look fully deployed while being completely non-functional for real visitors. Fixed live in the Cloudflare dashboard, re-verified immediately.

**Not yet done, explicitly carried forward:**
- P23 — expand the now-verified `partner_referrals` mechanism to the other 29+ partner-embedded widgets (only the public page routes to cometofiji.com so far), and ideally harden the keyword-fallback fragility at the same time.
- P24 — `/config` endpoint never selects `contact_email`, so no partner's widget can show its Email quick-action button network-wide, even when a real email is on file. One-line SQL fix.
- 14 pre-existing, unrelated TypeScript-checker warnings around worker.js line 1132-1133 (lead-scoring block) — cosmetic, noted, not touched.
- On the come-to-fiji side specifically (own repo/BUILD.md, summarized here for cross-reference only): `www.cometofiji.com` DNS still resolves to a stale Namecheap parking page; the "Select Flight" button has no destination yet (Duffel Links' A$149/mo cost was declined, plan is to deep-link to an external booking site instead — not yet built); hotel pricing has no vendor (Hotellook was shut down by Travelpayouts); 2 of 51 tours (cruise-ship excursions) link to a 404 URL format; tour/transfer pricing now correctly scales by party size but no tours are yet tagged "romantic" for the honeymoon planner.

**Key learning, worth carrying into any future partner-onboarding work:** two of this session's three real bugs (the keyword-fallback collision risk, the CORS allow-list gap) were the kind that would have looked completely fine on inspection — code runs, no error thrown — while silently failing or misbehaving for real visitors. Both were only caught by asking "does this actually still work for the existing 5 partners" and "does this actually render in a real browser," not by reading the diff. Worth treating as a standing verification habit for any future generic-mechanism change touching the live Worker.

### Session 51 (continued) — SEO/AI-visibility audit — 2026-07-05
Asked to find fast, scalable solutions to grow AI search visibility beyond the 3 hand-built Knowledge Hub pages. Built a new standalone `seo-visibility-audit` Worker rather than working partner-by-partner manually — reuses the same "check don't guess" discipline from earlier in the session. First version tried to scan all 39 domains in one request and silently hung (no logged errors) — root-caused to Cloudflare's per-request subrequest/time limits given ~1,500 potential outbound fetches, and rebuilt as a safe 5-domains-per-batch design with a `next` URL to continue.

The most important finding wasn't a visibility problem — it was a data-quality one. What looked like 4 broken/unreachable partner sites (chased through several wrong infrastructure theories: lapsed registration, orphaned Cloudflare zone, missing Pages custom domain) turned out to be: 2 simple typos in the `partners.website_url` D1 column, 1 likely-recurring issue worth flagging to that partner, and 1 case of partner-side bot-protection unrelated to our infrastructure. All 39 properties are genuinely live; the "outage" was almost entirely a database hygiene problem, not real downtime.

Fixed `fijihomestayz.com` actively blocking AI crawlers via a deliberate Cloudflare zone setting. Built verified FAQ schema for `fijibula.com`'s Nausori Highlands page directly from the real, confirmed page content — after search results initially surfaced a similar-sounding competitor's page, which was correctly rejected rather than used to fabricate schema for the wrong business. Drafted (but flagged as generic, needing review) llms.txt files for two more properties.

Also surfaced and incorporated a materially important, very recent fact: Google fully retired FAQ rich results in Search on 7 May 2026, for every site, no exceptions — this postdates Claude's training cutoff and was confirmed via live search mid-session, correcting earlier guidance given in the same conversation that overstated FAQ schema's SEO value. Schema is still worth adding (helps Bing/Perplexity/RAG crawlers and Google's own comprehension layer) but the actual content quality is what drives AI citation, not the markup.

**Repo:** new `workers/seo-visibility-audit/worker.js` tracked for the first time; three pending-upload artifacts (2 llms.txt drafts, 1 FAQ schema snippet) committed to `pending-uploads/` so they're not sitting only in chat history.

**Not yet done:** uploading the 3 pending artifacts to their live sites; following up with the `fiji679.com` and `thepalmsdenarau.com`/`smugglerscove.com.fj` operators about their respective issues; deciding whether to build the Cloudflare-API zone-enumeration option for the audit Worker (would catch any zone that exists but isn't in D1 or the hardcoded owned-properties list — the exact kind of gap that let `vakaviti-widget` sit undiscovered for 6 weeks earlier in this same session).

### Session 51 — 2026-07-05 — CLOSED
**P1 (page/tour awareness) fixed and verified live; root-caused a 6-week-stale, Git-disconnected widget deployment; found and fixed 6 latent escaping bugs nobody had caught.**

Built the P1 fix: widget now captures `page_url`/`page_title`/`page_heading` at message-send time and sends them to the Worker, which injects a grounding block into the system prompt tying the answer to the exact page the visitor is on, with an explicit instruction to admit uncertainty rather than borrow details from a different tour.

First deploy attempt to the Worker threw `PHASE2_WORKER_URL is not defined` — traced this to a pre-existing bug, not something introduced this session: the Session 46 GitHub-backup fix had escaped the nested backticks in `WIDGET_V2_JS` but left the neighboring `${...}` interpolations unescaped, so the Worker tried to evaluate client-side-only variables at its own module-load time. `node --check` never caught this because it validates parsing, not execution. Found and fixed 6 separate instances of this bug class by actually executing the module and extracting the served client script for independent syntax-checking — a verification method now written up as a standing rule for any future edit to this file. One instance (the bold-markdown regex, `/\*\*.../`) was subtler: browsers parsed the malformed unescaped version as a JSDoc comment, silently eating a function call and throwing on the very first message render — this alone caused a fully blank chat panel on the first live retest.

After fixing all of that and redeploying the Worker, the live retest still showed the original bug — leading to the real discovery of the session: `widget.vakaviti.ai` is a CNAME to a separate Cloudflare Pages project, `vakaviti-widget`, not routed to `fiji-chat-widget` at all. That Pages project's Git connection is currently disconnected, and its last real deployment was 25 May 2026 — six weeks before this session, meaning every partner site had been loading a stale widget the entire time regardless of any Worker-side fix. Fixed via manual direct-upload redeploy of the corrected script. Confirmed live and working on fijitourtransfers.com's Sawa-I-Lau Caves page: Lagi now answers about the correct tour and honestly says when it lacks specific details, instead of describing an unrelated tour.

Also committed both files to GitHub for the first time in their corrected state — `workers/chat-widget/worker.js` (updated) and `pages/vakaviti-widget/widget.js` (new — first-ever tracked copy of what `widget.vakaviti.ai` actually serves, closing the exact kind of undocumented-drift gap that caused this whole detour).

**Not yet done:** deciding permanently between reconnecting `vakaviti-widget`'s Git integration vs. eliminating it by routing `widget.vakaviti.ai` straight to the Worker; P2 (agentic tool-call loop), P3 (WooCommerce CSV export), and P8 (999999 OTP bypass code) remain open and carried forward. P4 (Environment Minister confirmation) resolved later in Session 51 — see Section 3 P4.

### Session 48 — 2026-06-26 — CLOSED
**DiscoverFiji.ai fully migrated into the Vakaviti.ai/Lagi ecosystem; AI-visibility infrastructure built from scratch; content build started; Lagi agentic upgrade fully scoped.**

Opened reviewing the live discoverfiji.vercel.app site James asked about boosting fijitourtransfers.com's revenue. Found the homepage's nav was almost entirely broken — 9 of 11 clickable elements (every category tile, both "Start Planning" CTAs, "Book Airport Transfer") 404'd, since the internal pages they pointed to (Phase 2+) were never built last session. Fixed immediately with a stop-gap: routed dead links to real fijitourtransfers.com/nadiairporttransfers.com pages, or to the working chat via a `#planner` anchor.

**The bigger thread — brand collision research, triggered by a domain question:** James asked whether `discoverfijiisland.com` would help. Research surfaced that "Discover Fiji" is genuinely contested — Tourism Fiji's own government tagline, Rosie Travel Group's discoverfiji.com (50-year incumbent, airport-distributed printed guide since 2019, relaunched Sept 2025 as a full booking platform), plus two more unrelated operators. Reframed the real question from "best domain" to "should this even be a separate brand" — James's own reminder ("we already have Vakaviti.ai") settled it. Decision: fold DiscoverFiji.ai into Vakaviti.ai/Lagi entirely rather than fight for a structurally hard-to-own name.

**Executed the fold-in:**
1. Added `discover.vakaviti.ai` as a new subdomain (CNAME in Cloudflare DNS) on the existing Vercel project — same pattern as lagi.vakaviti.ai/join.vakaviti.ai, avoiding the heavier path-based-routing-via-Worker-proxy alternative. Confirmed `discoverfiji.ai` itself was never actually connected to Vercel at all.
2. Stripped all "DiscoverFiji.ai" branding from the codebase — footer, headings, back-links, meta-title fallbacks — replaced with "Lagi by Vakaviti.ai" / "Powered by Vakaviti.ai." Canonical domain set to discover.vakaviti.ai.
3. **Dropped Supabase + OpenAI entirely**, replaced with a dedicated D1 database `discoverfiji-content` (kept separate from `vakaviti-kb` deliberately — isolates this site's content from live revenue-critical partner/lead data). Built `src/lib/d1.ts`, a server-only client calling D1's REST API (Vercel can't use native D1 bindings).
4. Built the first real destination page template (`/destinations/[slug]`), proven with Yasawa Islands + the real Sawa-I-Lau Caves tour.
5. **Built complete AI-visibility infrastructure from zero** — this app had none before today, unlike the rest of the platform: `robots.ts` (AI crawler allow-list matching the rest of the platform), dynamic `sitemap.ts` (queries D1, auto-scales), `llms.txt`, and JSON-LD schema (TouristDestination + Product/Offer + BreadcrumbList) built into the page template itself.
6. **Found and fixed a real bug**: D1's `datetime('now')` isn't valid ISO 8601 for a sitemap's `<lastmod>` — Google Search Console correctly flagged it on first submission. Fixed with a format-conversion helper.
7. Submitted to GSC (confirmed the existing vakaviti.ai Domain property auto-covers the new subdomain) and Bing Webmaster Tools (one-click import from GSC, zero errors). IndexNow discussed, not yet configured.
8. **Grew real content across four batches**: Yasawa Islands → Nadi/Natadola Beach/Sigatoka/Coral Coast → Port Denarau + deeper Nadi/Sigatoka/Natadola inventory → 6 more Nadi airport-transfer tours found in already-gathered data. Ended the session at **6 destinations, 18 real tours**, all pulled from the live fijitourtransfers.com catalogue, none invented.
9. **Hit a real wall**: fijitourtransfers.com's tour listing widget is JS/AJAX-rendered. Neither paginated archive URLs nor location taxonomy pages (`/st_location/...`) serve tour cards to a static fetch — confirmed by testing both directly. The only server-rendered source found was the homepage's hardcoded cards, now exhausted. Recommended a WooCommerce CSV export as the real path to the remaining ~90 of 108 tours — not yet done.

**Agentic AI scoping (no code written, by design):** James raised that "agentic AI" was the current industry conversation and felt Lagi was behind. Did a precise scoping pass rather than rushing: defined the term against six concrete properties, assessed Lagi honestly (single-shot RAG concierge, agentic on none of the six), and designed a bounded upgrade — one structured-lookup tool, capped tool-call loop (~3 iterations max), graceful fallback to normal RAG when the lookup returns nothing. Investigated `vakaviti-kb`'s real schema via `sqlite_master` and confirmed there's no dedicated `tours` table (closest is `deals`, promotional-only). Concluded the real blocker is content breadth, not engineering effort — recommended growing destination/tour content first, building the tool-call loop once there's real data to query. Deliberately did not touch the live Worker this session.

**Long-term vision stated explicitly:** James: "Become the Tripadvisor + Expedia + ChatGPT of Fiji." Broke into three honest pillars (breadth/trust, booking conversion, comprehensive AI) with realistic timelines for each — flagged that chasing the literal Expedia marketplace model would dilute the existing zero-commission differentiator rather than strengthen it. Landed on: content breadth is the lever that serves all three pillars at once, now the explicit shared priority.

**Key learning:** the D1 dashboard console's query box is genuinely single-line input — pasting multi-paragraph text with literal line breaks silently breaks it ("Requests without any query are not supported"). Fix (char(10) concatenation instead of literal newlines) now documented in every seed file for future sessions. Also: always verify a generated SQL statement is truly one physical line (caught one's own mistake mid-session where a Python-generated file had accidental line breaks between VALUES tuples) before handing it to James to paste.

**Not yet done, explicitly carried to Session 49:** the Lagi page-awareness fix (P1, still open), the agentic tool-call loop (scoped, zero code), the WooCommerce CSV export, IndexNow setup, the discoverfiji.ai→discover.vakaviti.ai redirect (nothing to redirect from yet), pushing batch 3/4 seed files to GitHub, and all carried fijitourtransfers.com cleanup items from prior sessions.

### Session 47 — 2026-06-26 — CLOSED
**DiscoverFiji.ai launched as a new, separate front-end initiative.**

James brought a comprehensive vision doc for "DiscoverFiji.ai" — originally specced as a fully independent Next.js/Supabase/OpenAI platform with its own AI brain. Flagged the strategic overlap with the existing platform before building anything (same core business — "generate leads and bookings for Fiji Tour Transfers" — plus a redundant AI concierge, redundant itinerary builder, redundant lead-scoring system). James confirmed: pursue it as a real separate build, new stack, new brand — domain already owned (discoverfiji.ai), starting completely from scratch on accounts.

**What got built and shipped same-day:**
1. Next.js 15 + Tailwind v4 scaffold, with an original visual identity (bathymetric/navigation-chart design system — deliberately not a Vakaviti.ai clone, grounded in Fiji's traditional wayfinding heritage rather than generic tropical-AI-startup defaults).
2. Supabase schema for content tables (destinations, tours, resorts, partners, reviews, blog articles).
3. GitHub repo created (github.com/jamesdeorajan-sys/discoverfiji), Vercel project connected and deployed — live, working homepage confirmed via screenshot.
4. **Key architectural correction, made before too much was built the wrong way:** the original spec called for a separate OpenAI-powered chatbot with its own vector database. Caught this as a direct conflict with "Lagi is our main superpower" — building a second brain would fragment learning signal across two disconnected pools instead of compounding into the one that already serves 29+ partners. Verified Cloudflare Vectorize's real capacity (10M vectors/index as of Jan 2026) to confirm there was no genuine scale justification for a separate system. James confirmed: route through Lagi instead.
5. Built the actual integration: `src/app/api/chat/route.ts` proxies server-side to the live Lagi Worker in public mode. This means DiscoverFiji.ai inherits RAG search, heat scoring, D1 lead capture, partner routing, and WhatsApp/email notification automatically — none of it rebuilt.
6. **Found and fixed a real bug during the first live test:** the Worker's `isAllowedOrigin` check isn't real browser CORS — it's a manual gate that rejects any request with no Origin header, which is what a bare server-side `fetch()` sends. First test silently 403'd, surfaced to the user as a generic "didn't catch that." Fixed by explicitly setting a trusted Origin header on the proxy call.
7. **Verified end-to-end with a real conversation:** asked about a 5-day honeymoon, got back a correctly-routed recommendation (Blue Lagoon Beach Resort), real live pricing, authentic Fijian voice, and the lead-capture flow firing exactly as designed. Also fixed a markdown-rendering bug (literal asterisks instead of bold text) found during this same test.
8. Removed the `leads`/`quotes`/`ai_conversations` tables from the Supabase schema once it became clear they'd be entirely redundant with what the Lagi proxy already provides for free.

**Key learning:** the original vision doc, while well-structured, would have meant rebuilding — on different infrastructure, from zero — several things that already exist and work well (the AI concierge, the itinerary builder, the lead-scoring engine). Reading a spec doc literally without checking it against what's already built risks real wasted effort. The fix wasn't complicated once spotted: keep the new front-end and content strategy, route the actual intelligence through the existing brain.

**Not yet done, explicitly carried to Session 48:** domain DNS connection, Supabase/OpenAI account setup, the 500 destination pages, the knowledge-ingestion pipeline (with review step), and GitHub token cleanup. None of the Session 46 priorities (Lagi page-awareness, OTP code, schema source hunt, etc.) were touched this session — they remain exactly as open as before, just now joined by DiscoverFiji.ai's own next steps.

### Session 46 — 2026-06-23 — CLOSED
**What we found and fixed:**
1. **Worker GitHub backup — root cause was worse than "stale," now genuinely fixed.** The GitHub copy was a completely different single-site draft Worker, not an old version of the real one. Pulled the live v57 source, found a real syntax bug (5 unescaped nested template-literal backticks, likely a copy-paste artifact), fixed mechanically with zero logic changes, verified with `node --check`, committed via fine-grained PAT, and independently re-fetched from GitHub to confirm the push actually landed correctly (1,875 lines, correct header, syntax-valid).
2. **Checkout failure (sentinel_errors, P2) tested live and confirmed working.** Real test booking completed end-to-end successfully. Created a real WooCommerce order in the process — needs cancelling/confirming-no-charge.
3. **Deep AI-visibility audit of fijitourtransfers.com.** Confirmed robots.txt, llms.txt, sitemap, and schema are all live and good quality — corrected stale BRAIN.md notes that said llms.txt/schema were missing (Praveen had already done this work).
4. **Found and fixed a real brand-name typo** in Rank Math (Website Name/Person-Organization Name had an extra "s" — "fijitourstransfers.com") causing a live `og:site_name` meta tag mismatch.
5. **Found and deactivated a duplicate Local Business/Organization schema** — a separate JS-injected block ("Jason" snippet, ID 19019) was creating a second, conflicting business entity with placeholder social links never filled in.
6. **Fixed three broken WhatsApp links** on the homepage (malformed Google-search-wrapped URL with literal placeholder text).
7. **Fixed a live typo** ("Port Denaru" → "Port Denarau") in a page H1.
8. **🔴 Found the session's most important issue: Lagi has no page/tour-level awareness.** Live-tested by asking a real question on a real tour page — Lagi answered confidently about the wrong tour entirely. Confirmed via Worker source code that no page-context mechanism exists anywhere in the request pipeline. This is now the top Session 47 priority.
9. **Found a homepage "hidden text" section** — a real Google spam-policy risk, not just an AI-search cosmetic issue, since the content is fully present in HTML but deliberately hidden from human visitors via Elementor responsive-visibility settings. Sent a brief to Praveen via Gmail draft.
10. Found several smaller issues: a 3rd unsourced Organization schema entity with a wrong address, a cross-brand Author/Legal-Name bleed pattern (confirmed sitewide, not isolated), a possible pricing outlier, a dead footer link, and a sitewide Cloudflare email-obfuscation pattern worth a conscious decision.
11. Verified one suspected issue was a false alarm: "Bulabard Resort" is a real hotel, not fabricated content — worth recording so it isn't re-investigated.

**Key learning:** the most valuable finding this session (Lagi's page-blindness) was only caught by actually *using* the product as a real visitor would, not by checking metadata, schema validators, or dashboards. Static audits (robots.txt, schema, sitemaps) caught real issues too, but none of them would ever have surfaced a behavioral/accuracy bug like this. Future sessions should budget time for live conversational testing of Lagi on real partner pages, not just technical SEO checks.

**Carried forward, not touched this session:** Knowledge Hub continuation, partner agreement doc, Google Business Profile, WhatsApp permanent number, ~68 unaudited Workers & Pages projects, lagi.vakaviti.ai meta description confirmation, lagi.vakaviti.ai Git pipeline migration.

### Session 45 — 2026-06-23 — CLOSED
Git auto-deploy pipeline established (7 properties). vakaviti.ai root domain redirect root-caused and fixed (months-long single-file-deploy bug). 5 GEO microsites' Lagi widget 404 fixed. Knowledge base real export (578 items, 32 PII rows found and deleted). 3 Knowledge Hub pages launched. Full detail in prior BRAIN.md versions / GitHub history.

### Sessions 1-44
Full platform built: D1 + Vectorize + Worker architecture, commercial engine, partner widgets, 118 referral routes, knowledge base foundation, GEO pages, reviews system, error sentinel, meta bridge, Zone Manager, AI Gateway, partner onboarding. Full detail in GitHub commit history and prior BRAIN.md versions.

---

## 19. GEO MICROSITES

Unchanged from Session 45 — 5 microsites on custom vakaviti.ai subdomains, Git-connected, not touched this session.

---

## 20. JAMES'S SAFETY PROMPT SYSTEM

Unchanged from Session 45. See prior BRAIN.md version for full prompt list (Checkpoint, Brain note, Close session, Verify first, Surgical only, Revenue test, North star check, Lagi impact?, Keep Lagi clean, Thinking out loud, Just ideas, Best practice?).

---

## 21. DISCOVER.VAKAVITI.AI — FOLDED INTO THE VAKAVITI.AI/LAGI ECOSYSTEM (Session 48)

> Was "DiscoverFiji.ai," a separate brand. Renamed and re-architected in Session 48 — see Section 2 and the Session 48 decisions log for why.

| Parameter | Value |
|---|---|
| Domain | **discover.vakaviti.ai** (subdomain, live and working) |
| discoverfiji.ai | Owned but was never connected to the Vercel project at all (only ever existed as the default vercel.app URL). No redirect needed yet since nothing currently points there — see Section 3 P4 if James reconnects it later. |
| GitHub | github.com/jamesdeorajan-sys/discoverfiji (repo name unchanged, only the live domain/branding changed) |
| Hosting | Vercel, auto-deploys on push to `main` |
| Stack | Next.js 15/16, TypeScript, Tailwind v4. **No Supabase, no OpenAI** — both dropped Session 48. |
| Database | **discoverfiji-content** — a dedicated Cloudflare D1 database (ID `2414dae8-f76f-4e18-877e-031a9d42fca4`), deliberately separate from `vakaviti-kb` to isolate this site's content from live revenue-critical partner/lead data. Reached via D1's REST API (`src/lib/d1.ts`, server-only) since Vercel can't use D1's native Worker bindings. 6 tables: destinations, tours, resorts, partners, reviews, blog_articles. |
| AI brain | **None of its own.** Proxies server-side to the live Lagi Worker (fiji-chat-widget) via `src/app/api/chat/route.ts`, site_id: `lagi_public` — unchanged from Session 47. |
| Booking | No own payment processing — hands off to fijitourtransfers.com's WooCommerce checkout |
| Branding | "Lagi by Vakaviti.ai" / "Lagi — Fiji's AI travel guide" / "Powered by Vakaviti.ai" throughout — all "DiscoverFiji.ai" references removed from on-page copy and metadata Session 48. Canonical domain set to discover.vakaviti.ai. |
| Design identity | Unchanged — bathymetric/navigation-chart aesthetic, deep chart-ink navy, aged-paper tones, coral accent, Space Grotesk + Source Sans 3 + IBM Plex Mono. |
| AI-visibility infrastructure | **Built from zero Session 48.** `robots.ts` (AI crawler allow-list matching rest of platform), dynamic `sitemap.ts` (queries D1, auto-scales with content), `llms.txt` route, JSON-LD schema (TouristDestination + Product/Offer + BreadcrumbList) built into the destination page template. Submitted to GSC (auto-covered by vakaviti.ai's existing Domain property) and Bing Webmaster Tools (imported from GSC, zero errors). |
| Content built | **6 destinations, 18 real tours** as of Session 48 close: Yasawa Islands, Nadi (12 tours/transfers — the deepest), Natadola Beach, Sigatoka, Coral Coast, Port Denarau. All pulled from the live fijitourtransfers.com catalogue — real prices, durations, booking URLs, none invented. |

**Status:** Foundation + chat + content engine all proven and live. ~482 of ~500 planned destination pages still to build — blocked on getting the rest of fijitourtransfers.com's 108-tour catalogue (see below), not on infrastructure.

**Critical context for any future session touching this project:**
- Do NOT rebuild a separate AI brain, lead-scoring system, or itinerary builder for this site. The whole point of the Session 47 architecture decision was routing through Lagi instead of duplicating it. If asked to "improve the AI" here, the fix almost certainly belongs in the shared Lagi Worker (benefiting every partner site), not in this repo.
- Do NOT reintroduce "DiscoverFiji" branding anywhere user-facing — this was a deliberate Session 48 fix for a real brand-collision problem (see decisions log). Internal identifiers (the `discoverfiji-content` D1 database name, the GitHub repo name, session_id prefixes in code) were left as-is since they're not user-facing and renaming them carries real risk for no benefit.
- The D1 console's query box is single-line input — any seed SQL with literal multi-line text (e.g. paragraph breaks) will silently fail to execute. Use `char(10) || char(10)` concatenation instead, and always verify generated SQL is genuinely one physical line before handing it to James.

**fijitourtransfers.com's tour catalogue is harder to scrape than expected.** Confirmed Session 48: the site's tour search/listing widget is JavaScript/AJAX-rendered. Paginated archive URLs (`/tours/page/2/`, etc.) return page-1's content regardless of page number; location taxonomy archive pages (`/st_location/suva/`, etc.) return zero tour cards at all in a static fetch. The only server-rendered tour data found anywhere on the site is a handful of cards hardcoded into the homepage — already fully used. **The real path to the remaining ~90 of 108 tours is a WooCommerce CSV export from James** (WordPress admin → Products → Export). Not yet done — see Section 3 P3.

**Content pipeline plan (not yet built):** once there's real breadth, push destination/tour pages into Lagi's `/knowledge-add` endpoint after a human review pass — not auto-ingested, since that endpoint has no auth and feeds the same knowledge base every partner relies on.

**Agentic upgrade for Lagi (Section 2/3 detail) is logically tied to this project's growth:** the recommended data source for the scoped tool-call loop is `discoverfiji-content`'s `tours` table specifically (cleaner schema than `vakaviti-kb`'s `deals` table, reached via REST API so no Worker-binding risk) — meaning every destination/tour batch added here also directly improves the eventual agentic Lagi upgrade, not just this site's own pages.

