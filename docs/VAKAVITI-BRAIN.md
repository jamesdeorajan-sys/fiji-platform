# VAKAVITI-BRAIN.md
# James Richardson — CEO Intelligence File
# Fetched by Claude at the start of every session
# Updated by Claude at the end of every session
# Last updated: Session 36 CLOSED — 2026-06-03

---

## 1. WHO WE ARE

**Company:** Vakaviti.ai — Fiji's AI Tourism Partner Network
**Mission:** Build Fiji's most powerful AI tourism platform — connecting travellers with verified local operators through Lagi, the AI travel guide
**Stage:** Build/test phase. Platform live, partners onboarding, revenue confirmed
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
| tourfijitours.com | tourfijitours.com | Live — Lagi active, booking engine working |
| fijitourtransfers.com | fijitourtransfers.com | Live — AI visibility pending |

### Revenue confirmed (April 1 — June 3, 2026)
- **$13,747.75 AUD across both booking sites**
- 44 confirmed orders
- Tuesday strongest day, peak hours 10am-3pm Sydney
- Referral sources: Coralcoasthorseriding.com sending real paid bookings
- Facebook ads: AUD $258 spent, strong ROI confirmed

### D1 Database (vakaviti-kb) — e697a253-e5fc-4201-939c-9aaeca6c5278
| Table | Count | Health |
|---|---|---|
| partners | 30 | All contacts centralised to helpronline@gmail.com |
| leads | 64 | Review notified=0 score>=70 each session |
| knowledge_items | 343 total, 251 vectorized | Language=4, Safety=1 critical gaps |
| partner_referrals | 118 | Healthy |
| conversation_events | 550 | Audit needed before knowledge expansion |
| sentinel_errors | 315 | Unreviewed |

### GEO Pages Live (vakaviti.ai)
| Page | GSC | Bing | FAQ Schema |
|---|---|---|---|
| /nadi-airport-transfers-guide | Done | Done | Done |
| /fiji-accommodation-guide | Done | Done | Done |
| /fiji-horse-riding-guide | Done | Done | Done |

### tourfijitours.com AI Visibility (Session 36)
| Item | Status |
|---|---|
| Lagi widget | Live and active |
| FOX currency switcher JS crash | Fixed — deactivated |
| JSON-LD schema + FAQ | Live via WPCode |
| robots.txt | Live in public_html |
| llms.txt | Already existed — 32KB |
| Bing registered + indexing requested | Done |
| GSC registered | Confirmed — 473 clicks, 42.8K impressions 3 months |
| Duplicate title + H1 tags | Pending fix — Rank Math vs theme conflict |
| Casino spam posts | Permanently deleted |

### fijitourtransfers.com AI Visibility
| Item | Status |
|---|---|
| Lagi widget | Live |
| robots.txt | Pending |
| JSON-LD schema | Pending |
| llms.txt | Pending |
| Bing submission | Pending |

---

## 3. TOP PRIORITIES — SESSION 37

> Claude: read this section first. Ask James which priority before building.

**P1 — fijitourtransfers.com AI visibility**
- [ ] Same process as tourfijitours.com — audit site first before touching anything
- [ ] Deploy robots.txt, JSON-LD schema, confirm Bing registration
- [ ] Check for JS errors before deploying anything

**P2 — tourfijitours.com remaining fixes**
- [ ] Fix duplicate title tag and H1 — Rank Math vs Traveler theme conflict
- [ ] Improve meta descriptions on top 5 GSC pages to increase 1.1% CTR
- [ ] Top pages to improve: Nausori Highland Waterfall, Tropical Island Hopping, Sawa-i-Lau Caves, Natadola Horse Riding

**P3 — Lagi knowledge expansion**
- [ ] Run conversation_events audit FIRST before writing any vectors
- [ ] Language domain: 4 vectors — expand with James's direct Fiji knowledge
- [ ] Safety domain: 1 vector — critical for traveller trust
- [ ] Quality rule: 50 accurate vectors per session maximum

**P4 — Revenue activation**
- [ ] First paying partner conversation — this must happen
- [ ] Blue Lagoon Beach Resort outreach — email reservations@bluelagoonresortfiji.com
- [ ] Show Heather Carper booking as proof point

---

## 4. STRATEGIC BETS

**The big bet:** Vakaviti.ai becomes the AI layer every Fiji tourism operator needs. Zero commission is the entry strategy.

**Revenue confirmed:** $13,747 AUD across two booking sites in 2 months. Platform works. Focus on growth not fixing.

**What keeps me up at night:**
- 5 decades building this brand — AI makes the challenge greater
- Revenue generation is the most important priority
- Must be #1 in Fiji tourism AI. Not second. First.

**What's working:**
- Lagi showing real humanised character
- Booking engine generating real revenue
- Referral network working — Coralcoasthorseriding.com sending paid bookings
- GEO strategy starting to work

> Claude: every build decision must serve revenue. The platform is generating $13,747/2 months. Build on what works.

