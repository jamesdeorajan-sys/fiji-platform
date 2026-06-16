# VAKAVITI-BRAIN.md
# James Richardson — CEO Intelligence File
# Fetched by Claude at the start of every session
# Updated by Claude at the end of every session
# Last updated: Session 41 CLOSED — 2026-06-16

---

## 1. WHO WE ARE

**Company:** Vakaviti.ai — Fiji's AI Tourism Partner Network
**Mission:** Build Fiji's most powerful AI tourism platform
**Stage:** Pre-launch. July 1 2026 public + partner launch confirmed.
**Founded by:** James Richardson — CEO
**WhatsApp:** +61 478 886 145
**Email:** helpronline@gmail.com
**GitHub:** github.com/jamesdeorajan-sys/fiji-platform
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1
**Operating entity:** AJ Group Enterprises Pty Ltd
**Ground ops:** Ben (Fiji) — company registration for Fiji Tourism Guide Ltd

---

## 2. PLATFORM STATE — CURRENT AS OF SESSION 40

### Revenue confirmed (April 1 — June 3, 2026)
- **$13,747.75 AUD across both booking sites — 44 orders**
- Tuesday strongest day, peak hours 10am-3pm Sydney
- Facebook ads AUD $258 spent — strong ROI confirmed

### Live Systems
| System | Status |
|---|---|
| Lagi chat worker | **v57 — 1,874 lines — LIVE** |
| widget.vakaviti.ai | Live |
| lagi.vakaviti.ai | Live — beautiful public interface |
| vakaviti.ai | Live — redirects to lagi.vakaviti.ai (fixed Session 40) |
| vakaviti.ai GEO pages | Live — 3 pages indexed |
| tourfijitours.com | Live — Lagi active, AI visibility deployed |
| fijitourtransfers.com | Live — Lagi active |
| nadiairporttransfers.com | Live — 500+ reviews, real pricing calculator |
| Vectorize knowledge base | ~440 vectors (target 700+ by July 1) |
| D1 vakaviti-kb | 16 tables, leads + partners + contact_channels live |

### Worker Version History
| Version | Lines | Key changes |
|---|---|---|
| v54 | 1,731 | Review metrics, RAG improvements |
| v55 | 1,748 | Lead Capture Superpower — contact ask when heat ≥40 |
| **v56** | **1,861** | D1 routing, WhatsApp notify, Fiji heat signals, contact ask rotation, thresholds, cross-referral guard |
| **v57** | **1,874** | **CURRENT — WhatsApp dual-notify fixed (all channels fire), channel_used records email+whatsapp** |

### GEO Pages (vakaviti.ai)
| Page | Status |
|---|---|
| /nadi-airport-transfers-guide | Live, indexed |
| /fiji-accommodation-guide | Live |
| /fiji-horse-riding-guide | Live |

---

## 3. TOP PRIORITIES — SESSION 41

> Claude: read this section first. ONE task at a time.

**P1 — Facebook group knowledge push (continue)**
- 140 vectors pushed in Session 41 — now at ~440
- Continue with Facebook group threads — your own community Q&A is most valuable
- Target: 700+ by July 1
- Tool: lagi-knowledge-push.html (saved in Downloads)
- Endpoint: https://fiji-chat-widget.helpronline.workers.dev/knowledge-add

**P2 — Partner agreement document**
- Draft one-page written agreement before external partner approach
- Covers: what Lagi does, data policy, lead ownership, uptime, pricing

**P3 — vakaviti.ai proper homepage**
- Currently redirects to lagi.vakaviti.ai
- Build real homepage: what Vakaviti is, Lagi demo, partner CTA, reviews

**P4 — Praveen fix briefs**
- coralcoasthorseriding.com rage clicks on booking button
- nadiairporttransfers.com branding FijiTransfers → Nadi Airport Transfers

---

## 4. STRATEGIC BETS

