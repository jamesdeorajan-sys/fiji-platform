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
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1

---

## 2. PLATFORM STATE — ALWAYS CURRENT

### Live Systems
| System | URL | Status |
|---|---|---|
| Lagi chat worker | fiji-chat-widget.helpronline.workers.dev | Live — v54, 1,725 lines |
| Widget CDN | widget.vakaviti.ai/widget.js | Live |
| Lagi public page | lagi.vakaviti.ai | Live |
| Partner dashboard | dashboard.vakaviti.ai | Live |
| Main domain | vakaviti.ai | Live |
| Join page | join.vakaviti.ai | Live |

### D1 Database (vakaviti-kb) — e697a253-e5fc-4201-939c-9aaeca6c5278
| Table | Count | Health |
|---|---|---|
| partners | 30 | All contacts → helpronline@gmail.com (centralised, build/test mode) |
| leads | 64 | 27 unnotified — review each session |
| knowledge_items | 343 | Healthy |
| partner_referrals | 118 | Healthy |
| conversation_events | 550 | Healthy |
| sentinel_errors | 315 | Unreviewed — JS errors on partner sites |
| domain_compliance | 10 | Most sites missing llms.txt, robots.txt, schema |

### GEO Pages Live (vakaviti.ai)
| Page | GSC | Bing | FAQ Schema |
|---|---|---|---|
| /nadi-airport-transfers-guide | Done | Done | Done |
| /fiji-accommodation-guide | Done | Done | Done |
| /fiji-horse-riding-guide | Done | Done | Done |

### Partner Sites with Lagi Widget
| Site | Widget | GSC | Bing | llms.txt | Schema |
|---|---|---|---|---|---|
| nadiairporttransfers.com | Done | No | No | No | No |
| fijitourtransfers.com | Done | No | No | No | No |
| tourfijitours.com | Done | No | No | No | No |
| guidefiji.com | Done | No | No | No | No |
| bestfijitours.com | Done | No | No | No | No |
| vosavakaviti.com | Done | No | No | No | No |

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
- [ ] Update partner count 15 to 29 on lagi.vakaviti.ai stats bar

**P3 — Platform intelligence**
- [ ] Build 3 new D1 tables: ideas, partner_intelligence, lessons_learned
- [ ] Add auto-intelligence briefing to session start ritual
- [ ] Build partner monthly lead digest

---

## 4. STRATEGIC BETS — WHAT WE'RE BUILDING TOWARD

**The big bet:** Vakaviti.ai becomes the AI layer that every Fiji tourism operator needs — not a booking platform, not an OTA, but the intelligence network that connects verified local operators to AI-driven traveller searches. Zero commission model is the moat.

**Why we win:**
- First mover — no competitor in Fiji has AI concierge at this depth
- 29 verified operators in D1 — real relationships, real data
- GEO pages + Lagi + partner widgets = full funnel from AI search to booking
- Lagi's local knowledge (343 vectors, Fijian language layer) cannot be replicated fast

**Current strategic focus:** AI search domination — get cited by ChatGPT, Perplexity, Google AI Overviews before any competitor understands what GEO is

---

**What keeps me up at night — James's honest words:**

- 5 decades building this brand. AI makes the challenge greater and more complex — integrating and building Vakaviti AI and Lagi at this scale is the hardest thing I have built
- Revenue generation and online bookings are the most important priority — every tool, every build must serve this. If it does not drive bookings it does not matter
- Vakaviti AI and Lagi must be the powerhouse that dominates the Fiji travel and tourism market — nothing less
- We have to be #1 — using the best of everything AI has to offer. Not second. First.

**What's working better than expected — James's honest words:**

- Lagi is showing real humanised character — travellers are responding to it as a person, not a bot
- We are starting to be AI searchable across platforms — GEO strategy is working
- We are building great AI workflows and online presence — the foundation is stronger than it looks

---

> Claude: read this section before every build decision. Every feature, every fix, every strategy must serve revenue and booking conversion. James has 5 decades invested in this. Move fast. Be #1.

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
**Lagi must never:** See CEO notes, ideas, build log, or strategy docs. Hard architectural separation.
**Critical Worker rule:** v54 is live at 1,725 lines. NEVER replace whole file. Surgical edits only.

---

## 6. LEAD MANAGEMENT — CURRENT PROTOCOL

**Build/test mode:** ALL leads go to helpronline@gmail.com + WhatsApp 61478886145
**James validates and forwards manually to partners**
**When to go partner-direct:** When James confirms individual partner is ready

**Lead review query — run every session start:**
```sql
SELECT l.traveller_name, l.traveller_email, l.partner_id, l.score,
       datetime(l.created_at,'unixepoch') as created
FROM leads l
WHERE l.notified=0 AND l.score>=70
ORDER BY l.score DESC, l.created_at DESC
```

**Session 35 actioned leads:**
- Heather Carper — Coral Coast Horse Riding, July 5, 2 people — manually actioned
- Ji Marino — Tour Fiji Tours — manually actioned

---

## 7. PARTNER INTELLIGENCE

> James: add notes after every partner conversation

