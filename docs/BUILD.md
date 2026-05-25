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
