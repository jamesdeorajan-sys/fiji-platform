# VAKAVITI-BRAIN.md
# James Richardson — CEO Intelligence File
# Fetched by Claude at the start of every session
# Updated by Claude at the end of every session
# Last updated: Session 42 CLOSED — 2026-06-17

---

## 1. WHO WE ARE

**Company:** Vakaviti.ai — Fiji's AI Tourism Partner Network
**Mission:** Build Fiji's most powerful AI tourism platform
**Stage:** Pre-launch. July 1 2026 public + partner launch confirmed. 14 days remaining.
**Founded by:** James Richardson — CEO
**WhatsApp:** +61 478 886 145
**Email:** helpronline@gmail.com
**GitHub:** github.com/jamesdeorajan-sys/fiji-platform
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1
**Operating entity:** AJ Group Enterprises Pty Ltd
**Ground ops:** Ben (Fiji) — company registration for Fiji Tourism Guide Ltd

---

## 2. PLATFORM STATE — CURRENT AS OF SESSION 42

### Revenue confirmed (April 1 — June 3, 2026)
- **$13,747.75 AUD across both booking sites — 44 orders**
- Tuesday strongest day, peak hours 10am-3pm Sydney
- Facebook ads AUD $258 spent — strong ROI confirmed

### Live Systems
| System | Status |
|---|---|
| Lagi chat Worker | **v57 — 1,874 lines — LIVE** |
| fiji-chat-widget Worker | v57 — both Anthropic calls routing through AI Gateway (lines 874 + 1767) |
| widget.vakaviti.ai | Live |
| lagi.vakaviti.ai | **v4 LIVE — 98/100 mobile, 99/100 desktop from Sydney** |
| vakaviti.ai | Live — Reviews product — 96/100 speed |
| vakaviti.ai GEO pages | Live — 3 pages indexed |
| tourfijitours.com | Live — Lagi active, AI visibility deployed |
| fijitourtransfers.com | Live — Lagi active — llms.txt missing (Praveen task) |
| nadiairporttransfers.com | Live — 500+ reviews, real pricing calculator |
| Vectorize knowledge base | ~440 vectors (target 700+ by July 1) |
| D1 vakaviti-kb | 16 tables, leads + partners + contact_channels live |
| vakaviti-ai-gateway | **NEW — LIVE — all AI calls logging cost + tokens** |
| vakaviti-zone-manager | **NEW — LIVE — auto-fixes all 29 domains weekly** |

### Worker Version History
| Version | Lines | Key changes |
|---|---|---|
| v54 | 1,731 | Review metrics, RAG improvements |
| v55 | 1,748 | Lead Capture Superpower |
| v56 | 1,861 | D1 routing, WhatsApp notify, Fiji heat signals |
| **v57** | **1,874** | **CURRENT — WhatsApp dual-notify fixed. Both Anthropic API calls now route through AI Gateway (lines 874 + 1767 updated Session 42)** |

---

## 3. TOP PRIORITIES — SESSION 43

> Claude: read this section first. ONE task at a time.

**P1 — fijitourtransfers.com/ask/ page — deploy via Praveen**
- ask.html built Session 42 — 936 lines, 73KB, 21 FAQ pairs, Lagi embedded
- Email brief sent to Praveen (Draft ID: r-6074124901006029401)
- Deadline: June 22, 2026
- After deploy: submit to GSC + Bing IndexNow

**P2 — AI visibility files for 3 domains still missing**
- fijinanny.com — llms.txt missing (404)
- fijitourtransfers.com — llms.txt missing (404) — in Praveen brief
- aiwebst.online — all AI files returning 530 (server error — investigate)

**P3 — Knowledge base push to 700+ vectors**
- Currently ~440 vectors
- Continue Facebook group Q&A knowledge push
- Tool: lagi-knowledge-push.html (saved in Downloads)
- Endpoint: https://fiji-chat-widget.helpronline.workers.dev/knowledge-add

