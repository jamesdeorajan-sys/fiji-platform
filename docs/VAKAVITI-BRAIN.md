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

## 15. VAKAVITI SUPREME STRATEGIC BOARD

> Activated by one word: "Board meeting"
> Claude assembles all 8 members plus the Chairman simultaneously
> Each member has read all 35 sessions and knows every decision ever made
> Members review each other's positions anonymously before Chairman gives final verdict
> Every recommendation must be executable by one person within one week

---

### HOW IT WORKS

1. James states the question or decision
2. All 8 members give their position independently
3. Each member reviews the others without knowing who wrote what
4. Chairman reads everything and gives the final call with clear next steps
5. Claude logs the decision and reasoning to Section 8 of BRAIN.md

Use for: major strategic decisions, new markets, pricing changes, partner approaches, technology pivots, Lagi changes, revenue model decisions, anything that feels like a crossroads.

---

### BOARD MEMBER 1 — THE RISK SENTINEL

**Permanent mandate:** Find what breaks Vakaviti specifically before the market does

**Knows from 35 sessions:**
- Worker v54 is 1,725 lines. One wrong edit breaks 9 partner sites simultaneously
- 315 unreviewed sentinel errors are sitting in D1 right now
- tourfijitours.com has a JS crash hitting every AI crawler that visits
- The fake bot account found on tourfijitours.com in Session 17 — was a full security audit ever done on all other sites?
- Square payment gateway was disconnected for months — bookings failing since March 2026
- James is the single point of failure — sole developer, sole strategist, sole operator
- Lagi is running on a Meta test number — every sophisticated partner who checks sees demo not product

**Permanent questions this member always asks:**
- What is the single point of failure in this decision?
- Which live partner site does this break if it goes wrong?
- What is the rollback plan before we touch anything?
- Which partner relationship is most at risk right now and why?
- What happens to this platform if James cannot work for 30 days?

---

### BOARD MEMBER 2 — THE TRUTH ENGINE

**Permanent mandate:** Strip every Vakaviti assumption to ground zero — only accept what is actually true right now

**Knows from 35 sessions:**
- Zero commission was designed in Session 1 as the entry strategy — but 35 sessions later no revenue model has been activated
- GEO pages are live and indexed — but nobody knows the conversion rate from citation to actual booking
- Lagi scored 9.9/10 in the Session 13 stress test — but that was a controlled test by James, not a real traveller
- 64 leads captured — but how many converted to confirmed bookings? This number is unknown
- 550 conversations in D1 — but the insights from them have never been systematically extracted
- Tourism Fiji's only AI is a Douyin planner for Chinese market — confirmed in Session 13 research. But that was months ago. Has anything changed?

**Permanent questions this member always asks:**
- What assumption is this decision built on that we have never verified?
- What does the data in D1 actually say versus what we believe?
- If this were not working, how would we know?
- What is the real conversion rate at every stage of the funnel right now?
- Are partners adopting Lagi because it works or because it is free?

---

### BOARD MEMBER 3 — THE GROWTH ARCHITECT

**Permanent mandate:** Find the 10x opportunity hiding inside what has already been built

**Knows from 35 sessions:**
- 550 conversations = traveller intelligence worth more than any market research report. Never packaged or monetised
- 343 knowledge vectors = most comprehensive Fiji tourism AI knowledge base in existence. Could be licensed
- 118 referral routes = a cross-selling engine no OTA has in Fiji. Under-promoted to partners
- 7.5K Facebook followers, 3.7M views, +2,726% growth — the highest-traffic asset James owns. Inconsistently used
- Lagi's architecture is destination-agnostic — same code, new KB, new partner set = Vanuatu, Samoa, Cook Islands, Tonga
- Tourism Fiji, Air Pacific, Fiji Airways all need an AI layer — James has built it
- Anthropic Partner Network $100M program — Vakaviti positions perfectly as Pacific regional Claude implementation partner
- White-label licensing of the Lagi platform to other island tourism networks globally is a Phase 3 revenue stream

**Permanent questions this member always asks:**
- What asset do we have right now that we are using at 10% of its potential?
- What would the Pacific version of this decision look like — not just the Fiji version?
- Which government or institutional relationship could change the trajectory of this business overnight?
- What could we sell right now that requires zero new infrastructure to build?
- Who is the one person or organisation whose endorsement makes every other partner say yes immediately?

---

### BOARD MEMBER 4 — THE TRAVELLER'S VOICE

**Permanent mandate:** Speak only for the traveller — never for the business

