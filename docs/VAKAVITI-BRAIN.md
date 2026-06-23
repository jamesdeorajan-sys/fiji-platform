# VAKAVITI-BRAIN.md
# James Richardson — CEO Intelligence File
# Fetched by Claude at the start of every session
# Updated by Claude at the end of every session
# Last updated: Session 45 CLOSED — 2026-06-23

---

## 1. WHO WE ARE

**Company:** Vakaviti.ai — Fiji's AI Tourism Partner Network
**Mission:** Build Fiji's most powerful AI tourism platform
**Stage:** Pre-launch. July 1 2026 public + partner launch confirmed. 8 days remaining.
**Founded by:** James Richardson — CEO
**WhatsApp:** +61 478 886 145
**Email:** helpronline@gmail.com
**GitHub:** github.com/jamesdeorajan-sys/fiji-platform
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1
**Operating entity:** AJ Group Enterprises Pty Ltd
**Ground ops:** Ben (Fiji) — company registration for Fiji Tourism Guide Ltd

---

## 2. PLATFORM STATE — CURRENT AS OF SESSION 45

### Revenue confirmed (April 1 — June 3, 2026)
- **$13,747.75 AUD across both booking sites — 44 orders**
- Tuesday strongest day, peak hours 10am-3pm Sydney
- Facebook ads AUD $258 spent — strong ROI confirmed
- Not re-verified Session 45 — still the last confirmed figure

### 🆕 NEW THIS SESSION — the Git auto-deploy pipeline
**Biggest infrastructure change since platform inception.** A fine-grained GitHub PAT (Contents: Read/write, scoped only to `fiji-platform`) now lets Claude push code directly, and Cloudflare Pages auto-deploys on push. **7 properties are now on this pipeline** — no more zip uploads, no more single-file-deploy file-wiping risk, for any of them:

| Pages Project | Custom Domain | Repo Folder |
|---|---|---|
| familyresortsfiji | familyresorts.vakaviti.ai | `microsites/familyresortsfiji` |
| divingfijiguide | diving.vakaviti.ai | `microsites/divingfijiguide` |
| honeymoonfijiguide | honeymoon.vakaviti.ai | `microsites/honeymoonfijiguide` |
| yasawaislandsguide | yasawa.vakaviti.ai | `microsites/yasawaislandsguide` |
| mamanucaislandsguide | mamanuca.vakaviti.ai | `microsites/mamanucaislandsguide` |
| vakaviti-join-page | join.vakaviti.ai | `vakaviti-join-page` |
| vakavitiai | vakaviti.ai | `vakaviti-root` |

**NOT yet on this pipeline:** `lagi.vakaviti.ai` (project `vakaviti-lagi-public`) — still deployed by manual zip upload. Working perfectly, just not yet protected the same way. The remaining ~68 of 75 Workers & Pages projects in the account have not been audited — likely includes dead legacy demos (`vakaviti-bluelagoon`, `vakaviti-palms-denarau`, `vakaviti-sofitel`) that should be retired, not migrated.

### 🆕 RESOLVED THIS SESSION — vakaviti.ai root domain redirect (the big one)
**Root cause found and fixed.** `vakaviti.ai` had a wildcard redirect to `lagi.vakaviti.ai` swallowing every path including `/sitemap.xml` and the GEO guide pages — traced to months of single-file "Create new deployment" uploads each silently replacing the entire live file set (a Session 18 meta-refresh redirect and a Session 31 real-homepage build had both been partially overwritten by later single-page uploads, with neither fully surviving). Rebuilt from scratch: real homepage + all 3 original GEO pages (corrected 2025→2026 throughout) + robots.txt + sitemap.xml, committed to `vakaviti-root`, Git-connected, **confirmed live** (screenshot-verified: URL stays on vakaviti.ai, sitemap.xml returns real XML, GSC shows sitemap Status: Success with discovered pages same-day).

### 🆕 RESOLVED THIS SESSION — P1 Lagi widget 404 on 5 GEO microsites
Changed `site_id` on all 5 microsites from the dead `op_vakaviti_guides_001` to **`lagi_public`** — confirmed working via a real lead record already in the `leads` table using that exact site_id. No new D1 partner row needed. Deployed automatically via the Git pipeline (zero manual Cloudflare steps) — first fix in this platform's history to do so.

### 🆕 NEW THIS SESSION — Lagi Knowledge Hub (first 3 pages live)
Built a diagnostic-only Worker (`vakaviti-kb-inspect`, D1-bound to `vakaviti-kb`, no write access used for inspection) to export the real knowledge base for the first time. **Real counts: 578 `knowledge_items` + 95 `kb_chunks`** — higher than the previously assumed ~440, but with heavy duplication (true unique count closer to 200-250). `kb_chunks` only stores a `content_preview` column — full chunk text likely lives in Vectorize itself, not D1; querying that needs a different approach next session.

**🔴 Critical finding, now fixed:** `knowledge_items` contained real customer PII — names, personal emails, a personal phone number — captured by the self-learning loop from live conversations instead of being filtered before storage. **32 rows identified and deleted** (47 other flagged rows were false positives — legitimate partner WhatsApp numbers/emails — correctly left alone). This was a live risk: Lagi was drawing on other travelers' personal data when answering new conversations, not just a publishing risk.

3 Knowledge Hub pages now live on `vakaviti.ai`, built from verified clean content, FAQPage schema, same design system as the GEO pages: `/fiji-visa-money-guide`, `/fiji-culture-kava-language-guide`, `/fiji-weather-best-time-guide`. Diving, safety, and dining topics are confirmed clean and ready to build next.

### 🔴 NEW FINDING, NOT YET ACTIONED — possible live checkout failure
`sentinel_errors` table contains an unresolved critical error: `"checkout payment failed"` on `fijitourtransfers.com/checkout/`, dated ~1 month ago (2026-05-24). **Status unknown — never confirmed fixed or still happening.** This is your highest-traffic site (21.6k+ hits). Needs a real test booking or a fresh Sentinel check before anything else, given the revenue exposure.

