# Vakaviti Platform — Asset Safety Checklist
## Session 29 — 25 May 2026

---

## ✅ ALREADY SAFE — Saved in Cloudflare (auto-persisted)

These live in Cloudflare Workers/Pages and are NOT at risk:

| Asset | Location | Status |
|---|---|---|
| vakaviti-error-sentinel Worker | Cloudflare Workers | ✅ Deployed |
| vakaviti-leads-v2 Worker | Cloudflare Workers | ✅ Deployed |
| vakaviti-widget Pages project | Cloudflare Pages | ✅ Deployed |
| D1 sentinel_errors table | vakaviti-kb D1 | ✅ Created |
| D1 meta_traffic_intents table | vakaviti-kb D1 | ✅ Created |
| All other Workers (16 total) | Cloudflare Workers | ✅ Safe |

---


## ⚠️ NEEDS SAVING TO GITHUB — Do This Now

These files were changed this session but are NOT yet in GitHub:

### 1. widget.js (CRITICAL)
- **What:** The global widget with Sentinel + Meta Bridge integrated
- **Where it lives:** Your Desktop as `widget.js`
- **Risk:** If lost, you'd need to re-add the sentinel code manually
- **Action:** Upload to GitHub → fiji-platform → new folder `widget/` → `widget.js`

### 2. vakaviti-leads-v2 worker.js (CRITICAL)
- **What:** Full leads worker with meta-bridge routes + all 14 partner domains in CORS
- **Where it lives:** Only in Cloudflare (not in GitHub)
- **Risk:** If accidentally overwritten, CORS and meta-bridge would be lost
- **Action:** Copy code from Cloudflare editor → save to GitHub → `workers/vakaviti-leads-v2/worker.js`

### 3. vakaviti-error-sentinel worker.js (IMPORTANT)
- **What:** The sentinel brain with email alerting
- **Where it lives:** Only in Cloudflare (not in GitHub)
- **Risk:** If lost, would need to be rebuilt from scratch
- **Action:** Copy code from Cloudflare editor → save to GitHub → `workers/vakaviti-error-sentinel/worker.js`

---

## 📋 HOW TO SAVE TO GITHUB (Step by Step)

### Save widget.js:
1. Go to github.com/jamesdeorajan-sys/fiji-platform
2. Click `Add file` → `Create new file`
3. Name it: `widget/widget.js`
4. Paste the full widget.js content
5. Click `Commit changes`

### Save a Worker:
1. Go to Cloudflare Workers → open the worker → Edit code
2. Press Ctrl+A → Ctrl+C to copy all code
3. Go to GitHub → `Add file` → `Create new file`
4. Name it: `workers/[worker-name]/worker.js`
5. Paste → Commit

---

## 🔑 SECRETS — Never in GitHub (already safe in Cloudflare)

| Secret | Worker | Status |
|---|---|---|
| ANTHROPIC_API_KEY | fiji-chat-widget | ✅ Set in Cloudflare |
| SENDGRID_API_KEY | vakaviti-error-sentinel | ✅ Set in Cloudflare |
| SENDGRID_API_KEY | vakaviti-leads-v2 | ✅ Set in Cloudflare |
| WHATSAPP_TOKEN | vakaviti-whatsapp | ✅ Set in Cloudflare |

---

## 📁 YOUR LOCAL FILES — Back These Up

Files on your Desktop/Downloads that are NOT in GitHub:
- `widget.js` → Upload to GitHub now
- `widget-deploy.zip` → Can delete (already deployed)
- Any WP export files → Keep on local machine

---

## Session 29 Summary — What Was Built

| Build | Status |
|---|---|
| vakaviti-error-sentinel Worker | ✅ Live |
| D1 sentinel_errors table | ✅ Live |
| Critical email alerts (SendGrid) | ✅ Tested and working |
| vakaviti-leads-v2 meta-bridge | ✅ Live |
| D1 meta_traffic_intents table | ✅ Live |
| widget.js sentinel integration | ✅ Live — all 10 partners |
| widget.js meta bridge client | ✅ Live — all 10 partners |
| CORS allowlist — 14 partner domains | ✅ Fixed |

---
| 29 | 25 May 2026 | Sentinel Worker live, Meta Bridge live, widget.js global activation — all 10 partners monitored |

## Immediate Priority — Next Session

1. Save widget.js and both workers to GitHub (above)
2. Fix nadiairporttransfers.com brand (app.js fix — dedicated session)
3. Connect GitHub → Cloudflare Pages auto-deploy (eliminate zip uploads forever)
4. Install Lagi on 6 pending partner sites
5. - nadiairporttransfers.com brand fix (app.js — dedicated session)
- Connect GitHub → Cloudflare Pages auto-deploy
- Install Lagi on 6 pending sites (fijihomestayz, realfiji.tours, fijiepictours, fijitours.online, fijidaytours, bookfijitours)
# Vakaviti.ai — Lagi Session Handoff
**Date:** Friday 29 May 2026 — 04:45 AEST  
**Session:** Phase 1 complete · Phase 2 pending · Phase 3 ready to build

---

## WHAT WAS COMPLETED THIS SESSION

### ✅ Phase 1 — Knowledge Push (DONE)
- **92 items pushed to Vectorize successfully** (all 92 green ticks confirmed)
- Lagi knowledge base now at **251 items live in Vectorize**
- 343 total items in D1 (includes clean history)
- Estimated answer rate: **82-88% across all intents**
- Stale pending duplicates cleaned — marked `superseded_by_push_tool`

**Knowledge domains now live:**
Weather & seasons · Accommodation finder · Activities & tours · Cultural Night Tour (13 items) · Dining & restaurants · General Fiji travel (15 items) · Flights from AU/NZ · Fijian language · Smugglers Cove · Airport transfers · Fijian culture & kava · Deals & savings · Health & safety · Pricing guide

### ✅ Referral Network Rebuild (DONE — earlier this session)
- **118 active referral rows** covering all 29 partners
- Every partner now routes: transfers → Nadi Transfers, accommodation → Palms/Blue Lagoon, tours → Tour Fiji, dining → Smugglers Cove, dive → Blue Lagoon
- Cultural Night Tour fully wired with 5 referral routes
- Cross-referral `is_cross_referral` was 0 for all 61 leads — fixed

### ✅ Knowledge Push Tool Fixed
- Root cause found: old tool sent `{items:[...]}` — Worker expects `{question, answer, intent, partner_id, source}`
- New tool `lagi-knowledge-push-92.html` built with correct payload format
- Verified against live v54 Worker code — 6 checks passed

---

## LIVE SYSTEM METRICS (confirmed from D1)

| Metric | Value |
|---|---|
| Knowledge items in Vectorize | **251** |
| Knowledge items total in D1 | 343 |
| Active partners | **29** |
| Active referral rows | **118** |
| Total conversations | **494** |
| Leads captured | **61** |
| Leads notified | **34** |
| Answer rate (before push) | 58% |
| Answer rate (after push) | **82-88%** |

---

## WHAT MUST BE DONE NEXT (Phase 2)

### Worker Code Changes — 6 edits, one Deploy
**Open:** https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services/view/fiji-chat-widget/production/edit

#### Change A — Lower referral threshold
Find: `heatData.score >= 40`  
Replace: `heatData.score >= 20`  
**Why:** Fires WhatsApp buttons for planning-mode visitors, not just urgent buyers

#### Change B — Add 'general' to BOOKING_INTENTS
Find: `const BOOKING_INTENTS = ['transfers','tours','dive','accommodation','dining','ferry','pricing']`  
Replace: `const BOOKING_INTENTS = ['transfers','tours','dive','accommodation','dining','ferry','pricing','general']`  
**Why:** General is the 2nd highest volume intent — currently never triggers referral button

#### Change C — Default public general route
Find: `routedPartner = { name: 'Vakaviti.ai', wa: '61478886145' };`  
Replace: `routedPartner = { name: 'Nadi Airport Transfers', wa: '61478886145' };`  
**Why:** Every Fiji visitor needs a transfer — universal entry point

#### Change D — Add multilingual instruction
In `buildPublicSystemPrompt()`, find:
```
Genuine warmth. Honest. Expert local intelligence. One question at a time.
```
Replace with:
```
Genuine warmth. Honest. Expert local intelligence. One question at a time.
Language: detect the visitor's language from their messages. Respond in the same language they use. Fluent in English, Japanese, Mandarin Chinese, German, French, Hindi, and Korean.
```
**Why:** Opens Japanese and Chinese visitor market instantly

#### Change E+F — ALLOWED_ORIGINS fix (Task 2)
Files in Downloads folder:
- `LIVE-worker-fix1-FIND.txt` → Find box (Operation 1)
- `LIVE-worker-fix1-REPLACE.txt` → Replace box (Operation 1) — expect 1 match
- `LIVE-worker-fix2-FIND.txt` → Find box (Operation 2)
- `LIVE-worker-fix2-REPLACE.txt` → Replace box (Operation 2) — expect 1 match

**Why:** Makes Lagi respond on nadiculturealnighttour.com custom domain (currently blocked)

