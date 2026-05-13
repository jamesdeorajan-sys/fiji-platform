# Vakaviti.ai — Partner Demo Page Build Standard
## Version 1.0 — Documented 2026-05-14

---

## THE REFERRAL BUTTON PROBLEM (and permanent fix)

### What we learned the hard way

When Lagi refers a visitor to a partner (e.g. Blue Lagoon → Nadi Airport Transfers),
we need a green WhatsApp button to appear in the chat with a pre-filled message.

**What DOES NOT work:**
- Asking Claude to output a markdown link `[label](url)` — Claude adds newlines between `]` and `(`
- Asking Claude to output a raw URL — `escHtml()` breaks the URL before the regex sees it
- Text markers like `WA_BTN:url:label` — colons in URLs break the split
- Browser-side regex on Claude's response — too fragile, too many edge cases

**What WORKS (permanent solution):**
The Worker returns the referral button as a **separate JSON field** — completely separate
from the message text. The demo page reads it and renders it directly with DOM.
No parsing. No regex. No escaping issues. Works 100% of the time.

---

## THE PATTERN (copy this for every new partner demo page)

### 1. Worker response shape

The chat Worker (`fiji-chat-widget`) returns:
```json
{
  "type": "reply",
  "message": "Lagi's text response here",
  "intent": "transfers",
  "referral_btn": {
    "url": "https://wa.me/61478886145?text=Hi%20Nadi%20Airport%20Transfers...",
    "label": "Contact Nadi Airport Transfers on WhatsApp"
  }
}
```

`referral_btn` is `null` when no referral applies.
`referral_btn` is populated when D1 `partner_referrals` has a matching row for this `site_id` + `intent`.

### 2. Demo page fetch handler (copy this exactly)

```javascript
const response = await fetch(WORKER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages:   messages,
    site_id:    'op_XXX_001',   // ← change per partner
    partner_id: 'op_XXX_001',   // ← change per partner
    session_id: 'session-' + Date.now()
  })
});

const data = await response.json();
const reply = data.message || "Sorry, I didn't catch that — please try again.";

messages.push({ role: 'assistant', content: reply });
const msgDiv = addBotMessage(reply);

// ── REFERRAL BUTTON — DO NOT CHANGE THIS PATTERN ──────────────
// The Worker returns referral_btn as a clean JSON field.
// We render it directly with DOM — no parsing, no regex, no escaping.
// This is the only reliable way to render WhatsApp buttons.
if (data.referral_btn && data.referral_btn.url) {
  const btn = document.createElement('a');
  btn.href = data.referral_btn.url;
  btn.target = '_blank';
  btn.rel = 'noopener';
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin-top:10px;padding:10px 18px;background:#25D366;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:500;';
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg> ' + data.referral_btn.label;
  msgDiv.querySelector('.msg-bubble').appendChild(btn);
}
// ── END REFERRAL BUTTON ────────────────────────────────────────
```

### 3. addBotMessage must return the div

```javascript
function addBotMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg bot';
  div.innerHTML = `
    <div class="msg-mini-avatar">🌊</div>
    <div class="msg-bubble">${formatText(text)}</div>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;  // ← MUST return div so referral button can append to it
}
```

### 4. formatText — keep simple, no WhatsApp link handling needed

```javascript
function formatText(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^#{1,3} (.+)$/gm, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '• $1')
    .replace(/\n/g, '<br>');
}
// No WhatsApp URL handling needed here — referral button comes from JSON field
```

---

## HOW REFERRALS ARE CONFIGURED

Referrals are rows in D1 `partner_referrals` table:

```sql
-- Blue Lagoon transfers → Nadi Airport Transfers
INSERT INTO partner_referrals (id, site_id, intent_category, referred_partner_id, priority, active)
VALUES ('ref_bluelagoon_transfers', 'op_bluelagoon_001', 'transfers', 'op_nadi_001', 1, 1);