### 🔴 NEW FINDING — domain_compliance / statement_performance / question_clusters gaps
- `domain_compliance` row for `vakaviti.ai` says "FULLY COMPLETE Session 34" in notes, but every structured flag (llms_txt_live, robots_txt_live, schema_deployed, lagi_widget) reads 0 — the notes field was never kept in sync with reality, which is exactly the pattern that let the redirect bug hide for months.
- `statement_performance` (the 5 A/B power statements from Session 34) show `last_checked: null` and zero citations across the board — never actually measured since deployment.
- `question_clusters` table is completely empty — the "self-learning knowledge gap detection" loop described in earlier sessions does not appear to be populating it.

### Live Systems
| System | Status |
|---|---|
| Lagi chat Worker | **v57 — 1,874 lines — LIVE.** GitHub backup still stale at 512 lines — unresolved, flagged again this session, highest remaining infrastructure risk |
| fiji-chat-widget Worker | v57 — both Anthropic calls routing through AI Gateway (lines 874 + 1767) |
| widget.vakaviti.ai | Live |
| lagi.vakaviti.ai | **v4 LIVE — 98/100 mobile, 99/100 desktop.** Missing meta description (Bing-flagged) — fix given Session 45, never confirmed deployed |
| vakaviti.ai | **REBUILT Session 45 — real homepage, 6 pages total, no redirect, Git-connected, GSC sitemap Status: Success** |
| 5 GEO microsites | **5/5 on custom vakaviti.ai subdomains + Git pipeline, Session 45.** Widget fix (lagi_public) deployed to all 5 |
| vakaviti-join-page | **Found not in GitHub, added Session 45** — meta description + canonical added, Git-connected |
| tourfijitours.com | Live — Lagi active, AI visibility deployed |
| fijitourtransfers.com | Live — Lagi active — llms.txt still missing (Praveen) — **possible checkout error, unconfirmed, see above** |
| nadiairporttransfers.com | Live — 500+ reviews — long-standing `app.js` brand/phone bug (FijiTransfers → Nadi Airport Transfers, AU→Fiji number) still unresolved since Session 22 |
| Knowledge base (D1 source of truth) | **578 knowledge_items (546 after PII cleanup) + 95 kb_chunks** — real counts confirmed Session 45, exceeds prior ~440 estimate but with heavy duplication |
| D1 vakaviti-kb | 21 tables (confirmed full list Session 45: partners, contact_channels, commission_tiers, embed_config, kb_chunks, leads, conversation_events, partner_referrals, deals, knowledge_queue, knowledge_items, question_clusters, reviews, sentinel_errors, meta_traffic_intents, build_log, domain_compliance, statement_performance, zone_compliance, zone_audit_history, zone_speed_history) |
| vakaviti-ai-gateway | LIVE — all AI calls logging cost + tokens |
| vakaviti-zone-manager | v3 LIVE — D1-driven, Sydney speed tests, auto-enrol |
| join.vakaviti.ai | LIVE — now Git-connected, see above |
| vakaviti-onboard Worker | v3 LIVE — email notifications working |
| vakaviti-kb-inspect Worker | **NEW Session 45** — diagnostic-only, D1-bound to vakaviti-kb, used for KB export and PII cleanup |

### Worker Version History
| Version | Lines | Key changes |
|---|---|---|
| v54 | 1,731 | Review metrics, RAG improvements |
| v55 | 1,748 | Lead Capture Superpower |
| v56 | 1,861 | D1 routing, WhatsApp notify, Fiji heat signals |
| **v57** | **1,874** | **CURRENT — WhatsApp dual-notify fixed. Both Anthropic API calls now route through AI Gateway. GitHub backup still stale at 512 lines — unresolved 19 sessions running** |

---

## 3. TOP PRIORITIES — SESSION 46

> Claude: read this section first. ONE task at a time.

**P1 — Worker GitHub backup still stale (1,362 lines of drift, 19 sessions unresolved)**
- Live `fiji-chat-widget` Worker is v57, 1,874 lines. GitHub `workers/chat-widget/worker.js` is only 512 lines.
- Confirmed via direct repo check Session 45. Highest remaining technical risk on the platform — if the live Worker is ever lost, the backup cannot rebuild it.
- Fix: pull the real v57 source and commit it properly. Do NOT replace the whole file blindly — confirm the live source first.

**P2 — Possible live checkout failure on fijitourtransfers.com**
- `sentinel_errors` table shows `"checkout payment failed"` on `fijitourtransfers.com/checkout/`, dated 2026-05-24, severity critical, never confirmed resolved.
- This is the highest-traffic site in the network (21.6k+ hits). Test a real booking or check Sentinel for recent recurrence before anything else this session.

**P3 — Remove the 999999 master OTP bypass code**
- Flagged Session 5 as "must remove before public launch." Never confirmed removed in any session since. 8 days to launch.

**P4 — Confirm lagi.vakaviti.ai meta description deployed**
- Bing flagged missing meta description Session 45. Fix instructions given. Never confirmed live.

**P5 — Continue the Lagi Knowledge Hub**
- 3 pages live (visa/money, culture/kava/language, weather/best-time). Diving, safety, and dining content confirmed clean in the Session 45 export — ready to build the same way.
- Re-query `kb_chunks` for full text (likely in Vectorize, not D1 — `content_preview` column is truncated).

**P6 — Put lagi.vakaviti.ai (vakaviti-lagi-public) on the Git pipeline**
- Last property still on manual zip upload. Working fine, not urgent, but unprotected against the same single-file-deploy risk that caused the vakaviti.ai redirect bug.

**P7 — Audit the remaining ~68 of 75 Workers & Pages projects**
- Sort by oldest-deployed in the Cloudflare dashboard. Identify dead legacy demos (`vakaviti-bluelagoon`, `vakaviti-palms-denarau`, `vakaviti-sofitel` are likely candidates) to retire, and any other active project that should join the Git pipeline.

**P8 — WhatsApp permanent business number**
- Still on Meta test number. Must resolve before July 1 launch.

