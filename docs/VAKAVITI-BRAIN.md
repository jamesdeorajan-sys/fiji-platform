# VAKAVITI-BRAIN.md
# James Richardson — CEO Intelligence File
# Fetched by Claude at the start of every session
# Updated by Claude at the end of every session
# Last updated: Session 37 CLOSED — 2026-06-05

---

## 1. WHO WE ARE

**Company:** Vakaviti.ai — Fiji's AI Tourism Partner Network
**Mission:** Build Fiji's most powerful AI tourism platform
**Stage:** Build/test phase. Revenue confirmed. Platform working.
**Founded by:** James Richardson — CEO
**WhatsApp:** +61 478 886 145
**Email:** helpronline@gmail.com
**GitHub:** github.com/jamesdeorajan-sys/fiji-platform
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1

---

## 2. PLATFORM STATE — ALWAYS CURRENT

### Revenue confirmed (April 1 — June 3, 2026)
- **$13,747.75 AUD across both booking sites — 44 orders**
- Tuesday strongest day, peak hours 10am-3pm Sydney
- Facebook ads AUD $258 spent — strong ROI confirmed
- Coralcoasthorseriding.com referral sending paid bookings

### Live Systems
| System | Status |
|---|---|
| Lagi chat worker v54 | Live — 1,725 lines |
| widget.vakaviti.ai | Live |
| lagi.vakaviti.ai | Live |
| vakaviti.ai GEO pages | Live — 3 pages indexed |
| tourfijitours.com | Live — Lagi active, AI visibility deployed Session 36 |
| fijitourtransfers.com | Live — AI visibility PENDING |
| nadiairporttransfers.com | Live — 500+ reviews, real pricing calculator |

### GEO Pages (vakaviti.ai)
| Page | GSC impressions | Status |
|---|---|---|
| /nadi-airport-transfers-guide | 10 impressions, position 13.6 | Live, needs content improvement |
| /fiji-accommodation-guide | 0 impressions | Live, not yet ranking |
| /fiji-horse-riding-guide | 1 impression | Live |

### CRITICAL — GEO page deployment facts
- GEO pages are NOT in fiji-platform GitHub repo
- They were deployed as ZIP files directly to Cloudflare Pages (vakavitiai project)
- Source HTML files are on James's Windows machine — Downloads or Desktop
- Deployment process uses zip file upload to Cloudflare Pages — NOT GitHub push
- Session 38 priority: find source files, update nadi-airport-transfers-guide.html, redeploy

### tourfijitours.com — Session 36 completed
| Item | Status |
|---|---|
| FOX currency switcher JS crash | Fixed — deactivated |
| JSON-LD schema + FAQ | Live via WPCode |
| robots.txt | Live in public_html |
| llms.txt | Already existed |
| Bing registered + indexed | Done |
| Duplicate title + H1 | Still pending |

---

## 3. TOP PRIORITIES — SESSION 38

> Claude: read this section first. ONE task at a time. Do not move to the next until current is complete.

**P1 — Deploy improved nadi-airport-transfers-guide (30 minutes)**
- Find original GEO page zip file on James's Windows machine
- The file is named something like nadi-airport-transfers-guide.html
- Update with improved content from nadi-transfers-guide-improved.html (in Downloads)
- Redeploy via Cloudflare Pages direct zip upload
- Verified prices: Denarau FJ$45, Port Denarau FJ$49, Coral Coast FJ$139

**P2 — Fix 3 Lagi professional launch blockers**
- WhatsApp: replace test number +1(555)641-4099 with production number
- Partner agreement: one page document — draft and finalise
- Top errors: fix Elementor mobile failure on tourfijitours.com

**P3 — fijitourtransfers.com AI visibility**
- Same process as tourfijitours.com Session 36
- Audit first, then deploy robots.txt, schema, Bing submission

**P4 — First paying partner conversation**
- Email Blue Lagoon Beach Resort — reservations@bluelagoonresortfiji.com
- Use $13,747 revenue and Heather Carper booking as proof

---

## 4. STRATEGIC BETS

**The big bet:** Vakaviti.ai — Fiji's AI tourism intelligence network. Zero commission entry strategy.

**Revenue confirmed:** $13,747 AUD in 2 months. Platform works. Build on strength.

**Current focus:** Fix 3 professional launch blockers, then approach external partners.

**What keeps me up at night:**
- 5 decades building this brand — AI makes it harder and more complex
- Revenue and bookings are everything — if it doesn't drive bookings it doesn't matter
- Must be #1 in Fiji tourism AI. Not second. First.

**What's working:**
- Booking engine generating real revenue
- Lagi converting real travellers — Heather Carper proof
- Referral network working — Coralcoasthorseriding.com sending paid bookings
- GEO pages indexed and getting early impressions

> Every build decision must serve revenue. Move fast. Be #1.

---

