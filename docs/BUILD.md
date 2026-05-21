````# Vakaviti.ai — Master Build Document
> Paste this entire document at the start of every new Claude session.
> Update it at the end of every session before closing the tab.
> GitHub: https://github.com/jamesdeorajan-sys/fiji-platform

---

## Who & What
**James Richardson** — WhatsApp: +61 478 886 145
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1

This repo powers two things:
1. **Existing business** — FTT Booking Site + Vakaviti dictionary (live, serving traffic)
2. **New platform** — Vakaviti.ai partner network (branded AI concierge for Fiji tourism operators)

---

## Live Systems (as of 2026-05-15)

| System | URL | Status |
|---|---|---|
| FTT Booking Site | nadiairporttransfers.com | ✅ Live |
| Vakaviti Dictionary | vosavakaviti.com | ✅ Live (Phase 2) |
| Chat Worker (Lagi v2) | fiji-chat-widget.helpronline.workers.dev | ✅ Live (v15) |
| Leads Worker | vakaviti-leads.helpronline.workers.dev | ✅ Live (v1) |
| Config Worker | vakaviti-config.helpronline.workers.dev | ✅ Live (v1) |
| Events Worker | vakaviti-events.helpronline.workers.dev | ✅ Live (v1) |
| Onboard Worker | vakaviti-onboard.helpronline.workers.dev | ✅ Live (v1) |
| Dashboard API Worker | vakaviti-dashboard-api.helpronline.workers.dev | ✅ Live (v1) |
| Widget CDN | widget.vakaviti.ai/widget.js | ✅ Live |
| Lagi Public Page | lagi.vakaviti.ai | ✅ Live (v2) |
| Blue Lagoon Demo | vakaviti-bluelagoon.pages.dev | ✅ Live |
| Palms Denarau Demo | vakaviti-palms-denarau.pages.dev | ✅ Live |
| Nadi Transfers Demo | vakaviti-nadi-transfers.pages.dev | ✅ Live |
| Tour Fiji Tours Demo | vakaviti-tourfiji.pages.dev | ✅ Live |
| Join Page | join.vakaviti.ai | ✅ Live |
| Dashboard | dashboard.vakaviti.ai | ✅ Live |
| Main Domain | vakaviti.ai / www.vakaviti.ai | ✅ Live |
| Chat Worker (Lagi v2) | fiji-chat-widget.helpronline.workers.dev | ✅ Live (v20) |
| Partner Dashboard v2 | vakaviti-dashboard-v2.pages.dev | ✅ Live |
---| Sofitel Demo | vakaviti-sofitel.pages.dev | ✅ Live |

## Repo Structure (github.com/jamesdeorajan-sys/fiji-platform)

```
fiji-platform/
├── README.md
├── ftt-booking-site/src/         ← live FTT booking site (v0.17)
├── vakaviti/src/                 ← live Vakaviti dictionary (v1.1)
├── workers/
│   ├── chat-widget/worker.js     ← DEPLOYED as fiji-chat-widget (v4)
│   └── drafting-console/         ← internal tool
├── docs/                         ← strategy docs
│   ├── BUILD_LOG.md
│   ├── STATUS.md
│   └── ... (VISION, ROADMAP, etc)
├── archives/                     ← deployment zips
│
│   ── NOT YET IN REPO (add these) ──
├── partners/                     ← NEW: partner demo pages
│   ├── palms-denarau/index.html
│   └── blue-lagoon/index.html
└── database/
    ├── schema.sql                ← full D1 schema
    └── seeds/partners.sql        ← all INSERT statements
```

### Files to add to repo immediately
1. `partners/blue-lagoon/index.html` — working demo (built 2026-05-12)
2. `partners/palms-denarau/index.html` — demo (needs site_id fix)
3. `database/schema.sql` — full D1 schema (see below)
4. `database/seeds/partners.sql` — all partner INSERTs run so far

---

## Cloudflare Worker — fiji-chat-widget (v4)

**File in repo:** `workers/chat-widget/worker.js`
**Deployed URL:** fiji-chat-widget.helpronline.workers.dev

### Bindings (all confirmed active)
| Binding | Type | Value |
|---|---|---|
| ANTHROPIC_API_KEY | Secret | Anthropic API key |
| SENDGRID_API_KEY | Secret | Email notifications |
| AI | Workers AI | @cf/baai/bge-base-en-v1.5 embeddings |
| DB | D1 | vakaviti-kb (e697a253-e5fc-4201-939c-9aaeca6c5278) |
| VECTORIZE | Vectorize | vakaviti-knowledge (51 vectors) |
| CHAT_USAGE | KV | Daily token budget tracking |

### Exact POST body (chat endpoint)
```json
{
  "messages":   [{ "role": "user", "content": "..." }],
  "site_id":    "op_bluelagoon_001",
  "partner_id": "op_bluelagoon_001",
  "session_id": "any-string"
}
```

### Response shape
```json
{ "type": "reply", "message": "...", "intent": "accommodation" }
```

### Routing logic
- `site_id` present + D1 lookup succeeds → **Phase 2** (partner identity + RAG)
- `site_id` null or lookup fails → **Legacy** (Fiji Tour Transfers identity)
- All `.pages.dev` origins allowed via CORS

### Other endpoints
- `GET /config?site_id=...` — partner config for widget embed
- `POST /lead` — store lead, score it, notify partner
- `POST /event` — analytics beacon
- `GET /v2.js` — Phase 2 widget JS

---

## D1 Database — vakaviti-kb

### partners table
```sql
CREATE TABLE partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  category TEXT,
  region TEXT,
  description TEXT,
  website_url TEXT,
  whatsapp_number TEXT,
  status TEXT DEFAULT 'active',
  created_at INTEGER
);
```

### embed_config table
```sql
CREATE TABLE embed_config (
  site_id TEXT PRIMARY KEY,
  partner_id TEXT,
  theme_color TEXT,
  greeting_text TEXT,
  allowed_intents TEXT,
  primary_intent TEXT,
  region_lock TEXT,
  created_at INTEGER
);
```

### leads table
```sql
-- includes: is_cross_referral, referred_by_site_id, referred_by_partner_id
-- (3 new columns added in Session 1)
```

### Other tables
- `kb_chunks` — knowledge base manifest (51 chunks)
- `partner_referrals` — cross-referral routing (6 rows seeded)
- `conversation_events` — analytics log

---

## Partners in D1

| ID | Name | WhatsApp | Slug | Status |
|---|---|---|---|---|
| op_nadi_001 | Nadi Airport Transfers | 61478886145 | nadi-airport-transfers | active |
| op_vosavakaviti_001 | Vosa Vakaviti | 61478886145 | vosa-vakaviti | active |
| op_tourfiji_001 | Tour Fiji Tours | TBC | tour-fiji-tours | active |
| op_palms_001 | The Palms Denarau | 6796750104 | the-palms-denarau | active |
| op_bluelagoon_001 | Blue Lagoon Beach Resort | 6797766223 | blue-lagoon-beach-resort | active |
| op_sofitel_001 | Sofitel Fiji Resort & Spa | all.accor.com/hotel/5706 | sofitel-fiji | active | Demo: vakaviti-sofitel.pages.dev |
---

## Demo Pages

### Blue Lagoon (✅ fully working)
- URL: vakaviti-bluelagoon.pages.dev
- File: `partners/blue-lagoon/index.html`
- site_id: `op_bluelagoon_001`
- Routes through Worker correctly

### The Palms Denarau (⚠️ needs fix)
- URL: vakaviti-palms-denarau.pages.dev
- File: `partners/palms-denarau/index.html`
- **Bug:** Currently calling api.anthropic.com directly OR not passing site_id
- **Fix needed:** Same pattern as Blue Lagoon — route through Worker with site_id: "op_palms_001"

### Correct fetch pattern for ALL demo pages
```javascript
const WORKER_URL = 'https://fiji-chat-widget.helpronline.workers.dev/';

const response = await fetch(WORKER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages:   messages,        // conversation array
    site_id:    'op_XXX_001',   // partner's site_id from D1
    partner_id: 'op_XXX_001',
    session_id: 'session-' + Date.now()
  })
});
const data = await response.json();
const reply = data.message;  // NOT data.content — that's direct Anthropic shape
```

### CRITICAL RULES
- **Never call api.anthropic.com from browser** — API key cannot be in browser
- **Always pass site_id** — without it Worker uses legacy Fiji Tour Transfers identity
- **Windows file save bug** — HTML files save as `.html.html` — always rename via CMD

---

## Windows Deployment Process (until GitHub auto-deploy is set up)

```cmd
cd %USERPROFILE%\Desktop\[folder-name]
rename index.html.html index.html
powershell Compress-Archive -Path index.html -DestinationPath "%USERPROFILE%\Desktop\deploy.zip" -Force
```
Then: Cloudflare Pages → project → Deployments → Create new deployment → upload zip.

---

## Phase 2 Widget Embed (for partner websites)
```html
<script src="https://fiji-chat-widget.helpronline.workers.dev/v2.js"
        data-site-id="op_bluelagoon_001"></script>
```
Widget auto-fetches config from D1, loads branding, greeting, WhatsApp URL.

---

## Pending Actions (priority order)

1. ⬜ Send Palms invitation email → reservations@thepalmsdenarau.com
2. ⬜ Send Blue Lagoon outreach email → reservations@bluelagoonresortfiji.com
3. ⬜ Fix Palms demo page — update fetch to use Worker + site_id: "op_palms_001"
4. ⬜ Add partners/ and database/ folders to GitHub repo
5. ⬜ Connect Cloudflare Pages to GitHub (eliminate zip uploads)
6. ⬜ Run kb-ingest.py — add palms-chunk-v2.py content → push 51→52 vectors
7. ⬜ Register 6 remaining in-house sites in D1 (URLs needed from James)
8. ⬜ Build next partner demo page (confirm target with James)

---

## GitHub → Cloudflare Auto-Deploy Setup (do once, saves hours)

