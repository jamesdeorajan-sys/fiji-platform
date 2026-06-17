# VAKAVITI-BRAIN.md
# James Richardson — CEO Intelligence File
# Fetched by Claude at the start of every session
# Updated by Claude at the end of every session
# Last updated: Session 43 CLOSED — 2026-06-17

---

## 1. WHO WE ARE

**Company:** Vakaviti.ai — Fiji's AI Tourism Partner Network
**Mission:** Build Fiji's most powerful AI tourism platform
**Stage:** Pre-launch. July 1 2026 public + partner launch confirmed. 13 days remaining.
**Founded by:** James Richardson — CEO
**WhatsApp:** +61 478 886 145
**Email:** helpronline@gmail.com
**GitHub:** github.com/jamesdeorajan-sys/fiji-platform
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1
**Operating entity:** AJ Group Enterprises Pty Ltd
**Ground ops:** Ben (Fiji) — company registration for Fiji Tourism Guide Ltd

---

## 2. PLATFORM STATE — CURRENT AS OF SESSION 43

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
| D1 vakaviti-kb | 18 tables (added zone_compliance, zone_speed_history, zone_audit_history) |
| vakaviti-ai-gateway | LIVE — all AI calls logging cost + tokens |
| vakaviti-zone-manager | **v3 LIVE — D1-driven, Sydney speed tests, auto-enrol** |
| join.vakaviti.ai | **LIVE — partner onboarding form fully operational** |
| vakaviti-onboard Worker | **v3 LIVE — email notifications working** |

### Worker Version History
| Version | Lines | Key changes |
|---|---|---|
| v54 | 1,731 | Review metrics, RAG improvements |
| v55 | 1,748 | Lead Capture Superpower |
| v56 | 1,861 | D1 routing, WhatsApp notify, Fiji heat signals |
| **v57** | **1,874** | **CURRENT — WhatsApp dual-notify fixed. Both Anthropic API calls now route through AI Gateway** |

---

## 3. TOP PRIORITIES — SESSION 44

> Claude: read this section first. ONE task at a time.

**P1 — Knowledge base push to 700+ vectors**
- Currently ~440 vectors
- Need 260+ new Q&A pairs
- Tool: lagi-knowledge-push.html (saved in Downloads)
- Endpoint: https://fiji-chat-widget.helpronline.workers.dev/knowledge-add
- Best source: Facebook group Q&A + partner site content

**P2 — Partner agreement document**
- Draft one-page written agreement before external partner approach
- Covers: what Lagi does, data policy, lead ownership, uptime, pricing
- Blocks ALL external partner conversations

**P3 — Google Business Profile**
- Free major AI trust signal
- Setup at: business.google.com
- Entity: Fiji Tourism Guide Ltd / Vakaviti.ai

**P4 — WhatsApp permanent business number**
- Still on Meta test number
- Must resolve before July 1 launch

**P5 — fijitourtransfers.com/ask/ page — Praveen**
- ask.html built Session 42 — 936 lines, 73KB, 21 FAQ pairs, Lagi embedded
- Email brief sent to Praveen (Draft ID: r-6074124901006029401)
- Deadline: June 22, 2026
- After deploy: submit to GSC + Bing IndexNow

**P6 — fijinanny.com llms.txt**
- 404 — needs file created and deployed
- Use: https://vakaviti-zone-manager.helpronline.workers.dev/generate-llms-txt?domain=fijinanny.com

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
| WhatsApp permanent business number | P1 | Must resolve before July 1 |
| Knowledge base ~440 vectors | P1 | Continue Facebook group push — target 700+ |
| No partner agreements | P1 | Draft one page document |
| fijitourtransfers.com llms.txt missing | P1 | Praveen brief sent — deadline June 22 |
| ask.html not yet deployed | P1 | Praveen brief sent |
| fijinanny.com llms.txt 404 | P2 | Use /generate-llms-txt endpoint |
| aiwebst.online AI files 530 error | P2 | Server error — investigate |
| CF Analytics token not embedded in lagi-v4 | P2 | Get token from Web Analytics, rebuild zip |
| 22 partners routing to James only | P2 | Phase 2 routing when ready |
| Old SendGrid key vakaviti-ai-v2 not deleted | P2 | Delete from SendGrid dashboard |
| 0-RTT + Prefetch Preload failing on all zones | P3 | Plan limitation — remove from enforced settings in v4 |
| Partner count shows 15 on lagi.vakaviti.ai | P3 | Update to 29 |

---

## 17. CEO IDEAS INBOX

| Date | Idea | Category | Status |
|---|---|---|---|
| 2026-06-17 | vakaviti-notify Worker — centralised email + WhatsApp for all Workers | infrastructure | Session 44 — high value |
| 2026-06-17 | status.vakaviti.ai public compliance dashboard | infrastructure | Session 45 |
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
Full platform built: D1 + Vectorize + Worker architecture, commercial engine, partner widgets, 118 referral routes, 440 knowledge vectors, 3 GEO pages live, reviews system, error sentinel, meta bridge.

---

## 19. JAMES'S SAFETY PROMPT SYSTEM

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