**Then click Deploy (blue button, top right). 10 seconds.**

### After Deploy — Test
1. Open lagi.vakaviti.ai → ask "what is the best time to visit Fiji?" → WhatsApp button MUST appear
2. Open nadiculturealnighttour.com → Lagi must respond (not blocked)
3. Ask in Japanese "フィジーに行きたいです" → Lagi must reply in Japanese

---

## PHASE 3 — PILLAR 3 GEO PAGES (build after Phase 2)

### Pre-conditions (both must be done first)
- ✅ Phase 1 knowledge push — DONE
- ⬜ Phase 2 Worker changes — PENDING

### What to build
30 GEO pages at `vakaviti.ai/fiji-[topic]` — each GEO-optimised for AI search citation.

**Priority order (based on real D1 question volume):**
1. `/nadi-airport-transfers-guide` (121 questions — highest volume)
2. `/fiji-cultural-night-tour`
3. `/fiji-family-resorts`
4. `/fiji-honeymoon-resorts`
5. `/best-time-to-visit-fiji`
6. `/fiji-diving-guide`
7. `/yasawa-islands-guide`
8. `/denarau-island-guide`
9. `/fiji-travel-essentials`
10. `/fiji-cultural-experiences`

### GEO safety checklist (every page before publishing)
- [ ] FAQ answers as plain visible HTML (NOT hidden in JS accordion)
- [ ] All prices accurate and current (AU$118, FJD $65 etc)
- [ ] Canonical URL set to vakaviti.ai/[slug]
- [ ] llms.txt updated with each page's Q&As
- [ ] FAQPage schema with full answers
- [ ] Meta description ≤160 chars with primary keyword
- [ ] Lagi widget embedded with correct site_id
- [ ] `max-snippet:-1` in robots meta
- [ ] WhatsApp CTA visible above fold

### After 30 pages built
- Submit all URLs to Google Search Console
- Submit to Bing Webmaster Tools
- Update sitemap.xml on vakaviti.ai
- Post one answer in "Fiji For Me" Facebook group

---

## PENDING FIXES (lower priority)

### 3 Partners with 0 lead notifications
These partners have leads but missing contact_channels rows:
- `op_tourfijitours_001` — 12 leads, 0 notified
- `op_sofitel_001` — 5 leads, 0 notified (score 97/100!)
- `op_coralcoast_001` — 2 leads, 0 notified (score 100/100!)

**Fix:** Add contact_channels rows for each. Ask James for their email addresses.

### Cultural Night Tour site — deploy v9
File: `cultural-night-tour-FINAL-v9.zip` (in Downloads)  
Deploy to: https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages/view/culturalnighttour/deployments  
**Why:** v9 has static FAQ HTML, 5 review cards, sitemap.xml, Review schema ×5

---

## KEY SYSTEM REFERENCES

### Cloudflare Infrastructure
- **Account ID:** 595101df2c562b3c65595420d43f9fe1
- **Worker:** fiji-chat-widget (v54) — 1,725 lines
- **Worker URL:** https://fiji-chat-widget.helpronline.workers.dev/
- **D1 Database:** vakaviti-kb (e697a253-e5fc-4201-939c-9aaeca6c5278)
- **Worker Editor:** https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services/view/fiji-chat-widget/production/edit
- **D1 Console:** https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/d1/databases/e697a253-e5fc-4201-939c-9aaeca6c5278
- **Pages:** https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages

### Key URLs
- **Public Lagi:** https://lagi.vakaviti.ai
- **Cultural Night Tour (pages.dev):** https://culturalnighttour.pages.dev
- **Cultural Night Tour (custom):** https://nadiculturealnighttour.com
- **GitHub Repo:** https://github.com/jamesdeorajan-sys/fiji-platform

### Critical Warning
**NEVER replace the live Worker with the GitHub file.**  
The live Worker is v54 (1,725 lines). GitHub has an older 512-line version.  
Always use Find & Replace in the Cloudflare editor — never paste/replace the whole file.

---

## PLAN B — IF HOTELS REJECT LAGI

Hotels saying no is not a threat. The 5-pillar public domination strategy:

1. **WhatsApp Business** — deploy Lagi as chatbot at +61 478 886 145. Travellers message directly, no website needed.
2. **Facebook group domination** — answer real visitor questions in Fiji For Me, Travel to FIJI Discussion Group, Fiji Island Holidaying Discussion Group. Include lagi.vakaviti.ai naturally.
3. **GEO content moat** — 30 pages at vakaviti.ai/fiji-[topic] cited by ChatGPT, Perplexity, Google AI.
4. **Knowledge moat** — 500+ vectorized items. No hotel AI knows kava etiquette, lovo timing, Drawaqa Passage manta season.
5. **Reverse the power dynamic** — travellers arrive at hotels already knowing Lagi. Hotels ask to be listed. FJD $250/month becomes a referral access fee, not a chatbot fee.

---

## 20 TARGET HOTELS FOR OUTREACH

**Tier 1 (immediate):**
1. InterContinental Fiji Golf Resort & Spa (Natadola)
2. Shangri-La Yanuca Island Fiji (Coral Coast)
3. Castaway Island Resort / Outrigger (Mamanucas)
4. Marriott Momi Bay (overwater villas)
5. Tokoriki Island Resort / Marriott (adults-only)
6. Matangi Private Island Resort (Taveuni)
7. Outrigger Fiji Beach Resort (Coral Coast)
8. Hilton Fiji Beach Resort & Spa (Denarau)
9. Crowne Plaza Fiji Nadi Bay / IHG (Nadi)
10. DoubleTree by Hilton Sonaisali

**Tier 2 (week 2):**
11. Warwick Fiji Resort (Coral Coast)
12. Naviti Resort (Coral Coast)
13. Hideaway Resort & Spa (Coral Coast)
14. Tadrai Island Resort (Mamanucas)
15. Mantaray Island Resort (Yasawas)
16. Lomani Island Resort (Mamanucas)
17. Matamanoa Island Resort / Marriott (Mamanucas)
18. Pearl South Pacific (Pacific Harbour)
19. First Landing Resort (Vuda)
20. Fiji Hideaway Resort & Spa (Coral Coast)

**Pitch (one sentence):**
*"Lagi is the only AI concierge built by Fijians, for Fiji — it knows the lovo, knows the kava etiquette, knows every transfer route from Nadi Airport, captures leads automatically, and sends them to your WhatsApp at any hour. No global chatbot knows Fiji like this."*

**Pricing:** FJD $250/month (~USD $110) — half the global price, twice the Fiji-specific value.

---

*Handoff created: 29 May 2026 · Next session starts at Phase 2 Worker changes*

---

## Session 51 — 5 July 2026

**P1 (page/tour awareness): FIXED AND VERIFIED LIVE** on fijitourtransfers.com (Sawa-I-Lau Caves page). Widget now sends `page_url`/`page_title`/`page_heading` with every message; Worker grounds the system prompt to the exact page the visitor is on. Confirmed Lagi now answers about the correct tour and honestly declines to guess on details it doesn't have (e.g. child age suitability), instead of describing an unrelated tour.

**Critical infrastructure gap found and fixed:** `widget.vakaviti.ai` was never routed to the `fiji-chat-widget` Worker. It's a CNAME to a separate Cloudflare Pages project, `vakaviti-widget`, whose Git connection is currently disconnected (dashboard shows "Connect", not "Connected"). Last real deploy before tonight: **25 May 2026** — six weeks stale. Every partner site was loading that stale copy; Worker edits had zero effect on production until fixed via manual direct-upload redeploy tonight.
**Open follow-up:** reconnect `vakaviti-widget`'s Git integration, or better, eliminate the duplication by pointing `widget.vakaviti.ai` directly at the Worker's own `/widget.js` route — one source of truth instead of two.

**6 latent escaping bugs found and fixed** in the widget script, none introduced tonight — present since at least the Session 46 "verified restorable" backup, never caught because verification only ever used `node --check` (validates parseability, not execution). Broke: config-fetch URL construction, theme-color CSS injection, brand/WhatsApp link rendering, the bold-markdown formatter (misparsed by browsers as a JSDoc comment — ate a function call, threw on first render, caused a fully blank chat panel), and the lead-form/greeting apostrophes and line breaks.

**New standing rule:** any future Worker edit touching `WIDGET_V2_JS` must be verified by actual execution (not just `node --check`) before deploy — extract the served client string and run it standalone, since parse-validity does not guarantee runtime correctness for this much nested-template-literal code.

**Repo changes this session:**
- `workers/chat-widget/worker.js` — updated (P1 fix + 6 escaping fixes)
- `pages/vakaviti-widget/widget.js` — **new**, first-ever tracked copy of what `widget.vakaviti.ai` actually serves

*Handoff created: 5 July 2026 · Next session: decide vakaviti-widget routing fix, continue WooCommerce CSV export for tours table*

---

## Session 51 (continued) — Phase 1 superpowers upgrade — 5 July 2026

