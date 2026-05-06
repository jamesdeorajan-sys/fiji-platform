# Vakaviti — Free Fijian Dictionary

Source files for **vosavakaviti.com** (also accessible at `vakavitifijiandictionary.pages.dev`).

## What it is

A free Fijian language learning app, built as a sister-brand project from Fiji Tour Transfers. 160-word dictionary with quizzes, XP system, spaced repetition, and prize tiers tied to FTT discounts.

Built originally in Perplexity, sophisticated under the hood (SM-2 spaced repetition, gamified tier system, dynamic sponsor rotation).

## What's here

`src/` — all 16 files of the live application.

### Core files
- `index.html` — main page (footer discloses "from Fiji Tour Transfers")
- `style.css` — all styling
- `app.js` — main app logic
- `words.js` — the 160-word dictionary data

### Learning mechanics
- `quiz.js` — quiz mode (English↔Fijian, configurable rounds)
- `drill.js` — flashcard mode with SM-2 spaced repetition
- `phonetics.js` — phonetics practice (separate skill)

### Gamification
- `xp.js` — XP/tier tracking (Vulagi → Tamata → Cauravou → Matai → Turaga)
- `dashboard.js` — progress dashboard
- `streak.js` — daily streak tracking
- `pb.js` — personal bests
- `rankcard.js` — shareable rank cards

### Other
- `guide.js` — in-app guide/tutorial
- `sponsors.js` — dynamic sponsor display (currently shows Taki Mai Resort, FTT)
- `sponsor-admin.html` — separate admin page for managing sponsors

### Cross-brand
- `chat-widget.js` — same chat widget used on FTT, scoped to Vakaviti origin

## Current version

**v1.1** deployed 5 May 2026.

Changes from v1.0 (the originally-built version):
- Added `chat-widget.js` script tag in `index.html`
- Updated guide CTA to disclose Vakaviti as a Fiji Tour Transfers project (was framed as third-party sponsorship)
- Updated footer to attribute Vakaviti to Fiji Tour Transfers

The exact zip uploaded is preserved in `../archives/vakaviti-v1.1-20260505.zip`.

## How to deploy

1. Make changes in `src/`
2. Zip up the contents of `src/` (NOT the `src/` folder itself)
3. Upload to Cloudflare Pages → `vakavitifijiandictionary` project → Create deployment
4. Verify at both `https://vosavakaviti.com` AND `https://vakavitifijiandictionary.pages.dev`

## Known issues

- **Browser TTS audio is the biggest credibility issue.** Vakaviti currently uses the browser's text-to-speech to pronounce Fijian words, which sounds like an English-accented computer reading Fijian. The fix is real native-speaker recordings of all 160 words (the credibility unlock).
- **No `sitemap.xml`** — single-page app, but a sitemap helps Google understand `https://vosavakaviti.com/` is the canonical URL.
- **Prize T&Cs page does not exist.** Australian Consumer Law treats prize claims seriously. A `/terms` page with explicit redemption rules is needed before promoting the prize tiers publicly.
- **Sponsor data flows are not in this repo.** `sponsors.js` reads from somewhere (likely localStorage or a hardcoded array) — needs documentation.