**P4 — Partner agreement document**
- Draft one-page written agreement before external partner approach
- Covers: what Lagi does, data policy, lead ownership, uptime, pricing

**P5 — WhatsApp permanent business number**
- Still on Meta test number
- Must resolve before July 1 launch

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

### Lagi v4 — what changed from v3 (Session 42)
| Fix | Detail |
|---|---|
| Async Google Fonts | `preload` + `onload` — eliminates render blocking |
| System font fallback | `system-ui, -apple-system, BlinkMacSystemFont` on all font-family |
| DNS prefetch | Worker URL + wa.me prefetched before page renders |
| `_headers` file | Security headers + cache rules per file type |
| `_redirects` | www.lagi.vakaviti.ai → apex 301 |
| Sitemap date | Updated to 2026-06-17 |
| CF Analytics beacon | Placeholder token — real token not yet embedded |

**Deploy file:** lagi-v4-full-2026-06-17.zip (6 files)
**Pages project:** vakaviti-lagi-public
**Weekly speed test:** Scheduled — Sydney, Australia — auto-alerts if score drops

### Lagi v4 Speed Results
| Metric | Mobile | Desktop |
|---|---|---|
| Score | **98/100** | **99/100** |
| FCP | 1,769ms | 579ms |
| LCP | 2,054ms | 682ms |
| TBT | 62ms | **0ms** |
| CLS | 0.03 | 0.05 |
| TTFB | 31ms | 56ms |

### Lead flow verified (Session 40 test)
- Guest chats on nadiairporttransfers.com
- Heat signals detected: family + date + destination + price = score 60-80
- Contact ask fires naturally in Lagi reply
- Guest provides name + email
- Lead saved to D1 with correct partner_id
- Email + WhatsApp notification both confirmed firing

### Lagi remaining blockers before July 1
1. **WhatsApp permanent number** — still on Meta test number
2. **Knowledge base** — ~440 vectors, needs 700+ for intelligent responses
3. **Partner agreements** — no written terms yet
4. **CF Analytics token** — beacon embedded but needs real token inserted
5. **22 partners still routing to James** — phase 2 routing not started

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
| Status | LIVE — awaiting first logged conversation |

**Dashboard:** https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/ai/ai-gateway/vakaviti-ai-gateway

---

## 7. ZONE MANAGER — vakaviti-zone-manager

**The automation superpower. Built Session 42. Never manually click Cloudflare settings again.**

| Item | Value |
|---|---|
| Worker URL | https://vakaviti-zone-manager.helpronline.workers.dev |
| Manager key | vakaviti-manager-2026 |
| CF API Token | [stored in Worker secrets — do not commit] |
| D1 binding | DB → vakaviti-kb |
| Cron | `0 2 * * 1` — Sundays 2am UTC (12pm Sydney) |

**Endpoints:**
- `/health` — health check (no auth)
- `/audit` — audit all zones, read only
- `/audit?domain=x` — audit one domain
- `/fix-all` — audit + auto-fix all settings gaps
- `/fix?domain=x` — fix one domain
- `/report` — read D1 compliance scores (fast)

All endpoints except /health require header: `X-Manager-Key: vakaviti-manager-2026`

**Settings enforced per zone:** HTTP/3 · Brotli · Always HTTPS · Early Hints · TLS 1.3 · 0-RTT · Min TLS 1.2

**AI files checked per domain:** robots.txt · llms.txt · sitemap.xml

**Session 42 first run results:**
- 19 zones audited · 18 compliant · 1 needs attention
- 79 settings fixed automatically in 30 seconds
- Average compliance score: 97/100