For each Pages project:
1. Cloudflare Pages → project → Settings → Build & deployments
2. Connect to Git → select `jamesdeorajan-sys/fiji-platform`
3. Set build output directory to e.g. `partners/blue-lagoon`
4. Save — now every push to GitHub auto-deploys

---

## Known Issues & Lessons Learned

| Issue | Root Cause | Fix |
|---|---|---|
| Chat returns Fiji Tour Transfers identity | site_id missing → legacy path | Always pass site_id in POST body |
| "Connection issue" error | Page calling api.anthropic.com directly | Route through Worker only |
| index.html.html double extension | Windows file save behaviour | Rename via CMD before zipping |
| partners INSERT fails | slug column NOT NULL | Always include slug in INSERT |
| Demo page 404 after deploy | File not named index.html in zip | Rename before zipping |
| lookupPartner returns null | SQL error on missing column | description column exists — was transient |

---

## Session Log

| Date | Session | What was built |
|---|---|---|
| Pre 2026-05-06 | Session 1 | FTT booking site, Vakaviti dictionary, chat worker v1-v3, D1 schema, Vectorize (51 vectors), partner_referrals seeded, leads columns added, Palms demo page |
| 2026-05-11 | Session 2 | Worker v4 deployed (cross-partner lead splitting), Blue Lagoon demo page built & live, op_bluelagoon_001 seeded in D1, Worker routing debugged & fixed, BUILD.md created, GitHub repo identified |
| 2026-05-12 | Session 2 | Worker v4 live, Blue Lagoon demo built & working, op_bluelagoon_001 seeded in D1, Worker routing debugged & fixed, BUILD.md created, GitHub repo structured with partners/ folder |
| 2026-05-12 | Session 2 cont. | Worker v5 deployed — cross-partner referral 
firing in chat responses. Blue Lagoon transfers intent now routes to 
Nadi Airport Transfers via D1 partner_referrals lookup. referralPartner 
injected into buildPhase2SystemPrompt. |
| 2026-05-12 | Session 3 | Worker v6 deployed — permanent 3-layer Lagi character. Layer 1 soul (permanent), Layer 2 D1 partner context (6 new fields), Layer 3 referral engine with pre-filled WhatsApp attribution links. Blue Lagoon + Nadi Transfers fully populated. Humanised responses live. Claude Pro activated. Memory + voice enabled. |
| 2026-05-13 | Session 4 | Palms demo fixed. WhatsApp green buttons live. Worker v7 deployed. Cross-referral engine tested. Partner onboarding live at vakaviti-join-page.pages.dev. Partner dashboard live at vakaviti-dashboard.pages.dev. D1 contact_channels seeded for all 5 partners. Lagi embedded on vosavakaviti dictionary — funnel working. vakaviti.ai domain active on Cloudflare. DNS records being configured. |
| 2026-05-15 | Session 11 | deals table created in D1 (5 live deals seeded). Worker v13 deployed — deals engine + Layer 5 network intelligence. Worker v14 — Blue Lagoon cross-sell hardwired, all deals in public mode, RAG topK 12. Worker v15 — Super leads channel (no raw phone numbers, WhatsApp/email only, always-fire referral button, snorkel→dive intent fix). lagi.vakaviti.ai updated v2. Full CEO stress test — Lagi scored 10/10 in public mode. Power Lead Framework designed. |
# Vakaviti.ai — Master Build Document
> Paste this entire document at the start of every new Claude session.
> Update it at the end of every session before closing the tab.
> GitHub: https://github.com/jamesdeorajan-sys/fiji-platform

---

## Who & What
**James Richardson** — WhatsApp: +61 478 886 145
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1

This repo powers two things:
1. **Existing business** — FTT Booking Site + Vakaviti dictionary (live, serving traffic)
2. **New platform** — Vakaviti.ai partner network (branded AI concierge for Fiji tourism operators)

---

## Live Systems (as of 2026-05-13)

| System | URL | Status |
|---|---|---|
| FTT Booking Site | nadiairporttransfers.com | ✅ Live |
| Vakaviti Dictionary | vosavakaviti.com | ✅ Live |
| Chat Worker | fiji-chat-widget.helpronline.workers.dev | ✅ Live (v8) |
| Leads Worker | vakaviti-leads.helpronline.workers.dev | ✅ Live (v1) |
| Drafting Console | fiji-drafting-console.helpronline.workers.dev | ✅ Live |
| Palms Denarau Demo | vakaviti-palms-denarau.pages.dev | ✅ Live & working |
| Blue Lagoon Demo | vakaviti-bluelagoon.pages.dev | ✅ Live & working |
| Join Page | vakaviti-join-page.pages.dev / join.vakaviti.ai | ✅ Live |
| Dashboard | vakaviti-dashboard.pages.dev / dashboard.vakaviti.ai | ✅ Live |
| Main Domain | vakaviti.ai / www.vakaviti.ai | ✅ Live |

---

## Domain — vakaviti.ai

### DNS Records (all confirmed correct 2026-05-13)
| Type | Name | Target | Status |
|---|---|---|---|
| CNAME | vakaviti.ai | vakavitiai.pages.dev | ✅ Proxied |
| CNAME | www | vakavitiai.pages.dev | ✅ Proxied |
| CNAME | join | vakaviti-join-page.pages.dev | ✅ Proxied |
| CNAME | dashboard | vakaviti-dashboard.pages.dev | ✅ Proxied |
| MX (x5) | vakaviti.ai | eforward1-5.registrar-servers.com | ✅ Email forwarding |
| TXT | vakaviti.ai | v=spf1 include:spf.efwd... | ✅ SPF |

### Custom Domains on Pages (all confirmed 2026-05-13)
| Pages Project | Custom Domain | Status |
|---|---|---|
| vakavitiai | vakaviti.ai | ✅ Active |
| vakavitiai | www.vakaviti.ai | ✅ Active |
| vakaviti-join-page | join.vakaviti.ai | ✅ Active |
| vakaviti-dashboard | dashboard.vakaviti.ai | ✅ Active |

---

## Repo Structure (github.com/jamesdeorajan-sys/fiji-platform)

```
fiji-platform/
├── README.md
├── ftt-booking-site/src/         ← live FTT booking site (v0.17)
├── vakaviti/src/                 ← live Vakaviti dictionary (v1.1)
│   └── words.js                  ← 175 Fijian words (all ingested to Vectorize)
├── workers/
│   ├── chat-widget/worker.js     ← DEPLOYED as fiji-chat-widget (v8)
│   ├── leads/worker.js           ← DEPLOYED as vakaviti-leads (v1)
│   └── drafting-console/         ← internal tool
├── docs/
│   ├── BUILD.md                  ← THIS FILE
│   ├── BUILD_LOG.md
│   ├── STATUS.md
│   └── ... (VISION, ROADMAP, etc)
├── archives/
├── partners/
│   ├── palms-denarau/index.html
│   └── blue-lagoon/index.html
└── database/
    ├── schema.sql
    └── seeds/partners.sql
```

---

## Cloudflare Workers

### fiji-chat-widget (v8)
**Deployed URL:** fiji-chat-widget.helpronline.workers.dev
**Changes in v8:** Removed master code 999999 bypass from handleDashboardVerify

#### Bindings
| Binding | Type | Value |
|---|---|---|
| ANTHROPIC_API_KEY | Secret | Anthropic API key |
| SENDGRID_API_KEY | Secret | SendGrid API key |
| AI | Workers AI | @cf/baai/bge-base-en-v1.5 |
| DB | D1 | vakaviti-kb |
| VECTORIZE | Vectorize | vakaviti-knowledge |
| CHAT_USAGE | KV | Daily token budget tracking |

#### Routing logic
- `site_id` present + D1 lookup succeeds → Phase 2 (partner identity + RAG)
- `site_id` null or lookup fails → Legacy (Fiji Tour Transfers identity)
- All `.pages.dev` and `vakaviti.ai` origins allowed via CORS

#### Email sender
- From: `leads@vakaviti.ai` (name: Vakaviti Leads)
- Via: SendGrid API

---

### vakaviti-leads (v1) — NEW in Session 5
**Deployed URL:** vakaviti-leads.helpronline.workers.dev
**Purpose:** Standalone leads handling Worker (extracted from chat Worker)
**Health check:** GET /health → `{"ok":true,"worker":"vakaviti-leads","version":1}`

#### Bindings
| Binding | Type | Value |
|---|---|---|
| DB | D1 | vakaviti-kb |
| SENDGRID_API_KEY | Secret | SendGrid API key |

#### Endpoints
- `POST /lead` — store lead, score it, fire cross-referrals, notify partner
- `GET /health` — health check

#### Lead scoring logic
- Name provided: +20
- Contact provided: +30
- Booking intent keywords: +20
- Price inquiry: +10
- Travel dates mentioned: +10
- Group size mentioned: +10
- Max score: 100

---

## D1 Database — vakaviti-kb (e697a253-e5fc-4201-939c-9aaeca6c5278)

### Tables
- `partners` — partner registry (5 partners seeded)
- `embed_config` — widget configuration per site_id
- `leads` — all leads (primary + cross-referral)
- `kb_chunks` — knowledge base manifest
- `partner_referrals` — cross-referral routing (6 rows)
- `conversation_events` — analytics log
- `contact_channels` — notification channels per partner

### partners table
```sql
CREATE TABLE partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  category TEXT,
  region TEXT,
  description TEXT,
  website_url TEXT,
  whatsapp_number TEXT,
  status TEXT DEFAULT 'active',
  created_at INTEGER
);
```

### embed_config table
```sql
CREATE TABLE embed_config (
  site_id TEXT PRIMARY KEY,
  partner_id TEXT,
  theme_color TEXT,
  greeting_text TEXT,
  allowed_intents TEXT,
  primary_intent TEXT,
  region_lock TEXT,
  created_at INTEGER
);
```

---

## Vectorize — vakaviti-knowledge

| Metric | Value |
|---|---|
| Index name | vakaviti-knowledge |
| Embedding model | @cf/baai/bge-base-en-v1.5 |
| Vectors (pre-Session 5) | 51 (KB chunks) |
| Vectors added Session 5 | 175 (Fijian dictionary words) |
| Total vectors | 226 |