---

## 5. LAGI — PROTECTED CORE

| Parameter | Value |
|---|---|
| Model | claude-sonnet-4-5 |
| Worker | fiji-chat-widget v54, 1,725 lines |
| Max tokens | 800 |
| Vectorize | vakaviti-knowledge, 251 live vectors |
| WhatsApp | Meta App ID 1700903951357623 |

**Critical:** v54 is 1,725 lines live. NEVER replace whole file. Surgical edits only.
**Lagi must never:** See CEO notes, ideas, or strategy docs.

---

## 6. LEAD MANAGEMENT

**All leads → helpronline@gmail.com + WhatsApp 61478886145**

```sql
SELECT l.traveller_name, l.traveller_email, l.partner_id, l.score,
       datetime(l.created_at,'unixepoch') as created
FROM leads l WHERE l.notified=0 AND l.score>=70
ORDER BY l.score DESC, l.created_at DESC
```

---

## 7. PARTNER INTELLIGENCE

| Partner | Status | Next action |
|---|---|---|
| Coral Coast Horse Riding | Active — sending paid referrals to tourfijitours.com | Confirm Heather Carper receipt |
| Tour Fiji Tours | Active — $13,747 revenue confirmed | First paid plan conversation |
| Blue Lagoon Beach Resort | Not yet outreached | Email this session |
| The Palms Denarau | Not yet outreached | Queue after Blue Lagoon |

---

## 8. DECISIONS LOG

| Session | Decision | Reasoning |
|---|---|---|
| 36 | Stop over-engineering tourfijitours.com | Site generating $13,747 revenue — it works. Build on strength not weakness. |
| 36 | fijitourtransfers.com AI visibility is Session 37 P1 | Systematic approach — audit first, then deploy |
| 35 | Centralised all leads to helpronline@gmail.com | Build/test mode validation |
| 35 | VAKAVITI-BRAIN.md replaces all handoff docs | Full context in 60 seconds |
| 34 | GEO pages on vakaviti.ai | Cloudflare Pages — AI-crawlable, instant deploy |

---

## 9. KNOWN ISSUES

| Issue | Affected | Priority | Fix |
|---|---|---|---|
| Duplicate title tag + H1 | tourfijitours.com | Medium | Rank Math rewrite titles ON, disable theme title output |
| 86 missing image alt attributes | tourfijitours.com | Low | Bulk update via Media Library |
| woocs_current_currency crash | FIXED Session 36 | Done | FOX plugin deactivated |
| Partner sites missing AI visibility | fijitourtransfers.com | P1 | Session 37 |
| Partner count shows 15 | lagi.vakaviti.ai | Low | Update to 29 |
| Language vectors only 4 | Vectorize | Medium | Expand with James's knowledge |
| Safety vectors only 1 | Vectorize | Medium | Build next knowledge session |

---

## 10. CEO IDEAS INBOX

| Date | Idea | Category | Status |
|---|---|---|---|
| 2026-06-02 | Lagi 99% autonomous lead routing to partners | lagi | inbox |
| 2026-06-02 | All inhouse sites 100% AI search optimised | seo | inbox |
| 2026-06-02 | Scale fast — BE the leader not be seen as leader | strategy | inbox |
| 2026-06-02 | Partner trust — one approach, they say wow | partners | inbox |

### CEO STRATEGIC NORTH STAR
"We must not be seen as the leader — we must BE the leader in AI tourism development in Fiji."

---

## 11. SESSION HISTORY

### Session 36 — 2026-06-03 — CLOSED
**What we built:** tourfijitours.com full audit and AI visibility deployment. Fixed FOX currency switcher JS crash. Deployed JSON-LD schema via WPCode with FAQ, TouristAttraction, and LocalBusiness structured data. Uploaded robots.txt to public_html. Confirmed Bing registered with 6,800 impressions. Requested Bing re-indexing. Permanently deleted casino spam posts from Trash. Confirmed Lagi live on site. Discovered $13,747 AUD revenue across both booking sites April-June 2026.
**Key insight:** Platform is generating real revenue. tourfijitours.com works. Stop fixing and start scaling.
**What needs fixing next session:** fijitourtransfers.com AI visibility, duplicate title/H1, meta description improvements.
**Honest note:** Session spent too long on incremental fixes to a working site. Session 37 — audit first, build second, always ask "does this drive revenue?"

### Session 35 — 2026-06-02
Built VAKAVITI-BRAIN.md, fixed all 29 partner contacts to helpronline@gmail.com, actioned Heather Carper and Ji Marino leads, confirmed GSC and Bing verified for vakaviti.ai, built 24-prompt safety system, built 8-member Supreme Board.

### Sessions 1-34
Key milestones: D1 + Vectorize + Worker architecture (S5-8), commercial engine + leads (S11-13), partner widgets (S21), 118 referral routes + 251 knowledge vectors (S28-30), 3 GEO pages live with FAQ schema (S34).