## 5. LAGI — PROTECTED CORE

| Parameter | Value |
|---|---|
| Worker | fiji-chat-widget v54, 1,725 lines |
| Vectorize | 252 live vectors |
| WhatsApp | Meta App ID 1700903951357623 — TEST NUMBER still active |

**NEVER replace whole Worker file. Surgical edits only.**

### Lagi professional launch blockers (Session 37 audit)
1. **WhatsApp test number** — +1(555)641-4099 still showing. Must replace with real number before external partner launch.
2. **430 sentinel errors** — 381 uncaught. Top errors: jQuery not loading on coralcoasthorseriding.com, Elementor chunk failures on tourfijitours.com mobile, iOS bridge error on fijitourtransfers.com Facebook ad traffic.
3. **No partner agreement** — no written terms covering what Lagi does, data policy, uptime expectations, pricing.

### What is genuinely ready for partner launch
- Lead capture working — 68.5 average heat score
- Referral routing working — paid bookings confirmed
- 252 knowledge vectors across 10 intents
- Partner dashboard live
- Revenue confirmed

---

## 6. VERIFIED TRANSFER PRICES (Session 37)

Verified live from nadiairporttransfers.com June 5, 2026:

| Route | Distance | Time | Sedan price |
|---|---|---|---|
| Nadi Airport → Denarau Island (Hilton) | 9.9 km | ~20 min | FJ$45 |
| Nadi Airport → Port Denarau Marina | 9.6 km | ~19 min | FJ$49 |
| Nadi Airport → Coral Coast (Naviti) | 90.3 km | ~90 min | FJ$139 (after 10% discount) |

---

## 7. LEAD MANAGEMENT

**All leads → helpronline@gmail.com + WhatsApp 61478886145**

```sql
SELECT l.traveller_name, l.traveller_email, l.partner_id, l.score,
       datetime(l.created_at,'unixepoch') as created
FROM leads l WHERE l.notified=0 AND l.score>=70
ORDER BY l.score DESC, l.created_at DESC
```

---

## 8. PARTNER INTELLIGENCE

| Partner | Status | Next action |
|---|---|---|
| Coral Coast Horse Riding | Active — sending paid referrals | Confirm Heather Carper receipt |
| nadiairporttransfers.com | Live — 500+ reviews, FJ$45 Denarau | First paid plan conversation |
| Blue Lagoon Beach Resort | Not yet outreached | Email this session |
| Tour Fiji Tours | $13,747 revenue confirmed | First paid plan conversation |

---

## 9. DECISIONS LOG

| Session | Decision | Reasoning |
|---|---|---|
| 37 | Do not approach external partners yet | 3 blockers must be fixed first: WhatsApp test number, 430 errors, no partner agreement |
| 37 | GEO page content improved with verified prices | Real data from nadiairporttransfers.com — FJ$45, FJ$49, FJ$139 |
| 36 | Stop over-engineering tourfijitours.com | Site generating $13,747 — it works |
| 35 | Centralised all leads to helpronline@gmail.com | Build/test mode validation |
| 35 | VAKAVITI-BRAIN.md replaces all handoff docs | Full context in 60 seconds |

---

## 10. KNOWN ISSUES

| Issue | Affected | Priority | Fix |
|---|---|---|---|
| GEO page source files location unknown | nadi-airport-transfers-guide | P1 | Find zip file on Windows machine, redeploy |
| WhatsApp test number still active | Lagi all sites | P1 | Meta Developer console — replace number |
| Elementor mobile chunk failure | tourfijitours.com | P1 | Update Elementor or clear cache |
| jQuery not loading | coralcoasthorseriding.com | P2 | Partner site — flag to operator |
| No partner agreement document | Platform | P1 | Draft one page agreement |
| Duplicate title + H1 | tourfijitours.com | P2 | Rank Math rewrite titles setting |
| fijitourtransfers.com AI visibility | fijitourtransfers.com | P2 | Session 38 after P1 done |
| Partner count shows 15 | lagi.vakaviti.ai | P3 | Update to 29 |
| Safety vectors only 1 | Vectorize | P2 | Expand with James's knowledge |
| Language vectors only 4 | Vectorize | P2 | James's direct Fiji knowledge |

---

## 11. CEO IDEAS INBOX

| Date | Idea | Category | Status |
|---|---|---|---|
| 2026-06-02 | Lagi 99% autonomous lead routing | lagi | inbox |
| 2026-06-02 | All inhouse sites 100% AI search optimised | seo | inbox |
| 2026-06-02 | BE the leader — scale faster than copycats | strategy | inbox |
| 2026-06-02 | Partner trust — one approach, they say wow | partners | inbox |

### CEO STRATEGIC NORTH STAR
"We must not be seen as the leader — we must BE the leader in AI tourism development in Fiji."

---

## 12. SESSION HISTORY

