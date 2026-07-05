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