-- Blue Lagoon tours → Tour Fiji Tours  
INSERT INTO partner_referrals (id, site_id, intent_category, referred_partner_id, priority, active)
VALUES ('ref_bluelagoon_tours', 'op_bluelagoon_001', 'tours', 'op_tourfiji_001', 1, 1);
```

To add a referral for a new partner: one SQL INSERT. That's it.
The Worker reads it automatically. The button appears automatically.

### Intent categories that trigger referrals
`transfers` | `tours` | `accommodation` | `dive` | `dining` | `ferry` | `language` | `general`

---

## BUILDING A NEW PARTNER DEMO PAGE

### Checklist
1. ⬜ Copy Blue Lagoon `index.html` as template
2. ⬜ Change `site_id` and `partner_id` to new partner's ID
3. ⬜ Update partner name, location, theme colour
4. ⬜ Update greeting text and chip questions
5. ⬜ Update WhatsApp number in the header strip
6. ⬜ Keep the referral button pattern EXACTLY as documented above
7. ⬜ Ingest partner KB into Vectorize (use `vakaviti-ingest-bl-worker.js` as template)
8. ⬜ Add referral rows to D1 `partner_referrals` for relevant intents
9. ⬜ Create Pages project, deploy zip, add custom domain

### What changes per partner (only these 5 things)
```javascript
const WORKER_URL = 'https://fiji-chat-widget.helpronline.workers.dev/';
const PARTNER_SITE_ID = 'op_XXX_001';        // ← change
const PARTNER_NAME = 'Partner Name';          // ← change  
const PARTNER_WHATSAPP = '6797XXXXXXX';       // ← change
const PARTNER_THEME = '#0d4d6e';              // ← change (hex colour)
```

Everything else is identical across all partner pages.

---

## WORKER — HOW REFERRAL_BTN IS BUILT

In `fiji-chat-widget` (Lagi v2+), after Claude responds:

```javascript
// Strip any WhatsApp links Claude may have output
let finalReply = replyText
  .replace(/\[([^\]\n]+)\][\s\S]{0,10}\(https?:\/\/wa\.me\/[^)]*\)/g, '')
  .replace(/https?:\/\/wa\.me\/\S+/g, '')
  .trim();

// Build referral button as separate JSON field
let referralBtn = null;
if (referralPartner && referralPartner.whatsapp_number) {
  const refWaNum = (referralPartner.whatsapp_number || '').replace(/[^0-9]/g, '');
  const refName = referralPartner.name || 'our partner';
  const sourceName = (partnerInfo && partnerInfo.name) ? partnerInfo.name : 'Vakaviti.ai';
  const prefilledMsg = 'Hi ' + refName + '! I was referred by ' + sourceName + ' via Vakaviti.ai and need help with ' + intent + '.';
  referralBtn = {
    url:   'https://wa.me/' + refWaNum + '?text=' + encodeURIComponent(prefilledMsg),
    label: 'Contact ' + refName + ' on WhatsApp',
  };
}

return json({ type: 'reply', message: finalReply, intent, referral_btn: referralBtn }, 200, cors);
```

---

## CONFIRMED WORKING TEST (2026-05-14)

- Site: vakaviti-bluelagoon.pages.dev
- Query: "transfer to nadi airport"
- Intent detected: `transfers`
- Referral fired: `op_nadi_001` (Nadi Airport Transfers)
- Button rendered: ✅ Green WhatsApp button
- Pre-filled message: "Hi Nadi Airport Transfers! I was referred by Blue Lagoon Beach Resort via Vakaviti.ai and need help with transfers."
- Message delivered to WhatsApp: ✅ Confirmed

---

## NEVER DO THESE THINGS

| ❌ Don't | ✅ Do instead |
|---|---|
| Ask Claude to output `[label](url)` | Return `referral_btn` in JSON |
| Parse Claude's response for URLs | Use the JSON field directly |
| Use text markers like `WA_BTN:` | Use JSON fields |
| Put WhatsApp links in system prompt | Inject server-side after Claude responds |
| Use innerHTML with Claude's text for links | Use DOM createElement for buttons |
