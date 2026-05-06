# Integration Backlog

> Features that require external services or significant backend work. Not yet built. Listed in rough priority order.

---

## INT-1: Stripe payment integration 💰

**Priority: HIGHEST after current QA**

### Why
Currently every booking ends with WhatsApp. We lose ~20% of customers in the gap. Stripe Checkout would let us close the loop on the spot.

### What we need
- Stripe account (or use existing if one exists for tourfijitours.com)
- Stripe Checkout integration (NOT custom card form — use their hosted page)
- Webhook handler for payment-confirmed events (Cloudflare Worker)
- Email sender for paid-booking receipts (Resend, Postmark, or SendGrid)

### Customer flow
1. Customer fills booking form
2. Confirmation page shows two options: "Pay now" + "WhatsApp confirm"
3. "Pay now" → Stripe Checkout (Apple Pay, Google Pay, card)
4. After payment → Bula success card with both confirmation email AND WhatsApp link
5. Backend stores the booking + payment ID for reconciliation

### Pricing handling
- Stripe charges 1.7% + 30c per Australian card (acceptable)
- Show price in FJD on booking widget, convert to AUD for Stripe (Stripe doesn't natively support FJD)
- Use a fixed conversion at booking time, locked in

### Estimated build effort
2–3 days, including testing. Mostly client-side; Cloudflare Worker for webhook.

---

## INT-2: Live tour catalogue sync (WordPress → widget)

**Priority: HIGH for ongoing maintenance**

### Why
Tour data drifts. Manual sync isn't sustainable as we add more tours.

### Three options

#### Option A: WordPress REST API (cleanest)
- WordPress already exposes `/wp-json/wp/v2/...`
- Create a custom endpoint for tour data with the right fields
- Widget fetches on page load, falls back to hardcoded if offline
- **Cost:** Plugin development on WordPress side
- **Pro:** Truly live data
- **Con:** Requires WordPress dev access

#### Option B: Manual `tours.json` + Cloudflare KV
- Maintain `tours.json` in this project
- Update weekly
- Widget fetches from Cloudflare KV (cached globally)
- **Cost:** None
- **Pro:** Zero infra
- **Con:** Still manual

#### Option C: Webhook from WordPress on tour update
- WordPress fires webhook when a tour is saved
- Cloudflare Worker updates Cloudflare KV
- Widget reads from KV
- **Cost:** Webhook setup
- **Pro:** Eventually consistent
- **Con:** Most complex

### Recommendation
Option B for now (pragmatic), Option A when we have WordPress dev time.

---

## INT-3: Hotel partner integration

**Priority: HIGH for revenue scale**

### Why
Major hotels (Hilton, Sheraton, Outrigger) want concierge desk to book transfers and have them on the room bill. This is the institutional revenue channel.

### What we need
- Partner login URL (e.g. `partners.fijitourtransfers.com`)
- Per-hotel signed booking link (so concierge bookings can be tracked)
- Daily reconciliation report email to each hotel partner
- Stripe ACH or direct deposit to hotel for shared revenue
- Negotiated commission structure (typical: 15–25% to hotel)

### Customer flow
1. Tourist asks hotel concierge for transfer
2. Concierge logs into partner portal, makes booking
3. Booking confirmed via WhatsApp to driver
4. Customer rides
5. Charge appears on hotel bill at checkout
6. Hotel pays us at end of month, minus commission

### First three target hotels
1. **Hilton Denarau** — high volume, friendly to digital
2. **Outrigger Fiji** — mid-tier Coral Coast volume
3. **Pearl South Pacific** — Pacific Harbour anchor

### Estimated build effort
1–2 weeks. Mostly business / negotiation, the tech is easy.

---

## INT-4: Returning-customer profile (phone-based login)

**Priority: MEDIUM**

### Why
Tourists come back. Re-entering details is friction.

### What we need
- Phone-number-based identification (no password)
- SMS OTP via Twilio or AWS SNS
- Lightweight profile storage (Cloudflare KV or D1)
- Saved data: name, email, preferred vehicle, kids' ages
- Loyalty tier display

### Customer flow
1. Returning customer opens widget
2. Top of widget: "Welcome back? Enter phone to load your details"
3. Enter phone → receive SMS code → load profile
4. Booking form pre-fills

### Privacy
- Encrypted at rest
- Auto-delete profiles after 24 months of inactivity
- Customer can delete profile via WhatsApp request
- GDPR / Australian Privacy Act compliant

### Estimated build effort
1 week.

---

## INT-5: AI WhatsApp concierge

**Priority: MEDIUM (this is the AI in "AI-driven")**

### Why
The "AI-driven" claim in our positioning. Currently 100% human. Could automate 70% of common questions.

### What we need
- WhatsApp Business API access (Meta-approved business)
- AI model with Fiji domain knowledge (Anthropic Claude API or OpenAI)
- Booking system integration so AI can quote prices
- Human escalation path (when AI is stuck, hand to driver-coordinator)

### Examples of automated answers
- "How much from airport to Hilton?" → instant quote
- "What time do you pick up?" → asks flight number, calculates arrival + 30min
- "Do you have car seats?" → "Yes, +FJ$8 each per trip"
- "Is my driver on the way?" → checks booking system

### Examples requiring human
- Complex itineraries
- Group of 12+ bookings
- Wedding / corporate
- Unusual destinations

### Estimated build effort
2–4 weeks.

---

## INT-6: Driver mobile app

**Priority: LOWER (nice-to-have, not blocking growth)**

### Why
Currently drivers check WhatsApp manually. A purpose-built app would:
- Show daily booking schedule
- GPS check-in at pickup
- One-tap call to passenger
- Real-time customer "driver is X mins away" tracking

### What we need
- Native iOS + Android (or React Native)
- Driver authentication
- Backend booking system + GPS tracking
- Customer-facing tracking page

### Estimated build effort
4–8 weeks.

---

## INT-7: Domestic flight booking integration

**Priority: LOWER**

### Why
Customers booking Savusavu / Taveuni / Vanua Levu often need:
1. Nadi → Nausori transfer
2. Domestic flight (Fiji Airways, Northern Air)
3. Destination transfer

Currently we do (1) and (3), they figure out (2) themselves. If we could book all three, we'd capture more revenue.

### What we need
- Fiji Airways API (or scrape/screen-scrape if no API)
- Northern Air partnership / API
- Multi-leg booking flow
- Refund / change handling for cancellations

### Estimated build effort
3–4 weeks. May not be worth it — small market segment.

---

## INT-8: Google Maps / Places API for live custom-location pickup

**Priority: LOWER**

### Why
The current "Custom location" panel uses a zone dropdown for pricing. Customers can type any address. With Google Maps Places, we could:
- Autocomplete addresses as they type
- Get exact lat/lng (more accurate pricing)
- Show the location on a small map

### What we need
- Google Maps API key
- Places Autocomplete library
- Cost: ~$3 per 1000 API calls (need to monitor)

### Estimated build effort
1 week.

---

## INT-9: Email confirmation system

**Priority: MEDIUM**

### Why
Currently no email confirmation. Customer relies on WhatsApp screenshot. Email creates a permanent record.

### What we need
- Transactional email service (Resend, Postmark, SendGrid)
- HTML email template (matches Bula success card)
- Cloudflare Worker to send on booking confirm
- Domain authentication (SPF, DKIM, DMARC)

### Email sequence
1. Booking confirmation (immediate)
2. Pre-trip reminder (24 hr before)
3. Day-of pickup details (4 hr before)
4. Post-trip thank-you + review request (next day)

### Estimated build effort
3–5 days.

---

## INT-10: SMS fallback for non-WhatsApp customers

**Priority: LOWER**

### Why
Some markets (USA, UK older travellers) don't use WhatsApp as primary messaging.

### What we need
- Twilio account
- Detect customer country from phone number
- If country = US/UK and customer < 65 → still default WhatsApp
- If country = US/UK and customer > 65 → offer SMS

### Estimated build effort
2 days.

---

## How to use this backlog

When something is ready to be built:

1. Move it to `ROADMAP.md` under "Next" or "Soon"
2. Open a project ticket
3. When shipped, move to `BUILD_LOG.md`
4. Update relevant docs (PRICING_MODEL, HOTEL_DATABASE, etc)

When new integration ideas come up, add them here first. Don't build until they hit the roadmap.