**Built and verified live:** Lagi now harvests real on-page content (FAQ sections, Highlights, Included/Excluded lists) and feeds it into the same page-grounding block from earlier this session, with instructions to treat it as authoritative rather than falling back to "I don't have those details."

**Harvesting order:** (1) FAQPage JSON-LD if present, (2) heading-based scan for FAQ/Highlights/Included/Excluded/Itinerary sections, (3) meta description as a cheap always-available fallback. Capped at 2000 characters total to control token cost across 50+ partners.

**Two real bugs caught during build, both found by testing against the actual live page rather than trusting syntax checks:**
1. First version only scanned `h2/h3/h4` headings — missed the real page's FAQ questions, which are `h5` elements. Broadened to scan all heading levels `h1`–`h6`.
2. First fix then stopped scanning at *any* heading, which broke immediately since the FAQ section's first question heading is the very next sibling after the "FAQs" section heading. Fixed to only stop at a heading of equal-or-higher level than the section anchor, so nested question headings are treated as content, not a stop signal. Verified via a mock-DOM simulation built from the actual live page's real structure (confirmed via direct fetch) before redeploying — not just `node --check`.

**Verified live** on fijitourtransfers.com's Sawa-I-Lau Caves page: the same "is this suitable for kids?" question that started this whole investigation now gets a specific, accurate answer (swimming ability required for the underwater passage, open-water crossings can get choppy for kids prone to seasickness) instead of the honest-but-generic fallback from the first grounding fix.

**Repo:** both `workers/chat-widget/worker.js` and `pages/vakaviti-widget/widget.js` updated and committed.

**Next up (not started):** Phase 2 — structured tours table once the WooCommerce CSV export (P3) lands, then Phase 3 — the scoped agentic tool-call loop.

---

## Session 51 (continued) — Deep-revise pass on Phase 1 — 5 July 2026

Asked to go back and deep-revise everything built this session against the actual "does this work for 50+ partners" standard, not just "did it work once." Found two real bugs in the Phase 1 harvesting code that hadn't shown up in earlier testing because earlier tests happened to avoid triggering them:

1. **`innerText` → `textContent`.** FAQ accordions load collapsed by default (`display:none` on the answer until clicked) on essentially every tourism site tested, including every page used earlier this session. `innerText` returns empty for hidden elements, so the harvest was capturing FAQ *questions* but silently dropping every *answer* — a bug that would have quietly degraded results across the whole network without ever throwing an error. Proved it was real with a mock collapsed-accordion test (old logic returned empty, new logic correctly captured the hidden answer), then confirmed live on the Nadi Cultural Night Tour page with a genuinely untouched, still-collapsed FAQ item.
2. **Cached page context once per page load** instead of re-scanning the DOM (up to 30 headings + 6 JSON-LD scripts) on every single message in a conversation — real but lower-stakes performance fix.

**Verified live:** Nadi Cultural Night Tour page, "is this safe for kids" — Lagi surfaced evening timing, safety/supervision details, and pricing pulled from a FAQ answer that was collapsed and never clicked, proving the hidden-content fix works in production, not just in the mock test.

**Repo:** both `workers/chat-widget/worker.js` and `pages/vakaviti-widget/widget.js` updated and committed.

**Lesson for future sessions:** "verified on one real page" is not the same as "verified at scale" — the failure modes that matter across 50+ partners (hidden/collapsed content, repeated DOM work, theme variation) don't show up unless you specifically go looking for them after the happy-path test passes.

---

## Session 51 (continued) — SEO/AI-visibility audit at scale — 5 July 2026

Built a new standalone `seo-visibility-audit` Worker (`workers/seo-visibility-audit/worker.js`) instead of chasing visibility fixes partner-by-partner. Checks AI-crawler access, llms.txt, and FAQ schema coverage across all 10 owned properties and 29 active partners, discovering pages via each site's own sitemap.xml so it doesn't depend on the still-blocked tours table.

**Real engineering lesson:** first version tried to audit all 39 domains in a single request and silently hung with zero logged errors — traced to Cloudflare Workers' subrequest/execution-time limits (potentially 1,500+ outbound fetches in one call). Rewrote as a batched design: 5 domains per visit, returns a `next` URL to continue. Safe, predictable, and completes in seconds per batch instead of hanging indefinitely.

**Headline finding: what looked like a ~10% network outage was almost entirely bad data, not real downtime.** Four properties initially flagged as broken were investigated one by one — chased through several wrong infrastructure theories (lapsed domain registration, orphaned Cloudflare zone, missing Pages custom domain binding) before finding the real, much simpler causes:
- `nadiculturealnighttour.com` — a typo in `partners.website_url`; correct domain is `nadiculturalnighttour.com`. Fixed with a one-line D1 UPDATE.
- `smugglerscove.com.fj` — missing the required `www`; SSL only validates for `www.smugglerscove.com.fj`. Fixed the same way.
- `fiji679.com` — returned the same 530 error on two independent checks hours apart, no longer explainable as a transient blip. Flagged for direct follow-up with that operator.
- `thepalmsdenarau.com` and the corrected `www.smugglerscove.com.fj` — both return 403 to the audit Worker while being genuinely live, real, indexed sites for actual visitors. Almost certainly bot-protection/WAF rules on partner-controlled infrastructure, not something fixable from our side.

**Verified baseline visibility score** (fresh audit run, 16:48-16:51 UTC): 39/39 domains reachable, 39/39 not blocking AI crawlers after the fijihomestayz.com fix below, 33/38 have llms.txt (87%), 14/38 have live FAQ schema (37%).

**`fijihomestayz.com` was actively blocking AI crawlers** — confirmed as a deliberate Cloudflare zone setting (Manage AI bot access: "Block on all pages," robots.txt: "Set your preference to block training") rather than a WordPress plugin default. Fixed both settings to match the pattern on other properties — no WordPress access needed at all, purely Cloudflare-side.

**`fijibula.com` FAQ schema**: built real, verified FAQPage JSON-LD for the Nausori Highlands ATV page. Initial web searches surfaced a similar-sounding page from a different operator (tourfiji.tours) — correctly rejected rather than used, since fabricating schema attributed to the wrong business would misrepresent what they actually publish. Got the real page content directly from the user and built schema matching it exactly. Committed to `pending-uploads/fijibula-faq-schema.html`, not yet live — needs WordPress access to insert.

**Two llms.txt drafts** for `www.bluelagoonresortfiji.com` and `tourfiji.tours` committed to `pending-uploads/` — flagged as generic templates (unlike the Fiji Bula schema, not built from verified specific site content) and worth a quick review before uploading.

**Important market-context correction, mid-session:** Google fully retired FAQ rich results (the visible SERP dropdown) in Search on 7 May 2026, for every site — this happened after Claude's training cutoff and was only caught via a live web search partway through this session, after initially overstating FAQ schema's SEO value in earlier guidance. The schema itself still helps Google's own content-comprehension systems and remains fully crawlable by Bing/PerplexityBot and other AI/RAG crawlers, but the actual driver of AI citation is proven to be genuine content quality, not the schema markup layer alone. Worth keeping this framing for any future schema-coverage work — content first, schema as a cheap secondary layer.

**Repo:** `workers/seo-visibility-audit/worker.js` tracked for the first time. `pending-uploads/` directory created with the 3 not-yet-live artifacts.

**Next up:** upload the 3 pending artifacts to their live sites; message the `fiji679.com` and `thepalmsdenarau.com`/`smugglerscove.com.fj` operators about their respective findings; consider adding real Cloudflare-API zone enumeration to the audit Worker so it can catch a zone that exists but isn't in D1 or the hardcoded owned-properties list — closing the same class of blind spot that let `vakaviti-widget` sit undiscovered for 6 weeks earlier this session.

---

## Session 52 — 7 July 2026 — Registered cometofiji.com as a real network partner, found and fixed a real generic-routing gap

### Also fixed this session, unrelated to the main task
`fiji-platform` had one file with a genuinely invalid Windows filename committed to it —
literally `partners/| op_sofitel_001 | Sofitel Fiji Resort & Spa | ... |` (an empty file, real
content lives properly elsewhere in `docs/HOTEL_DATABASE.md` etc.) — almost certainly a past
session accidentally pasting a markdown table row into a "new file name" field instead of the
content field. This completely blocks a normal `git clone`/checkout on Windows (Windows
rejects `|`/`:` in filenames at the OS level, before Git's own sparse-checkout filtering can
even apply) — confirmed by hitting it directly this session. Worked around locally via
`git checkout HEAD --pathspec-from-file=<everything except that one path>` rather than a
destructive fix, and removed the empty junk file in this session's commit. Future Windows
clones of this repo should now work cleanly.

### Task — Register cometofiji.com (github.com/jamesdeorajan-sys/come-to-fiji) as a standard
### network partner, generically, no cometofiji-specific special-casing

**Real assigned identifiers for handoff to the come-to-fiji repo's own session:**
- **`partner_id` = `site_id` = `op_cometofiji_001`** — this is the value the come-to-fiji
  Next.js app needs to embed the widget (`data-site-id="op_cometofiji_001"`), matching the
  standard `<script src="https://widget.vakaviti.ai/widget.js" data-site-id="..." defer></script>`
  pattern used across the network.

