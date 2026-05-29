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
