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

## Live Systems (as of 2026-05-12)

| System | URL | Status |
|---|---|---|
| FTT Booking Site | nadiairporttransfers.com | ✅ Live |
| Vakaviti Dictionary | vosavakaviti.com | ✅ Live |
| Chat Worker | fiji-chat-widget.helpronline.workers.dev | ✅ Live (v4) |
| Drafting Console | fiji-drafting-console.helpronline.workers.dev | ✅ Live |
| Palms Denarau Demo | vakaviti-palms-denarau.pages.dev | ⚠️ Live but needs site_id fix |
| Blue Lagoon Demo | vakaviti-bluelagoon.pages.dev | ✅ Live & working |

---

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