**P9 — Resolve backlink/widget-rollout mechanism with Praveen**
- Unknown whether the Lagi widget is a shared/synced snippet across partner sites or individually installed. Determines whether the planned backlink campaign (partner sites linking back to vakaviti.ai/lagi) is one edit or a 29-site campaign.

**P10 — Partner agreement document**
- Draft before any external partner approach. Covers: what Lagi does, data policy, lead ownership, uptime, pricing. Blocks all external partner conversations.

**P11 — Google Business Profile**
- Setup at business.google.com. Entity: Fiji Tourism Guide Ltd / Vakaviti.ai.

**P12 — fijitourtransfers.com/ask/ page — Praveen**
- Brief sent Session 44, deadline was June 22 — status unconfirmed.

**P13 — Verify 6 unconfirmed partner Lagi installs**
- fijihomestayz.com, realfiji.tours, fijiepictours.com, fijitours.online, fijidaytours.com.au, bookfijitours.com.au — all show real traffic in Cloudflare Analytics, but none explicitly confirmed widget-live since their Session 21-22 install.

**P14 — fijinanny.com llms.txt 404** — still unresolved, low urgency.

**P15 — Decide the fijithingstodo.com / "Seru" competing-widget question** — strategic call, not a bug.

**P16 — Define or retire aiwebst.online** — 2 total visitors, no session record of original intent.

---

## 4. STRATEGIC BETS

**The big bet:** Vakaviti.ai — Fiji's AI tourism intelligence network. Zero commission entry strategy.

**Revenue confirmed:** $13,747 AUD in 2 months. Platform works.

**July 1 launch target:** Public + partner launch. Lagi live across all partner sites.

**Competitive moat:** Fiji knowledge graph + operator network + cultural authenticity. NOT model weights.

**AI search position:** 156 AI crawler requests in 24hrs (up 437.9%). Google, ChatGPT, Bing, Claude, Perplexity all crawling the network. Citations expected within days of session 42.

**What's working:**
- Booking engine generating real revenue
- Lagi converting real travellers — full lead flow verified
- Email + WhatsApp notification confirmed working
- Heat scoring detecting real booking intent
- D1-driven partner routing working for all 29 partners
- AI crawlers actively indexing — 10 companies confirmed
- Partner onboarding form live and sending emails ✅

> Every build decision must serve revenue. Move fast. Be #1.

---

## 5. LAGI — PROTECTED CORE

| Parameter | Value |
|---|---|
| Worker | fiji-chat-widget **v57**, 1,874 lines |
| Lagi page | lagi-v4 — deployed 2026-06-17 |
| Speed | 98/100 mobile · 99/100 desktop · Sydney |
| Vectorize | ~440 live vectors |
| AI Gateway | vakaviti-ai-gateway — ACTIVE on both lines 874 + 1767 |
| WhatsApp Meta App | ID 1700903951357623 — VakavitiBot system user |
| WHATSAPP_TOKEN | Set in Worker secrets ✅ |
| WHATSAPP_PHONE_ID | Set in Worker secrets ✅ |

**NEVER replace whole Worker file. Surgical edits only via find-and-replace.**

---

## 6. AI GATEWAY — vakaviti-ai-gateway

| Setting | Value |
|---|---|
| Gateway name | vakaviti-ai-gateway |
| Endpoint | https://gateway.ai.cloudflare.com/v1/595101df2c562b3c65595420d43f9fe1/vakaviti-ai-gateway/ |
| Anthropic URL | https://gateway.ai.cloudflare.com/v1/595101df2c562b3c65595420d43f9fe1/vakaviti-ai-gateway/anthropic/v1/messages |
| Collect Logs | ON — 100,000 limit |
| Cache Responses | ON — 5 minute purge |
| Rate Limit | ON — 50 req/min |
| Worker lines updated | Line 874 (main chat) + Line 1767 (itinerary builder) |
| Status | LIVE |

---

## 7. ZONE MANAGER — vakaviti-zone-manager v3

**The automation superpower. Built Session 42, upgraded Session 43.**

| Item | Value |
|---|---|
| Worker URL | https://vakaviti-zone-manager.helpronline.workers.dev |
| Manager key | vakaviti-manager-2026 |
| CF API Token | [stored in Worker secrets — do not commit] |
| D1 binding | DB → vakaviti-kb |
| Cron 1 | `0 2 * * 1` — Monday 2am UTC (12pm Sydney) — compliance fix + start speed tests |
| Cron 2 | `0 3 * * mon` — Monday 3am UTC (1pm Sydney) — read + store speed results |

**Endpoints:**
- `/health` — no auth
- `/status` — no auth — JSON for status dashboard
- `/report` — auth — full compliance + speed table
- `/fix-all` — auth — audit + fix all zones
- `/fix?domain=x` — auth — fix one domain
- `/enrol?domain=x&partner_id=y` — auth — add domain instantly
- `/generate-llms-txt?domain=x` — auth — ready-to-deploy llms.txt
- `/speed?domain=x` — auth — speed history
- `/history?domain=x` — auth — audit history

**Settings enforced per zone (9):** HTTP/3 · Brotli · Always HTTPS · Early Hints · TLS 1.3 · 0-RTT · Min TLS 1.2 · HTTP/2 Priority · Prefetch Preload

**Speed tests:** Region locked to `australia-southeast1` (Sydney). Priority domains get weekly scheduled tests, others get monthly one-off.

**Priority domains (weekly speed tests):**
- nadiairporttransfers.com
- lagi.vakaviti.ai
- vakaviti.ai
- tourfijitours.com
- fijitourtransfers.com

**Session 43 first run results:**
- 30 domains read from D1
- 11 CF zones processed (19 external partner sites skipped correctly)
- 18 settings fixed
- 11 Sydney speed tests started
- 0 false alerts

**Known issues:**
- `0-RTT` and `Prefetch Preload` settings failing on all zones (plan limitation — not blocking)
- `fijitourtransfers.com` at 67% — llms.txt missing (Praveen task)

