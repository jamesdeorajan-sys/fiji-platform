# Cloudflare Workers

Two Workers, both running on the `helpronline` Cloudflare account, both calling the same Anthropic API key.

## chat-widget/

**Live URL:** `https://fiji-chat-widget.helpronline.workers.dev/`

Customer-facing AI chat. Powers the floating chat widget on:
- `nadiairporttransfers.com`
- `vosavakaviti.com`
- `vakavitifijiandictionary.pages.dev`

### Configuration (set in Cloudflare dashboard, NOT in this file)

- **Secret:** `ANTHROPIC_API_KEY` (encrypted, never visible after setting)
- **KV binding:** `CHAT_USAGE` → KV namespace `CHAT_USAGE`
- **Daily token cap:** ~16,000,000 tokens (~$50/day at Sonnet 4.5 pricing)
- **Conversation cap:** 30 messages, then routes to WhatsApp
- **Origin allowlist:** Hardcoded in `worker.js`

### Key features

- Server-side markdown stripping (handles AI's tendency to use `**` for bold)
- Daily cost tracking via KV (resets at UTC midnight)
- Cross-brand context awareness (won't recommend Vakaviti to Vakaviti users)
- Pricing data baked into system prompt (one row per route × per vehicle, no column-counting)

### How to deploy

1. Edit `worker.js` locally
2. Open Cloudflare dashboard → Workers & Pages → `fiji-chat-widget` → Edit Code
3. Select all → delete → paste new contents
4. Click Deploy

### Critical maintenance

When pricing changes in `ftt-booking-site/src/app.js`, the corresponding prices in this Worker's system prompt MUST be updated to match. Mismatch = customers seeing different prices in chat vs booking widget = bad customer experience and legal exposure.

The pricing block in `worker.js` lists each route with three explicit per-vehicle lines:

```
Outrigger Fiji
  Sedan: FJ$129
  Minivan: FJ$159
  Minibus: FJ$199
```

Don't change this format — the per-line format eliminates the column-confusion bug we hit on 6 May 2026 where the AI quoted sedan prices for minivans.

---

## drafting-console/

**Live URL:** `https://fiji-drafting-console.helpronline.workers.dev/`

Internal-only AI tool for drafting WhatsApp replies. James-only — no authentication beyond the URL being unguessable.

### Files

- `worker.js` — backend, similar pattern to chat-widget but different system prompt
- `console.html` — HTML interface (also served by Cloudflare, often pasted into the Worker as a static response or hosted as a separate Pages project)

### Use case

James pastes incoming customer message into the console, AI generates a draft reply with confidence/escalate/reasoning/assumptions metadata. James reviews and uses or edits.

### Key difference from chat-widget

- Output is structured JSON (not plain text) — confidence score, suggested escalation, reasoning, assumptions
- No origin restriction (single user, single device)
- No daily cap (low volume, internal use only)
