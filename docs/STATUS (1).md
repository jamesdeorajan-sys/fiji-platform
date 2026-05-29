# Vakaviti.ai — Platform Status
**Last updated:** 30 May 2026 — Session 32  
**Worker:** fiji-chat-widget v54 (1,725 lines)  
**Session start ritual:** Fetch this file + query D1 `SELECT * FROM build_log WHERE status='pending' ORDER BY id DESC`

---

## Session Start Command (paste every new session)
```
Bula — new session. Fetch https://raw.githubusercontent.com/jamesdeorajan-sys/fiji-platform/main/docs/STATUS.md and query D1 build_log (e697a253-e5fc-4201-939c-9aaeca6c5278) WHERE status='pending'. Brief me instantly.
```

---

## Live System References

| System | URL |
|---|---|
| Worker editor | https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/workers/services/view/fiji-chat-widget/production/edit |
| D1 database | https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/d1/databases/e697a253-e5fc-4201-939c-9aaeca6c5278 |
| Cloudflare Pages | https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages |
| GitHub repo | https://github.com/jamesdeorajan-sys/fiji-platform |
| Lagi public | https://lagi.vakaviti.ai |
| Partner dashboard | https://dashboard.vakaviti.ai |
| Cultural Night Tour Pages | https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages/view/culturalnighttour/deployments |
| nadiairporttransfers Pages | https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages/view/nadiairporttransfers/deployments |

---

## ⚠ CRITICAL WORKER RULE
**NEVER replace the live Worker with any file from Desktop or GitHub.**  
Live Worker = v54, 1,725 lines.  
TOOLS\worker.js and TOOLS\fiji-chat-worker-v4.js are OLD — never deploy these.  
GitHub workers/chat-widget/worker.js = old 512-line version — never deploy this.  
**Always use Find & Replace in Cloudflare editor only.**

---

## Current Platform State (confirmed 30 May 2026)

| Item | Value | Status |
|---|---|---|
| Worker version | v54 — 1,725 lines | Live |
| Vectorize vectors | 251 live (92 superseded) | Live |
| Active partners | 29 | Live |
| Contact channels | 29/29 covered | Fixed 30 May |
| Knowledge intent NULLs | 0 remaining | Fixed 30 May |
| Nadi WhatsApp number | 6796369435 in D1 | Fixed 30 May |
| Referral rows | 118 active | Live |
| Total leads | 61 | Live |
| Answer rate | 82–88% | Live |
| Multilingual | EN/JP/ZH/DE/FR/HI/KO | Live |
| Referral threshold | heatData.score >= 20 | Live |
| BOOKING_INTENTS | includes 'general' | Live |
| Default public route | Nadi Airport Transfers | Live |
| nadiculturealnighttour.com | Unblocked in ALLOWED_ORIGINS | Live |
| nadiairporttransfers.com brand | Nadi Airport Transfers | Fixed 30 May |

---

## Worker Feature Flags (v54 confirmed)
```
heatData.score >= 20                           ✅ line ~1017
BOOKING_INTENTS includes 'general'             ✅ line ~1016
default routedPartner = Nadi Airport Transfers ✅ line ~1021
Multilingual 7 languages                       ✅ line ~1154
nadiculturealnighttour.com in ALLOWED_ORIGINS  ✅ lines 425-426
```

---

## Pending Tasks (priority order)

### 1. 🔴 Deploy Cultural Night Tour v12
- **File:** `C:\Users\James\Desktop\VAKAVITI-MASTER\DEPLOY-ZIPS\cultural-night-tour-v12.zip`
- **Deploy to:** https://dash.cloudflare.com/595101df2c562b3c65595420d43f9fe1/pages/view/culturalnighttour/deployments
- v12 is the latest — NOT v9

### 2. 🔴 Verify partner Lagi deploy ZIPs
These ZIPs exist in DEPLOY-ZIPS and may not be deployed yet — check each:
- `bestfijitours-lagi.zip` → bestfijitours Pages project
- `fijithingstodo-lagi.zip` → fijithingstodo Pages project  
- `guidefiji-lagi.zip` → guidefiji Pages project
- `vosavakaviti-lagi.zip` → vosavakaviti Pages project

### 3. 🔴 Deploy GEO Page 1
- **File exists:** `C:\Users\James\Desktop\VAKAVITI-MASTER\GEO-PAGES\nadi-airport-transfers-guide.html`
- **Deploy to:** vakaviti.ai/nadi-airport-transfers-guide
- Submit to Google Search Console after deploy

### 4. 🟡 Fix Lagi widget title on nadiairporttransfers.com
- Shows "Fiji Tour Transfers" in widget header
- Find in Worker editor (Ctrl+H): `Fiji Tour Transfers`
- Replace with: `Nadi Airport Transfers`
- Deploy after change

### 5. 🟡 Get real partner WhatsApp numbers
- 22 partners using James fallback 61478886145
- Priority: op_tourfijitours_001, op_sofitel_001, op_coralcoast_001
- SQL to update: `UPDATE contact_channels SET destination='NUMBER' WHERE partner_id='ID' AND channel_type='whatsapp'`

### 6. 🟡 Build remaining 29 GEO pages
Priority by D1 question volume:
1. `/fiji-cultural-night-tour`
2. `/fiji-family-resorts`
3. `/fiji-honeymoon-resorts`
4. `/best-time-to-visit-fiji`
5. `/fiji-diving-guide`

### 7. 🟡 Knowledge base — push to 500+ vectors
- Current: 251 live
- Tool: `TOOLS\lagi-knowledge-push-92.html` (correct payload format)
- Focus: Palms, Tour Fiji, Smugglers Cove, safety (1 item), language (4 items)