### Vector ID format
- KB chunks: `chunk_XXX`
- Dictionary words: `dict_word_1` through `dict_word_175`

### Dictionary vector metadata fields
- `word` — Fijian word
- `phonetic` — pronunciation
- `category` — greetings / food / culture / etc
- `englishDef` — English definition (truncated to 200 chars)
- `tags` — comma-separated tags
- `source` — `vakaviti_dictionary`

---

## Partners in D1

| ID | Name | WhatsApp | Slug | Status |
|---|---|---|---|---|
| op_nadi_001 | Nadi Airport Transfers | 61478886145 | nadi-airport-transfers | active |
| op_vosavakaviti_001 | Vosa Vakaviti | 61478886145 | vosa-vakaviti | active |
| op_tourfiji_001 | Tour Fiji Tours | TBC | tour-fiji-tours | active |
| op_palms_001 | The Palms Denarau | 6796750104 | the-palms-denarau | active |
| op_bluelagoon_001 | Blue Lagoon Beach Resort | 6797766223 | blue-lagoon-beach-resort | active |

---

## Demo Pages

### Blue Lagoon (✅ fully working)
- URL: vakaviti-bluelagoon.pages.dev
- site_id: `op_bluelagoon_001`

### The Palms Denarau (✅ fixed Session 4)
- URL: vakaviti-palms-denarau.pages.dev
- site_id: `op_palms_001`

### Correct fetch pattern for ALL demo pages
```javascript
const WORKER_URL = 'https://fiji-chat-widget.helpronline.workers.dev/';

const response = await fetch(WORKER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages:   messages,
    site_id:    'op_XXX_001',
    partner_id: 'op_XXX_001',
    session_id: 'session-' + Date.now()
  })
});
const data = await response.json();
const reply = data.message;
```

### CRITICAL RULES
- **Never call api.anthropic.com from browser** — API key cannot be in browser
- **Always pass site_id** — without it Worker uses legacy identity
- **Windows file save bug** — HTML files save as `.html.html` — always rename via CMD

---

## Phase 2 Widget Embed (for partner websites)
```html
<script src="https://fiji-chat-widget.helpronline.workers.dev/v2.js"
        data-site-id="op_bluelagoon_001"></script>
```

---

## Windows Deployment Process
```cmd
cd %USERPROFILE%\Desktop\[folder-name]
rename index.html.html index.html
powershell Compress-Archive -Path index.html -DestinationPath "%USERPROFILE%\Desktop\deploy.zip" -Force
```
Then: Cloudflare Pages → project → Deployments → Create new deployment → upload zip.

---

## Pending Actions (priority order)