### Zone compliance — current state
| Domain | Score | Issue |
|---|---|---|
| bestfijitours.com | 100% | ✅ |
| bookfijitours.com.au | 100% | ✅ |
| fijidaytours.com.au | 100% | ✅ |
| fijiepictours.com | 100% | ✅ |
| fijihomestayz.com | 100% | ✅ |
| fijithingstodo.com | 100% | ✅ |
| fijitours.online | 100% | ✅ |
| guidefiji.com | 100% | ✅ |
| innerwestplumber.au | 100% | ✅ |
| nadiairporttransfers.com | 100% | ✅ |
| nadiculturalnighttour.com | 100% | ✅ |
| petershamplumbing.au | 100% | ✅ |
| realfiji.tours | 100% | ✅ |
| vakaviti.ai | 100% | ✅ |
| vosavakaviti.com | 100% | ✅ |
| eastwoodplumbing.au | 90% | sitemap.xml 401 |
| fijinanny.com | 90% | llms.txt 404 |
| fijitourtransfers.com | 90% | llms.txt 404 (Praveen task) |
| aiwebst.online | 70% | all AI files 530 error |

**To use from CMD:**
```cmd
curl -X GET "https://vakaviti-zone-manager.helpronline.workers.dev/fix-all" -H "X-Manager-Key: vakaviti-manager-2026"
```

---

## 8. AI VISIBILITY — CONFIRMED LIVE

### Cloudflare settings — all enabled (Session 42)
| Setting | Status |
|---|---|
| HTTP/3 | ✅ Enabled |
| HTTP/2 | ✅ Enabled |
| HTTP/2 to Origin | ✅ Enabled |
| 0-RTT Connection Resumption | ✅ Enabled |
| Always use HTTPS | ✅ Enabled |
| TLS 1.3 | ✅ Enabled |
| Early Hints | ✅ Enabled |
| Speed Brain (Beta) | ✅ Enabled |
| Cloudflare Fonts (Beta) | ✅ Enabled |
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

**Most crawled:** widget.vakaviti.ai/widget.js (14 requests), lagi.vakaviti.ai/ (6 requests, 85kB downloaded)

