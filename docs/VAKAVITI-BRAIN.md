# VAKAVITI-BRAIN.md
# James Richardson — CEO Intelligence File
# Fetched by Claude at the start of every session
# Updated by Claude at the end of every session
# Last updated: Session 46 CLOSED — 2026-06-23

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

## 2. PLATFORM STATE — CURRENT AS OF SESSION 46

### 🔴 TOP FINDING THIS SESSION — Lagi has no page-level awareness
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

## 3. TOP PRIORITIES — SESSION 47

> Claude: read this section first. ONE task at a time.

**P1 — Lagi has no page/tour-level awareness — gives confidently wrong answers**
- Confirmed via live test: asked about Sawa-I-Lau Caves tour suitability for kids, Lagi answered in detail about the unrelated Cultural Night Tour instead.
- Root cause confirmed in Worker source: only `site_id` is ever sent; no page/tour identifier exists anywhere in the request pipeline.
- Fix needs: (1) embed snippet change to detect and pass current page/tour context, (2) Worker system-prompt logic to ground answers in that context instead of falling back to generic RAG search.
- This is the single highest-impact fix available — it affects every one of the ~108 tour pages on fijitourtransfers.com and any other partner site using per-page content.

**P2 — Find the source of the wrong Organization schema address**
- NSW postcode 2763 (real address is Rouse Hill NSW 2155), invalid country code format.
- WooCommerce, Rank Math Local SEO, and the "Jason" snippet all ruled out this session.
- Likely another WPCode "Untitled Snippet" — there were 26 active snippets total, most unnamed.

**P3 — Remove the 999999 master OTP bypass code**
- Flagged Session 5 as "must remove before launch." Still never confirmed removed. 8 days to launch — now genuinely urgent.

**P4 — Cancel/refund the test booking created this session**
- Real WooCommerce order created during the checkout test (Pravin Deorajan, $8, Nadi Airport to Aquarius Beach Resort). Confirm no real charge fired; cancel the order.

**P5 — Confirm the Praveen "hidden text" brief was sent and validate within 24 hours**
- Gmail draft created this session, addressed to madasanipraveen@gmail.com. James needs to actually send it. Follow up to confirm the homepage text section is converted to a visible accordion/FAQ and not just unhidden as a wall of text.

**P6 — Resolve the cross-brand bleed pattern (Author field, Legal Name field)**
- Confirmed sitewide on fijitourtransfers.com, not isolated. Decide: intentional shared-brand content pool, or needs separating for AI-citation clarity.

**P7 — Confirm lagi.vakaviti.ai meta description deployed**
- Carried from Session 45, still unconfirmed.

**P8 — Re-verify the Local Business schema duplicate is actually gone**
- "Jason" snippet deactivated this session but never re-tested via Rich Results Test afterward (got pulled into other findings). Quick re-check needed.

**P9 — WhatsApp permanent business number**
- Still on Meta test number. Must resolve before July 1 launch.

**P10 — Continue the Lagi Knowledge Hub, partner agreement doc, Google Business Profile**
- All carried unchanged from Session 45 — not touched this session.

**P11 — Verify the pricing outlier on fijitourtransfers.com**
- AU$61 Tanoa Hotel transfer vs AU$5–10 comparable routes — confirm correct or fix.

**P12 — Minor fijitourtransfers.com cleanup (low urgency)**
- Dead "Blogs" footer link, duplicate code block in redirect snippet, Cloudflare email-obfuscation tradeoff decision.

**P13 — Audit the remaining ~68 of 75 Workers & Pages projects**
- Carried from Session 45, not touched this session.

---

## 4. STRATEGIC BETS

**The big bet:** Vakaviti.ai — Fiji's AI tourism intelligence network. Zero commission entry strategy.

**Revenue confirmed:** $13,747 AUD in 2 months (last verified Session 35, not re-checked since).

**July 1 launch target:** Public + partner launch. Lagi live across all partner sites.

**Competitive moat:** Fiji knowledge graph + operator network + cultural authenticity. NOT model weights.

> Every build decision must serve revenue. Move fast. Be #1.

**New strategic note from Session 46:** the Lagi page-awareness gap is a moat risk, not just a bug — if AI assistants (including Lagi itself) can't reliably answer page-specific questions correctly, that undermines the "Fiji's most advanced transport AI" positioning the platform's own content claims. Fixing this is now as strategically important as the GEO/schema work that drives traffic *to* these pages in the first place.

---

## 5. LAGI — PROTECTED CORE

| Parameter | Value |
|---|---|
| Worker | fiji-chat-widget **v57**, 1,875 lines |
| GitHub backup | **FIXED Session 46** — genuine restorable copy, syntax-validated, independently re-verified |
| Lagi page | lagi-v4 — deployed 2026-06-17 |
| Speed | 98/100 mobile · 99/100 desktop · Sydney |
| Vectorize | ~440+ live vectors |
| AI Gateway | vakaviti-ai-gateway — ACTIVE |
| Page/tour awareness | **CONFIRMED ABSENT — see Section 2 top finding and Section 3 P1** |

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
| 46 | Did not fix the cross-brand Author/Legal-Name bleed pattern, logged as a decision needed rather than a bug to silently correct | Could be intentional (shared content pool between two related brands run by the same person) rather than an error — needs James's call, not an assumption. |

---

## 16. KNOWN ISSUES

| Issue | Priority | Status |
|---|---|---|
| Lagi has no page/tour-level awareness — gives wrong answers about specific tours | **P1 — NEW Session 46** | Confirmed via live test. Platform-level fix needed. |
| 3rd Organization schema entity has wrong address (NSW 2763) | P2 | Source hunt continues — WooCommerce, Rank Math, "Jason" snippet all ruled out |
| 999999 master OTP bypass code | P1 | Still not confirmed removed — flagged Session 5, now 41 sessions later |
| Test booking created during checkout verification needs cancelling | P1 — NEW Session 46 | Real WooCommerce order, $8, needs James to confirm no real charge + cancel |
| Praveen "hidden text" brief sent — needs confirmation + 24hr follow-up | P1 — NEW Session 46 | Gmail draft created, not confirmed sent yet |
| Cross-brand Author/Legal-Name bleed (Tour Fiji Tours ↔ Fiji Tour Transfers) | P2 — NEW Session 46 | Confirmed sitewide pattern, needs a decision not just a fix |
| Local Business schema duplicate fix not re-verified | P2 — NEW Session 46 | "Jason" snippet deactivated but Rich Results Test not re-run after |
| Worker GitHub backup stale/wrong | ~~P1~~ **RESOLVED Session 46** | Was a different single-site draft Worker entirely, not just old. Fixed, verified. |
| Checkout failure on fijitourtransfers.com | ~~P1~~ **RESOLVED Session 46** | Tested live, working. Real test order needs cleanup (see above). |
| fijitourtransfers.com llms.txt/schema "missing" | ~~P2~~ **RESOLVED Session 46 (was already done, just unconfirmed)** | Praveen had completed this; BRAIN.md notes were simply never updated to reflect it |
| WhatsApp permanent business number | P1 | Still on Meta test number, unresolved |
| lagi.vakaviti.ai meta description | P2 | Still unconfirmed deployed, carried multiple sessions |
| Pricing outlier — Tanoa Hotel transfer AU$61 | P2 — NEW Session 46 | Not confirmed wrong, needs a manual check |
| Dead "Blogs" footer link on fijitourtransfers.com | P3 — NEW Session 46 | Cosmetic |
| Cloudflare email obfuscation hides contact email from all AI/crawlers sitewide | P3 — NEW Session 46 | Informational — may be intentional tradeoff |
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