### Zone compliance — current state
| Domain | Score | Issue |
|---|---|---|
| nadiairporttransfers.com | 80% | 0-RTT, Prefetch Preload (plan limit) |
| vosavakaviti.com | 80% | 0-RTT, Prefetch Preload (plan limit) |
| lagi.vakaviti.ai | 80% | 0-RTT, Prefetch Preload (plan limit) |
| fijitourtransfers.com | 67% | llms.txt missing + plan limits |
| bestfijitours.com | 80% | 0-RTT, Prefetch Preload (plan limit) |
| fijiepictours.com | 80% | 0-RTT, Prefetch Preload (plan limit) |
| fijihomestayz.com | 80% | 0-RTT, Prefetch Preload (plan limit) |
| fijithingstodo.com | 80% | 0-RTT, Prefetch Preload (plan limit) |
| fijitours.online | 80% | 0-RTT, Prefetch Preload (plan limit) |
| guidefiji.com | 80% | 0-RTT, Prefetch Preload (plan limit) |
| realfiji.tours | 80% | 0-RTT, Prefetch Preload (plan limit) |

**To run manually from CMD:**
```cmd
curl -X POST "https://vakaviti-zone-manager.helpronline.workers.dev/fix-all" -H "X-Manager-Key: vakaviti-manager-2026"
```

---

## 8. AI VISIBILITY — CONFIRMED LIVE

### Cloudflare settings — all enabled
| Setting | Status |
|---|---|
| HTTP/3 | ✅ Enabled |
| HTTP/2 | ✅ Enabled |
| 0-RTT Connection Resumption | ✅ Enabled |
| Always use HTTPS | ✅ Enabled |
| TLS 1.3 | ✅ Enabled |
| Early Hints | ✅ Enabled |
| Brotli | ✅ Enabled |

### AI Crawl Control — 24hr snapshot (Session 42)
| Bot | Company | Requests |
|---|---|---|
| Googlebot | Google/Gemini | 29 |
| OAI-SearchBot | ChatGPT Search | 18 |
| BingBot | Microsoft/Copilot | 12 |
| ClaudeBot | Anthropic | 12 |
| PerplexityBot | Perplexity | 11 |
| Applebot | Apple | 9 |
| Amazonbot | Amazon | 9 |
| Meta-ExternalAgent | Meta AI | 8 |
| Bytespider | ByteDance/TikTok | 6 |
| CCBot | Common Crawl | 6 |
| **TOTAL** | | **156 (+437.9%)** |

---

## 9. VERIFIED TRANSFER PRICES (Session 37)

| Route | Sedan | Minivan |
|---|---|---|
| Nadi Airport → Nadi Town | FJ$19 | FJ$29 |
| Nadi Airport → Denarau Island | FJ$49 | FJ$69 |
| Nadi Airport → Port Denarau Marina | FJ$49 | FJ$69 |
| Nadi Airport → Coral Coast (mid) | FJ$129 | FJ$159 |
| Nadi Airport → Pacific Harbour | FJ$199 | FJ$269 |
| Nadi Airport → Suva | FJ$319 | FJ$369 |

---

## 10. LEAD MANAGEMENT

**All leads → helpronline@gmail.com + WhatsApp +61 478 886 145**

```sql
SELECT l.traveller_name, l.traveller_email, l.partner_id, l.score,
       datetime(l.created_at,'unixepoch') as created
FROM leads l WHERE l.notified=0 AND l.score>=70
ORDER BY l.score DESC, l.created_at DESC
```

### Notify thresholds (v57)
- Score < 40: saved silently, no notification
- Score 40-69: email only
- Score ≥70: email + WhatsApp (both confirmed firing)

---

## 11. PARTNER INTELLIGENCE

| Partner | D1 ID | Status |
|---|---|---|
| Nadi Airport Transfers | op_nadi_001 | Live — email + WhatsApp |
| Fiji Tour Transfers | op_fijitourtransfers_001 | Live — email + WhatsApp |
| Tour Fiji Tours | op_tourfiji_001 | Live — email only |
| Blue Lagoon Beach Resort | op_bluelagoon_001 | Live — email only |
| The Palms Denarau | op_palms_001 | Live — email only |
| Smugglers Cove | op_smugglers_001 | Live — email only |
| Sofitel | op_sofitel_001 | Live — demo deployed |
| Coral Coast Horse Riding | op_coralcoast_001 | Live — sending paid referrals |
| + 21 more partners | — | Seeded in D1 |

**Total: 29 partners in D1**

---

## 12. SENDGRID — UNIFIED KEY

**Critical: ALL Workers must use the same SendGrid key.**

| Item | Value |
|---|---|
| Account | My SendGrid Account |
| Key name | vakaviti-platform |
| Key ID | 0nEyabeJQ-C5zkzumcU4kw |
| Verified sender | helpronline@gmail.com ✅ |
| FROM address | helpronline@gmail.com |
| Click tracking | DISABLED ✅ |
| Open tracking | ENABLED |
| Reputation | 100% |
| Trial ends | July 11, 2026 — upgrade before then |

**Workers using this key:**
- fiji-chat-widget ✅
- vakaviti-onboard ✅
- vakaviti-error-sentinel ✅
- vakaviti-zone-manager ✅

**Old key `vakaviti-ai-v2` — delete this** (superseded by vakaviti-platform)

---

## 13. JOIN.VAKAVITI.AI — PARTNER ONBOARDING

**Fully operational as of Session 43.**

| Item | Value |
|---|---|
| URL | https://join.vakaviti.ai |
| Pages project | vakaviti-join-page |
| Worker | vakaviti-onboard (v3) |
| Worker URL | https://vakaviti-onboard.helpronline.workers.dev/onboard |
| D1 binding | DB → vakaviti-kb |
| SENDGRID_API_KEY | vakaviti-platform key ✅ |

**What happens on submit:**
1. Partner saved to D1 partners table (status: pending)
2. embed_config row created
3. Notification email → helpronline@gmail.com (subject: 🌺 New Vakaviti.ai partner application)
4. Welcome email → partner email (subject: Welcome to Vakaviti.ai)
5. Partner ID auto-generated (format: op_slug_timestamp36)

**To activate a new partner:** Go to D1 → update status from 'pending' to 'active'