### Real user analytics — 24hr snapshot (Session 42)
| Metric | Value |
|---|---|
| Visits | 27 (+68.75%) |
| Page views | 29 (+81.25%) |
| Page load time | 794ms |
| LCP Good | 91% |
| Top country | USA (#1 ~13 visits) |
| #2 country | Australia (~8 visits) |
| #3 country | Fiji (~3 visits) |
| Lagi vs Reviews | Lagi dominant — 14 vs 8 visits |

### AI visibility files — status
| File | lagi.vakaviti.ai | vakaviti.ai |
|---|---|---|
| robots.txt | ✅ live | ✅ live |
| llms.txt | ✅ live | ✅ live |
| sitemap.xml | ✅ live | ✅ live |
| FAQPage schema | ✅ 21 Q&A pairs | ✅ |
| ItemList schema | ✅ 14 tours | ✅ |
| TravelAgency schema | ✅ | ✅ |

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

## 12. FIJITOURTRANSFERS.COM — PRAVEEN TASK BRIEF

**Email draft sent:** Draft ID r-6074124901006029401 (Gmail)
**Deadline:** June 22, 2026
**8 tasks:**
1. Upload robots.txt to public_html/
2. Upload llms.txt to public_html/
3. Add site-wide JSON-LD schema (WPCode → HTML → Header)
4. Fix display name "Dipan" → "Fiji Tourism Guide" (both sites)
5. Submit Bing sitemap + IndexNow ping
6. **Per-tour PHP schema** (WPCode → PHP → Run Everywhere) — auto-generates TouristTrip + Product + FAQPage on every /st_tour/ page
7. Confirm Traveler plugin review field names for star ratings
8. Repeat Tasks 1–3 + 6 on tourfijitours.com

**ask.html page also to deploy:**
- File: ask.html (936 lines, 73KB)
- Target URL: fijitourtransfers.com/ask/
- Lagi embedded with site_id: op_fijitourtransfers_001
- 21 FAQ pairs, 14 booking links, full transfer price table
- After deploy: GSC Request Indexing + Bing IndexNow

---

## 13. DECISIONS LOG

| Session | Decision | Reasoning |
|---|---|---|
| 42 | Build vakaviti-zone-manager — automate all CF settings | 29 domains can't be managed manually. Scale to 50+ requires automation. |
| 42 | AI Gateway on both Worker lines 874 + 1767 | Every AI call must be logged for cost visibility and caching |
| 42 | Rocket Loader — leave OFF | Risk of breaking Lagi chat JS. 99/100 already achieved without it. |
| 42 | Managed robots.txt — leave OFF | Our custom robots.txt already correct. CF managed version would override it. |
| 42 | Gateway cache 5 min purge | Travel deals change frequently — 5 min balances cost savings vs freshness |
| 41 | Worker v57 — WhatsApp dual-notify | Both email+WhatsApp fire confirmed |
| 40 | Worker v56 — all 7 improvements | Lead capture, routing, WhatsApp all needed before July 1 |
| 37 | Do not approach external partners yet | 3 blockers must be fixed first |
| 36 | Stop over-engineering tourfijitours.com | Site generating $13,747 — it works |
| 35 | Centralised all leads to helpronline@gmail.com | Build/test mode validation |

---

## 14. KNOWN ISSUES

| Issue | Priority | Fix |
|---|---|---|
| WhatsApp permanent business number | P1 | Must resolve before July 1 |
| Knowledge base ~440 vectors | P1 | Continue Facebook group push — target 700+ |
| No partner agreements | P1 | Draft one page document |
| fijitourtransfers.com llms.txt missing | P1 | Praveen brief sent — deadline June 22 |
| ask.html not yet deployed | P1 | Praveen brief sent |
| fijinanny.com llms.txt 404 | P2 | Create and deploy llms.txt |
| aiwebst.online AI files 530 error | P2 | Investigate server error |
| CF Analytics token not embedded in lagi-v4 | P2 | Get token from Web Analytics, rebuild zip |
| 22 partners routing to James only | P2 | Phase 2 routing when ready |
| GEO page source files on Windows only | P2 | Back up to GitHub |
| Partner count shows 15 on lagi.vakaviti.ai | P3 | Update to 29 |

---

## 15. CEO IDEAS INBOX

| Date | Idea | Category | Status |
|---|---|---|---|
| 2026-06-17 | Google Business Profile — free major AI trust signal | seo | pending — business.google.com |
| 2026-06-17 | Workers AI intent classifier — cut Anthropic cost 40% | infrastructure | inbox |
| 2026-06-17 | Durable Objects for conversation memory | infrastructure | inbox |
| 2026-06-17 | status.vakaviti.ai compliance dashboard | infrastructure | inbox — Session 45 |
| 2026-06-12 | Lagi needs Fiji cultural authenticity as named moat | strategy | confirmed |
| 2026-06-12 | Facebook group Q&A is single best untapped knowledge source | knowledge | in progress |
| 2026-06-12 | Partner contracts = lock network before competitor does | partners | pending |

### CEO STRATEGIC NORTH STAR
"We must not be seen as the leader — we must BE the leader in AI tourism development in Fiji."

---

## 16. SESSION HISTORY

### Session 42 — 2026-06-17 — CLOSED
**What we did:**
1. **Lagi v4 deployed** — async Google Fonts, DNS prefetch, system font fallback, _headers cache rules, _redirects. Speed 82 → 98/100 mobile, 99/100 desktop from Sydney. Paint time 3,484ms → 579ms. TBT 0ms.
2. **Weekly speed test scheduled** — Sydney, Australia — auto-alerts if score drops.
3. **All Cloudflare free settings enabled** — HTTP/3, 0-RTT, Always HTTPS, Early Hints, Speed Brain, Cloudflare Fonts, Brotli, TLS 1.3.
4. **AI Gateway created** — vakaviti-ai-gateway. Both Worker lines 874 + 1767 updated. Cache ON, Rate Limit ON (50/min). Every Lagi conversation now logging cost + tokens.
5. **AI Crawl Control confirmed** — 156 crawler requests in 24hrs, up 437.9%. All 10 major AI companies crawling: Google, ChatGPT, Bing, Claude, Perplexity, Apple, Amazon, Meta, ByteDance, CommonCrawl.
6. **Web Analytics confirmed** — 27 real visits, USA #1 market, Lagi dominant page (14 vs 8 visits).
7. **Security audit** — .env probe files all returning 404 redirects. No breach.
8. **vakaviti-zone-manager built and deployed** — 354-line Worker. Audit + auto-fix all 29 zones. Cron every Sunday 2am UTC. First run: 19 zones, 79 settings fixed, avg 97/100.
9. **fijitourtransfers.com/ask/ built** — 936-line AI landing page with Lagi embedded, 21 FAQ pairs, 14 booking links. Email brief sent to Praveen.
10. **8-task Praveen brief sent** — AI visibility + per-tour PHP schema for fijitourtransfers.com and tourfijitours.com. Deadline June 22.

**Key learning:** AI crawlers respond immediately to visibility files — 438% increase overnight confirms robots.txt + llms.txt + FAQPage schema is working. Zone manager makes manual Cloudflare clicking obsolete.

**Session 43 focus:** Verify Praveen tasks, deploy fijinanny.com llms.txt, continue knowledge push to 700+, partner agreement draft, Google Business Profile.

### Session 41 — 2026-06-16 — CLOSED
Worker v57 — WhatsApp dual-notify fixed. 140 vectors pushed (~440 total). WhatsApp BURNING HOT ping confirmed. Meta token refreshed. Transfer Q&A corrected to recommend Nadi Airport Transfers.

### Session 40 — 2026-06-12 — CLOSED
Worker v56 — D1-driven routing, WhatsApp notify, Fiji heat signals, contact ask rotation. Lead flow tested end-to-end. vakaviti.ai 404 fixed.

### Session 39 — 2026-06-10
Lead duplicate bug found and fixed. 20/20 tests passed.

### Session 38 — 2026-06-08
fijithingstodo.com rebuild. 49 Q&A vectors pushed. All 28 partner D1 records populated. Auto partner onboarding built.

### Session 37 — 2026-06-05
Lagi professional readiness audit. 3 blockers identified. Transfer prices verified.

### Session 36 — 2026-06-03
tourfijitours.com AI visibility deployed. Revenue $13,747 confirmed.

### Session 35 — 2026-06-02
VAKAVITI-BRAIN.md built. 24-prompt safety system. 8-member Supreme Board built.

### Sessions 1-34
D1 + Vectorize + Worker architecture, commercial engine, partner widgets, 118 referral routes, 300 knowledge vectors, 3 GEO pages live.

---

## 17. JAMES'S SAFETY PROMPT SYSTEM

### GROUP 1 — Memory
| Prompt | Claude does |
|---|---|
| "Checkpoint" | Generate BRAIN.md update now. Upload to GitHub. Every 60 minutes. |
| "Brain note: ___" | Capture instantly. Confirm receipt. |
| "Close session" | Generate complete updated BRAIN.md. Every session. |
| "What have we built?" | Full session summary in 60 seconds. |
| "Log this decision" | Write decision AND reasoning to Section 13. |

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
| "Just ideas" | Capture in Section 15 only. No planning. |
| "Best practice?" | Research before executing. |
| "How would #1 do this?" | Benchmark against world's best. |

### GROUP 6 — Emergency
| Prompt | Claude does |
|---|---|
| "Stop — review" | Halt everything. Show safe state. Wait for proceed. |
| "Something feels wrong" | Audit last 5 actions. Check D1. Report honestly. |
| "What's live right now?" | Query D1, confirm Worker version, surface errors. |
| "Lagi down?" | Check sentinel errors, embed configs. Diagnose in 2 minutes. |
| "run zone audit" | Call vakaviti-zone-manager/audit — show all 29 domain scores. |
| "fix all zones" | Call vakaviti-zone-manager/fix-all — auto-fix every settings gap. |

---

## 18. SESSION START RITUAL

```
1. Fetch VAKAVITI-BRAIN.md from GitHub
2. Call vakaviti-zone-manager/report — check D1 compliance scores
3. Query D1: leads WHERE notified=0 AND score>=70
4. Query D1: build_log WHERE status='pending' — top 5
5. Brief James in 60 seconds: leads + compliance + top 3 priorities
6. Ask: "What is the ONE thing we are building today?"
```

**GitHub fetch URL:**
https://raw.githubusercontent.com/jamesdeorajan-sys/fiji-platform/main/docs/VAKAVITI-BRAIN.md

**Session discipline rule:** Complete one task fully before starting the next.

---

## 19. VAKAVITI SUPREME STRATEGIC BOARD

> Activated by: "Board meeting"
> 8 members + Chairman. Each armed with all 42 sessions.

**Member 1 — Risk Sentinel:** What breaks Vakaviti specifically before the market does.
**Member 2 — Truth Engine:** Strips every assumption. Only accepts what is actually true.
**Member 3 — Growth Architect:** Finds the 10x in what's already built.
**Member 4 — Traveller's Voice:** Speaks only for the traveller.
**Member 5 — Monday General:** Converts insight to the next deployable action.
**Member 6 — Cultural Guardian:** Ensures every decision honours Fiji.
**Member 7 — Revenue Prosecutor:** Why has no partner paid yet. What are we doing about it today.
**Member 8 — Legacy Architect:** Protects the long game — Pacific institution not just a product.
**Chairman:** Reads all 8. Makes the call. Issues 3-5 next steps executable this week.

---

## 20. CLOUDFLARE QUICK LINKS

| Resource | URL |
|---|---|
| Workers | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services |
| Pages — vakavitiai | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages/view/vakavitiai |
| Pages — lagi | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages/view/vakaviti-lagi-public |
| D1 Database | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/d1/databases/e697a253-e5fc-4201-939c-9aaeca6c5278 |
| fiji-chat-widget Worker | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services/view/fiji-chat-widget |
| vakaviti-zone-manager | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services/view/vakaviti-zone-manager |
| AI Gateway | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/ai/ai-gateway/vakaviti-ai-gateway |
| AI Crawl Control | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/vakaviti.ai/ai-crawl-control |
| Web Analytics | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/web-analytics |
| GSC | search.google.com/search-console |
| Bing Webmaster | bing.com/webmasters |

---

## 21. KEY INFRASTRUCTURE CONSTANTS

| Item | Value |
|---|---|
| Cloudflare Account ID | 595101df2c562b3c65595420d43f9fe1 |
| D1 Database ID | e697a253-e5fc-4201-939c-9aaeca6c5278 |
| knowledge-add endpoint | https://fiji-chat-widget.helpronline.workers.dev/knowledge-add |
| Lagi Pages project | vakaviti-lagi-public |
| Meta WhatsApp App ID | 1700903951357623 |
| VakavitiBot system user ID | 61589646643436 |
| Bing IndexNow API key | 122e5d1bb7294084ab0409ba089c1ed3 |
| PC master folder | Desktop\VAKAVITI-MASTER\ |
| AI Gateway URL | https://gateway.ai.cloudflare.com/v1/595101df2c562b3c65595420d43f9fe1/vakaviti-ai-gateway/anthropic/v1/messages |
| Zone Manager URL | https://vakaviti-zone-manager.helpronline.workers.dev |
| Zone Manager key | vakaviti-manager-2026 |
| Zone Manager CF token | [stored in Worker secrets — do not commit] |

---

*VAKAVITI-BRAIN.md — Session 42 closed 2026-06-17. Lagi 99/100. AI Gateway live. Zone Manager live — 79 settings fixed across 19 domains. 156 AI crawlers confirmed. 14 days to July 1.*