### 8. 🟡 Partner outreach emails
- Blue Lagoon: reservations@bluelagoonresortfiji.com
- Palms Denarau: reservations@thepalmsdenarau.com
- Pitch: FJD $250/month

### 9. 🟢 Google Search Console + Bing
- Submit all GEO pages after first 5 live
- Update sitemap.xml on vakaviti.ai

### 10. 🟢 Facebook group posts
- Page: facebook.com/FJTourismGuide — 7.5K followers
- Post GEO pages in: Fiji For Me, Travel to FIJI Discussion Group

---

## James's PC — Exact File Locations

### VAKAVITI-MASTER folder structure
```
C:\Users\James\Desktop\VAKAVITI-MASTER\
├── DEPLOY-ZIPS\
│   ├── cultural-night-tour-v12.zip     ← LATEST Cultural Night Tour — PENDING DEPLOY
│   ├── cultural-night-tour-v11.zip     ← older
│   ├── cultural-night-tour-v10.zip     ← older
│   ├── bestfijitours-lagi.zip          ← PENDING verify deploy
│   ├── fijithingstodo-lagi.zip         ← PENDING verify deploy
│   ├── guidefiji-lagi.zip              ← PENDING verify deploy
│   └── vosavakaviti-lagi.zip           ← PENDING verify deploy
├── GEO-PAGES\
│   └── nadi-airport-transfers-guide.html  ← GEO page 1 built — PENDING deploy
├── PARTNER-SITES\
│   ├── cultural-night-tour-FINAL-v9.zip   ← older version, use v12 instead
│   └── cultural-night-tour-v9-extracted\  ← extracted files
├── SESSION-HANDOFFS\
│   └── SESSION-HANDOFF-2026-05-29.md
├── TOOLS\
│   ├── lagi-knowledge-push-92.html     ← CORRECT knowledge push tool (use this)
│   ├── lagi-knowledge-push.html        ← OLD — wrong payload format, do not use
│   ├── DEPLOY-GEO-PAGE.bat             ← batch deploy script
│   ├── nadi-kb-ingest.py               ← Python KB ingest for Nadi
│   ├── palms-kb-ingest.py              ← Python KB ingest for Palms
│   ├── tourfiji-kb-ingest.py           ← Python KB ingest for Tour Fiji
│   ├── fiji-general-kb-ingest.py       ← Python KB ingest general
│   ├── worker.js                       ← OLD worker backup — DO NOT DEPLOY
│   └── fiji-chat-worker-v4.js          ← OLD worker — DO NOT DEPLOY
└── OLD-DEPLOYS\                        ← archive, do not use
```

### Key Downloads folder files
```
C:\Users\James\Downloads\
├── transfers-unified_1\transfers-unified\   ← nadiairporttransfers source (fixed)
├── fiji-transfers-v019\                     ← LIVE nadiairporttransfers.com (deployed 30 May)
└── fiji-transfers-cloudflare_9\             ← older backup
```

---

## Deploy Commands (Windows CMD)

### Zip a folder for Cloudflare Pages
```cmd
powershell Compress-Archive -Path "C:\Users\James\Desktop\VAKAVITI-MASTER\DEPLOY-ZIPS\FOLDER\*" -DestinationPath "%USERPROFILE%\Desktop\deploy.zip" -Force
```

### Find & replace across all HTML files
```cmd
powershell -Command "Get-ChildItem -Path 'FOLDER' -Recurse -Filter '*.html' | ForEach-Object { (Get-Content $_.FullName -Raw) -replace 'OLD','NEW' | Set-Content $_.FullName -NoNewline }"
```

### Find a file on Desktop
```cmd
dir /s /b "%USERPROFILE%\Desktop\FILENAME"
```

---

## Partners with confirmed real WhatsApp numbers

| Partner ID | Name | WhatsApp |
|---|---|---|
| op_nadi_001 | Nadi Airport Transfers | 6796369435 ✅ |
| op_bluelagoon_001 | Blue Lagoon Beach Resort | 6797766223 |
| op_palms_001 | The Palms Denarau | 6796750104 |
| op_smugglers_001 | Smugglers Cove | 6798902713 |
| All 22 others | — | 61478886145 (James fallback) |

---

## D1 Database Tables

| Table | Key facts |
|---|---|
| partners | 29 active |
| embed_config | widget config per site |
| leads | 61 total, 34 notified |
| knowledge_items | 343 rows — 251 live vectors, 92 superseded |
| partner_referrals | 118 active referral rows |
| contact_channels | 55 rows — all 29 partners covered |
| conversation_events | event tracking |
| build_log | **NEW** — 52 rows — full history + all pending tasks |

---

## Key Contacts & Credentials

| Item | Value |
|---|---|
| Cloudflare account | helpronline@gmail.com |
| Anthropic account | tourfijitours@gmail.com |
| WhatsApp Business | +61 478 886 145 |
| Meta App ID | 1700903951357623 |
| Notification email | helpronline@gmail.com |
| D1 database ID | e697a253-e5fc-4201-939c-9aaeca6c5278 |
| Cloudflare Account ID | 595101df2c562b3c65595420d43f9fe1 |

---

## How to Update This File
At end of every session:
1. Update the Current Platform State table
2. Move completed items out of Pending
3. Add new pending items
4. Update D1: `UPDATE build_log SET status='done' WHERE id=X`
5. Commit to GitHub: docs/STATUS.md

*Created: 30 May 2026 — Session 32*
