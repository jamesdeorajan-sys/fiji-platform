# Brand Guidelines — Fiji Tour Transfers

> Brand consistency = trust. Every customer touchpoint must reflect the same identity. Inconsistency bleeds conversions.

## ⚠️ Current brand fragmentation problem

The live WordPress site at fijitourtransfers.com currently shows **four different brand identities** on a single page. This must be fixed.

| Touchpoint | Currently Shows | Should Show |
|---|---|---|
| Header logo text | "fijitourstransfers.com" (typo) | "Fiji Tour Transfers" |
| Domain | fijitourtransfers.com (no extra s) | (correct as-is) |
| Email | info@tourfiji.tours (different domain!) | info@fijitourtransfers.com |
| Footer copyright | "Fiji Tourism Guide" (different brand) | "Fiji Tour Transfers" |
| Phone WhatsApp greeting | "Bula Vinaka" | "Bula! Welcome to Fiji Tour Transfers" |

**This is the highest-priority fix in the entire roadmap.** Every visitor to your site sees four brands and unconsciously thinks "is this a real company?"

---

## The official brand

### Name
**Fiji Tour Transfers**

(Two words: "Tour" and "Transfers" together describe what we do. Don't shorten to "FTT" except in booking refs.)

### Tagline
**"One message. We sort it."**

(Captures the WhatsApp-first concierge promise, fits in 4 words, scales from header to footer.)

### Domain
**fijitourtransfers.com** (singular)

NOT:
- ❌ fijitourstransfers.com (extra s before transfers)
- ❌ fijitour-transfers.com (no hyphen)
- ❌ fjtourtransfers.com

### Email
**info@fijitourtransfers.com** (canonical)

The current `info@tourfiji.tours` should be retired or set to forward to the canonical address.

### WhatsApp & Phone
**+61 478 886 145**

International format. The "61" prefix is correct because we're an Australian-registered business operating Fiji tours.

### Greeting
"Bula!" or "Bula Vinaka!" (when warm response wanted)

Never use "Hello" or "Hi" alone — Fiji-style hospitality is part of the brand.

### Closing
"Vinaka!" or "Vinaka vakalevu!" (more emphatic)

---

## Voice & tone

We are:
- **Warm** — not corporate
- **Knowledgeable** — local Fiji expertise
- **Direct** — say what we'll do, do it
- **Professional** — never sloppy, never typos

We are NOT:
- ❌ Salesy or pushy
- ❌ Stiff or formal
- ❌ Overly casual ("hey buddy!")
- ❌ Generic ("dear valued customer")

### Examples

**Good:**
- "Bula James! Your driver Junior will be at Nadi Arrivals Hall at 10:15 with a sign showing your name."
- "Just landed and can't find us? WhatsApp +61 478 886 145, we'll find you."
- "We're online for your whole Fiji stay — pharmacy run? Sigatoka tour? Just say the word."

**Bad:**
- ❌ "Hi James! We received your booking inquiry and are processing it now."
- ❌ "Greetings, valued customer."
- ❌ "Hey bro, see ya at the airport!"

---

## Colour palette

```css
/* Primary brand colours */
--ocean:      #0066cc;   /* Primary brand blue — Fiji ocean */
--sunset:     #f97316;   /* Accent orange — Fiji sunset */
--coral:      #dc2626;   /* Hibiscus red — for discounts and CTAs */
--palm:       #10b981;   /* Tropical green — for success states */
--sand:       #fef3c7;   /* Warm sand — for wellness/calm sections */

/* Functional greys */
--ink:        #0f172a;   /* Body text */
--mist:       #475569;   /* Secondary text */
--cloud:      #94a3b8;   /* Muted text */
--paper:      #ffffff;   /* Card backgrounds */
--mist-tint:  #f1f5f9;   /* Section separators */
```

These are aspirational — not all are currently in `styles.css`. Migrate gradually.

---

## Typography

- **Headings:** DM Sans (modern, friendly, distinctive)
- **Body:** DM Sans (consistent, clean)
- **Mono:** SF Mono / monospace fallback (booking refs, code)

Hierarchy:
- H1: 36–48px bold
- H2: 28–32px bold
- H3: 20–24px bold
- Body: 15–16px regular
- Small: 13–14px regular

---

## Logo (TBD — needs creating)

Currently using a JPEG of a hibiscus emblem on the WordPress site. This needs:
- [ ] Vector SVG version
- [ ] Light + dark variants
- [ ] Square + horizontal layouts
- [ ] Favicon set

Until a proper logo exists, use the hibiscus emoji 🌺 in a coloured circle as a placeholder.

---

## Marketing claims (truthful, defensible)

When writing marketing copy, only use claims that are actually true:

- ✅ "3.19 million views in 90 days on our Facebook page" (verified)
- ✅ "Largest independent Fiji tourism Facebook page" (verifiable)
- ✅ "110+ Fiji hotels supported" (count from app.js)
- ✅ "Online throughout your Fiji stay" (operational claim, true)

Do NOT use claims like:
- ❌ "Voted #1 in Fiji" (by who?)
- ❌ "Trusted by thousands" (vague)
- ❌ "Best price guaranteed" (we don't have price-match infrastructure)
- ❌ "Award-winning" (which awards?)

---

## Cross-property consistency

When this platform powers other landing pages (coralcoasthorseriding.com, natadolabayhorseriding.com, etc), each gets:

1. **Its own colour accent** (premium horse riding = teal, budget horse = sandy gold)
2. **Same booking widget** (this platform), styled in the parent brand's accent
3. **Footer links back** to fijitourtransfers.com as the main brand
4. **Same WhatsApp number** (+61 478 886 145)
5. **Same vehicle / pricing model**

This means: a customer who arrives via coralcoasthorseriding.com still sees they're booking with Fiji Tour Transfers. No surprises, no rebrand mid-flow.

---

## Brand fixes — action items

In order:

1. [ ] **Fix WordPress logo typo** ("fijitourstransfers.com" → no extra s)
2. [ ] **Set up info@fijitourtransfers.com** as primary email; forward tourfiji.tours
3. [ ] **Update WordPress footer copyright** ("Fiji Tourism Guide" → "Fiji Tour Transfers")
4. [ ] **Decide on Fiji Tourism Guide brand** — is it a separate Facebook page only, or also a brand?
5. [ ] **Commission proper logo** (vector SVG, multiple variants)
6. [ ] **Audit all email signatures** across team
7. [ ] **Audit all social profiles** (Facebook, Instagram, Twitter, YouTube) — same name everywhere

These cost almost nothing but compound trust on every page view.