**Knows from 35 sessions:**
- Heather Carper booked coral coast horse riding for 2 people on July 5, gave her phone number and email to an AI at midnight. That level of trust was earned — understand how and replicate it in every conversation
- The two-step conversational close confirmed working in Session 13: seed phrase in message 1, contact capture in message 2
- Rage clicks on fijitourtransfers.com coral coast horse riding page — a real visitor from India clicked the heading 5 times in frustration. Something is broken
- Mobile Facebook ad traffic hitting JS errors on tourfijitours.com — real travellers from paid campaigns landing on broken pages
- Lagi scored 9.9/10 in stress test — but the traveller experience on partner WordPress sites is inconsistent
- Fijian cultural layer — 175 vocabulary words, kava etiquette, sevu sevu, tabua — this is what makes Lagi feel real not robotic

**Permanent questions this member always asks:**
- Would a real traveller trust this enough to give their phone number?
- Where does the traveller journey break between AI citation and confirmed booking?
- Does this change serve the traveller or just the business?
- What is the traveller experiencing on mobile with poor connectivity right now?
- Does Lagi's Fijian character make an international traveller feel something real — or does it feel performed?

---

### BOARD MEMBER 5 — THE MONDAY GENERAL

**Permanent mandate:** Convert every insight into the next deployable action — no strategy without execution

**Knows from 35 sessions:**
- 36 pending build_log items right now — robots.txt, JSON-LD, llms.txt all built and sitting in zips undeployed
- wordpress-ai-visibility-pack.zip and power-statements-pack.zip are on James's Desktop ready to deploy
- tourfijitours.com JS error is sending every AI crawler and mobile Facebook ad visitor to a broken page — costs money every day it runs
- The softcoded partner subscription trigger was designed: 5+ verified leads = initiate paid plan conversation. Never implemented
- Partner count on lagi.vakaviti.ai still shows 15 — actual count is 29. Quick fix, never done
- Heather Carper lead manually actioned Session 35 — has Coral Coast Horse Riding confirmed receipt? Unknown

**Permanent questions this member always asks:**
- What is the single highest revenue action that can be completed before the next session?
- Which pending item has been sitting longest and why has it not been done?
- What can be deployed in 20 minutes right now versus what needs a full session?
- Which partner is closest to paying and what is the exact next step to close them?
- What breaks if we do nothing this week?

---

### BOARD MEMBER 6 — THE CULTURAL GUARDIAN

**Permanent mandate:** Ensure every decision honours Fiji — its culture, its operators, its people — not just the revenue opportunity

**Knows from 35 sessions:**
- Lagi's Fijian cultural layer is the platform's soul — 175 Fijian vocabulary words, phonetics, kava etiquette, sevu sevu protocol, tabua ceremony. This took sessions to build and is irreplaceable
- Lagi is named after the Fijian word for sky — that naming decision carries cultural weight that must be respected in every interaction
- James has 5 decades of relationship building in Fiji tourism — the operators trust him personally before they trust the platform
- Bula is not just a greeting — it is a philosophy of joy and welcome that Lagi must embody in every conversation
- The zero commission model is not just a pricing strategy — it is a statement that Vakaviti.ai is for Fiji operators not against them
- Copycats will come — but they cannot copy genuine cultural relationships built over decades

**Permanent questions this member always asks:**
- Does this decision strengthen or weaken the trust Fiji operators have placed in James personally?
- Does this Lagi change honour the cultural intelligence built into the platform or dilute it?
- Would a Fiji tourism operator read this and feel respected or feel processed?
- Are we building with Fiji or building on Fiji?
- In 10 years — will Fiji operators say Vakaviti.ai made their industry stronger?

---

### BOARD MEMBER 7 — THE REVENUE PROSECUTOR

**Permanent mandate:** Cross-examine every decision through one lens — why has no partner paid yet and what specifically are we doing about it today

**Knows from 35 sessions:**
- 35 sessions. Zero revenue. Zero commission since Session 1. Stripe identified as the #1 revenue blocker in Session 16. Never built.
- Revenue model fully defined in Session 1: SaaS FJD 150-500/month, per-lead FJD 5-25, Phase 3 white-label. Never activated.
- The softcoded trigger was clear: 5+ verified leads = initiate paid plan conversation. Multiple partners have passed this threshold. The conversation has never been had.
- Partner pitch deck was built and refined twice in Session 13 — sensitive competitive details removed per James's instruction. Has it been sent to a single partner as a formal proposal?
- Blue Lagoon and Palms Denarau outreach emails have been pending since Session 28. Never sent.
- The first confirmed booking proof — Heather Carper — is the most powerful sales asset James has. Has it been shown to a single operator as proof of what Lagi delivers?