**The big bet:** Vakaviti.ai — Fiji's AI tourism intelligence network. Zero commission entry strategy.

**Revenue confirmed:** $13,747 AUD in 2 months. Platform works.

**July 1 launch target:** Public + partner launch. Lagi live across all partner sites.

**Competitive moat:** Fiji knowledge graph + operator network + cultural authenticity. NOT model weights.

**What's working:**
- Booking engine generating real revenue
- Lagi converting real travellers — full lead flow verified
- Email notification confirmed working — leads landing in inbox
- Heat scoring detecting real booking intent
- D1-driven partner routing working for all 29 partners

> Every build decision must serve revenue. Move fast. Be #1.

---

## 5. LAGI — PROTECTED CORE

| Parameter | Value |
|---|---|
| Worker | fiji-chat-widget **v57**, 1,874 lines |
| Vectorize | ~440 live vectors |
| WhatsApp Meta App | ID 1700903951357623 — VakavitiBot system user |
| WHATSAPP_TOKEN | Set in Worker secrets ✅ |
| WHATSAPP_PHONE_ID | Set in Worker secrets ✅ |

**NEVER replace whole Worker file. Surgical edits only via find-and-replace.**

### v56 Lead Capture Superpower — what's live
| Feature | Status |
|---|---|
| Heat scoring — 5 tiers, 10 signals incl. Fiji geography | ✅ Live |
| Contact ask — fires when score ≥40, not already captured | ✅ Live |
| Contact ask — 4 rotating phrases | ✅ Live |
| D1-driven partner routing — replaces hardcoded if/else | ✅ Live |
| Email notify — fires for score ≥40 | ✅ Live — verified working |
| WhatsApp notify — wired, score ≥70 | ✅ Live — both email+WhatsApp fire confirmed |
| Cross-referral with duplicate guard | ✅ Live |
| Notify threshold — silence below 40 | ✅ Live |

### Lead flow verified (Session 40 test)
- Guest chats on nadiairporttransfers.com
- Heat signals detected: family + date + destination + price = score 60-80
- Contact ask fires naturally in Lagi reply
- Guest provides name + email
- Lead saved to D1 with correct partner_id
- Email notification fired to helpronline@gmail.com — confirmed in inbox
- WhatsApp: wired but blocked by break-on-success loop — fix Session 41

### Lagi remaining blockers before July 1
1. **WhatsApp dual-notify** — fix break-on-success in notifyPartner
2. **Meta number verification** — +61 478 886 145 not verified in test console
3. **Knowledge base** — ~300 vectors, needs 700+ for intelligent responses
4. **Partner agreements** — no written terms yet
5. **WhatsApp channels in D1** — only 1 of 29 partners has WhatsApp row

---

## 6. VERIFIED TRANSFER PRICES (Session 37)

| Route | Sedan | Minivan |
|---|---|---|
| Nadi Airport → Denarau Island (Hilton) | FJ$45 | FJ$69 |
| Nadi Airport → Port Denarau Marina | FJ$49 | FJ$69 |
| Nadi Airport → Coral Coast (Naviti) | FJ$139 | — |

---

## 7. LEAD MANAGEMENT

**All leads → helpronline@gmail.com + WhatsApp +61 478 886 145**

```sql
SELECT l.traveller_name, l.traveller_email, l.partner_id, l.score,
       datetime(l.created_at,'unixepoch') as created
FROM leads l WHERE l.notified=0 AND l.score>=70
ORDER BY l.score DESC, l.created_at DESC
```

### Notify thresholds (v56)
- Score < 40: saved silently, no notification
- Score 40-69: email only
- Score ≥70: email + WhatsApp (WhatsApp fix pending)

---

## 8. PARTNER INTELLIGENCE