**Required fields:** biz_name, contact_name, contact_email, whatsapp, category, region

---

## 14. FIJITOURTRANSFERS.COM — PRAVEEN TASK BRIEF

**Email draft sent:** Draft ID r-6074124901006029401 (Gmail)
**Deadline:** June 22, 2026
**8 tasks:**
1. Upload robots.txt to public_html/
2. Upload llms.txt to public_html/
3. Add site-wide JSON-LD schema (WPCode → HTML → Header)
4. Fix display name "Dipan" → "Fiji Tourism Guide" (both sites)
5. Submit Bing sitemap + IndexNow ping
6. **Per-tour PHP schema** (WPCode → PHP → Run Everywhere)
7. Confirm Traveler plugin review field names for star ratings
8. Repeat Tasks 1–3 + 6 on tourfijitours.com

**ask.html page also to deploy:**
- File: ask.html (936 lines, 73KB)
- Target URL: fijitourtransfers.com/ask/
- Lagi embedded with site_id: op_fijitourtransfers_001

---

## 15. DECISIONS LOG

| Session | Decision | Reasoning |
|---|---|---|
| 45 | Git auto-deploy pipeline adopted as the standard for all new and fixed properties | Single-file Cloudflare Pages uploads were the confirmed root cause of the vakaviti.ai redirect bug and months of silent drift. Git makes that failure mode structurally impossible. |
| 45 | vakaviti.ai rebuilt as a real content hub, redirect to lagi.vakaviti.ai removed entirely | AI search engines can't cite a page that bounces elsewhere. All 5 microsites already link to vakaviti.ai expecting real content. Lagi remains the conversion engine, not the homepage. |
| 45 | Fixed the 5-microsite widget 404 by reusing existing `lagi_public` site_id, not creating a new partner row | Confirmed working via a real lead record already using that site_id. Simpler, faster, no new D1 row needed. |
| 45 | PII identified in knowledge_items deleted at the source (32 rows), not just excluded from publishing | The PII was feeding back into Lagi's live answers to other travelers, not just a publishing risk. Required fixing the data itself. |
| 45 | Knowledge Hub built only from manually verified clean entries, not the full table | Heavy duplication and the PII issue meant mechanical bulk-publishing was unsafe. Verify-then-publish, topic by topic. |
| 43 | Zone Manager v3 — D1-driven zone list | New partners auto-enrol. No code change needed. |
| 43 | Sydney (australia-southeast1) as speed test region | Audience is AU/NZ/Fiji. Iowa scores meaningless. |
| 43 | Two cron jobs — 2am fix + 3am results | Speed tests async — need 1hr gap for results |
| 43 | vakaviti-platform SendGrid key — one key all Workers | Single point of management. No more per-Worker key issues. |
| 43 | Click tracking disabled in SendGrid | Clean URLs in partner emails. |
| 43 | vakaviti-onboard Worker v3 — email to James + partner | Both parties notified on every application. |
| 42 | Build vakaviti-zone-manager — automate all CF settings | 29 domains can't be managed manually. Scale to 50+ requires automation. |
| 42 | AI Gateway on both Worker lines 874 + 1767 | Every AI call must be logged for cost visibility and caching |
| 42 | Rocket Loader — leave OFF | Risk of breaking Lagi chat JS. 99/100 already achieved without it. |
| 41 | Worker v57 — WhatsApp dual-notify | Both email+WhatsApp fire confirmed |

---

## 16. KNOWN ISSUES

| Issue | Priority | Fix |
|---|---|---|
| Worker GitHub backup stale — 512 lines vs live 1,874 | P1 | Pull real v57, commit properly. 19 sessions unresolved. |
| Possible live checkout failure on fijitourtransfers.com | P1 | Confirmed unresolved sentinel error, dated 2026-05-24 — test a real booking |
| 999999 master OTP bypass code | P1 | Must remove before July 1 — flagged Session 5, never confirmed removed |
| WhatsApp permanent business number | P1 | Must resolve before July 1 |
| lagi.vakaviti.ai meta description fix | P2 | Given Session 45, never confirmed deployed |
| lagi.vakaviti.ai not on Git pipeline | P2 | Last property on manual zip upload — same risk class as the vakaviti.ai redirect bug |
| nadiairporttransfers.com app.js brand/phone bug | P2 | Unresolved since Session 22 — flagged across 4 separate sessions |
| No partner agreements | P2 | Draft one page document |
| fijitourtransfers.com llms.txt missing | P2 | Praveen brief sent — deadline June 22 passed unconfirmed |
| ask.html deployment status | P2 | Praveen brief sent, deadline passed, status unknown |
| domain_compliance notes contradict actual flags for vakaviti.ai | P2 | Notes said "fully complete," structured flags all read 0 — don't trust notes fields without cross-checking data |
| statement_performance (5 A/B test statements) never measured since deployment | P2 | last_checked is null on all — either measure or formally abandon the test |
| question_clusters table empty | P2 | Self-learning knowledge-gap detection loop does not appear to be populating it |
| 6 unconfirmed partner Lagi installs (fijihomestayz, realfiji.tours, fijiepictours, fijitours.online, fijidaytours.com.au, bookfijitours.com.au) | P2 | Real traffic confirmed in Analytics, widget status never explicitly verified |
| fijithingstodo.com runs competing "Seru" widget instead of Lagi | P2 | Strategic decision needed, not a bug |
| aiwebst.online — purpose unknown, 2 total visitors | P2 | Define or retire |
| fijinanny.com llms.txt 404 | P2 | Use /generate-llms-txt endpoint |
| ~68 of 75 Workers & Pages projects unaudited | P2 | Sort oldest-first, identify dead demos to retire and active projects to migrate to Git |
| Shared-snippet vs per-site widget install unknown | P2 | Ask Praveen — determines if backlink rollout is one edit or a 29-site campaign |
| kb_chunks only stores content_preview, not full text | P2 | Full text likely in Vectorize — needs a different query than D1 SQL |
| Old SendGrid key vakaviti-ai-v2 not deleted | P3 | Delete from SendGrid dashboard |
| 0-RTT + Prefetch Preload failing on all zones | P3 | Plan limitation — remove from enforced settings in v4 |
| Partner count shows 15 on lagi.vakaviti.ai | P3 | Update to 29 |
| 22+ of 29 partners still route leads to James only | P3 | Phase 2/3 graduation framework already designed — becomes the real bottleneck at 500+ partners, not a technical one |
| WhatsApp notifications fire to one centralized number, not per-partner | P3 | Same root issue as above — needs per-partner routing before scale forces it |
| Cloudflare Pages Git-connect step is fully manual (5 dashboard clicks per project) | P3 | Fine at current scale, becomes the bottleneck past ~50 properties — Cloudflare API automation discussed, not built |