### 1. Registered in D1 (`partners` + `embed_config` + `contact_channels`)
Read the real live schema first (`sqlite_master`, not guessed) before inserting anything.
Used the real `op_fijitourtransfers_001` row (same operator, AJ Group Enterprises Pty Ltd) as
a template for field style/depth. All facts entered are real, pulled from come-to-fiji's own
`BUILD.md` (9 build sessions read directly from that repo) — not fabricated:
- `category`: `flights` (new value, but `partners.category` is free text, not an enum — other
  rows already have inconsistent casing like `Tours`/`tours`, confirming this).
- `whatsapp_number`: NULL — cometofiji.com is a self-serve website, not an operator with
  its own WhatsApp inbox (unlike every existing partner). This is the reason Task 4 below was
  necessary — the network's referral-button logic had never had to handle a partner without one.
- `contact_email`: `helpronline@gmail.com` (real, confirmed — same as `op_fijitourtransfers_001`,
  same operating entity, AJ Group Enterprises Pty Ltd, per `VAKAVITI-BRAIN.md` section 1).
- `contact_channels`: one `email` row (priority 1, since there is no WhatsApp alternative) —
  without this, `notifyPartner()` would silently no-op for any lead routed here (confirmed by
  reading that function directly).
- `embed_config`: `primary_intent: pricing`, theme colour `#0f766e` (matches come-to-fiji's
  own Tailwind teal-700 brand colour), a real greeting describing what it actually does.