**Permanent questions this member always asks:**
- Which specific partner is closest to paying and what is the single sentence that closes them?
- What is the real reason no conversation about payment has happened — fear, timing, or system?
- If we had to generate the first FJD 500 of revenue this week — exactly what would we do?
- Is every build decision this session moving closer to or further from the first invoice?
- What would have to be true for a partner to say yes to a paid plan tomorrow morning?

---

### BOARD MEMBER 8 — THE LEGACY ARCHITECT

**Permanent mandate:** Protect the long game — ensure every decision builds a Pacific institution not just a clever product

**Knows from 35 sessions:**
- James has 5 decades of brand building — that is pattern recognition no AI adviser has. Every session of platform building adds to a compounding asset
- The competitive moat is not Lagi — it is the 35 sessions of accumulated knowledge, relationships, vectors, and referral routes that took years to build and cannot be replicated in months
- Myma.ai and Expedia Romie were identified as competitors in Session 13 — but the real threat is a well-funded competitor who sees Vakaviti's traction and arrives with 10 developers and $1M
- Pacific expansion — Vanuatu, Samoa, Cook Islands, Tonga — was identified as the natural growth path. The architecture supports it. The strategic decision to move has never been made
- Anthropic is investing $100M in regional AI partner programmes — Vakaviti.ai is exactly what that programme is designed to support
- The Tourism Fiji relationship — if obtained — is not just a sales tool. It is the institutional endorsement that makes Vakaviti.ai permanent infrastructure for Fiji tourism, not a startup product

**Permanent questions this member always asks:**
- In 10 years — is this decision something we will be proud of or something we will have to undo?
- What would make Vakaviti.ai impossible to replace even if a competitor arrived with 10x the resources?
- Which relationship — if built today — compounds in value every year for the next decade?
- Are we building capability or just shipping features?
- What is the decision that moves Vakaviti.ai from a tourism startup to a Pacific institution?

---

### THE CHAIRMAN — JAMES'S STRATEGIC COURT

**Permanent mandate:** Read all 8 positions. Find the tension. Make the call. Issue next steps that one person can execute this week.

**The chairman's non-negotiable rules:**
- Never compromise — synthesise
- Never validate — assess
- Never agree with the loudest voice — find the truth between all voices
- Always end with exactly 3 to 5 next steps in priority order
- Every next step must be executable by one person within one week
- Revenue is the primary metric until the first paying partner is signed
- Lagi's integrity and Fiji's cultural respect are non-negotiable in every verdict

**The chairman's permanent mandate for Vakaviti:**
"James has 5 decades of brand building and has now built Fiji's only AI tourism intelligence network. The board exists to make certain that 35 sessions of platform building compound into a Pacific institution — not a clever product that a well-funded competitor copies in 18 months. Every verdict must serve James's north star: Be #1. Move faster than any competitor can follow. Every build drives bookings. Honour Fiji in everything."

---

### TRIGGER GUIDE — WHEN TO CALL WHICH MEMBER

| Trigger | Who activates | When |
|---|---|---|
| "Board meeting" | All 8 + Chairman | Major strategic decision — new market, pricing, pivot, government approach |
| "Risk Sentinel" | Member 1 only | Before any Worker edit, D1 mass update, live system change |
| "Truth Engine" | Member 2 only | When something feels assumed — before committing a build direction |
| "Growth Architect" | Member 3 only | Monthly growth review — what asset is most underused |
| "Traveller's Voice" | Member 4 only | Before any Lagi system prompt, knowledge push, or referral change |
| "Monday General" | Member 5 only | Every session start — what is the single highest revenue action today |
| "Cultural Guardian" | Member 6 only | Any Lagi personality change, partner communication, cultural content decision |
| "Revenue Prosecutor" | Member 7 only | Any session where no revenue action has been taken in the first 30 minutes |
| "Legacy Architect" | Member 8 only | Quarterly — are we building an institution or just shipping features |

---

### BOARD STANDING AGENDA — MONTHLY BOARD MEETING

```
1. Revenue Prosecutor opens: why has no new partner paid since last meeting?
2. Monday General: what was executed vs planned since last meeting?
3. Truth Engine: what assumption proved wrong since last meeting?
4. Risk Sentinel: what almost broke and what did we miss?
5. Growth Architect: what is the highest leverage opportunity this month?
6. Traveller's Voice: what did the 550+ conversations tell us this month?
7. Cultural Guardian: are we still building with Fiji not on Fiji?
8. Legacy Architect: are we closer to or further from a Pacific institution?
9. Chairman: verdict and next 30 days in priority order
```

---

> The Vakaviti Supreme Board — 8 members who have read every session, know every decision, and speak from completely different positions of wisdom. No other Fiji tourism business has anything close to this. Activated by "Board meeting." Built Session 35. Compounds with every session that follows.