---

## 17. CEO IDEAS INBOX

| Date | Idea | Category | Status |
|---|---|---|---|
| 2026-06-23 | Automate the Cloudflare Pages Git-connect step via API (token scoped to Pages:Edit) | infrastructure | inbox — discussed Session 45, manual still fine at current scale |
| 2026-06-23 | Extend vakaviti-zone-manager to auto-audit backlink presence + llms.txt compliance across all domains | infrastructure | inbox — directly addresses the "fixed once, never re-verified" pattern found repeatedly this session |
| 2026-06-23 | Connect James's 7,300+ Facebook followers (+ Instagram, YouTube) directly into Lagi/GEO content funnel | growth | inbox |
| 2026-06-23 | Publish anonymized real Lagi Q&A as fresh AI-citable content (separate from the static Knowledge Hub) | seo | inbox — contingent on the PII cleanup methodology proving reliable |
| 2026-06-17 | vakaviti-notify Worker — centralised email + WhatsApp for all Workers | infrastructure | Session 44 — high value |
| 2026-06-17 | status.vakaviti.ai public compliance dashboard | infrastructure | Session 45 — not built, deprioritised in favour of the Git pipeline + redirect fix |
| 2026-06-17 | Google Business Profile — free major AI trust signal | seo | pending — business.google.com |
| 2026-06-17 | Workers AI intent classifier — cut Anthropic cost 40% | infrastructure | inbox |
| 2026-06-17 | Durable Objects for conversation memory | infrastructure | inbox |
| 2026-06-12 | Lagi needs Fiji cultural authenticity as named moat | strategy | confirmed |
| 2026-06-12 | Facebook group Q&A is single best untapped knowledge source | knowledge | in progress |
| 2026-06-12 | Partner contracts = lock network before competitor does | partners | pending |

### CEO STRATEGIC NORTH STAR
"We must not be seen as the leader — we must BE the leader in AI tourism development in Fiji."

---

## 18. SESSION HISTORY

### Session 45 — 2026-06-23 — CLOSED
**The biggest infrastructure session since platform inception — found and fixed root causes, not just symptoms.**

**What we built:**
1. **GitHub → Cloudflare Pages Git auto-deploy pipeline** — established for the first time using a fine-grained GitHub PAT. 7 properties migrated onto it: the 5 GEO microsites (now on custom `vakaviti.ai` subdomains, not just `.pages.dev`), `vakaviti-join-page`, and `vakaviti-root` (the rebuilt `vakaviti.ai`). This eliminates the single-file-upload failure mode confirmed as the root cause of the redirect bug below.
2. **vakaviti.ai redirect bug — root-caused and fixed.** Months of single-file Cloudflare Pages uploads had left a wildcard redirect to `lagi.vakaviti.ai` swallowing the homepage, `/sitemap.xml`, and the GEO guide pages — explaining both the long-standing sitemap error AND the unresolved P2 link-audit from Session 44. Rebuilt the complete file set (homepage + 3 GEO pages with 2025→2026 date fixes + robots.txt + sitemap.xml) from scratch, committed to Git, connected, confirmed live end-to-end (no redirect, real sitemap XML, GSC Status: Success same-day).
3. **P1 Lagi widget 404 — fixed.** All 5 microsites' `site_id` changed from the dead `op_vakaviti_guides_001` to `lagi_public` (confirmed working via a real existing lead record). Auto-deployed via the new Git pipeline with zero manual Cloudflare steps — first fix in this platform's history to do so.
4. **Knowledge base — real export and audit, for the first time.** Built `vakaviti-kb-inspect`, a diagnostic Worker bound to `vakaviti-kb`, and pulled the actual content: 578 `knowledge_items`, 95 `kb_chunks`. Found and deleted 32 rows containing real customer PII (names, emails, a phone number) that the self-learning loop had captured from live conversations — this was actively feeding into Lagi's answers to other travelers, not just a publishing risk. Carefully distinguished from 47 false-positive flags (legitimate partner contact details) which were correctly left alone.
5. **Lagi Knowledge Hub — launched.** 3 real, schema-rich, zero-PII pages built from verified-clean content and added to `vakaviti.ai`: `/fiji-visa-money-guide`, `/fiji-culture-kava-language-guide`, `/fiji-weather-best-time-guide`. All submitted to GSC, sitemap confirmed reading correctly same-day.
6. **`vakaviti-join-page` found not in GitHub at all** — added for the first time, with a missing meta description and canonical tag fixed in the same pass.
7. **`mamanucaislandsguide` confirmed fully complete** — custom domain + Git connection verified via screenshot.
8. **Real Cloudflare dashboard data pulled for the first time** — Domains list and Workers & Pages list (75 total projects) reviewed directly, confirming real traffic numbers across the network (`vakaviti.ai` 10.6k, `fijitourtransfers.com` 21.6k, etc.) instead of relying on session-history assumptions.

**Critical findings, not yet actioned (carried to Section 3 as P1-P4 next session):**
- Worker GitHub backup confirmed still stale (512 lines vs live 1,874) — directly verified via repo check, unresolved 19 sessions running.
- A likely-unresolved checkout failure error on `fijitourtransfers.com` found in `sentinel_errors`, dated a month ago, never confirmed fixed.
- `999999` master OTP bypass code, flagged Session 5, still never confirmed removed.
- `domain_compliance` notes for `vakaviti.ai` claimed "fully complete" while every structured flag read 0 — a direct example of exactly the kind of untracked drift that let the redirect bug persist for months.