### Session 37 — 2026-06-05 — CLOSED
**What we did:** Lagi professional readiness audit — identified 3 blockers before external partner launch. Reviewed 430 sentinel errors for first time — real breakdown by site and error type. Verified transfer prices from nadiairporttransfers.com. Built improved GEO page content with verified prices. GEO page deployment attempted but source files not found — not in GitHub repo, deployed via zip upload process.
**Key learning:** GEO pages are NOT in fiji-platform GitHub repo. Source files are on James's Windows machine. Deployment is via direct zip upload to Cloudflare Pages — not GitHub push.
**Honest reflection:** Session covered too many topics. Need to be more disciplined — one task completed properly beats five tasks started poorly.
**Session 38 focus:** Find GEO source files, deploy improved page, then fix WhatsApp test number.

### Session 36 — 2026-06-03
tourfijitours.com AI visibility deployed. FOX JS crash fixed. Schema live. robots.txt live. Bing indexed. Casino spam deleted. Revenue $13,747 confirmed.

### Session 35 — 2026-06-02
VAKAVITI-BRAIN.md built and deployed. All partner contacts centralised. 24-prompt safety system. 8-member Supreme Board built.

### Sessions 1-34
D1 + Vectorize + Worker architecture, commercial engine, partner widgets, 118 referral routes, 252 knowledge vectors, 3 GEO pages live.

---

## 13. JAMES'S SAFETY PROMPT SYSTEM

### GROUP 1 — Memory
| Prompt | Claude does |
|---|---|
| "Checkpoint" | Generate BRAIN.md update now. Upload to GitHub. Every 60 minutes. |
| "Brain note: ___" | Capture instantly. Confirm receipt. |
| "Close session" | Generate complete updated BRAIN.md. Every session. |
| "What have we built?" | Full session summary in 60 seconds. |
| "Log this decision" | Write decision AND reasoning to Section 9. |

### GROUP 2 — Build safety
| Prompt | Claude does |
|---|---|
| "Verify first" | Confirm current state before touching anything. |
| "What breaks if we do this?" | Map every downstream impact before executing. |
| "Surgical only" | v54 is 1,725 lines live. Show exact line range. Nothing else touched. |
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
| "Just ideas" | Capture in Section 11 only. No planning. |
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

## 14. SESSION START RITUAL

```
1. James pastes GitHub raw URL — Claude fetches VAKAVITI-BRAIN.md
2. Query D1: leads WHERE notified=0 AND score>=70
3. Query D1: build_log WHERE status='pending' — top 5
4. Brief James in 60 seconds: leads + top 3 priorities
5. Ask: "What is the ONE thing we are building today?"
```

**GitHub fetch URL:**
https://raw.githubusercontent.com/jamesdeorajan-sys/fiji-platform/main/docs/VAKAVITI-BRAIN.md

**Session discipline rule:** Complete one task fully before starting the next. If a task cannot be completed safely, stop and close the session rather than switching to another task.

---

## 15. VAKAVITI SUPREME STRATEGIC BOARD

> Activated by: "Board meeting"
> 8 members + Chairman. Each armed with all 37 sessions.

**Member 1 — Risk Sentinel:** What breaks Vakaviti specifically before the market does.
**Member 2 — Truth Engine:** Strips every assumption. Only accepts what is actually true.
**Member 3 — Growth Architect:** Finds the 10x in what's already built.
**Member 4 — Traveller's Voice:** Speaks only for the traveller.
**Member 5 — Monday General:** Converts insight to the next deployable action.
**Member 6 — Cultural Guardian:** Ensures every decision honours Fiji.
**Member 7 — Revenue Prosecutor:** Why has no partner paid yet. What are we doing about it today.
**Member 8 — Legacy Architect:** Protects the long game — Pacific institution not just a product.
**Chairman:** Reads all 8. Makes the call. Issues 3-5 next steps executable this week.

| Trigger | Who | When |
|---|---|---|
| "Board meeting" | All 8 + Chairman | Major strategic decisions |
| "Revenue Prosecutor" | Member 7 | When no revenue action in 30 mins |
| "Monday General" | Member 5 | Every session start |
| "Risk Sentinel" | Member 1 | Before any live system change |
| "Truth Engine" | Member 2 | When something feels assumed |

---

## 16. CLOUDFLARE QUICK LINKS

| Resource | URL |
|---|---|
| Workers | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services |
| Pages — vakavitiai | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages/view/vakavitiai |
| D1 Database | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/d1/databases/e697a253-e5fc-4201-939c-9aaeca6c5278 |
| GSC — vakaviti.ai | search.google.com/search-console |
| Bing Webmaster | bing.com/webmasters |

---

*VAKAVITI-BRAIN.md — Session 37 closed 2026-06-05. Revenue $13,747 confirmed. 3 professional launch blockers identified. GEO page deployment pending — source files on Windows machine.*
