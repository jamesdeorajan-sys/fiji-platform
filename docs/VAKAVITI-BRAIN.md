# VAKAVITI-BRAIN.md
# James Richardson — CEO Intelligence File
# Fetched by Claude at the start of every session
# Updated by Claude at the end of every session
# Last updated: Session 35 — 2026-06-02

---

## 1. WHO WE ARE

**Company:** Vakaviti.ai — Fiji's AI Tourism Partner Network
**Mission:** Build Fiji's most powerful AI tourism platform — connecting travellers with verified local operators through Lagi, the AI travel guide
**Stage:** Build/test phase. Platform live, partners onboarding, revenue engine firing
**Founded by:** James Richardson — CEO, builder, and strategic lead
**Based:** Fiji / Sydney (GMT+10/11)
**WhatsApp:** +61 478 886 145
**Email:** helpronline@gmail.com
**GitHub:** github.com/jamesdeorajan-sys/fiji-platform

---

## 2. PLATFORM STATE — ALWAYS CURRENT

### Live Systems
| System | URL | Status |
|---|---|---|
| Lagi (chat worker) | fiji-chat-widget.helpronline.workers.dev | ✅ Live — v54, 1,725 lines |
| Widget CDN | widget.vakaviti.ai/widget.js | ✅ Live |
| Lagi public page | lagi.vakaviti.ai | ✅ Live |
| Partner dashboard | dashboard.vakaviti.ai | ✅ Live |
| Main domain | vakaviti.ai | ✅ Live |
| Join page | join.vakaviti.ai | ✅ Live |

### D1 Database (vakaviti-kb)
| Table | Count | Health |
|---|---|---|
| partners | 30 | ✅ All → helpronline@gmail.com (centralised, build mode) |
| leads | 64 | ⚠️ 27 unnotified — review each session |
| knowledge_items | 343 | ✅ |
| partner_referrals | 118 | ✅ |
| conversation_events | 550 | ✅ |
| sentinel_errors | 315 | ⚠️ Unreviewed — JS errors on partner sites |
| domain_compliance | 10 | ⚠️ Most sites missing llms.txt, robots.txt, schema |

### GEO Pages Live (vakaviti.ai)
| Page | GSC | Bing | FAQ Schema |
|---|---|---|---|
| /nadi-airport-transfers-guide | ✅ | ✅ | ✅ |
| /fiji-accommodation-guide | ✅ | ✅ | ✅ |
| /fiji-horse-riding-guide | ✅ | ✅ | ✅ |

### Partner Sites with Lagi Widget
| Site | Widget | GSC | Bing | llms.txt | Schema |
|---|---|---|---|---|---|
| nadiairporttransfers.com | ✅ | ❌ | ❌ | ❌ | ❌ |
| fijitourtransfers.com | ✅ | ❌ | ❌ | ❌ | ❌ |
| tourfijitours.com | ✅ | ❌ | ❌ | ❌ | ❌ |
| guidefiji.com | ✅ | ❌ | ❌ | ❌ | ❌ |
| bestfijitours.com | ✅ | ❌ | ❌ | ❌ | ❌ |
| vosavakaviti.com | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 3. TOP PRIORITIES — THIS WEEK

> Claude: read this section first. Do not start building until James confirms which priority he wants to tackle.

**P1 — Revenue critical**
- [ ] Deploy robots.txt + JSON-LD schema + llms.txt to fijitourtransfers.com + tourfijitours.com (files built, in wordpress-ai-visibility-pack.zip)
- [ ] Embed power statements into all 3 GEO pages (HTML ready in power-statements-pack.zip)
- [ ] Fix tourfijitours.com JS errors — woocs_current_currency crash killing mobile + AI crawler visits

**P2 — AI visibility**
- [ ] Add Statement D to guidefiji.com homepage
- [ ] Add Statement E to bestfijitours.com homepage
- [ ] Update partner count 15 → 29 on lagi.vakaviti.ai stats bar

**P3 — Platform intelligence**
- [ ] Build 3 new D1 tables: ideas, partner_intelligence, lessons_learned
- [ ] Add auto-intelligence briefing to session start ritual
- [ ] Build partner monthly lead digest

---

## 4. STRATEGIC BETS — WHAT WE'RE BUILDING TOWARD

> James: fill in your honest current thinking here each session

**The big bet:** Vakaviti.ai becomes the AI layer that every Fiji tourism operator needs — not a booking platform, not an OTA, but the intelligence network that connects verified local operators to AI-driven traveller searches. Zero commission model is the moat.

**Why we win:**
- First mover — no competitor in Fiji has AI concierge at this depth
- 29 verified operators in D1 — real relationships, real data
- GEO pages + Lagi + partner widgets = full funnel from AI search to booking
- Lagi's local knowledge (343 KB vectors, Fijian language layer) cannot be replicated fast

**Current strategic focus:** AI search domination — get cited by ChatGPT, Perplexity, Google AI Overviews before any competitor understands what GEO is

**What keeps me up at night:**
> [James — add your honest concerns here each session]

**What's working better than expected:**
> [James — add wins here each session]

---

## 5. LAGI — PROTECTED CORE

> NEVER modify without James explicit instruction

| Parameter | Value |
|---|---|
| Model | claude-sonnet-4-5 |
| Worker | fiji-chat-widget (v54, 1,725 lines) |
| Max tokens | 800 |
| Vectorize | vakaviti-knowledge (343+ vectors) |
| System prompt layers | Soul + Partner context + Network intelligence + Fijian language |
| WhatsApp | Meta App ID 1700903951357623, test +1(555)641-4099 |

**Lagi's job:** Serve Fiji tourism visitors. Convert bookings. Represent partners.
**Lagi must never:** See CEO notes, ideas, build log, strategy docs. Hard architectural separation.