**Key learning:** Almost every recurring problem this session traced back to one root cause — Cloudflare Pages single-file uploads silently replacing complete file sets, with no version control to catch it. The Git pipeline isn't one fix among many; it's the fix that prevents this entire category of failure from recurring. Properties still on manual upload (`lagi.vakaviti.ai`, ~68 unaudited Workers & Pages projects) remain exposed to the same risk.

### Session 44 — 2026-06-19 — CLOSED
**What we built:**
1. **5 single-intent GEO microsites** built and deployed to Cloudflare Pages — familyresortsfiji, yasawaislandsguide, mamanucaislandsguide, honeymoonfijiguide, divingfijiguide. Full detail in Section 19.
2. **Full AI-visibility file set** (robots.txt, llms.txt, sitemap.xml) added to all 5, verified serving correctly.
3. **Google Search Console** — all 5 verified, all 5 sitemaps submitted.
4. **Bing IndexNow** — 1 of 5 confirmed pinged; 4 remaining with James.
5. **Mid-session quality fixes across all 5 guides** — corrected stale 2025 dating to 2026 throughout, added missing dateModified schema, fixed mobile nav overflow risk, added table horizontal-scroll, added tablet breakpoint, added contextual Ask-Lagi prompts at peak-intent moments without adding more outbound partner links (deliberate strategy call).
6. **Bug found, not fixed (Session 45 fixed it):** Lagi widget on all 5 new guides 404s — site_id `op_vakaviti_guides_001` not in D1 partners table.
7. **Link audit started, not completed (Session 45 found the real cause):** vakaviti.ai/nadi-airport-transfers-guide, /fiji-accommodation-guide, guidefiji.com, bestfijitours.com.

**Key learning:** Cloudflare Pages "upload assets" always deploys a complete file set, never a patch — every iteration this session required a full zip rebuild. Build the AI-visibility file set into the initial deploy next time, not as a second pass. **(This exact issue is what caused the Session 45 redirect bug — should have been treated as a platform-wide risk, not a microsite-specific lesson.)**

**Strategic decision logged:** GEO microsites optimise for routing qualified leads into Lagi → D1 partner referral engine, not for maximising outbound link count to named operators. Partner onboarding kept off these pages by design.

### Session 43 — 2026-06-17 — CLOSED
**What we built:**
1. **Zone Manager v3** — D1-driven zone list (auto-enrols all active partners), Sydney speed tests (`australia-southeast1`), two-cron architecture (2am fix + 3am results), compliance alerts, speed alerts, origin-down detection, `/enrol` endpoint, `/generate-llms-txt` endpoint, `/status` public feed. 760 lines. Deployed.
2. **D1 tables** — `zone_compliance`, `zone_audit_history`, `zone_speed_history` all created with indexes.
3. **Zone Manager first run** — 30 domains read, 11 CF zones processed, 18 settings fixed, 11 Sydney speed tests fired. 0 false alerts.
4. **CF API token rolled** — new token generated with Zone Settings:Edit + Zone:Read. Stored in Worker secrets only.
5. **join.vakaviti.ai fixed** — Worker URL corrected from fiji-chat-widget → vakaviti-onboard. Form now submits to correct endpoint.
6. **vakaviti-onboard v3** — fixed embed_config updated_at missing field, FROM address set to helpronline@gmail.com (verified sender), James notification email added, welcome email to partner working.
7. **SendGrid unified** — new key `vakaviti-platform` created. Same key in all Workers. Click tracking disabled. Reputation 100%.
8. **End-to-end verified** — join form submits → D1 saved → email to James (inbox) → welcome email to partner (spam → reported not spam).

**Key learning:** Every Worker managing its own email = fragile. Session 44 should build `vakaviti-notify` centralised Worker. SendGrid key unification was the critical fix.

### Session 42 — 2026-06-17 — CLOSED
Lagi v4 deployed (98/99 speed). AI Gateway live. Zone Manager v1 built (354 lines). 79 settings fixed. 156 AI crawlers confirmed.

### Session 41 — 2026-06-16 — CLOSED
Worker v57 — WhatsApp dual-notify fixed. 140 vectors pushed (~440 total). WhatsApp BURNING HOT ping confirmed.

### Session 40 — 2026-06-12 — CLOSED
Worker v56 — D1-driven routing, WhatsApp notify, Fiji heat signals. Lead flow tested end-to-end.

### Sessions 1-39
Full platform built: D1 + Vectorize + Worker architecture, commercial engine, partner widgets, 118 referral routes, knowledge base foundation, 3 GEO pages live, reviews system, error sentinel, meta bridge. **Note (Session 45): this period also includes the Session 18 vakaviti.ai redirect decision and the Session 31 real-homepage build that later conflicted — see Session 45 entry above for how that was resolved.**

---

## 19. GEO MICROSITES — BUILT SESSION 44, MIGRATED TO CUSTOM DOMAINS + GIT SESSION 45

**Pattern:** Single-intent sites on custom `vakaviti.ai` subdomains (not `.pages.dev`, as of Session 45), Git-connected for auto-deploy, embedding Lagi widget (`site_id=lagi_public` as of Session 45 — fixed from the dead `op_vakaviti_guides_001`), cross-linking to each other + fijitourtransfers.com.

| Pages Project | Live URL (Session 45) | Canonical Target | Topic |
|---|---|---|---|
| familyresortsfiji | familyresorts.vakaviti.ai | vakaviti.ai/fiji-family-resorts-guide | Family resorts, kids clubs |
| yasawaislandsguide | yasawa.vakaviti.ai | vakaviti.ai/yasawa-islands-guide | Yasawa Islands, Blue Lagoon |
| mamanucaislandsguide | mamanuca.vakaviti.ai | vakaviti.ai/mamanuca-islands-guide | Mamanuca day trips, Cloud 9 |
| honeymoonfijiguide | honeymoon.vakaviti.ai | vakaviti.ai/fiji-honeymoon-guide | Honeymoon resorts, overwater bures |
| divingfijiguide | diving.vakaviti.ai | vakaviti.ai/fiji-diving-guide | Dive sites, Beqa Lagoon, Rainbow Reef |