1. ⬜ Complete 5-Worker split — extract remaining Workers from fiji-chat-widget:
   - `vakaviti-config` — handles GET /config
   - `vakaviti-events` — handles POST /event
   - `vakaviti-onboard` — handles POST /onboard
   - `vakaviti-dashboard` — handles all /dashboard/* routes
2. ⬜ Fix D1 kb_chunks insert in ingest (minor — Vectorize already complete)
3. ⬜ Send Palms invitation email → reservations@thepalmsdenarau.com
4. ⬜ Send Blue Lagoon outreach email → reservations@bluelagoonresortfiji.com
5. ⬜ Add partners/ and database/ folders to GitHub repo
6. ⬜ Connect Cloudflare Pages to GitHub (eliminate zip uploads)
7. ⬜ Register 6 remaining in-house sites in D1 (URLs needed from James)
8. ⬜ Build next partner demo page (confirm target with James)

---

## Security

| Item | Status |
|---|---|
| Master code 999999 bypass | ✅ Removed in v8 (Session 5) |
| API keys in browser | ✅ Never — all routed through Worker |
| SendGrid sender | ✅ leads@vakaviti.ai |

---

## Known Issues & Lessons Learned

| Issue | Root Cause | Fix |
|---|---|---|
| Chat returns Fiji Tour Transfers identity | site_id missing → legacy path | Always pass site_id in POST body |
| "Connection issue" error | Page calling api.anthropic.com directly | Route through Worker only |
| index.html.html double extension | Windows file save behaviour | Rename via CMD before zipping |
| partners INSERT fails | slug column NOT NULL | Always include slug in INSERT |
| Demo page 404 after deploy | File not named index.html in zip | Rename before zipping |
| Binding dialog defaults to D1 | Cloudflare UI quirk | Click Back to get type selector first |
| kb_chunks D1 insert failed | Schema column mismatch | Vectorize succeeded — D1 minor fix pending |

---

## Session Log

| Date | Session | What was built |
|---|---|---|
| Pre 2026-05-06 | Session 1 | FTT booking site, Vakaviti dictionary, chat worker v1-v3, D1 schema, Vectorize (51 vectors), partner_referrals seeded, leads columns added, Palms demo page |
| 2026-05-11 | Session 2 | Worker v4 deployed (cross-partner lead splitting), Blue Lagoon demo page built & live, op_bluelagoon_001 seeded in D1, Worker routing debugged & fixed, BUILD.md created |
| 2026-05-12 | Session 3 | Worker v6 deployed — permanent 3-layer Lagi character. Layer 1 soul, Layer 2 D1 partner context, Layer 3 referral engine. Blue Lagoon + Nadi Transfers fully populated. |
| 2026-05-12 | Session 4 | Palms demo fixed. WhatsApp green buttons live. Worker v7 deployed. Partner onboarding live at join.vakaviti.ai. Partner dashboard live at dashboard.vakaviti.ai. D1 contact_channels seeded. vakaviti.ai domain activated. |
| 2026-05-13 | Session 5 | DNS records complete (www, join, dashboard). Custom domains active on all Pages projects. Master code 999999 removed (Worker v8). vakaviti-leads Worker deployed (v1) — standalone lead handling. 175 Fijian dictionary words ingested into Vectorize (226 total vectors). |
# Vakaviti.ai — Master Build Document
> Paste this entire document at the start of every new Claude session.
> Update it at the end of every session before closing the tab.
> GitHub: https://github.com/jamesdeorajan-sys/fiji-platform

---

## Who & What
**James Richardson** — WhatsApp: +61 478 886 145
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1

This repo powers two things:
1. **Existing business** — FTT Booking Site + Vakaviti dictionary (live, serving traffic)
2. **New platform** — Vakaviti.ai partner network (branded AI concierge for Fiji tourism operators)

---

## Live Systems (as of 2026-05-13)

| System | URL | Status |
|---|---|---|
| FTT Booking Site | nadiairporttransfers.com | ✅ Live |
| Vakaviti Dictionary | vosavakaviti.com | ✅ Live |
| Chat Worker (Lagi) | fiji-chat-widget.helpronline.workers.dev | ✅ Live (v8) — chat only |
| Leads Worker | vakaviti-leads.helpronline.workers.dev | ✅ Live (v1) |
| Config Worker | vakaviti-config.helpronline.workers.dev | ✅ Live (v1) |
| Events Worker | vakaviti-events.helpronline.workers.dev | ✅ Live (v1) |
| Onboard Worker | vakaviti-onboard.helpronline.workers.dev | ✅ Live (v1) |
| Dashboard API Worker | vakaviti-dashboard-api.helpronline.workers.dev | ✅ Live (v1) |
| Drafting Console | fiji-drafting-console.helpronline.workers.dev | ✅ Live |
| Palms Denarau Demo | vakaviti-palms-denarau.pages.dev | ✅ Live |
| Blue Lagoon Demo | vakaviti-bluelagoon.pages.dev | ✅ Live |
| Join Page | join.vakaviti.ai | ✅ Live |
| Dashboard | dashboard.vakaviti.ai | ✅ Live |
| Main Domain | vakaviti.ai / www.vakaviti.ai | ✅ Live |

---

## Domain — vakaviti.ai

### DNS Records (confirmed 2026-05-13)
| Type | Name | Target | Status |
|---|---|---|---|
| CNAME | vakaviti.ai | vakavitiai.pages.dev | ✅ Proxied |
| CNAME | www | vakavitiai.pages.dev | ✅ Proxied |
| CNAME | join | vakaviti-join-page.pages.dev | ✅ Proxied |
| CNAME | dashboard | vakaviti-dashboard.pages.dev | ✅ Proxied |
| MX (x5) | vakaviti.ai | eforward1-5.registrar-servers.com | ✅ Email forwarding |
| TXT | vakaviti.ai | v=spf1 include:spf.efwd... | ✅ SPF |

### Custom Domains on Pages (confirmed 2026-05-13)
| Pages Project | Custom Domain | Status |
|---|---|---|
| vakavitiai | vakaviti.ai | ✅ Active |
| vakavitiai | www.vakaviti.ai | ✅ Active |
| vakaviti-join-page | join.vakaviti.ai | ✅ Active |
| vakaviti-dashboard | dashboard.vakaviti.ai | ✅ Active |

---

## Worker Architecture — 5-Worker Split (complete Session 6)

Monolithic 976-line Worker fully split. Each Worker is isolated,
independently deployable, gets 100,000 free requests/day.
Total free capacity: 500,000 requests/day — handles 50+ partners at launch.

### fiji-chat-widget (v8) — CHAT ONLY
**URL:** fiji-chat-widget.helpronline.workers.dev
**Purpose:** Runs Lagi — the AI concierge. Nothing else.
**Bindings:** ANTHROPIC_API_KEY, SENDGRID_API_KEY, AI (Workers AI), DB (D1), VECTORIZE, CHAT_USAGE (KV)

### vakaviti-leads (v1)
**URL:** vakaviti-leads.helpronline.workers.dev
**Bindings:** DB, SENDGRID_API_KEY
**Endpoints:** POST /lead, GET /health

### vakaviti-config (v1)
**URL:** vakaviti-config.helpronline.workers.dev
**Bindings:** DB
**Endpoints:** GET /config?site_id=..., GET /health

### vakaviti-events (v1)
**URL:** vakaviti-events.helpronline.workers.dev
**Bindings:** DB
**Endpoints:** POST /event, GET /health

### vakaviti-onboard (v1)
**URL:** vakaviti-onboard.helpronline.workers.dev
**Bindings:** DB, SENDGRID_API_KEY
**Endpoints:** POST /onboard, GET /health

### vakaviti-dashboard-api (v1)
**URL:** vakaviti-dashboard-api.helpronline.workers.dev
**Bindings:** DB, CHAT_USAGE (KV), SENDGRID_API_KEY
**Endpoints:** POST /dashboard/login, POST /dashboard/verify, GET /dashboard/leads, GET /dashboard/stats, POST /dashboard/settings, GET /health

---

## Lagi — AI Concierge

### Current state (v8)
- 3-layer system prompt: Soul (permanent) + Partner context (D1) + Referral engine
- RAG: Vectorize search on 226 vectors (51 KB chunks + 175 dictionary words)
- Intent detection: regex-based
- Lead capture: natural in-conversation + form at message 3
- Cross-referral: D1 partner_referrals → referred partner WhatsApp link injected
- Model: claude-sonnet-4-5, max_tokens: 800

### Vectorize — vakaviti-knowledge
| Metric | Value |
|---|---|
| Total vectors | 226 |
| KB chunks | 51 (chunk_XXX) |
| Dictionary words | 175 (dict_word_1 → dict_word_175) |
| Embedding model | @cf/baai/bge-base-en-v1.5 |

### Lagi v2 — NEXT BUILD (Session 7)
Upgrades planned:
1. **Unified RAG** — single Vectorize query covers all 226 vectors
2. **Fijian language answers** — Lagi teaches visitors words, phonetics, cultural context from dictionary vectors
3. **Claude-powered intent detection** — replace regex with fast Claude call
4. **Partner knowledge push** — partner-specific content (menus, room types, pricing) ingested as vectors
5. **Richer system prompt** — Lagi knows she has a dictionary and cultural knowledge base

---

## D1 Database — vakaviti-kb (e697a253-e5fc-4201-939c-9aaeca6c5278)

### Tables
- `partners` — 5 partners seeded
- `embed_config` — widget config per site_id
- `leads` — all leads (primary + cross-referral)
- `kb_chunks` — knowledge base manifest
- `partner_referrals` — cross-referral routing (6 rows)
- `conversation_events` — analytics log
- `contact_channels` — notification channels per partner

### partners table
```sql
CREATE TABLE partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  category TEXT,
  region TEXT,
  description TEXT,
  website_url TEXT,
  whatsapp_number TEXT,
  contact_email TEXT,
  status TEXT DEFAULT 'active',
  created_at INTEGER
);
```

### embed_config table
```sql
CREATE TABLE embed_config (
  site_id TEXT PRIMARY KEY,
  partner_id TEXT,
  theme_color TEXT,
  greeting_text TEXT,
  allowed_intents TEXT,
  primary_intent TEXT,
  region_lock TEXT,
  created_at INTEGER
);
```

---

## Partners in D1

| ID | Name | WhatsApp | Slug | Status |
|---|---|---|---|---|
| op_nadi_001 | Nadi Airport Transfers | 61478886145 | nadi-airport-transfers | active |
| op_vosavakaviti_001 | Vosa Vakaviti | 61478886145 | vosa-vakaviti | active |
| op_tourfiji_001 | Tour Fiji Tours | TBC | tour-fiji-tours | active |
| op_palms_001 | The Palms Denarau | 6796750104 | the-palms-denarau | active |
| op_bluelagoon_001 | Blue Lagoon Beach Resort | 6797766223 | blue-lagoon-beach-resort | active |

---

## Demo Pages

### Blue Lagoon (✅ working)
- URL: vakaviti-bluelagoon.pages.dev
- site_id: `op_bluelagoon_001`

### The Palms Denarau (✅ working)
- URL: vakaviti-palms-denarau.pages.dev
- site_id: `op_palms_001`

### Correct fetch pattern
```javascript
const WORKER_URL = 'https://fiji-chat-widget.helpronline.workers.dev/';
const response = await fetch(WORKER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages:   messages,
    site_id:    'op_XXX_001',
    partner_id: 'op_XXX_001',
    session_id: 'session-' + Date.now()
  })
});
const data = await response.json();
const reply = data.message;
```

### CRITICAL RULES
- Never call api.anthropic.com from browser
- Always pass site_id
- Windows: rename .html.html → .html before zipping

---

## Phase 2 Widget Embed
```html
<script src="https://fiji-chat-widget.helpronline.workers.dev/v2.js"
        data-site-id="op_bluelagoon_001"></script>
```

---

## Windows Deployment Process
```cmd
cd %USERPROFILE%\Desktop\[folder-name]
rename index.html.html index.html
powershell Compress-Archive -Path index.html -DestinationPath "%USERPROFILE%\Desktop\deploy.zip" -Force
```

---

## Security

| Item | Status |
|---|---|
| Master code 999999 bypass | ✅ Removed (Session 5) |
| API keys in browser | ✅ Never |
| SendGrid sender | ✅ leads@vakaviti.ai |
| Single point of failure | ✅ Eliminated — 5-Worker split done |

---

## Pending Actions (priority order)

1. ⬜ **Lagi v2** — unified RAG, Fijian language answers, Claude intent detection, partner KB push
2. ⬜ Send Palms invitation → reservations@thepalmsdenarau.com
3. ⬜ Send Blue Lagoon outreach → reservations@bluelagoonresortfiji.com
4. ⬜ Add partners/ and database/ to GitHub repo
5. ⬜ Connect Cloudflare Pages → GitHub auto-deploy
6. ⬜ Fix D1 kb_chunks insert (minor — Vectorize complete)
7. ⬜ Register 6 remaining in-house sites in D1
8. ⬜ Build next partner demo page
9. ⬜ Activate auto-onboarding (join → D1 → live widget, no manual step)

---

## Known Issues & Lessons Learned

| Issue | Root Cause | Fix |
|---|---|---|
| Chat returns Fiji Tour Transfers identity | site_id missing | Always pass site_id |
| Connection issue error | Browser calling Anthropic directly | Route through Worker only |
| index.html.html double extension | Windows save behaviour | Rename via CMD |
| partners INSERT fails | slug NOT NULL | Always include slug |
| Binding dialog defaults to D1 | Cloudflare UI quirk | Click Back for type selector |
| kb_chunks D1 insert failed | Schema column mismatch | Vectorize succeeded — D1 fix pending |

---

## Session Log

| Date | Session | What was built |
|---|---|---|
| Pre 2026-05-06 | Session 1 | FTT booking site, Vakaviti dictionary, chat worker v1-v3, D1 schema, Vectorize (51 vectors), partner_referrals seeded, leads columns added, Palms demo |
| 2026-05-11 | Session 2 | Worker v4, Blue Lagoon demo live, op_bluelagoon_001 seeded, routing fixed, BUILD.md created |
| 2026-05-12 | Session 3 | Worker v6 — 3-layer Lagi, RAG live, Blue Lagoon + Nadi Transfers populated |
| 2026-05-12 | Session 4 | Palms demo fixed, Worker v7, join.vakaviti.ai + dashboard.vakaviti.ai live, vakaviti.ai domain activated |
| 2026-05-13 | Session 5 | DNS complete, custom domains active, 999999 removed (v8), vakaviti-leads deployed, 175 words → Vectorize (226 total) |
| 2026-05-13 | Session 6 | 5-Worker split complete — vakaviti-config, vakaviti-events, vakaviti-onboard, vakaviti-dashboard-api all live. fiji-chat-widget now chat-only. Architecture scales to 50+ partners. |
# Vakaviti.ai — Master Build Document
> Paste this entire document at the start of every new Claude session.
> Update it at the end of every session before closing the tab.
> GitHub: https://github.com/jamesdeorajan-sys/fiji-platform

---

## Who & What
**James Richardson** — WhatsApp: +61 478 886 145
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1

This repo powers two things:
1. **Existing business** — FTT Booking Site + Vakaviti dictionary (live, serving traffic)
2. **New platform** — Vakaviti.ai partner network (branded AI concierge for Fiji tourism operators)

---

## Live Systems (as of 2026-05-13)

| System | URL | Status |
|---|---|---|
| FTT Booking Site | nadiairporttransfers.com | ✅ Live |
| Vakaviti Dictionary | vosavakaviti.com | ✅ Live |
| Chat Worker (Lagi v2) | fiji-chat-widget.helpronline.workers.dev | ✅ Live (v9 — Lagi v2) |
| Leads Worker | vakaviti-leads.helpronline.workers.dev | ✅ Live (v1) |
| Config Worker | vakaviti-config.helpronline.workers.dev | ✅ Live (v1) |
| Events Worker | vakaviti-events.helpronline.workers.dev | ✅ Live (v1) |
| Onboard Worker | vakaviti-onboard.helpronline.workers.dev | ✅ Live (v1) |
| Dashboard API Worker | vakaviti-dashboard-api.helpronline.workers.dev | ✅ Live (v1) |
| Drafting Console | fiji-drafting-console.helpronline.workers.dev | ✅ Live |
| Palms Denarau Demo | vakaviti-palms-denarau.pages.dev | ✅ Live |
| Blue Lagoon Demo | vakaviti-bluelagoon.pages.dev | ✅ Live |
| Join Page | join.vakaviti.ai | ✅ Live |
| Dashboard | dashboard.vakaviti.ai | ✅ Live |
| Main Domain | vakaviti.ai / www.vakaviti.ai | ✅ Live |

---

## Domain — vakaviti.ai

### DNS Records (confirmed 2026-05-13)
| Type | Name | Target | Status |
|---|---|---|---|
| CNAME | vakaviti.ai | vakavitiai.pages.dev | ✅ Proxied |
| CNAME | www | vakavitiai.pages.dev | ✅ Proxied |
| CNAME | join | vakaviti-join-page.pages.dev | ✅ Proxied |
| CNAME | dashboard | vakaviti-dashboard.pages.dev | ✅ Proxied |
| MX (x5) | vakaviti.ai | eforward1-5.registrar-servers.com | ✅ Email forwarding |
| TXT | vakaviti.ai | v=spf1 include:spf.efwd... | ✅ SPF |

### Custom Domains on Pages (confirmed 2026-05-13)
| Pages Project | Custom Domain | Status |
|---|---|---|
| vakavitiai | vakaviti.ai | ✅ Active |
| vakavitiai | www.vakaviti.ai | ✅ Active |
| vakaviti-join-page | join.vakaviti.ai | ✅ Active |
| vakaviti-dashboard | dashboard.vakaviti.ai | ✅ Active |

---

## Worker Architecture — 5-Worker Split (complete)

| Worker | URL | Purpose | Bindings |
|---|---|---|---|
| fiji-chat-widget (v9) | fiji-chat-widget.helpronline.workers.dev | Lagi AI concierge — chat only | ANTHROPIC_API_KEY, SENDGRID_API_KEY, AI, DB, VECTORIZE, CHAT_USAGE |
| vakaviti-leads (v1) | vakaviti-leads.helpronline.workers.dev | Lead storage, scoring, referrals, notify | DB, SENDGRID_API_KEY |
| vakaviti-config (v1) | vakaviti-config.helpronline.workers.dev | Widget config from D1 | DB |
| vakaviti-events (v1) | vakaviti-events.helpronline.workers.dev | Analytics beacon | DB |
| vakaviti-onboard (v1) | vakaviti-onboard.helpronline.workers.dev | Partner self-registration | DB, SENDGRID_API_KEY |
| vakaviti-dashboard-api (v1) | vakaviti-dashboard-api.helpronline.workers.dev | Partner dashboard auth + data | DB, CHAT_USAGE, SENDGRID_API_KEY |

---

## Lagi — AI Concierge (v2 — current)

### Architecture
- **Model:** claude-sonnet-4-5, max_tokens: 800
- **4-layer system prompt:**
  - Layer 1: Lagi soul (permanent character, voice, lead capture rules)
  - Layer 2: Partner context (D1 lookup — name, category, region, description, WhatsApp)
  - Layer 3: Network intelligence (cross-referral engine, trusted partner routing)
  - Layer 4: Fijian language & cultural knowledge (dictionary + cultural customs)
- **Unified RAG:** Single Vectorize query → splits into dictWords, kbChunks, partnerKb
- **Intent detection:** transfers, tours, dive, accommodation, dining, visa, weather, safety, language, pricing, ferry, general

### Lagi v2 changes (Session 7)
- `searchKnowledge` rewritten — uses Vectorize metadata directly, no D1 fallback needed for dict words
- Score threshold 0.65 — only relevant matches sent to Claude
- Results bucketed: `dictWords` / `kbChunks` / `partnerKb`
- Layer 4 added — Lagi teaches Fijian words with phonetics, meaning, cultural context
- Language intent expanded — catches: bula, vinaka, moce, kerekere, yadra, fijian word, how do you say, what does * mean, vosa, dictionary
- Dashboard routes now return 301 to standalone Workers
- Widget greeting updated — Lagi introduces herself by name and mentions language teaching

### Confirmed working (tested 2026-05-13)
- "What does bula mean?" → phonetics (mboo-lah) + 4 meanings + cultural context + bula vinaka bonus + invitation to learn more ✅

---

## Vectorize — vakaviti-knowledge

| Metric | Value |
|---|---|
| Total vectors | 226 |
| KB chunks | 51 (chunk_XXX) |
| Dictionary words | 175 (dict_word_1 → dict_word_175) |
| Embedding model | @cf/baai/bge-base-en-v1.5 |
| Score threshold | 0.65 |

### Vector metadata fields (dictionary words)
- `word`, `phonetic`, `category`, `englishDef` (200 chars), `tags`, `source: vakaviti_dictionary`

### Vector metadata fields (partner KB — next build)
- `word/title`, `content`, `partner_id`, `source: partner_kb`

---

## D1 Database — vakaviti-kb (e697a253-e5fc-4201-939c-9aaeca6c5278)

### Tables
- `partners` — 5 partners seeded
- `embed_config` — widget config per site_id
- `leads` — all leads (primary + cross-referral)
- `kb_chunks` — knowledge base manifest
- `partner_referrals` — cross-referral routing (6 rows)
- `conversation_events` — analytics log
- `contact_channels` — notification channels per partner

---

## Partners in D1

| ID | Name | WhatsApp | Slug | Status |
|---|---|---|---|---|
| op_nadi_001 | Nadi Airport Transfers | 61478886145 | nadi-airport-transfers | active |
| op_vosavakaviti_001 | Vosa Vakaviti | 61478886145 | vosa-vakaviti | active |
| op_tourfiji_001 | Tour Fiji Tours | TBC | tour-fiji-tours | active |
| op_palms_001 | The Palms Denarau | 6796750104 | the-palms-denarau | active |
| op_bluelagoon_001 | Blue Lagoon Beach Resort | 6797766223 | blue-lagoon-beach-resort | active |

---

## Demo Pages

### Blue Lagoon (✅ working + Lagi v2 live)
- URL: vakaviti-bluelagoon.pages.dev
- site_id: `op_bluelagoon_001`

### The Palms Denarau (✅ working)
- URL: vakaviti-palms-denarau.pages.dev
- site_id: `op_palms_001`

### Correct fetch pattern
```javascript
const WORKER_URL = 'https://fiji-chat-widget.helpronline.workers.dev/';
const response = await fetch(WORKER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages:   messages,
    site_id:    'op_XXX_001',
    partner_id: 'op_XXX_001',
    session_id: 'session-' + Date.now()
  })
});
const data = await response.json();
const reply = data.message;
```

### CRITICAL RULES
- Never call api.anthropic.com from browser
- Always pass site_id
- Windows: rename .html.html → .html before zipping

---

## Phase 2 Widget Embed
```html
<script src="https://fiji-chat-widget.helpronline.workers.dev/v2.js"
        data-site-id="op_bluelagoon_001"></script>
```

---

## Windows Deployment Process
```cmd
cd %USERPROFILE%\Desktop\[folder-name]
rename index.html.html index.html
powershell Compress-Archive -Path index.html -DestinationPath "%USERPROFILE%\Desktop\deploy.zip" -Force
```

---

## Security

| Item | Status |
|---|---|
| Master code 999999 bypass | ✅ Removed (Session 5) |
| API keys in browser | ✅ Never |
| SendGrid sender | ✅ leads@vakaviti.ai |
| Single point of failure | ✅ Eliminated — 5-Worker split |

---

## Pending Actions (priority order)

1. ⬜ **Partner KB ingest** — push Blue Lagoon room types, dive packages, pricing into Vectorize so Lagi answers factually (Session 8)
2. ⬜ Send Palms invitation → reservations@thepalmsdenarau.com
3. ⬜ Send Blue Lagoon outreach → reservations@bluelagoonresortfiji.com
4. ⬜ Add partners/ and database/ to GitHub repo
5. ⬜ Connect Cloudflare Pages → GitHub auto-deploy
6. ⬜ Fix D1 kb_chunks insert (minor — Vectorize complete)
7. ⬜ Register 6 remaining in-house sites in D1
8. ⬜ Build next partner demo page
9. ⬜ Activate auto-onboarding (join → D1 → live widget, no manual step)
10. ⬜ Claude-powered intent detection (replace regex with fast Claude call)

---

## Known Issues & Lessons Learned

| Issue | Root Cause | Fix |
|---|---|---|
| Chat returns Fiji Tour Transfers identity | site_id missing | Always pass site_id |
| Connection issue error | Browser calling Anthropic directly | Route through Worker only |
| index.html.html double extension | Windows save behaviour | Rename via CMD |
| partners INSERT fails | slug NOT NULL | Always include slug |
| Binding dialog defaults to D1 | Cloudflare UI quirk | Click Back for type selector |
| kb_chunks D1 insert failed | Schema column mismatch | Vectorize succeeded — D1 fix pending |

---

## Session Log

| Date | Session | What was built |
|---|---|---|
| Pre 2026-05-06 | Session 1 | FTT booking site, Vakaviti dictionary, chat worker v1-v3, D1 schema, Vectorize (51 vectors), partner_referrals seeded, leads columns added, Palms demo |
| 2026-05-11 | Session 2 | Worker v4, Blue Lagoon demo live, op_bluelagoon_001 seeded, routing fixed, BUILD.md created |
| 2026-05-12 | Session 3 | Worker v6 — 3-layer Lagi, RAG live, Blue Lagoon + Nadi Transfers populated |
| 2026-05-12 | Session 4 | Palms demo fixed, Worker v7, join.vakaviti.ai + dashboard.vakaviti.ai live, vakaviti.ai domain activated |
| 2026-05-13 | Session 5 | DNS complete, custom domains active, 999999 removed (v8), vakaviti-leads deployed, 175 words → Vectorize (226 total) |
| 2026-05-13 | Session 6 | 5-Worker split complete — config, events, onboard, dashboard-api all live. Chat Worker now chat-only. |
| 2026-05-13 | Session 7 | Lagi v2 deployed (v9). Unified RAG. Layer 4 Fijian language intelligence. Dictionary answers with phonetics + cultural context confirmed working. |
# Vakaviti.ai — Master Build Document
> Paste this entire document at the start of every new Claude session.
> Update it at the end of every session before closing the tab.
> GitHub: https://github.com/jamesdeorajan-sys/fiji-platform

---

## Who & What
**James Richardson** — WhatsApp: +61 478 886 145
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1

This repo powers two things:
1. **Existing business** — FTT Booking Site + Vakaviti dictionary (live, serving traffic)
2. **New platform** — Vakaviti.ai partner network (branded AI concierge for Fiji tourism operators)

---

## Live Systems (as of 2026-05-14)

| System | URL | Status |
|---|---|---|
| FTT Booking Site | nadiairporttransfers.com | ✅ Live |
| Vakaviti Dictionary | vosavakaviti.com | ✅ Live |
| Chat Worker (Lagi v2) | fiji-chat-widget.helpronline.workers.dev | ✅ Live (v10) |
| Leads Worker | vakaviti-leads.helpronline.workers.dev | ✅ Live (v1) |
| Config Worker | vakaviti-config.helpronline.workers.dev | ✅ Live (v1) |
| Events Worker | vakaviti-events.helpronline.workers.dev | ✅ Live (v1) |
| Onboard Worker | vakaviti-onboard.helpronline.workers.dev | ✅ Live (v1) |
| Dashboard API Worker | vakaviti-dashboard-api.helpronline.workers.dev | ✅ Live (v1) |
| Blue Lagoon Demo | vakaviti-bluelagoon.pages.dev | ✅ Live (updated) |
| Palms Denarau Demo | vakaviti-palms-denarau.pages.dev | ✅ Live |
| Join Page | join.vakaviti.ai | ✅ Live |
| Dashboard | dashboard.vakaviti.ai | ✅ Live |
| Main Domain | vakaviti.ai / www.vakaviti.ai | ✅ Live |

---

## Domain — vakaviti.ai

### DNS Records (confirmed 2026-05-13)
| Type | Name | Target | Status |
|---|---|---|---|
| CNAME | vakaviti.ai | vakavitiai.pages.dev | ✅ Proxied |
| CNAME | www | vakavitiai.pages.dev | ✅ Proxied |
| CNAME | join | vakaviti-join-page.pages.dev | ✅ Proxied |
| CNAME | dashboard | vakaviti-dashboard.pages.dev | ✅ Proxied |
| MX (x5) | vakaviti.ai | eforward1-5.registrar-servers.com | ✅ Email forwarding |
| TXT | vakaviti.ai | v=spf1 include:spf.efwd... | ✅ SPF |

---

## Worker Architecture — 5-Worker Split (complete)

| Worker | URL | Purpose | Bindings |
|---|---|---|---|
| fiji-chat-widget (v10) | fiji-chat-widget.helpronline.workers.dev | Lagi AI concierge — chat only | ANTHROPIC_API_KEY, SENDGRID_API_KEY, AI, DB, VECTORIZE, CHAT_USAGE |
| vakaviti-leads (v1) | vakaviti-leads.helpronline.workers.dev | Lead storage, scoring, referrals | DB, SENDGRID_API_KEY |
| vakaviti-config (v1) | vakaviti-config.helpronline.workers.dev | Widget config from D1 | DB |
| vakaviti-events (v1) | vakaviti-events.helpronline.workers.dev | Analytics beacon | DB |
| vakaviti-onboard (v1) | vakaviti-onboard.helpronline.workers.dev | Partner self-registration | DB, SENDGRID_API_KEY |
| vakaviti-dashboard-api (v1) | vakaviti-dashboard-api.helpronline.workers.dev | Partner dashboard auth + data | DB, CHAT_USAGE, SENDGRID_API_KEY |

---

## Lagi — AI Concierge (v2 — current)

### Architecture
- **Model:** claude-sonnet-4-5, max_tokens: 800
- **4-layer system prompt:** Soul + Partner context + Network intelligence + Fijian language
- **Unified RAG:** Single Vectorize query → splits into dictWords / kbChunks / partnerKb
- **Intent detection:** transfers, tours, dive, accommodation, dining, visa, weather, safety, language, pricing, ferry, general
- **Referral engine:** D1 partner_referrals lookup → `referral_btn` JSON field in response

### Worker response shape (v10)
```json
{
  "type": "reply",
  "message": "Lagi's text response",
  "intent": "transfers",
  "referral_btn": {
    "url": "https://wa.me/61478886145?text=Hi%20Nadi...",
    "label": "Contact Nadi Airport Transfers on WhatsApp"
  }
}
```
`referral_btn` is `null` when no referral applies.

### CRITICAL — Referral button pattern (see docs/PARTNER_DEMO_BUILD_STANDARD.md)
- Worker returns `referral_btn` as separate JSON field — NOT in message text
- Demo pages render button with DOM `createElement` — NOT innerHTML or regex parsing
- This is the ONLY reliable pattern. Never ask Claude to output WhatsApp links.

---

## Vectorize — vakaviti-knowledge

| Metric | Value |
|---|---|
| Total vectors | 245 |
| KB chunks (general) | 51 |
| Dictionary words | 175 (dict_word_1 → dict_word_175) |
| Blue Lagoon partner KB | 19 (bl_location, bl_room_*, bl_diving, bl_activities, etc) |
| Embedding model | @cf/baai/bge-base-en-v1.5 |
| Score threshold | 0.65 |

### Vector metadata fields (partner KB)
- `title`, `content` (500 chars), `category`, `partner_id`, `source: partner_kb`

---

## D1 Database — vakaviti-kb (e697a253-e5fc-4201-939c-9aaeca6c5278)

### Tables
- `partners` — 5 partners seeded
- `embed_config` — widget config per site_id
- `leads` — all leads (primary + cross-referral)
- `kb_chunks` — knowledge base manifest
- `partner_referrals` — cross-referral routing (6 rows seeded)
- `conversation_events` — analytics log
- `contact_channels` — notification channels per partner

### partner_referrals seeded
| site_id | intent | referred_partner_id | active |
|---|---|---|---|
| op_bluelagoon_001 | transfers | op_nadi_001 | 1 |
| op_bluelagoon_001 | tours | op_tourfiji_001 | 1 |

---

## Partners in D1

| ID | Name | WhatsApp | Slug | Status |
|---|---|---|---|---|
| op_nadi_001 | Nadi Airport Transfers | 61478886145 | nadi-airport-transfers | active |
| op_vosavakaviti_001 | Vosa Vakaviti | 61478886145 | vosa-vakaviti | active |
| op_tourfiji_001 | Tour Fiji Tours | TBC | tour-fiji-tours | active |
| op_palms_001 | The Palms Denarau | 6796750104 | the-palms-denarau | active |
| op_bluelagoon_001 | Blue Lagoon Beach Resort | 6797766223 | blue-lagoon-beach-resort | active |

---

## Blue Lagoon Knowledge Base (ingested Session 8)

19 vectors covering:
- Location (Nacula Island, Yasawa Islands, 45nm from mainland)
- Transfers: Finnoki Kai boat schedules, charter Waya Flyer NZD $2,399, helicopter
- Rooms: Bula Lodge, Garden Villa, Deluxe Garden Villa, Lagoon Villa, Family Suite
- Pricing: NZD low/high season rates with AUD + USD conversions
- Seasons: High = Mar 15–Oct 31 + Dec 21–Jan 14 | Low = Nov–mid-Dec + mid-Jan–Mar 14
- Meal plan: Adults NZD $143/day, Kids NZD $105/day, Infants FREE
- Dining: Main Restaurant + Donu (Japanese omakase)
- Deals: 7-night package, Kids Eat Free, Dive Free, Free Scuba 5+ nights
- Diving: PADI courses, unlimited free diving after course
- Activities: Paddle boarding, snorkelling, Sawa-i-Lau caves, hiking, Tumba Kids Club
- Weddings, family rates, contact details, booking terms

---

## Demo Pages

### Blue Lagoon (✅ fully working — updated Session 8)
- URL: vakaviti-bluelagoon.pages.dev
- site_id: `op_bluelagoon_001`
- Referral button: ✅ Green WhatsApp button with pre-filled attribution message
- Partner KB: ✅ 19 vectors — Lagi answers pricing, room types, packages accurately

### The Palms Denarau (✅ working — needs KB ingest)
- URL: vakaviti-palms-denarau.pages.dev
- site_id: `op_palms_001`
- Referral button: ⬜ Not yet updated to new pattern

### Standard fetch pattern (all demo pages)
```javascript
const WORKER_URL = 'https://fiji-chat-widget.helpronline.workers.dev/';
const response = await fetch(WORKER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: messages, site_id: 'op_XXX_001',
    partner_id: 'op_XXX_001', session_id: 'session-' + Date.now()
  })
});
const data = await response.json();
const reply = data.message;
// Render referral_btn with DOM if data.referral_btn exists
// See docs/PARTNER_DEMO_BUILD_STANDARD.md
```

---

## Key Documents in Repo

| File | Purpose |
|---|---|
| docs/BUILD.md | Master build doc — paste at session start |
| docs/PARTNER_DEMO_BUILD_STANDARD.md | How to build partner demo pages — referral button pattern |
| docs/BRAND_GUIDELINES.md | Visual identity |
| docs/ROADMAP.md | Feature roadmap |
| docs/PRICING_MODEL.md | Partner pricing |

---

## Security

| Item | Status |
|---|---|
| Master code 999999 bypass | ✅ Removed (Session 5) |
| API keys in browser | ✅ Never |
| SendGrid sender | ✅ leads@vakaviti.ai |
| Single point of failure | ✅ Eliminated — 5-Worker split |
| WhatsApp links in system prompt | ✅ Removed — referral_btn JSON field only |

---

## Pending Actions (priority order)

1. ⬜ Update Palms demo to new referral button pattern (copy Blue Lagoon pattern)
2. ⬜ Ingest Palms Denarau partner KB into Vectorize
3. ⬜ Send Palms invitation → reservations@thepalmsdenarau.com
4. ⬜ Send Blue Lagoon outreach → reservations@bluelagoonresortfiji.com
5. ⬜ Add partners/ and database/ to GitHub repo
6. ⬜ Connect Cloudflare Pages → GitHub auto-deploy
7. ⬜ Register 6 remaining in-house sites in D1
8. ⬜ Build next partner demo page (Tour Fiji Tours or Nadi Airport Transfers)
9. ⬜ Activate auto-onboarding (join → D1 → live widget, no manual step)
10. ⬜ Claude-powered intent detection (replace regex)

---

## Known Issues & Lessons Learned

| Issue | Root Cause | Fix |
|---|---|---|
| Chat returns Fiji Tour Transfers identity | site_id missing | Always pass site_id |
| Connection issue error | Browser calling Anthropic directly | Route through Worker only |
| index.html.html double extension | Windows save behaviour | Rename via CMD |
| partners INSERT fails | slug NOT NULL | Always include slug |
| Binding dialog defaults to D1 | Cloudflare UI quirk | Click Back for type selector |
| kb_chunks D1 insert failed | Schema column mismatch | Vectorize succeeded — D1 fix pending |
| WhatsApp referral button showing as raw text | Claude outputs markdown links with newlines; escHtml breaks URLs | Return referral_btn as JSON field, render with DOM. See PARTNER_DEMO_BUILD_STANDARD.md |

---

## Session Log

| Date | Session | What was built |
|---|---|---|
| Pre 2026-05-06 | Session 1 | FTT booking site, Vakaviti dictionary, chat worker v1-v3, D1 schema, Vectorize (51 vectors), partner_referrals seeded, leads columns added, Palms demo |
| 2026-05-11 | Session 2 | Worker v4, Blue Lagoon demo live, op_bluelagoon_001 seeded, routing fixed, BUILD.md created |
| 2026-05-12 | Session 3 | Worker v6 — 3-layer Lagi, RAG live, Blue Lagoon + Nadi Transfers populated |
| 2026-05-12 | Session 4 | Palms demo fixed, Worker v7, join.vakaviti.ai + dashboard.vakaviti.ai live, vakaviti.ai domain activated |
| 2026-05-13 | Session 5 | DNS complete, custom domains active, 999999 removed (v8), vakaviti-leads deployed, 175 words → Vectorize (226 total) |
| 2026-05-13 | Session 6 | 5-Worker split complete — config, events, onboard, dashboard-api all live. Chat Worker now chat-only. |
| 2026-05-13 | Session 7 | Lagi v2 deployed (v9). Unified RAG. Layer 4 Fijian language intelligence. Dictionary answers confirmed working. |
| 2026-05-14 | Session 8 | Blue Lagoon partner KB ingested (19 vectors, 245 total). Cross-referral green WhatsApp button live with pre-filled attribution message. referral_btn JSON pattern documented in PARTNER_DEMO_BUILD_STANDARD.md. Worker v10 deployed. |
| 2026-05-15 | Session 9 | Palms demo updated (referral btn pattern). Palms KB ingested (15 vectors). General Fiji KB ingested (24 vectors, 284 total). Worker v12 deployed — proactive Fijian language, -- fix, WA strip fix. widget.vakaviti.ai live as permanent widget CDN. Vosa Vakaviti upgraded to Phase 2 (live traffic). Nadi Airport Transfers flagship demo live. |
| 2026-05-15 | Session 10 | Tour Fiji Tours demo live (vakaviti-tourfiji.pages.dev). Tour Fiji Tours KB ingested (15 vectors). Nadi Airport Transfers KB ingested (20 vectors). Vectorize total 319 vectors. lagi.vakaviti.ai public page live — network-wide mode, live deals ticker, partner sidebar, Smugglers Cove featured. lagi.vakaviti.ai DNS active with SSL. |

| 2026-05-15 | Session 11 | deals table created in D1 (5 live deals seeded). Worker v13 deployed — deals engine + Layer 5 network intelligence. Worker v14 — Blue Lagoon cross-sell hardwired, all deals in public mode, RAG topK 12. Worker v15 — Super leads channel (no raw phone numbers, WhatsApp/email only, always-fire referral button, snorkel→dive intent fix, contact attribution). lagi.vakaviti.ai updated v2 — lead form suppressed, lagi_public site_id. Full CEO stress test completed — Lagi scored 10/10 in public mode. Power Lead Framework designed — heat scoring, Top 3 offers, partner pricing model defined. |
| 2026-05-15 | Session 12 | Smugglers Cove onboarded as Partner 6 in D1. leads table upgraded (heat_score, heat_tier, deals_interested, contact_preference columns). Worker v16 deployed — Power Lead Engine: scoreConversationHeat(), Top 3 power offers at heat≥60, WhatsApp/email choice, enhanced lead payload. CEO stress test — v16 scored 9.4/10. Platform ready for Facebook group deployment. |
| 2026-05-15 | Session 12 final | Worker v17 — smart context routing (isFamily/isHoneymoon detection). Worker v18 — early lead trigger, two-step close enforced. Worker v19 — auto lead capture (phone/email detection, D1 storage, email notification). SendGrid sender fixed. Contact channel priorities updated. NON-NEGOTIABLE seed planting message 1, contact capture message 2. First live lead notification received. lagi.vakaviti.ai v4 — mobile optimised, 10 deals all screens. Platform approved for Facebook deployment. |
| 2026-05-16 | Session 13 | Worker v20 deployed — rate limiting (50msg/IP/hr), prompt injection detection, security headers, conversation_snapshot stored with leads. Partner Dashboard v2 built — live leads, heat scores, conversation snippets, modal detail view. Privacy Policy + Terms of Service built. leads-query + deals-query endpoints added to Worker. Dashboard login fixed — Unicode syntax error resolved. D1: conversation_snapshot column added. |
| 2026-05-16 | Session 14 | Platform hardening — 20 fixes deployed (v21-v27). Dashboard doLogin syntax error fixed. Live D1 leads fetch working (CORS OPTIONS preflight). Heat score fixed (min 60). Name extraction from user messages only. Email channel loop — tries all channels. Referral button routing fixed (intent priority over contact override). Intent detection 15/15 test cases passing. Flight numbers trigger tier 4 heat. Budget word boundaries. Performance tab built (30-day chart). Active Deals tab with Submit a Deal form. Dashboard sessionStorage (clears on tab close, 8hr expiry). dashboard.vakaviti.ai live on v2. Partner view confirmed — Tour Fiji Tours isolated. Full pipeline validated — Lagi → D1 → email → dashboard end-to-end. |
| 2026-05-17 | Session 15 | Self-learning knowledge base — all 4 layers built and confirmed working (v28-v38). D1: 3 new tables (knowledge_queue, knowledge_items, question_clusters), 5 new columns on conversation_events. Layer 1: every question stored with RAG score + lead_converted flag. Layer 2: GET /knowledge-gaps endpoint live. Layer 3: POST /knowledge-add — Q+A auto-embeds to Vectorize in 2 seconds, confirmed working. Layer 4: conversation-to-vector via ctx.waitUntil — confirmed first conversation_learning vector ingested. Lagi now learns from every lead capture. Knowledge base self-compounding from this point. |
| 2026-05-17 | Session 16-18 | Lagi v44-v48: Itinerary Builder live (personalised day-by-day plan emailed after lead capture). Partner routing fixed 8/8 test cases (v46-v47). Power greeting built — "your Fiji insider" + WhatsApp/Email buttons on lagi.vakaviti.ai (v5). WhatsApp Business API Worker built (vakaviti-whatsapp) — deployed, awaiting Meta setup. Worker: fiji-chat-widget now v48. |
| 2026-05-17 | Session 19 | WhatsApp Business API live end-to-end. 
Meta Vakaviti AI app created and published. vakaviti-whatsapp Worker 
deployed (v5) with service binding to fiji-chat-widget. Lagi responding 
on WhatsApp with full intelligence + referral buttons. Test number: 
+1 (555) 641-4099. Permanent token needed (current token expires in hours). |
| 2026-05-17 | Session 19 | WhatsApp Business API live end-to-end. 
Meta Vakaviti AI app published (App ID: 1700903951357623). 
vakaviti-whatsapp Worker v5 deployed with service binding to 
fiji-chat-widget. Lagi responding on WhatsApp with full intelligence 
+ referral buttons. Test number: +1 (555) 641-4099. Privacy page 
live at vakaviti-privacy.pages.dev. Permanent system user token 
pending. |
| 2026-05-17 | Session 20 | Permanent WhatsApp token live. 
Lagi installed on 10 WordPress sites (fijitourtransfers.com, 
tourfijitours.com, natadolabayhorseriding.com, coralcoasthorseriding.com, 
bulaadventure.com, fijitourpackages.com, bulahappiness.com, fijibula.com, 
namosiadventuretoursfiji.com, wananavudeals.com). 9 Cloudflare AI sites 
registered in D1 with unique configs. tourfijitours.com security audit 
complete — fake accounts deleted, admin email secured, Square reconnected, 
bookings working for first time since March. fiji679.com domain down — 
flag for developer. Widget header caching issue pending fix in next session.|
# Vakaviti.ai — Master Build Document
> Paste this entire document at the start of every new Claude session.
> Update it at the end of every session before closing the tab.
> GitHub: https://github.com/jamesdeorajan-sys/fiji-platform

---

## Who & What
**James Richardson** — WhatsApp: +61 478 886 145
**Cloudflare Account ID:** 595101df2c562b3c65595420d43f9fe1

---

## Live Systems (as of 2026-05-18)

| System | URL | Status |
|---|---|---|
| FTT Booking Site | nadiairporttransfers.com | ✅ Live |
| Vakaviti Dictionary | vosavakaviti.com | ✅ Live |
| Chat Worker (Lagi) | fiji-chat-widget.helpronline.workers.dev | ✅ Live (v48) |
| Leads Worker | vakaviti-leads.helpronline.workers.dev | ✅ Live |
| Config Worker | vakaviti-config.helpronline.workers.dev | ✅ Live |
| Events Worker | vakaviti-events.helpronline.workers.dev | ✅ Live |
| Onboard Worker | vakaviti-onboard.helpronline.workers.dev | ✅ Live |
| Dashboard API Worker | vakaviti-dashboard-api.helpronline.workers.dev | ✅ Live |
| Widget CDN | widget.vakaviti.ai/widget.js | ✅ Live (caching fixed Session 21) |
| Lagi Public Page | lagi.vakaviti.ai | ✅ Live (v5) |
| Blue Lagoon Demo | vakaviti-bluelagoon.pages.dev | ✅ Live |
| Palms Denarau Demo | vakaviti-palms-denarau.pages.dev | ✅ Live |
| Nadi Transfers Demo | vakaviti-nadi-transfers.pages.dev | ✅ Live |
| Tour Fiji Tours Demo | vakaviti-tourfiji.pages.dev | ✅ Live |
| Join Page | join.vakaviti.ai | ✅ Live |
| Dashboard | dashboard.vakaviti.ai | ✅ Live (v2) |
| Main Domain | vakaviti.ai / www.vakaviti.ai | ✅ Live |
| WhatsApp Worker | vakaviti-whatsapp Worker | ✅ Live (v5) |

---

## Widget CDN — widget.vakaviti.ai
- Served from Cloudflare Pages project: vakaviti-widget
- Cache-Control: no-store, no-cache, must-revalidate ✅ (fixed Session 21)
- Snippet for all sites:
```html
<script src="https://widget.vakaviti.ai/widget.js"
        data-site-id="op_SITEID_001"
        defer></script>
```

---

## Lagi — AI Concierge (v48 current)
- Model: claude-sonnet-4-5, max_tokens: 800
- 4-layer system prompt + deals engine + power lead engine + itinerary builder
- RAG: 319+ Vectorize vectors
- WhatsApp Business API: live (Meta App ID: 1700903951357623)
- Test number: +1 (555) 641-4099

---

## D1 Database — vakaviti-kb

### Partners in D1 (15 total)

| ID | Name | Domain | Status |
|---|---|---|---|
| op_nadi_001 | Nadi Airport Transfers | nadiairporttransfers.com | active |
| op_vosavakaviti_001 | Vosa Vakaviti | vosavakaviti.com | active |
| op_tourfiji_001 | Tour Fiji Tours | tourfijitours.com | active |
| op_palms_001 | The Palms Denarau | thepalmsdenarau.com | active |
| op_bluelagoon_001 | Blue Lagoon Beach Resort | bluelagoonresortfiji.com | active |
| op_smugglers_001 | Smugglers Cove | — | active |
| op_fijitourtransfers_001 | Fiji Tour Transfers | fijitourtransfers.com | active |
| op_fijithingstodo_001 | Fiji Things To Do | fijithingstodo.com | active |
| op_guidefiji_001 | Guide Fiji | guidefiji.com | active |
| op_bestfijitours_001 | Best Fiji Tours | bestfijitours.com | active |
| op_fijihomestayz_001 | Fiji Homestayz | fijihomestayz.com | active |
| op_realfijitours_001 | Real Fiji Tours | realfiji.tours | active |
| op_fijiepictours_001 | Fiji Epic Tours | fijiepictours.com | active |
| op_fijitoursonline_001 | Fiji Tours Online | fijitours.online | active |
| op_fijidaytours_001 | Fiji Day Tours | fijidaytours.com.au | active |
| op_bookfijitours_001 | Book Fiji Tours | bookfijitours.com.au | active |

---

## Domain Portfolio — Lagi Installation Status

| Domain | Visits/mo | Lagi Status | site_id |
|---|---|---|---|
| fijitourtransfers.com | 8,960 | ✅ Live | op_fijitourtransfers_001 |
| nadiairporttransfers.com | 2,740 | ✅ Live | op_nadi_001 |
| guidefiji.com | 2,130 | ✅ Live | op_guidefiji_001 |
| fijithingstodo.com | 1,560 | ✅ Live | op_fijithingstodo_001 |
| bestfijitours.com | 1,280 | ✅ Live | op_bestfijitours_001 |
| fijihomestayz.com | 1,170 | ⬜ Pending | op_fijihomestayz_001 |
| realfiji.tours | 1,080 | ⬜ Pending | op_realfijitours_001 |
| fijiepictours.com | 986 | ⬜ Pending | op_fijiepictours_001 |
| fijitours.online | 967 | ⬜ Pending | op_fijitoursonline_001 |
| vosavakaviti.com | 921 | ✅ Live | op_vosavakaviti_001 |
| fijidaytours.com.au | 756 | ⬜ Pending | op_fijidaytours_001 |
| vakaviti.ai | 786 | ✅ Live | platform |
| bookfijitours.com.au | 632 | ⬜ Pending | op_bookfijitours_001 |

**DO NOT install on:** eastwoodplumbing.au, innerwestplumber.au, petershamplumbing.au, aiwebst.online

---

## WordPress Sites with Lagi Installed (Session 20)
fijitourtransfers.com, tourfijitours.com, natadolabayhorseriding.com, coralcoasthorseriding.com, bulaadventure.com, fijitourpackages.com, bulahappiness.com, fijibula.com, namosiadventuretoursfiji.com, wananavudeals.com

---

## Windows Deployment Process
```cmd
move %USERPROFILE%\Downloads\[filename].html %USERPROFILE%\Desktop\index.html
```
Type Yes if prompted.
```cmd
powershell Compress-Archive -Path %USERPROFILE%\Desktop\index.html -DestinationPath "%USERPROFILE%\Desktop\deploy.zip" -Force
```
Upload deploy.zip to Cloudflare Pages → correct project → Deployments → Create new deployment.

---

## Critical Rules
- Never call api.anthropic.com from browser
- Always pass site_id in widget script tag
- Windows: use CMD move command to rename files — avoids .html.html bug
- Cloudflare Pages merge deploys — uploading index.html only does NOT delete other files

---

## Pending Actions (Session 22)

1. ⬜ Install Lagi on fijihomestayz.com (1,170/mo)
2. ⬜ Install Lagi on realfiji.tours (1,080/mo)
3. ⬜ Install Lagi on fijiepictours.com (986/mo)
4. ⬜ Install Lagi on fijitours.online (967/mo)
5. ⬜ Install Lagi on fijidaytours.com.au (756/mo)
6. ⬜ Install Lagi on bookfijitours.com.au (632/mo)
7. ⬜ Fix fiji679.com domain (down — flag for developer)
8. ⬜ Add partners/ and database/ to GitHub repo
9. ⬜ Connect Cloudflare Pages to GitHub auto-deploy

---

## Session Log

| Date | Session | What was built |
|---|---|---|
| 2026-05-18 | Session 21 | Widget caching fixed (_headers, Cache-Control: no-store confirmed). 10 new sites registered in D1. Lagi installed on fijitourtransfers.com, guidefiji.com, fijithingstodo.com, bestfijitours.com. All Cloudflare Pages sites. 4 of 10 pending sites done. |
| 2026-05-18 | Session 21 | CORS fix deployed to Worker v48 — all 10 WordPress domains added to ALLOWED_ORIGINS. fijitourtransfers.com confirmed working. fijihomestayz.com (Cloudflare Pages: fijivillagehomestay) — pending snippet install. realfiji.tours, fijiepictours.com, fijitours.online, fijidaytours.com.au, bookfijitours.com.au — pending. |
1. ⬜ Install Lagi on fijihomestayz.com (Pages: fijivillagehomestay)
2. ⬜ Install Lagi on realfiji.tours
3. ⬜ Install Lagi on fijiepictours.com
4. ⬜ Install Lagi on fijitours.online
5. ⬜ Install Lagi on fijidaytours.com.au
6. ⬜ Install Lagi on bookfijitours.com.au
| 2026-05-18 | Session 21-22 | lagi.vakaviti.ai 
rebuilt — hero image, trust bar, live deals 
slider, starter chips. vakaviti.ai redirect live. 
Facebook bio + WhatsApp action button live. 
Island Vibes post updated. 7.5K followers pointed 
to Lagi. OG image card pending — Cloudflare bot 
fix needed. |
| 2026-05-18 | Session 22 | Facebook OG card live — 
Fiji ocean image showing. Cloudflare WAF rule 
deployed — Facebook scraper allowed. Island Vibes 
post live to 7.5K followers with lagi.vakaviti.ai 
link. 5 site installs pending — fijihomestayz.com 
next (project: fijivillagehomestay). |
| 2026-05-18 | Session 23 | Emergency fix: www.nadiairporttransfers.com was pointing to Namecheap parking page — fixed DNS CNAME to fttlandingpage.pages.dev, added custom domain to Cloudflare Pages, SSL active. Google Search Console: homepage + www re-indexed, sitemap resubmitted (23 pages). index.html brand fixes committed to GitHub: title tag fixed, og:title fixed, schema name fixed, nav/footer "Fiji Tour Transfers" → "Nadi Airport Transfers", phone → +679 936 9435, WhatsApp only in nav, auto email on booking fires to helpronline@gmail.com via vakaviti-leads Worker. Repo made public — Claude can now assist faster. WhatsApp Lagi confirmed working end-to-end (two live test responses). Referral markdown bug on WhatsApp identified (pending Worker fix). app.js brand name fix pending (FijiTransfers + AU number injected dynamically). Full site checklist compiled — 15 sites to verify Lagi widget. CEO priority board built. |
| 2026-05-19 | Session 23 | Emergency fixes: www.nadiairporttransfers.com DNS fixed (was pointing to Namecheap parking) — CNAME updated, custom domain added to Cloudflare Pages, SSL active. Google Search Console: homepage + www re-indexed, sitemap resubmitted (23 pages). index.html brand fixes committed to GitHub. Booking widget crash diagnosed — root cause: deploying index.html alone deletes all other files (app.js, styles.css). Rule added: always zip ALL files together. Site restored via Cloudflare Pages rollback to 9e832da4. Vakaviti CEO Skill built and installed — SKILL.md + references/priorities.md + references/facebook.md + references/strategy.md. 16-session deep audit complete — all lost strategy recovered including revenue model (FJD 150-500/month), Stripe integration priority, Tourism Fiji endorsement opportunity, Pacific expansion roadmap, June launch plan, 30-minute weekly KB system. Sofitel Fiji demo page built and live (vakaviti-sofitel.pages.dev) — luxury design, real resort data, Lagi chat live. Sofitel seeded in D1 as op_sofitel_001. Enterprise hotel launch strategy built — 5-step playbook, Tawk.to competitive destruction, free pilot offer model. fijithingstodo.com CSS issue diagnosed — rollback applied. nadiairporttransfers.com booking widget confirmed working. WhatsApp Lagi confirmed working end-to-end. |