**Critical Worker rule:** v54 is live at 1,725 lines. NEVER replace whole file. Surgical edits only.

---

## 6. LEAD MANAGEMENT — CURRENT PROTOCOL

**Build/test mode:** ALL leads → helpronline@gmail.com + WhatsApp 61478886145
**James validates and forwards manually to partners**
**When to go partner-direct:** When James confirms individual partner is ready

**Lead review ritual (every session start):**
```sql
SELECT l.traveller_name, l.traveller_email, l.partner_id, l.score, 
       datetime(l.created_at,'unixepoch') as created
FROM leads l 
WHERE l.notified=0 AND l.score>=70 
ORDER BY l.score DESC, l.created_at DESC
```

**Unnotified high-score leads as of Session 35:**
- Heather Carper — Coral Coast Horse Riding, July 5, 2 people ✅ Manually actioned
- Ji Marino — Tour Fiji Tours ✅ Manually actioned

---

## 7. PARTNER INTELLIGENCE

> James: add notes after every partner conversation

| Partner | Last contact | Key insight | Next action |
|---|---|---|---|
| Coral Coast Horse Riding | — | Heather Carper lead sent manually | Confirm receipt |
| Tour Fiji Tours | — | Ji Marino lead sent manually | Confirm receipt |
| Blue Lagoon Beach Resort | — | Not yet outreached | Email reservations@bluelagoonresortfiji.com |
| The Palms Denarau | — | Not yet outreached | Email reservations@thepalmsdenarau.com |

---

## 8. DECISIONS LOG — WHY WE CHOSE WHAT WE CHOSE

| Session | Decision | Reasoning |
|---|---|---|
| 35 | Centralised all leads → helpronline@gmail.com | Build/test mode — validate engine before partner-direct routing |
| 35 | CEO brain separate from Lagi | Lagi stays focused on tourism visitors. CEO intelligence never enters Vectorize or system prompt |
| 34 | GEO pages on vakaviti.ai not WordPress | Cloudflare Pages = instant deploy, full control, AI-crawlable, no plugin conflicts |
| 34 | Zero commission model as core positioning | Viator/Expedia take 20–30%. Our moat is direct booking — operators keep 100% |

---

## 9. KNOWN ISSUES — CHECK BEFORE BUILDING

| Issue | Affected | Fix |
|---|---|---|
| woocs_current_currency JS crash | tourfijitours.com | WooCommerce currency plugin conflict — disable or update |
| Rage clicks on coral coast horse riding page | fijitourtransfers.com | Something broken/confusing on that listing page |
| 315 unreviewed sentinel errors | All partner sites | Review top 20 each session |
| Partner count shows 15 on lagi.vakaviti.ai | lagi.vakaviti.ai | Update stats bar to 29 |
| Partner sites missing llms.txt/robots.txt | All WP sites | Deploy from wordpress-ai-visibility-pack.zip |
| .html.html double extension bug | Windows deploy | Always use CMD rename, never File Explorer |
| Unicode/emoji in JS strings | Worker edits | Full ES5 rebuild — remove all non-ASCII |

---

## 10. CEO IDEAS INBOX

> James: drop raw ideas here anytime. Claude reviews and categorises each session.

| Date | Idea | Category | Status |
|---|---|---|---|
| — | [Your ideas go here] | — | inbox |

---

## 11. SESSION HISTORY — STRATEGIC NARRATIVE

### Session 35 — 2026-06-02
**What we did:** Full platform audit. Discovered 27 unnotified leads, all partner contacts pointing to wrong destinations. Fixed by centralising all leads to helpronline@gmail.com. Manually actioned Heather Carper + Ji Marino leads. Confirmed GSC + Bing verified (done in Session 34). Designed VAKAVITI-BRAIN.md architecture.
**Key decision:** Centralise all lead notifications during build/test phase — James validates before partner-direct routing.
**What's working:** GEO pages indexed, FAQ schema detected by Google, Bing submitted. Platform engine is firing.
**What needs fixing:** Partner site JS errors, undeployed AI visibility files, power statements not yet embedded.
**Next session focus:** Deploy wordpress-ai-visibility-pack.zip, embed power statements, fix tourfijitours JS errors.

### Session 34 — 2026-05-31 / 2026-06-02
**What we did:** Built GEO page 3 (horse riding). Registered vakaviti.ai on GSC + Bing. Submitted all 3 GEO pages. Built power statements pack + wordpress AI visibility pack. Set up statement_performance A/B test tracking.
**Key win:** FAQ schema detected on horse riding page — AI Overview citation pipeline active.

### Sessions 1–33
See Claude memory for full history. Key milestones: D1 + Vectorize + Worker architecture (S5–8), commercial engine + leads + deals (S11–13), partner widget installs (S21), 118 referral routes + 251 knowledge vectors (S28).

---

## 12. SESSION START RITUAL — CLAUDE READS THIS EVERY TIME

```
1. Fetch this file from GitHub raw URL
2. Query D1: SELECT notified=0 leads score>=70 — surface immediately
3. Query D1: SELECT pending build_log items — show top 5 by priority
4. Check sentinel_errors last 7 days — flag any new critical errors
5. Brief James in under 60 seconds: leads to action + top 3 build priorities
6. Ask: "What are we building today?"
```

---

## 13. CLOUDFLARE QUICK LINKS

| Resource | URL |
|---|---|
| Workers | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services |
| Pages | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages |
| D1 Database | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/d1/databases/e697a253-e5fc-4201-939c-9aaeca6c5278 |
| Vectorize | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/ai/workers-ai |

---

*VAKAVITI-BRAIN.md — updated end of every session by Claude. Source of truth for platform state and CEO strategy.*