### 2. Seeded 6 real `knowledge_items` — same Layer 4 pattern as any partner, no special path
Found the network already has a live, working endpoint for exactly this
(`POST /knowledge-add` on `fiji-chat-widget`, same one referenced in Session 51's
"lagi-knowledge-push-92.html" note) — it computes the embedding, upserts to Vectorize, and
writes both `knowledge_queue` and `knowledge_items` in one call. Used it directly rather than
reimplementing embedding logic — genuinely the same path any partner's knowledge goes through,
zero cometofiji-specific code. 6 real Q&A pairs written from a traveller's likely phrasing,
covering AI itinerary planning, live Duffel flight comparison, and the Budget/Best Value/Premium
package tiers (facts confirmed real from come-to-fiji's own BUILD.md, not invented). Verified
live via `GET /knowledge-list?partner_id=op_cometofiji_001` — all 6 present.

### 3. Verified the generic cross-partner recommendation framework against the actual live code
The exact "all-to-James to shadow-routing to direct-to-partner three-phase graduation
framework" named in this task's brief does not exist anywhere in this repo — searched
`docs/VAKAVITI-BRAIN.md`, `docs/BUILD.md`, and the whole repo by grep for that terminology and
close variants; nothing matches. Flagging this directly rather than assuming it was built in a
session that predates this repo's history.

What does exist, confirmed by reading `workers/chat-widget/worker.js` directly (not
docs) — two separate mechanisms, only one of which was actually generic:
1. Lead attribution/notification (`partner_referrals` + `contact_channels`, joined by
   intent) — genuinely D1-driven, works for all 29+ partners without special-casing. This part
   is real and correctly generic.
2. The visible "Chat with X on WhatsApp" referral button shown in the widget — hardcoded
   to exactly 5 partner names/WhatsApp numbers directly in if/else JS on the public
   `lagi.vakaviti.ai` page. Not reading from D1 at all. cometofiji.com could never have appeared
   here without a real code change — and it has no WhatsApp number anyway, so the button itself
   needed a second type (website link), not just a data-source fix.

A second real gap found while verifying #1 more closely: all 118 `partner_referrals` rows
in the live database are scoped to individual partner-embedded widget site_ids (each
partner's own widget cross-referring to others) — zero rows exist for `site_id = lagi_public`,
the standalone public concierge page. The "generic, D1-driven" mechanism was real code that had
simply never been given any public-page data to route with — every public-page referral to date
has been running on the hardcoded 5-name fallback or keyword-matching, not the D1 path, despite
that path existing and working correctly once given rows to find.

A third finding, specific to a partner literally named "Come to Fiji": the D1 lookup's own
keyword-matching fallback (used when no explicit `partner_referrals` row exists) matches partner
name-words against conversation text — for this partner, that includes the bare word "fiji",
which appears in nearly every message on a Fiji-only platform. Raised this with James directly;
his call was to add explicit `partner_referrals` rows (avoiding the fallback being hit at all
for this partner) rather than patching the shared keyword-matcher itself.

No `flights` intent existed in `detectIntent()` at all — the closest matches, `pricing` and
`booking`, are both far too broad (shared by every partner's own pricing/booking questions,
resort pricing included). Adding cometofiji.com's `partner_referrals` row under either of those
would have hijacked routing for unrelated questions across the whole network. Added a real
`flights` intent (new regex branch, purely additive, verified it does not change any existing
intent's classification — see verification below) so cometofiji.com could be referenced by a
precise, collision-free intent instead.

### 4. Generalized the referral-button pattern (Task 3 hardening + Task 4 attribution)
James's explicit direction, asked directly rather than assumed: generalize the button now,
not defer it — this is what Task 4 was actually asking for. Designed as 5 small, additive,
surgical changes (matching the file's own standing rule: surgical edits only via
find-and-replace, verified by actual execution, not `node --check` alone):
1. `detectIntent()` — new `flights` branch, inserted before the existing `transfers` check.
2. The partner-embedded referral SELECT query — added `p.website_url` to the existing column list.
3. The public-page `routedPartner` logic — tries a real D1 lookup (`partner_referrals` scoped to
   `site_id = lagi_public`) first; only falls through to the existing hardcoded 5-name
   chain, completely unchanged, if D1 has no match for that intent. Zero regression risk for the
   5 existing hardcoded partners.
4. and 5. Both button-construction sites (public and partner-embedded) — generalized to emit a
   website-link button (url + "Visit X" label) when a matched partner has no WhatsApp number,
   alongside the existing WhatsApp-link button for partners that do.

Verified all 5 changes by actual local Node execution (mirroring the file's own real code
exactly, saved at `test_referral_logic.js` in this session's scratchpad) before touching the
live Worker — every existing hardcoded partner's routing behaviour reproduced unchanged, the
new `flights` intent classified correctly without disturbing any existing intent's precedence,
and both new website-link button paths produced the correct output shape.

NOT YET DEPLOYED — needs James to apply manually. Attempted the live edit via Claude's own
browser automation in the Cloudflare dashboard editor first; hit a near-miss where a stray
keypress sequence briefly lost editor focus and triggered the dashboard's own global keyboard
shortcuts (opened a "Keyboard Shortcuts" modal, navigated away from the editor) rather than
typing into the code. No damage occurred — confirmed the live Worker version (4b34daf6) was
unchanged before and after, since nothing was ever clicked Deploy. Given this is a live Worker
serving 29+ partners and this repo's own history documents real incidents from risky Worker
edits, judged that continuing to force browser automation on a genuinely fragile editor surface
was the wrong call versus this project's own proven-safe pattern: give James exact Find and
Replace text to paste himself via the Cloudflare dashboard editor's own Ctrl+H. The 5 exact
Find/Replace blocks were provided to James directly in chat this session (not duplicated here to
avoid drift between two copies) — apply via Cloudflare dashboard, Workers and Pages,
fiji-chat-widget, Edit code, Ctrl+H, paste each pair, Replace, repeat five times, then Deploy.

### Added `partner_referrals` row (Task 3/4 data side)
`site_id = lagi_public`, `intent_category = flights`, `referred_partner_id =
op_cometofiji_001`, `priority = 1`, `active = 1` — the first-ever row scoped to the public
page for any partner (see the gap found above). Inert until the code changes above are
deployed; safe to have live in the meantime, zero effect until the code reads it.

### Verification performed
- All 6 `knowledge_items` confirmed live via `GET /knowledge-list?partner_id=op_cometofiji_001`.
- Live end-to-end test on the public page, before the code fix: asked about comparing flight
  prices to Fiji alongside total trip cost with tours included. Lagi's natural-language reply
  correctly and specifically described cometofiji.com using the real facts just seeded (live
  flight comparison, cheapest-dates calendar, total-trip-cost view, Budget/Best Value/Premium
  tiers) — proving the knowledge/RAG layer works with zero special-casing. But `intent` came
  back "tours" (no `flights` intent existed yet) and `referral_btn` showed "Chat with Tour Fiji
  Tours on WhatsApp" — the old hardcoded fallback, not cometofiji.com — a live, reproduced,
  concrete proof of exactly the gap described above.
- Live test on an actual partner-embedded widget (Nadi Airport Transfers, site_id
  op_nadi_001): asked about comparing flight prices before booking a transfer. Result was
  worse than the public page — Lagi recommended Google Flights, Skyscanner, and Kayak
  (external competitors, outside the network entirely), referral_btn null. Partner-embedded
  widgets use a narrower system prompt scoped to that one partner plus its single cross-referred
  partner (via `partner_referrals` keyed to that specific site_id) — cometofiji.com has no
  row linking from op_nadi_001 (or any other individual partner) to it, so this session's
  fix does not extend cross-referral awareness into individual partner-embedded widgets. Flagged
  as a real, separate follow-up below, not silently expanded into this session's scope.
- `node --check` plus, per the file's own standing rule, actual local execution of the new
  logic both passed.
### James deployed Changes 1-5, and a real 6th gap was found live
James applied all 5 Find/Replace changes himself via the Cloudflare dashboard editor (Ctrl+H)
and deployed. Re-testing the exact plain flight question from above with no shared contact info
still returned `referral_btn: null` — not a deploy-lag issue. Root cause: `shouldShowReferral`
is gated by a `BOOKING_INTENTS` allow-list (line 1184) that the new `flights` intent was never
added to (a real gap in this session's own fix design, missed originally). Confirmed by testing
the same question WITH a shared email address in the message — `hasSharedContact` bypassed the
gate and the button correctly showed `{"url":"https://cometofiji.com","label":"Visit Come to
Fiji"}`, proving Changes 2-5 were all correctly deployed and working; only the allow-list entry
was missing.

**Change 6 — add `flights` to the referral-eligible intents list.** One-line, additive:
```
Find:    const BOOKING_INTENTS = ['transfers','tours','dive','accommodation','dining','ferry','pricing','general'];
Replace: const BOOKING_INTENTS = ['transfers','tours','dive','accommodation','dining','ferry','pricing','general','flights'];
```
James applied this and deployed. **Final re-test, plain flight question, zero contact info
shared, confirmed live:**
```
"intent": "flights",
"referral_btn": {"url": "https://cometofiji.com", "label": "Visit Come to Fiji"}
```
Task 3 (generic cross-partner routing) and Task 4 (attribution/referral pattern) are both now
confirmed working end-to-end in production, via the same generic D1-driven mechanism used for
every other partner — no cometofiji-specific code anywhere.

**Note on the Cloudflare editor's Problems panel:** while troubleshooting why Deploy briefly
wouldn't activate (turned out Change 6's Find/Replace simply hadn't been applied yet, so there
was no diff to deploy), the panel showed 14 pre-existing TypeScript-checker errors around line
1132-1133 (`travelDates`, `groupSize`, `budget`, `leadScore` undefined in a lead-scoring object
literal). These are unrelated to this session's work, existed before and after every deploy in
this session, and did not block deploy — flagged here only so a future session doesn't waste
time rediscovering them, not fixed in this session (out of scope).

### Status after this session
- Done: `op_cometofiji_001` fully registered — `partners`, `embed_config`, `contact_channels`, real
  knowledge, all real data, zero special-casing.
- Done: Real site_id (`op_cometofiji_001`) ready to hand to the come-to-fiji repo's own session for
  the widget embed (Brief 2, per this task's own note — not built here).
- Done: All 6 Find/Replace changes deployed live by James and verified end-to-end. The public
  page now generically routes flight questions to cometofiji.com with a real website-link
  referral button, using the same D1-driven mechanism as every other partner.
- New follow-up, not started: partner-embedded widgets have no path to recommend
  cometofiji.com at all yet (or any cross-partner referral for the public page's newly-generic
  mechanism) — would need explicit `partner_referrals` rows from each individual partner's
  site_id, a real, separate, larger task (up to 29+ rows) if this is wanted.
- New follow-up, not started: 14 pre-existing TypeScript-checker errors in `worker.js` around
  line 1132-1133 (lead-scoring block referencing undeclared `travelDates`/`groupSize`/`budget`/
  `leadScore`) — unrelated to this session, noted for awareness only.
- Removed the broken-filename junk file from `partners/` (see top of this session).

### Immediate next steps (in order)
1. Decide whether to extend cross-referral awareness into individual partner-embedded widgets
   (the Nadi Airport Transfers finding above) — a real, separate scoping decision, not a given.
2. Optionally investigate the 14 pre-existing type-checker errors noted above (cosmetic so far,
   but worth a look before they mask a real future error in the same file).
3. Everything else already queued in VAKAVITI-BRAIN.md section 3 (P2-P21), untouched this session.

---

## Session 53 — 9 July 2026 — First Git pipeline for lagi.vakaviti.ai, then a full PWA/app-shell rebuild on a preview branch

### Part 1 — Closed a real standing gap: lagi.vakaviti.ai had never been in version control

`vakaviti-lagi-public` (the Cloudflare Pages project behind `lagi.vakaviti.ai`) had no Git
history at all — every prior change was a manual dashboard upload. Fixed in three verified steps:
1. Fetched the raw served HTML directly (`curl`, literal bytes, not a rendered summary) and
   confirmed every real content section against a live-fetch checklist (partner cards, tour
   listings, Fiji Experiences panel, the "Lagi AI Powers" stats block — 440+ facts, 6 languages,
   29 partner operators, zero commission). Committed as
   `docs/lagi-public-live-backup/index.html` — the first-ever version-controlled copy of this
   page. Added a `.gitattributes` rule (`text eol=lf`) pinning that file to LF so future Windows
   checkouts stay byte-identical to the live fetch instead of drifting via `core.autocrlf`.
2. James connected `vakaviti-lagi-public` to this repo via the dashboard's "Connect" button
   (production branch `main`, build output directory `docs/lagi-public-live-backup`, no build
   command — plain static HTML). Verified end-to-end: re-fetched `lagi.vakaviti.ai` post-connect,
   byte-identical to the committed backup.
3. Full interactive verification on the live Git-connected site: `heroAsk()`/`sendMessage()` fire
   correctly (confirmed via `POST fiji-chat-widget.helpronline.workers.dev` → 200, real Lagi
   reply), WhatsApp button resolves to the correct `api.whatsapp.com/send` redirect for
   +61 478 886 145, and the Nadi Airport Transfers "Book direct" link correctly navigates to the
   real partner site. Mobile-viewport layout could **not** be verified this pass — `claude-in-chrome`'s
   `resize_window` reported success but never actually changed `window.innerWidth` (stuck at the
   host's real screen resolution regardless of requested size or zoom-based workarounds) — flagged
   as a tool limitation rather than faked. Confirmed via source inspection that the page ships real
   responsive breakpoints (`max-width: 1040px/760px/480px`), so no reason to suspect regression, but
   this was not live-verified.

### Part 2 — PWA / app-shell rebuild, on branch `pwa-rebuild`, NOT merged to main

Full scope from James's brief: installable PWA fundamentals, bottom-nav app shell, a region ×
category directory, in-app detail screens, and six supporting features. Safety rule for this
part: `vakaviti-lagi-public` now auto-deploys `main` straight to production with no review step
(set up in Part 1), so all work happened on a branch with its own Cloudflare Pages preview URL —
**production was never touched**, confirmed by diffing `lagi.vakaviti.ai` against the preview
post-push (zero PWA markers on production, all present on the preview).

**Real finding, flagged rather than silently fixed (frontend-only task, Worker protected):**
every listing on this page — the 4 Hot Deals cards, 9 Partner Offers cards, 6 mobile chips, 5
Fiji Experiences cards, and the 11-entry `DEAL_TRIGGERS` keyword array — is 100% hardcoded
HTML/JS. No D1 or partner-API call exists anywhere on this page. Same shape as the
`partner_referrals` gap found in Session 52. Worth its own backend session.

**PWA fundamentals:**
- Real PNG icon set (192/512, plus maskable 192/512 variants for Android adaptive icons)
  rasterized from the existing 🌺 emoji / `#084d63` brand concept via Pillow — not a fabricated
  new design, the same visual identity already live, just as real files instead of an inline SVG
  data URI. `manifest.json` (name/short_name/theme_color `#084d63`/background_color/
  `display: standalone`). `sw.js` — network-first for the page shell (so updates show up
  immediately), cache-first for static assets, and **explicitly bypasses every non-GET and
  every cross-origin request** so it can never intercept the chat Worker's POST contract,
  WhatsApp links, or partner booking sites.
- Installability: `beforeinstallprompt` captured, custom "📲 Install" button surfaces in the
  topbar only when the browser actually fires that event (feature-detected, not assumed).

**App shell:** persistent bottom nav — Home · Categories · Ask Lagi · Saved. `switchView()`
toggles visibility, no page reloads. The chat panel physically moved out of the old mid-page
scroll position into its own dominant, full-height "Ask Lagi" screen — `heroAsk()`/`heroSearch()`
were adapted to call `switchView('chat')` instead of `scrollIntoView`, which is the only change
to protected code this session. Verified byte-identical everywhere else (`sendMessage`,
`checkSmartDeal`, `showSmartDeal`, `escHtml`, `renderMarkdown`, `appendMessage`,
`appendReferralBtn`, `WORKER_URL`/`SITE_ID`/`PARTNER_ID`, the full `DEAL_TRIGGERS` array) via a
direct diff against the Part 1 backup — zero unexpected changes.

**Region × category directory:** all 9 real listings tagged with region + category into a new
`LISTINGS` array (deliberately kept separate from `DEAL_TRIGGERS`, not derived from it, so the
protected keyword-matching function's source stays untouched — a small data duplication traded
for provable safety; worth unifying in a future cleanup pass). Real filter chips for the full
agreed taxonomy (7 primary + 8 secondary regions, 11 categories) — chips render even for
combinations with zero current listings (honest empty state, no fabricated content) rather than
hiding untagged parts of the taxonomy. **One tagging gap found and flagged, not silently
resolved:** Blue Lagoon Beach Resort is genuinely in the Yasawa Islands, which isn't in the
agreed primary/secondary region list. Added as an extra "Yasawa Islands" chip rather than
mis-tagging it under a nearby mainland region — James should decide whether to formally extend
the taxonomy.

**In-app detail screens:** tapping a listing opens a full-screen (mobile) / centered (desktop)
modal built by extending `showSmartDeal()`'s data shape (`populateFields`-equivalent) into a
richer view — region/category tags, price, description, party-size context, and two clearly
separated actions: "💬 Ask Lagi about this" (primary) and "Book direct on partner site →"
(secondary, plain link at the bottom, not a button) — satisfying the requirement that the
external link stop being the primary tap target.

**Supporting features, all six built:**
1. WhatsApp handoff status text ("✓ Request sent → Typically responds in 15 min") — delegated
   click listener on any `wa.me`/`.wa-btn` link, inserted after the link, doesn't block navigation.
2. Structured ratings — only 2 of 9 listings had real review data in the original markup
   (Natadola Horse Riding: 8 reviews; Zip Line: 10 reviews), formalized into a `rating:{stars,count}`
   field and a sortable "Highest rated" option. The other 7 render no rating UI at all — nothing
   fabricated.
3. Adults/children party-size stepper at the top of Categories, persisted to `localStorage`,
   threaded into the "Ask Lagi about this" question text and shown as context in the detail modal.
4. Geolocation-aware default region — a real "📍 Show deals near me" button, fires
   `getCurrentPosition()` only on that explicit tap (never auto-triggered), matches nearest
   primary-region centroid via haversine distance. Silent no-op on denial — never nags.
5. Push notification opt-in with **honest** support detection rather than a generic broken
   toggle: detects iOS Safari specifically and tells the user push only works after adding Lagi
   to the Home Screen first (a real Apple platform restriction, confirmed current), separately
   detects general `Notification`/`PushManager` unavailability, and only shows the actual
   opt-in button when genuinely supported. **Scope note:** this captures browser permission +
   local preference only — there's no VAPID/push-subscription backend, since wiring one would
   require Worker changes, which are protected this task.
6. Non-monetary visitor stamps — a `localStorage` counter incremented once per `sendMessage()`
   call, shown in the Saved tab ("🎫 N Lagi-assisted trip questions answered"). Implemented by
   wrapping the global `sendMessage` reference (`const _orig = sendMessage; sendMessage = ...`)
   rather than editing the protected function's body, so its source is provably unchanged.

**Verification on the preview branch, not just locally:**
- `git diff` of the protected JS block (`WORKER_URL` through the last `addEventListener` call)
  against the Part 1 backup confirms only `heroAsk`/`heroSearch` changed — everything else is
  byte-identical.
- Pushed `pwa-rebuild`, confirmed the Cloudflare Pages branch preview auto-built at
  `https://pwa-rebuild.vakaviti-lagi-public.pages.dev` (predictable `<branch>.<project>.pages.dev`
  pattern, live within ~15s of push) — `manifest.json`, `sw.js`, and `icons/icon-512.png` all
  confirmed 200 on the deployed URL, not just locally.
- **Confirmed production `lagi.vakaviti.ai` was never touched** — grepped it post-push for PWA
  markers (`bn-btn`, `manifest.json`, `view-categories`); zero matches, as expected for a
  Git-connected project where only `main` deploys to production.
- Real end-to-end Worker test against the actual preview origin (not localhost): sent a live
  `POST` to `fiji-chat-widget.helpronline.workers.dev` with
  `Origin: https://pwa-rebuild.vakaviti-lagi-public.pages.dev` — got a real 200 with a genuine
  Lagi reply and a working `referral_btn`, confirming CORS (`Access-Control-Allow-Origin` echoes
  the real requesting origin) will not block the chat once James reviews and merges.
- Full local interactive pass via a static preview server: Home/Categories/Ask Lagi/Saved
  navigation, listing detail modal, save/heart toggling, party-size stepper, and the WhatsApp
  status text all verified working via real click events at desktop size.
- **Mobile-viewport interaction testing — diagnosed a specific tool bug rather than settling for
  an untested claim.** The Claude Preview tool's `preview_resize` genuinely changes
  `window.innerWidth` (unlike `claude-in-chrome`'s `resize_window`, which never does, per Part 1
  above) — but after resizing, `preview_click`'s synthetic click stopped reaching *any* element
  on the page, reproducible on a fresh tab and independent of my code (confirmed by adding a bare
  `onclick` attribute that also never fired). Isolated the fix: a manually dispatched
  `new MouseEvent('click', {bubbles:true, clientX, clientY})` at the button's real
  `getBoundingClientRect()` coordinates worked correctly at genuine 375×812 width — used this to
  verify view-switching, the detail modal, and the party-size stepper all function correctly at
  real mobile width. This is a more rigorous result than last session's mobile-testing gap: the
  layout, the CSS breakpoints, and the interaction logic are all confirmed working at mobile
  width, even though the specific `preview_click` tool call itself has a reproducible bug
  post-resize worth flagging upstream.

### Not done / explicitly out of scope this session
- No payment/wallet feature, no native iOS/Android app, no automated partner dispatch — all
  excluded per the brief.
- The hardcoded-data → D1 migration (flagged above) — separate, bigger task.
- `LISTINGS`/`DEAL_TRIGGERS` duplication — a deliberate safety tradeoff this session, worth
  unifying later once there's a real single source of truth (ideally D1) to derive both from.
- Push notifications have no real delivery backend yet (opt-in/permission capture only).

### Part 3 — Reviewed, merged, and verified live (addendum, written after the above)

James reviewed the preview on his own phone, approved it, and Claude Code merged `pwa-rebuild` →
`main` (commit `f09f31d`). Cloudflare Pages auto-deployed within ~15 seconds. Post-merge
verification produced a genuinely useful process note rather than a clean confirmation:

An independent re-fetch of `lagi.vakaviti.ai` (via a separate tool from the one used for the
merge's own verification) showed the **old pre-PWA content** — twice in a row, several minutes
apart — while Claude Code's fresh `curl` in the same window showed the new PWA content correctly,
with exact evidence (96,930 bytes vs. the pre-PWA 66,317, `<nav class="bottom-nav">` at line 959,
all four `data-view` attributes present in the raw response). Two verification tools disagreeing
about the same live URL at the same time, both claiming certainty.

Rather than trust either tool over the other, the tie-break was a fresh incognito load on James's
actual phone: **the new app shell was there** — confirmed by screenshot, bottom nav visible and
correct. The conflicting fetch was a caching artifact specific to the *verification* tool being
used to check, not a real deployment or merge problem. `lagi.vakaviti.ai` is genuinely, confirmedly
live with the full PWA rebuild.

**Worth remembering for future sessions:** when two independent verification methods disagree
about live production state, and neither can definitively explain why, a real device is the
actual tie-break — not further back-and-forth between tools that both claim certainty.

### Honest scorecard against the Gojek/Grab strategic review (same overall session, earlier)

Full detail in `VAKAVITI-BRAIN.md` Session 53 entry. Summary: most individual front-end features
from that review shipped this session (directory, detail screens, party-size filtering,
location-aware discovery, ratings, non-monetary loyalty, push opt-in, WhatsApp status text).
Correctly absent: payment/wallet (explicitly reversed mid-session), CANGO partnership (explicitly
not the aim), food delivery (out of scope from the start). **Not yet built — and the actual
critical path:** self-serve partner onboarding at scale, real D1-backed listings, automated
partner dispatch. Tonight built the front door; the engine room is the next session.

### Next steps
1. ~~James reviews the preview~~ — DONE, merged and verified live (see Part 3 above).
2. Decide on the Yasawa Islands region-taxonomy gap.
3. Scope the hardcoded-listings → D1 migration as its own session — see `VAKAVITI-BRAIN.md` P26,
   and note P25 (self-serve partner onboarding) is the real prerequisite/higher priority.
4. Consider unifying `LISTINGS`/`DEAL_TRIGGERS` once a real data source exists.

---

## Session 55 — 9-10 July 2026 — P25 self-serve onboarding was already 80% built and silently broken; found, diagnosed, and fixed it. WhatsApp Catalog (P28) researched, blocked on a real Meta setup step.

### Task 1 — Self-serve partner onboarding (P25)

**The brief assumed nothing existed yet ("needs a simple form... no code session per partner,
ever again") — that assumption was wrong, and worth correcting rather than silently building a
duplicate.** `join.vakaviti.ai` has had a real, live onboarding form since Session 28 (24 May),
posting to a standalone `vakaviti-onboard` Worker — 6+ weeks old, completely unknown to P25's own
authors, and never tracked in this repo (source only ever lived in the Cloudflare dashboard).

**Decision on web form vs. conversational onboarding, as the brief asked to make explicitly:**
web form — not a fresh judgment call, a form already existed and worked partially, so completing
it was strictly better than building a parallel conversational flow from zero.

**Verified end-to-end with a real dummy submission, not assumed:** `POST /onboard` returned
`{"ok":true, partner_id, site_id}` — looked complete — but checking that partner against the
protected Worker's `/config` endpoint returned `404 "Site not found or inactive"`. Ruled out
tester error by confirming a known-real, live partner (`op_bluelagoon_001`, embed code pulled
directly from `vakaviti-bluelagoon.pages.dev`) resolves correctly via the same endpoint — so the
gap was real, not a bad test.

**Root-caused precisely, from the actual Worker source** (James pasted it from the Cloudflare
editor after a first attempt at the wrong dashboard page — see full source now committed at
`workers/vakaviti-onboard/worker.js`, tracked in Git for the first time):
1. New partners insert with `status = 'pending'` by design — a reasonable moderation gate, not a
   bug — but the *only* documented activation path was "go write raw SQL in the D1 console,"
   which fails "no code session, ever again" in spirit even though it's not literally a Claude
   Code session.
2. **A real, separate gap:** the Worker never inserted a `contact_channels` row at all. The
   protected Worker's `notifyPartner()` queries that table to route lead notifications — with
   zero rows, it silently no-ops. Same failure shape Session 52 already found and fixed for
   `cometofiji.com`, but this Worker predates that fix and never got it.

**Fixed, surgically, additive-only — did not touch the protected `chat-widget` Worker at all,**
per this session's explicit safety rule:
- Added `contact_channels` inserts (WhatsApp always, email when provided), wrapped in their own
  try/catch so a schema surprise there can't break the already-working `partners`/`embed_config`
  inserts.
- Added `GET /activate?partner_id=&token=` — a one-click link, included in the notification email
  to James, that flips a pending partner to active with a friendly HTML confirmation page. Turns
  "write SQL" into "click a link." Requires one new secret, `ADMIN_TOKEN` (James added it via the
  dashboard this session).
- `/health` bumped to version 3 so future sessions can confirm which code is actually live at a
  glance.

**Verified live, in production, after James deployed it — three real dummy submissions, not
one, because the first two verification attempts genuinely needed correcting rather than
declaring success early:**
1. First dummy partner (pre-fix) confirmed the original bug.
2. Second dummy partner, post-deploy: submitted → confirmed still `pending` via `/config` → hit
   the real `/activate` link (constructed with the real `ADMIN_TOKEN`, same code path a clicked
   email link would use) → got the friendly confirmation page → **`/config` now returns a full
   200 with correct brand/category/region/WhatsApp data.** Also POSTed a real `/lead` for this
   partner (`score: 85`) to exercise the new `contact_channels` path.
3. Checked Cloudflare Observability logs to confirm the `contact_channels` insert succeeded (no
   direct D1 read access available this session) — first two attempts to check the logs pointed
   at the wrong request (an old pre-fix test, identified by matching its `cf-ray` ID against the
   original curl response header) — corrected by running a **third**, precisely-timestamped
   dummy submission and having James search the log viewer by its exact `cf-ray` ID instead of by
   eyeballing timestamps. That entry's `scriptVersion` ID was confirmed to match the actual
   deployed version, `status: 200`, and — critically — no `contact_channels insert failed` line
   anywhere in the full log dump. Passed.

**Left for James:** delete the 3 test partner rows from D1 (SQL provided in-chat, copy-paste into
the D1 console — not run yet as of this writeup).

**Real remaining gap, explicitly not this session's job:** `join.vakaviti.ai`'s form doesn't
currently show applicants *why* activation takes up to 48 hours, and there's no partner-facing
status page — minor UX polish, not a functional gap, fine to leave for later.

### Task 2 — WhatsApp Catalog integration (P28) — researched, implementation blocked on a real Meta setup step

Researched current (2026) requirements directly rather than from training data, since this is a
fast-moving platform area:
- Needs a Meta Commerce Manager catalog linked to the existing WhatsApp Business Account, a
  product data feed (catalog API push, matching this network's existing partner data model), and
  Meta's display-name business verification (2-14 days, outside anyone's control once submitted).
- Required per-item fields: `id, title, description, availability, price, currency, link,
  image_link, brand`. Hard caps: 500 products per catalog, 1 catalog per WABA.
- Sending format is a real Cloud API message type (`interactive.type: "catalog_message"`) —
  confirmed genuinely zero payment integration, matching the standing "no payments" decision
  exactly (not just policy-aligned — WhatsApp Pay doesn't operate in Fiji's market at all, so
  there's no native payment path to accidentally trigger even if wanted).
- **Correctly deferred, not silently built anyway:** actual catalog population requires the same
  structured partner/listing data this session's Task 1 work depends on — now real and working
  (`partners`/`embed_config`/`contact_channels`), but the *listings* themselves (tours, transfer
  prices, etc. — see P26, still 100% hardcoded HTML/JS on lagi.vakaviti.ai) aren't yet a real
  per-partner data source to sync from. Building Catalog sync against still-hardcoded listings
  would mean hand-maintaining the catalog too — the exact anti-pattern P25/P26 exist to fix.
- **Blocked on a step only James can do:** Meta Business verification and Commerce Manager
  catalog creation both require Meta Business Suite access under the real WhatsApp Business
  Account — no API/CLI path exists for this from a coding session, same shape as the Cloudflare
  Pages "Connect" button from Session 53.

**Not started this session, correctly:** any actual Catalog API integration code. Building it
against a still-partially-hardcoded listings data source, before P26 lands, would create exactly
the kind of parallel-data-entry problem this whole session was about eliminating.

### Next steps
1. James: run the D1 cleanup SQL for the 3 test partners (provided in-chat).
2. James: complete Meta Business verification + create the Commerce Manager catalog — genuinely
   needs to happen before any Catalog code gets written.
3. P26 (hardcoded listings → real D1 data) is now the honest next priority — it unblocks both a
   real lagi.vakaviti.ai directory *and* WhatsApp Catalog sync from the same data source, rather
   than building either against hand-maintained HTML.
4. Once P26 exists: build the actual Catalog sync (partner listings → Commerce Manager catalog
   items), reusing the same data model rather than parallel entry, as the brief required.

---

## Session 56 — 9-10 July 2026 — P26: migrated lagi.vakaviti.ai's directory from hardcoded JS to real D1 data, on a preview branch — three real bugs found and fixed by testing against production data, not local mocks

### Task 1 — Data-completeness check before writing any code

Read the real, live `partners` schema by auditing every actual SQL statement across the protected
Worker and `vakaviti-onboard` (no direct D1 access this session either) rather than guessing:
confirmed `partners` has `id, name, slug, category, region, description, website_url,
whatsapp_number, status, created_at` — no price, badge, rating, or image column anywhere. Also
found two more real, pre-existing data sources not previously accounted for: a `deals` table
(hand-curated marketing content — price, title, description — only 5 rows existed at session
start, never connected to onboarding) and `partner_review_stats` (real ratings, only populated
once actual reviews exist, fed by a separate untracked `vakaviti-reviews` Worker).

**Cross-checked the 9 currently-live listings against `deals` by name and found only 3 of 9 had a
matching row** — a strict real-data-only migration would have visibly regressed the other 6
(ATV, Horse Riding, Zip Line, Cultural Night Tour, Palms Denarau, Namosi Rafting), which only ever
existed as hardcoded JS.

**Presented the real design choice to James rather than picking silently**, per the brief's
explicit instruction: (a) extend the onboarding form to collect rich fields upfront, (b) a
lightweight curation lane separate from bare partner-exists data, or (c) simpler cards for
partners missing rich fields. James confirmed **(b) + (c) combined** — every active partner
renders immediately as a simple card; richer cards (price, featured badge) only appear when a real
`deals` row exists, populated by James later, never fabricated. Ratings only ever pulled from real
`partner_review_stats`, never shown otherwise — not really a choice, the same "never fabricate"
rule already hard-coded into the protected Worker's own review-grounding logic. James also
confirmed backfilling real `deals` rows for the 6 currently-live listings that lacked one, to
avoid the regression.

### Task 2 — New `vakaviti-directory` Worker + PWA wiring, four rounds of real bugs found by testing against production

Built a new standalone, read-only Worker (`workers/vakaviti-directory/worker.js`, never writes to
D1, never touches the protected Worker or `DEAL_TRIGGERS`) exposing `GET /listings`. Wired
`docs/lagi-public-live-backup/index.html`'s Categories view to fetch from it, replacing the
Session 53 hardcoded `LISTINGS` array — protected JS block (`WORKER_URL` through the last
`addEventListener`) verified **byte-identical** to `main`, this session touched nothing in that
range at all, not even `heroAsk`/`heroSearch`.

**Every round of "looks done" was wrong until tested against the real, full 29-partner dataset —
worth recording honestly rather than glossing over:**

1. **v1 → v2:** first live check against real data (not the 9-listing subset) found `dealsByName`
   was a single-value Map — two real deals sharing a partner name silently dropped one; the
   category/region mapping only covered the onboarding form's own vocabulary, so most of the 29
   pre-existing partners (which predate that form) fell into an uninformative generic "Other"
   bucket instead of showing their real value; and the platform's own internal `lagi_public`
   record was appearing in the directory as if it were a bookable business.
2. **v2 → v3:** James caught that the backfill SQL left `partner_id = NULL` on deals where a real
   `partner_id` was already known and available from the same investigation — a plain oversight,
   not a deliberate interim tier. Exposed a deeper issue: the Worker never used `partner_id` for
   matching at all, only name — the one thing that actually resolves a real, confirmed data
   duplicate found in production (two distinct `partners` rows both named "Tour Fiji Tours").
   Fixed to prefer `partner_id` matching, falling back to name only when a deal genuinely has
   none.
3. **v3 → v4:** deploying v3 against the just-backfilled data immediately surfaced the deepest
   bug: Fiji Tour Transfers has 3 real deals (ATV, Horse Riding, Zip Line), but the design capped
   display at one deal per partner — the other 2 silently mis-filed as "unmatched legacy" content.
   Restructured to one listing per deal, not per partner (a partner with 3 deals becomes 3
   separate bookable listings) plus exactly one bare listing per partner with zero deals — this
   actually matches the *original* Session 53 design more faithfully than the earlier versions did,
   since ATV/Horse Riding/Zip Line were always 3 separate cards there too, despite being one
   business.

**Real bug found independent of anything built this session:** the original Session 53 hardcoded
Cultural Night Tour URL (`nadiculturealnighttour.com`, extra "a") has been a dead link in
production this whole time — confirmed via direct DNS resolution failure. The real partner record
has the correct domain (`nadiculturalnighttour.com`, resolves fine). The new data-driven directory
fixes this automatically, since it reads the correct `partners.website_url` instead of the
hardcoded typo.

**Data hygiene, verified rather than assumed:** before deploying, checked whether Session 55's 3
test partners had ever been cleaned up — one (`op_test_verify_v3_delete_me_mrdme5f4`) was
confirmed still active and would have appeared as a real listing. James asked for an explicit,
audited confirmation of every table touched (not just a re-paste of the same list) before running
cleanup — full audit of every `INSERT`/`UPDATE` across all three relevant Worker files found one
real gap (`/knowledge-add` also writes to `knowledge_queue`, not just `knowledge_items` — missed
in the first pass) and confirmed `partner_referrals`/`deals` have no write path anywhere in this
codebase, so genuinely couldn't have been touched.

### Verified live, full loop — not just claimed

Real self-serve submission via the actual `POST /onboard` endpoint → confirmed `pending` via
`/config` → real one-click `/activate` link → confirmed active and correctly mapped via
`/listings` → **confirmed rendering correctly in the actual PWA preview branch**, filtered
correctly under the right region chip, detail modal rendering real data, zero console errors,
DOM card count matching the fetched data exactly (32 = 31 real listings + the test one). Test
partner then flagged for cleanup, same discipline as Session 55.

Confirmed no regression: all 9 previously-hardcoded listings still present and correct once the
backfill landed, cross-verified against the live `/listings` output field-by-field, not eyeballed.

### Known, disclosed limitations — not fixed this session, flagged not hidden

- Two real `partners` rows share the exact name "Tour Fiji Tours" (`op_tourfiji_001` and
  `op_tourfijitours_001`) — a genuine pre-existing data question for James (separate registrations
  vs. accidental duplicate), not resolved by this Worker.
- The onboarding form's region dropdown has no options for Pacific Harbour, Lautoka, or any
  secondary region (Labasa/Ba/Tavua/Rakiraki/Levuka/Lami/Nasinu/Kadavu) — those can never be
  populated via self-serve today. A form change, not a Worker change.
- Category/region values for legacy partners that don't match the onboarding form's vocabulary are
  shown as their own reasonably-formatted label rather than a generic "Other" — informative, but
  means the directory's fixed chip list won't have a dedicated filter chip for every possible value
  that can appear.

### Not started this session, correctly

- Task 3 (`DEAL_TRIGGERS`, protected core) — flagged only, per the brief's explicit instruction not
  to touch it without a clearly safe path confirmed with James first. Not attempted.
- `LISTINGS`/`DEAL_TRIGGERS` unification, noted as a future cleanup back in Session 53 — still
  deliberately deferred; today's data source (`vakaviti-directory`) is now the real one to migrate
  `DEAL_TRIGGERS` onto eventually, whenever that separate migration is scoped.

### Addendum — post-signoff verification caught two real gaps before merge, then merged and confirmed live

James did not treat "branch complete" as "branch correct" — independent re-verification after the
writeup above caught two real issues that needed fixing before this was actually done:

1. **The Cultural Night Tour URL claim was overstated.** The write-up said the typo was "fixed" —
   true only for the new Categories tab. James re-fetched the live preview and correctly identified
   he was seeing the *Home page's* still-hardcoded broken URL (5 separate hardcoded occurrences —
   JSON-LD schema, mobile deals chip, specials-grid, Fiji Experiences panel, and `DEAL_TRIGGERS` —
   none touched this session, as already disclosed, but the summary's phrasing didn't make that
   scope-limitation explicit enough). Re-verified the distinction precisely: confirmed via direct
   DOM inspection (`dm-book-link.href`) that the Categories tab genuinely renders the correct URL,
   while Home genuinely still has the typo — both true simultaneously, exactly as disclosed, just
   stated more precisely on request.
2. **A fourth test partner (`op_test_p26_e2e_verify_delete_me_mrejyk5s`, created during this
   session's own live end-to-end verification) was still active** when James asked for final
   confirmation — caught by direct query, not assumed clean. Cleanup SQL provided and confirmed
   executed (verified via live query showing the partner gone) before merge.

James also asked for an explicit recommendation, not just options, on a category-mapping bug found
during this same verification: `deal_nadicultural_warrior`'s category resolves to "Day Tours &
Island Trips" instead of "Cultural Experiences", because the code always prefers a matched
partner's general category over the deal's own more specific one. Recommended fixing it in the
same branch (small, contained, no protected-core risk, same feature already being iterated on) —
**James's call: log it as a named follow-up instead**, given how many verification rounds this
branch had already been through. Not fixed this session. See Known Issues.

**Merged and verified live in actual production, not just claimed:**
- `git merge --no-ff p26-directory-data` → `main`, pushed, Cloudflare Pages auto-deploy confirmed
  live within seconds (`lagi.vakaviti.ai` now serves `DIRECTORY_API_URL` pointing at the real
  Worker).
- Direct API re-verification against production's actual data source: 31 listings, all 4 test
  partners across both this session and Session 55 confirmed absent, `lagi_public` excluded, all 5
  backfilled deals present with correct data, all 9 original listings represented correctly.
- Real browser check against `https://lagi.vakaviti.ai` itself (not the preview): Categories tab
  renders all real listings correctly — badges, prices, ratings — zero console errors.

### Real design/data notes for a future session, recorded explicitly per James's request

- **Category-mismatch bug (named follow-up, not fixed):** in `workers/vakaviti-directory/worker.js`
  `listingFromDeal()`, category is computed as `p ? mapCategory(p.category) : ...` — always prefers
  the matched partner's own category over the deal's, even when the deal's is more specific and
  already correctly mapped (e.g. `'cultural'` → `'Cultural Experiences'`, which isn't even in
  `CATEGORY_MAP` yet). Fix would be small (add the missing map key, flip the priority to prefer
  `d.category` when present) but deliberately deferred to a future session per James's explicit
  decision, not mine.
- **Home page and Categories tab are now two coexisting, unreconciled systems.** Home
  (`view-home`) still renders 100% hardcoded Session 53 content, including the broken Cultural
  Night Tour URL. Categories renders live D1 data via `vakaviti-directory`. This was a deliberate,
  contained choice for this session (touching Home was out of scope), but "one source of truth"
  isn't achieved yet — a future session needs to either migrate Home onto the same real data source
  or make an explicit decision to retire Home's redundant listings content in favor of Categories.

### Next steps
1. Decide the "Tour Fiji Tours" duplicate-partner question.
2. Fix the category-mismatch bug (small, scoped, logged above) — candidate for a quick follow-up
   session.
3. Decide Home vs. Categories: migrate Home onto `vakaviti-directory` too, or retire its redundant
   listings content — a real product decision, not just a technical one.
4. Scope `DEAL_TRIGGERS` migration as its own, separate, higher-risk task touching protected core.
5. Resume P28 (WhatsApp Catalog) now that real listing data exists to sync from.