---

## 12. JAMES'S SAFETY PROMPT SYSTEM

### GROUP 1 — Memory
| Prompt | Claude does |
|---|---|
| "Checkpoint" | Generate BRAIN.md update now. Upload to GitHub. Every 60 minutes. |
| "Brain note: ___" | Capture instantly. Confirm receipt. Include in next checkpoint. |
| "Close session" | Generate complete updated BRAIN.md. Every session. No exceptions. |
| "What have we built?" | Full session summary in 60 seconds. |
| "Log this decision" | Write decision AND reasoning to Section 8. |

### GROUP 2 — Build safety
| Prompt | Claude does |
|---|---|
| "Verify first" | Confirm current state before touching anything. |
| "What breaks if we do this?" | Map every downstream impact before executing. |
| "Surgical only" | v54 is 1,725 lines live. Show exact line range. Nothing else touched. |
| "Staging first" | Test deploy only. Never touch live sites without staging confirmation. |
| "Rollback plan?" | State exact rollback steps before proceeding. |

### GROUP 3 — Strategic clarity
| Prompt | Claude does |
|---|---|
| "Revenue test" | Does this directly drive bookings? If not — explain why before continuing. |
| "North star check" | Re-read Section 4. Be #1. Drive bookings. |
| "Competitor check" | Can a Fiji competitor replicate this in 6 months? |
| "Priority reset" | Re-read Section 3. Confirm most important thing. |

### GROUP 4 — Lagi protection
| Prompt | Claude does |
|---|---|
| "Lagi impact?" | Map whether this touches system prompt, Vectorize, or referral logic. |
| "Keep Lagi clean" | CEO notes never enter Vectorize. /knowledge-add pipeline only. |

### GROUP 5 — Freedom
| Prompt | Claude does |
|---|---|
| "Thinking out loud" | Listen only. Build nothing until "let's build this." |
| "Just ideas" | Capture in Section 10 only. No planning. |
| "Challenge me" | Honest pushback. Real assessment not agreement. |
| "Best practice?" | Research before executing. |
| "How would #1 do this?" | Benchmark against world's best. |

### GROUP 6 — Emergency
| Prompt | Claude does |
|---|---|
| "Stop — review" | Halt everything. Show safe state. Wait for proceed. |
| "Something feels wrong" | Audit last 5 actions. Check D1. Report honestly. |
| "What's live right now?" | Query D1, confirm Worker version, surface errors. |
| "Lagi down?" | Check sentinel errors, embed configs. Diagnose in 2 minutes. |

---

## 13. SESSION START RITUAL

```
1. James pastes GitHub raw URL — fetch VAKAVITI-BRAIN.md
2. Query D1: leads WHERE notified=0 AND score>=70
3. Query D1: build_log WHERE status='pending' — top 5
4. Check sentinel_errors last 7 days
5. Brief James in 60 seconds: leads + top 3 priorities
6. Ask: "What are we building today?"
```

**GitHub fetch fix:** James pastes this URL at session start:
https://raw.githubusercontent.com/jamesdeorajan-sys/fiji-platform/main/docs/VAKAVITI-BRAIN.md

**Checkpoint rule:** Suggest every 60 minutes or after major build block.

---

## 14. CLOUDFLARE QUICK LINKS

| Resource | URL |
|---|---|
| Workers | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services |
| Pages | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages |
| D1 Database | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/d1/databases/e697a253-e5fc-4201-939c-9aaeca6c5278 |
| GSC | search.google.com/search-console |
| Bing Webmaster | bing.com/webmasters |

---

## 15. VAKAVITI SUPREME STRATEGIC BOARD

> Activated by: "Board meeting"
> 8 members + Chairman. Each armed with all 36 sessions.

**Member 1 — Risk Sentinel:** What breaks Vakaviti specifically.
**Member 2 — Truth Engine:** Strips every assumption to ground zero.
**Member 3 — Growth Architect:** Finds the 10x in what's already built.
**Member 4 — Traveller's Voice:** Speaks only for the traveller.
**Member 5 — Monday General:** Converts insight to Monday action.
**Member 6 — Cultural Guardian:** Ensures every decision honours Fiji.
**Member 7 — Revenue Prosecutor:** Why has no partner paid yet.
**Member 8 — Legacy Architect:** Protects the long game.
**Chairman:** Reads all 8. Makes the call. Issues 3-5 next steps.

| Trigger | Who | When |
|---|---|---|
| "Board meeting" | All 8 + Chairman | Major strategic decisions |
| "Revenue Prosecutor" | Member 7 | When no revenue action taken in 30 mins |
| "Monday General" | Member 5 | Every session start |
| "Traveller's Voice" | Member 4 | Before any Lagi change |
| "Risk Sentinel" | Member 1 | Before any live system change |

---

*VAKAVITI-BRAIN.md — Session 36 closed 2026-06-03. Revenue confirmed $13,747 AUD. Platform works. Build on strength.*