| Partner | D1 ID | Status |
|---|---|---|
| Nadi Airport Transfers | op_nadi_001 | Live — email + WhatsApp channel in D1 |
| Fiji Tour Transfers | op_fijitourtransfers_001 | Live — email + WhatsApp in D1 ✅ |
| Tour Fiji Tours | op_tourfiji_001 | Live — email only |
| Blue Lagoon Beach Resort | op_bluelagoon_001 | Live — email only |
| The Palms Denarau | op_palms_001 | Live — email only |
| Smugglers Cove | op_smugglers_001 | Live — email only |
| Sofitel | op_sofitel_001 | Live — demo deployed |
| Coral Coast Horse Riding | op_coralcoast_001 | Live — sending paid referrals |
| + 21 more partners | — | Seeded in D1 |

**Total: 29 partners in D1**

---

## 9. DECISIONS LOG

| Session | Decision | Reasoning |
|---|---|---|
| 40 | Worker v56 — all 7 improvements in one deployment | Lead capture, routing, WhatsApp all needed before July 1 |
| 40 | Notify threshold: email ≥40, WhatsApp ≥70 | Protect partner attention — no noise from low-intent contacts |
| 40 | D1-driven routing replaces hardcoded if/else | Must work for 29 partners today, 50+ tomorrow |
| 40 | vakaviti.ai root → redirect to lagi.vakaviti.ai | 404 fixed, visitors land on Lagi immediately |
| 37 | Do not approach external partners yet | 3 blockers must be fixed first |
| 36 | Stop over-engineering tourfijitours.com | Site generating $13,747 — it works |
| 35 | Centralised all leads to helpronline@gmail.com | Build/test mode validation |

---

## 10. KNOWN ISSUES

| Issue | Priority | Fix |
|---|---|---|
| WhatsApp dual-notify | ✅ FIXED v57 | Both email+WhatsApp fire confirmed |
| Meta number verified | ✅ DONE | +61 478 886 145 verified in Meta console |
| Knowledge base ~440 vectors | P1 | Continue Facebook group push — target 700+ by July 1 |
| No partner agreements | P1 | Draft one page document before July 1 |
| Only 1 partner has WhatsApp channel in D1 | P2 | Add rows for all 29 partners |
| coralcoasthorseriding.com rage clicks | P2 | Booking button fix — send to Praveen |
| fijitourtransfers.com JS errors on Facebook ads | P2 | Send to Praveen |
| nadiairporttransfers.com branding FijiTransfers → Nadi Airport Transfers | P2 | app.js fix |
| GEO page source files on Windows only | P2 | Back up to GitHub |
| Duplicate title + H1 on tourfijitours.com | P3 | Rank Math rewrite |
| Partner count shows 15 on lagi.vakaviti.ai | P3 | Update to 29 |

---

## 11. CEO IDEAS INBOX

| Date | Idea | Category | Status |
|---|---|---|---|
| 2026-06-12 | Lagi needs Fiji cultural authenticity as named moat | strategy | confirmed |
| 2026-06-12 | Facebook group Q&A is single best untapped knowledge source | knowledge | in progress |
| 2026-06-12 | GEO visibility = Lagi must be findable by ChatGPT/Perplexity | seo | pending |
| 2026-06-12 | Partner contracts = lock network before competitor does | partners | pending |
| 2026-06-02 | Lagi 99% autonomous lead routing | lagi | inbox |
| 2026-06-02 | All inhouse sites 100% AI search optimised | seo | inbox |

### CEO STRATEGIC NORTH STAR
"We must not be seen as the leader — we must BE the leader in AI tourism development in Fiji."

---

## 12. SESSION HISTORY