| Partner | Last contact | Key insight | Next action |
|---|---|---|---|
| Coral Coast Horse Riding | Session 35 | Heather Carper lead sent manually | Confirm receipt |
| Tour Fiji Tours | Session 35 | Ji Marino lead sent manually | Confirm receipt |
| Blue Lagoon Beach Resort | Not yet | Not yet outreached | Email reservations@bluelagoonresortfiji.com |
| The Palms Denarau | Not yet | Not yet outreached | Email reservations@thepalmsdenarau.com |

---

## 8. DECISIONS LOG — WHY WE CHOSE WHAT WE CHOSE

| Session | Decision | Reasoning |
|---|---|---|
| 35 | Centralised all leads to helpronline@gmail.com | Build/test mode — validate engine before partner-direct routing |
| 35 | CEO brain separate from Lagi | Lagi stays focused on tourism visitors. CEO intelligence never enters Vectorize or system prompt |
| 35 | VAKAVITI-BRAIN.md as master session file | Replaces scattered handoff docs. Claude fetches at session start. Full context in 60 seconds. |
| 34 | GEO pages on vakaviti.ai not WordPress | Cloudflare Pages = instant deploy, full control, AI-crawlable, no plugin conflicts |
| 34 | Zero commission model as core positioning | Viator/Expedia take 20-30%. Our moat is direct booking — operators keep 100% |

---

## 9. KNOWN ISSUES — CHECK BEFORE BUILDING

| Issue | Affected | Fix |
|---|---|---|
| woocs_current_currency JS crash | tourfijitours.com | WooCommerce currency plugin conflict — disable or update |
| Rage clicks on coral coast horse riding page | fijitourtransfers.com | Something broken on that listing page — investigate |
| 315 unreviewed sentinel errors | All partner sites | Review top 20 each session |
| Partner count shows 15 on lagi.vakaviti.ai | lagi.vakaviti.ai | Update stats bar to 29 |
| Partner sites missing llms.txt and robots.txt | All WP sites | Deploy from wordpress-ai-visibility-pack.zip |
| .html.html double extension bug | Windows deploy | Always use CMD rename, never File Explorer |
| Unicode/emoji in JS strings cause SyntaxError | Worker edits | Full ES5 rebuild — remove all non-ASCII |

---

## 10. CEO IDEAS INBOX

> James: drop raw ideas here anytime. Claude reviews and categorises each session.

| Date | Idea | Category | Status |
|---|---|---|---|
| 2026-06-02 | Lagi to scale fast — 99% autonomous intelligence: picking leads, qualifying them, and serving them directly to the right partner with zero manual intervention from James | lagi | inbox |
| 2026-06-02 | All in-house tour and transfer sites must be 100% optimised for AI search — every page crawlable, structured, cited by ChatGPT and Perplexity | seo | inbox |
| 2026-06-02 | Scale fast and block copycats — online dominance must be current with all AI advancements. Do not wait to be seen as the leader. BE the leader. Move faster than any competitor can follow | strategy | inbox |
| 2026-06-02 | Partner trust through one single powerful approach — every operator we approach should say "wow, add me to Lagi and Vakaviti AI immediately." The demo, the pitch, the proof must be so strong that yes is the only answer | partners | inbox |

---

### CEO STRATEGIC NORTH STAR — Session 35

> James's own words — Claude reads this every session before making any build decision

"We must not be seen as the leader — we must BE the leader in AI tourism development in Fiji. Make certain partner trust is built with one single approach. They say wow, add me to Lagi and Vakaviti AI."

---

## 11. SESSION HISTORY — STRATEGIC NARRATIVE

### Session 35 — 2026-06-02
**What we built:** Full platform audit. Discovered 27 unnotified leads and all partner contacts pointing to wrong destinations. Fixed by centralising all 29 partners to helpronline@gmail.com. Manually actioned Heather Carper and Ji Marino leads. Confirmed GSC and Bing verified (completed Session 34). Designed and deployed VAKAVITI-BRAIN.md. Built 24-prompt safety system.
**Key decisions:** Centralise all leads during build/test phase. CEO brain stays separate from Lagi permanently. BRAIN.md replaces all handoff docs.
**What's working:** GEO pages indexed, FAQ schema detected by Google, Bing submitted. Platform engine firing.
**What needs fixing:** Partner site JS errors, undeployed AI visibility files, power statements not yet embedded.
**Next session focus:** Deploy wordpress-ai-visibility-pack.zip, embed power statements, fix tourfijitours JS errors.

### Session 34 — 2026-05-31 to 2026-06-02
**What we built:** GEO page 3 (horse riding). Registered vakaviti.ai on GSC and Bing. Submitted all 3 GEO pages to both. Built power statements pack and wordpress AI visibility pack. Set up statement_performance A/B test tracking in D1.
**Key win:** FAQ schema detected on horse riding page — AI Overview citation pipeline now active.

### Sessions 1 to 33
See Claude memory for full history. Key milestones: D1 + Vectorize + Worker architecture (S5-8), commercial engine + leads + deals (S11-13), partner widget installs (S21), 118 referral routes + 251 knowledge vectors (S28).