**Session 45 fixes applied to all 5:** custom domain + Git connection (replacing direct-upload `.pages.dev`-only deployment), Lagi widget `site_id` changed to `lagi_public` (was 404ing on the dead `op_vakaviti_guides_001`), cross-links between all 5 sites updated to reference each other's new custom domains instead of `.pages.dev`, and a self-referencing bug in each site's own `llms.txt` "Related Guides" section (each guide was listing itself) found and removed from all 5.

**Each microsite ships 5 files per deployment:**
- `index.html` — full page, Article + FAQPage JSON-LD schema, mobile-responsive
- `robots.txt` — explicit allow for GPTBot, ChatGPT-User, ClaudeBot, Claude-Web, anthropic-ai, PerplexityBot, Google-Extended, Bytespider, CCBot
- `llms.txt` — machine-readable summary, canonical source link, related guides, booking/Lagi links
- `sitemap.xml` — single URL entry, confirmed serving with correct `application/xml` content-type
- `google[token].html` — Search Console verification file (same token issued across all 5 properties by Google — not a copy error)

**Build process notes:**
- Cloudflare Pages "Upload assets" always deploys a complete file set — no partial/patch upload exists. Every redeploy needs the full set (index.html + robots.txt + llms.txt + sitemap.xml + verification file once issued).
- `/robots.txt`, `/llms.txt`, `/sitemap.xml` silently fallback to index.html if not included in the deployed zip — single-asset Pages projects have no routing rules. Always verify these 3 paths directly after each deploy.
- Sitemap "Couldn't fetch" in Search Console on first submission is a known harmless timing issue, not a file error — confirmed via DevTools Console `fetch()` test (200, application/xml, correct URL, no redirect). One resubmit clears it.
- **Lesson for next batch:** build the full AI-visibility file set (robots/llms/sitemap) into the initial deploy, not as a bolt-on second pass — saves a redeploy cycle.

**Quality fixes applied mid-build (all 5 guides):**
- Dates: "2025" corrected to "2026" or removed across titles, og:title, JSON-LD headlines, hero badges, footer copyright. `dateModified` added/corrected to "2026-06-19" in all 5 Article schema blocks.
- Mobile: nav bar given `flex-wrap` (previously rigid, risked overflow under 360px). Data tables wrapped in `.table-scroll` horizontal-scroll container instead of just shrinking font. Added 600–900px tablet breakpoint (previously only one breakpoint at 600px).
- Engagement: contextual "Ask Lagi" callout added immediately after each guide's named resort/island/dive-site card grid — peak reader-intent moment.

**Strategic decision (James, Session 44):** these pages route leads through Lagi into the D1 referral engine rather than linking out directly to many named partners — deliberately no added outbound partner links beyond the existing single fijitourtransfers.com CTA. Partner onboarding CTAs deliberately excluded — these stay traveller-facing only; onboarding happens elsewhere.

**Indexing status at Session 44 close:**
- Google Search Console: all 5 verified (URL prefix + HTML file), all 5 sitemaps submitted, all 5 showing "Couldn't fetch" pending next crawl pass (file confirmed correct, not a real error).
- Bing IndexNow: 1 of 5 confirmed pinged (familyresortsfiji). 4 remaining given to James — not confirmed fired by session close.
- Bing Webmaster Tools full property/reporting: explicitly deferred — IndexNow ping only for now, by James's choice.

**RESOLVED Session 45:** Lagi widget on all 5 pages previously called `site_id=op_vakaviti_guides_001`, confirmed absent from D1 partners table. Fixed by switching to `lagi_public`, a confirmed-working public site_id. Auto-deployed via the new Git pipeline.

**RESOLVED Session 45 (root cause found):** the link audit on vakaviti.ai/nadi-airport-transfers-guide and /fiji-accommodation-guide was never completed because those pages were being swallowed by a wildcard redirect on the vakaviti.ai root domain — not a broken-link issue at all. The redirect was found, root-caused (single-file deploy history), and removed. Both pages now serve correctly. `guidefiji.com` and `bestfijitours.com` links were extracted and listed but not independently verified live — still worth a manual click-through.

---

## 20. JAMES'S SAFETY PROMPT SYSTEM

### GROUP 1 — Memory
| Prompt | Claude does |
|---|---|
| "Checkpoint" | Generate BRAIN.md update now. Upload to GitHub. Every 60 minutes. |
| "Brain note: ___" | Capture instantly. Confirm receipt. |
| "Close session" | Generate complete updated BRAIN.md. Every session. |
| "What have we built?" | Full session summary in 60 seconds. |
| "Log this decision" | Write decision AND reasoning to Section 15. |

### GROUP 2 — Build safety
| Prompt | Claude does |
|---|---|
| "Verify first" | Confirm current state before touching anything. |
| "What breaks if we do this?" | Map every downstream impact before executing. |
| "Surgical only" | v57 is 1,874 lines live. Show exact line range. Nothing else touched. |
| "Rollback plan?" | State exact rollback steps before proceeding. |

### GROUP 3 — Strategic clarity
| Prompt | Claude does |
|---|---|
| "Revenue test" | Does this directly drive bookings? If not — explain why before continuing. |
| "North star check" | Be #1. Drive bookings. Move faster than competitors. |
| "Priority reset" | Re-read Section 3. Are we on the most important thing? |
| "Challenge me" | Honest pushback. Real assessment not agreement. |

### GROUP 4 — Lagi protection
| Prompt | Claude does |
|---|---|
| "Lagi impact?" | Map whether this touches system prompt, Vectorize, or referral logic. |
| "Keep Lagi clean" | CEO notes never enter Vectorize. /knowledge-add only. |

### GROUP 5 — Freedom
| Prompt | Claude does |
|---|---|
| "Thinking out loud" | Listen only. Build nothing until "let's build this." |
| "Just ideas" | Capture in Section 17 only. No planning. |
| "Best practice?" | Research before executing. |