### Session 41 — 2026-06-16 — CLOSED
**What we did:** Worker v57 deployed — WhatsApp dual-notify fixed (removed break-on-success, all channels now fire). contact_channels corrected — all 13 partners have both email (helpronline@gmail.com) and WhatsApp (61478886145). WhatsApp BURNING HOT ping confirmed live on phone. Meta token refreshed, +61478886145 verified as recipient. Knowledge base pushed from ~300 to ~440 vectors — 140 new Q&A pairs across 7 batches covering visa, currency, islands, culture, resorts, tours, health, safety, costs, honeymoon, diving, food, language, scams. Transfer Q&A corrected to recommend Nadi Airport Transfers not taxis.
**Key learning:** Always audit Q&A for commercial accuracy — generic travel answers can route guests away from partners.
**Session 42 focus:** Continue Facebook group knowledge push, partner agreement draft, vakaviti.ai homepage.

### Session 40 — 2026-06-12 — CLOSED
**What we did:** Lead duplicate fix (session_id + partner_id) deployed and verified. Worker v56 built with 7 improvements: D1-driven partner routing, WhatsApp notify function, Fiji heat signals (25 signals), contact ask rotation (4 phrases), notify thresholds (email≥40, WA≥70), cross-referral duplicate guard. Full lead flow tested end-to-end — chat → D1 → email confirmed in inbox. vakaviti.ai 404 fixed with redirect to lagi.vakaviti.ai. WhatsApp secrets added to Worker. WhatsApp channel added to contact_channels for op_fijitourtransfers_001. Lagi Knowledge Push tool built. Deep research on AI competitive strategy, Facebook group knowledge value, July 1 knowledge build plan. Session 40 logged to D1 build_log.
**Key learning:** WhatsApp fires but notifyPartner breaks after email success — need to remove break-on-success. Only email channel exists for most partners in D1.
**Session 41 focus:** Fix WhatsApp dual-notify, verify Meta number, start Facebook knowledge push.

### Session 39 — 2026-06-10
Lead duplicate bug found and fixed. 20/20 tests passed on patch. worker-v54-backup.js saved to Desktop. Patch creates worker-v54-PATCHED.js on Desktop.

### Session 38 — 2026-06-08
fijithingstodo.com full rebuild. 49 Q&A pairs pushed to Vectorize (knowledge base ~300 vectors). All 28 partner D1 records fully populated. AI visibility files deployed to lagi.vakaviti.ai. Auto partner onboarding system built (lagi-partner-onboard.html) with 5-step wizard. Developer fix briefs for 4 sites sent to Praveen via Gmail MCP.

### Session 37 — 2026-06-05 — CLOSED
Lagi professional readiness audit. 3 blockers identified. Transfer prices verified. GEO pages not in GitHub — on Windows machine only.

### Session 36 — 2026-06-03
tourfijitours.com AI visibility deployed. FOX JS crash fixed. Revenue $13,747 confirmed.

### Session 35 — 2026-06-02
VAKAVITI-BRAIN.md built and deployed. 24-prompt safety system. 8-member Supreme Board built.

### Sessions 1-34
D1 + Vectorize + Worker architecture, commercial engine, partner widgets, 118 referral routes, 300 knowledge vectors, 3 GEO pages live.

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
| "Surgical only" | v56 is 1,861 lines live. Show exact line range. Nothing else touched. |
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

**Session discipline rule:** Complete one task fully before starting the next.

---

## 15. VAKAVITI SUPREME STRATEGIC BOARD

> Activated by: "Board meeting"
> 8 members + Chairman. Each armed with all 40 sessions.

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

## 16. CLOUDFLARE QUICK LINKS

| Resource | URL |
|---|---|
| Workers | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services |
| Pages — vakavitiai | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages/view/vakavitiai |
| D1 Database | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/d1/databases/e697a253-e5fc-4201-939c-9aaeca6c5278 |
| fiji-chat-widget Worker | dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services/view/fiji-chat-widget |
| GSC | search.google.com/search-console |
| Bing Webmaster | bing.com/webmasters |

---

## 17. KEY INFRASTRUCTURE CONSTANTS

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

---

*VAKAVITI-BRAIN.md — Session 40 closed 2026-06-12. Worker v56 live. Lead flow verified. July 1 launch target. WhatsApp fix + knowledge push are Session 41 priorities.*