---

## 12. JAMES'S SAFETY PROMPT SYSTEM

> Claude: treat every one of these words as a hard instruction. Drop everything else and execute the defined response immediately. Proactively suggest relevant prompts when risk is detected.

### GROUP 1 — Memory and capture

| Prompt | Claude does |
|---|---|
| "Checkpoint" | Generate BRAIN.md update for everything built so far this session. James uploads to GitHub immediately. Suggest this every 60 minutes in long sessions. |
| "Brain note: ___" | Capture the note instantly. Confirm "Captured: [note]" and continue building. Include in next checkpoint. |
| "Close session" | Generate complete updated BRAIN.md — all decisions, builds, ideas, priorities, platform state. Zero exceptions. Every session. |
| "What have we built?" | Summarise everything completed this session, decisions made, what is pending. 60 second reality check. |
| "Log this decision" | Write the decision AND the reasoning into Section 8 of BRAIN.md update. The why matters as much as the what. |

### GROUP 2 — Build safety

| Prompt | Claude does |
|---|---|
| "Verify first" | Confirm current state, line count, exact changes before touching anything. No assumptions ever. |
| "What breaks if we do this?" | Map every downstream impact — partners affected, workers touched, D1 tables changed — before executing. |
| "Surgical only" | Worker v54 is 1,725 lines live. Show exact line range being edited. Nothing else touched. Confirm before proceeding. |
| "Staging first" | Build for staging deploy only. Never touch live partner sites without staging confirmation. |
| "Rollback plan?" | State exactly how to undo this action before proceeding. Provide exact rollback SQL or revert steps first. |

### GROUP 3 — Strategic clarity

| Prompt | Claude does |
|---|---|
| "Revenue test" | Score the current task: does this directly drive bookings? If not — explain why we are doing it now before continuing. |
| "North star check" | Re-read Section 4. Confirm current build serves: Be #1. Move faster than competitors. Every build drives bookings. |
| "Competitor check" | Assess: can a Fiji competitor replicate this in under 6 months? If yes — go faster or go deeper. Report honestly. |
| "Priority reset" | Re-read Section 3 priorities. Confirm we are working on the most important thing. Surface if we have gone off track. |

### GROUP 4 — Lagi protection

| Prompt | Claude does |
|---|---|
| "Lagi impact?" | Map whether this touches Lagi's system prompt, Vectorize, knowledge, or referral logic. Explicit approval required if yes. |
| "Keep Lagi clean" | CEO notes and ideas never enter Vectorize or system prompt. Route content via /knowledge-add pipeline only. Confirm separation. |

### GROUP 5 — Freedom prompts

| Prompt | Claude does |
|---|---|
| "Thinking out loud" | Listen and engage strategically. Ask questions. Challenge assumptions. Build NOTHING until "let's build this" is said. |
| "Just ideas" | Capture in Section 10 inbox only. No planning, no scoping, no build estimates unless explicitly asked. |
| "Challenge me" | Give honest pushback. Is this the right priority? Is there a faster way? Real assessment — not agreement. |
| "Best practice?" | Research and advise before executing. Never build the wrong thing right. |
| "How would #1 do this?" | Benchmark against world's best AI tourism platform. Pull thinking from tactical to visionary. Recommend accordingly. |

### GROUP 6 — Emergency

| Prompt | Claude does |
|---|---|
| "Stop — review" | Halt everything immediately. Show exactly what has changed, what is incomplete, what the safe state is. Wait for "proceed." |
| "Something feels wrong" | Audit last 5 actions this session. Check D1 for unexpected changes. Give honest assessment of what might be off. |
| "What's live right now?" | Query D1, confirm Worker version, check domain compliance, surface errors. True live platform state in 60 seconds. |
| "Lagi down?" | Test Worker endpoint, check sentinel errors, confirm embed configs intact. Diagnose and prioritise fix within 2 minutes. |

---

## 13. SESSION START RITUAL — CLAUDE EXECUTES THIS EVERY TIME

```
1. Fetch this file from GitHub raw URL
2. Query D1: leads WHERE notified=0 AND score>=70 — surface immediately
3. Query D1: build_log WHERE status='pending' — show top 5 by priority
4. Check sentinel_errors last 7 days — flag any new critical errors
5. Brief James in under 60 seconds: leads to action + top 3 build priorities
6. Ask: "What are we building today?"
```

**Proactive checkpoint rule:** If session exceeds 60 minutes or a major build block completes — suggest "Checkpoint" before continuing.

---

## 14. CLOUDFLARE QUICK LINKS

| Resource | URL |
|---|---|
| Workers | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services |
| Pages | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages |
| D1 Database | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/d1/databases/e697a253-e5fc-4201-939c-9aaeca6c5278 |
| Vectorize | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/ai/workers-ai |
| GSC | search.google.com/search-console |
| Bing Webmaster | bing.com/webmasters |

---

*VAKAVITI-BRAIN.md — updated end of every session by Claude. Single source of truth for platform state and CEO strategy. Never scattered across handoff docs again.*
