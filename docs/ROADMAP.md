# Roadmap — Fiji Tour Transfers Platform

> Prioritised by ROI and customer impact. Updated whenever we ship something or learn something new.

## Now (in active development)

### NOW-1: Brand consistency cleanup ⚠️ HIGH PRIORITY
- [ ] Fix logo typo on live WordPress site ("fijitourstransfers.com" → "fijitourtransfers.com")
- [ ] Reconcile email domain confusion (info@tourfiji.tours vs fijitourtransfers.com)
- [ ] Decide: is "Fiji Tourism Guide" a separate brand or rename to "Fiji Tour Transfers"?
- [ ] Update copyright footer on WordPress site
- [ ] Set up consistent logo, colour palette, voice across all properties

**Why now:** Bleeding trust on every page view. Highest-ROI fix possible. Costs us nothing.

### NOW-2: Test the current build end-to-end
- [ ] Deploy latest build to Cloudflare Pages
- [ ] Test 5 booking scenarios on mobile (airport→Denarau, airport→Coral Coast, tour booking, return trip, custom location)
- [ ] Verify all 16 tour images load correctly
- [ ] Verify typeahead search works on mobile keyboard
- [ ] Test Bula success card on actual phone
- [ ] Verify discount calculation for orders just-over-FJ$50

**Why now:** We've shipped a lot of features rapidly; need a real-world QA pass before promoting it.

---

## Next (next 2 weeks)

### NEXT-1: Stripe payment integration 💰
**The single biggest lever for conversion.**

Currently every booking ends with a WhatsApp handoff. ~20% of customers never complete the WhatsApp send (we lose them in the gap between widget and chat). Adding Stripe pay-now would convert these.

- [ ] Set up Stripe account or get keys from existing one
- [ ] Add "Pay now" button as a third option alongside WhatsApp
- [ ] Build Stripe Checkout integration (no card form — use hosted page)
- [ ] Handle paid bookings differently: instant email confirmation, calendar invite
- [ ] Test 3DS / SCA compliance for Australian + NZ cards
- [ ] Add fraud screening rules

**Estimated impact:** +15-25% booking completion rate.

### NEXT-2: Real-time tour catalogue sync
Tours currently hardcoded. They drift from main site within weeks.

- [ ] Decide between options:
  - Option A: WordPress REST API (`/wp-json/wp/v2/...`) — needs WordPress plugin enabled
  - Option B: Manual `tours.json` updated weekly — pragmatic, no infra changes
  - Option C: Build a WordPress webhook that pushes price changes
- [ ] Implement chosen option
- [ ] Add fallback to hardcoded data if fetch fails (always graceful degradation)
- [ ] Test daily cron / scheduled refresh

### NEXT-3: Hotel-partner room-charging
Major Fiji hotels (Hilton, Sheraton, Outrigger, Shangri-La, Marriott) offer "room-charge" billing. Tourists book transfers via concierge desk and it goes on their hotel bill.

- [ ] Build hotel-partner login (separate URL, separate dashboard)
- [ ] Generate signed booking links for partner concierges
- [ ] Daily reconciliation report email to each partner hotel
- [ ] Negotiate first 3 hotel partnerships (start with Hilton Denarau, Outrigger, Pearl Pacific Harbour)

**Estimated impact:** Unlocks corporate booking volume — could 10x bookings.

---

## Soon (1–3 months)

### SOON-1: Returning-customer profile
Tourists return to Fiji every 1–3 years. Right now they re-enter all details every time.

- [ ] Phone-number-based profile (no password, just SMS OTP)
- [ ] Save: name, email, preferred vehicle, kids' ages (for car seats), favourite hotels
- [ ] One-tap re-book from profile
- [ ] Loyalty tier display ("This is your 4th Fiji booking with us — you're a Tagimoucia member")

### SOON-2: Multi-language support
- [ ] English (already)
- [ ] Mandarin Chinese (large NZ tourism segment)
- [ ] Japanese (premium market segment)
- [ ] Auto-detect via browser language

### SOON-3: Smart departure scheduler
At 11pm before a 6am departure, customers panic. Smart push:
- [ ] At hotel check-in (via partner): auto-suggest pickup time based on flight
- [ ] 4-hour pre-flight WhatsApp confirmation: "Your driver is on the way"
- [ ] 30-minute warning: "Arriving in 30 mins, please be in lobby"

### SOON-4: Tour upsell on transfer confirmation
When a customer books a Coral Coast transfer, recommend Coral Coast Beach Horse Riding right there. Smart match by destination, available time, group composition.

### SOON-5: Cruise ship arrival mode
On ship arrival days at Lautoka / Port Denarau (we know the schedules — Carnival, P&O, Norwegian, etc), launch a special booking flow:
- [ ] Detect cruise day from URL parameter or date
- [ ] Show "Today only" tour packages with guaranteed return-by-departure
- [ ] Bulk pricing for groups of 4+ from same cabin

---

## Later (3–12 months)

### LATER-1: AI concierge chat (the "AI-driven" promise)
- [ ] WhatsApp + web chat assistant trained on Fiji tour knowledge
- [ ] Natural language booking: "I'm at the Hilton, need to get to the Sand Dunes tomorrow morning, party of 4"
- [ ] AI handles 70% of pre-booking questions, escalates to human for booking confirm

### LATER-2: Driver app
- [ ] Driver mobile app showing daily bookings
- [ ] GPS check-in at pickup point
- [ ] Tap-to-call passenger
- [ ] Customer "driver is X minutes away" tracking link

### LATER-3: Sister-brand landing pages on this platform
Reuse this platform for the brand portfolio:
- [ ] coralcoasthorseriding.com — already built, port to this engine
- [ ] natadolabayhorseriding.com — already built, port to this engine
- [ ] sigatokasanddunestours.com (new)
- [ ] beqasharkdive.com (new — premium positioning)
- [ ] Each gets its own theme but shares the booking engine

### LATER-4: Loyalty programme
- [ ] "Bula Member" tier (1–3 bookings)
- [ ] "Vinaka Member" tier (4–10 bookings)
- [ ] "Tagimoucia Member" tier (11+ bookings) — automatic upgrades, dedicated WhatsApp line
- [ ] Refer-a-friend: FJ$25 credit each way

### LATER-5: Corporate / wedding / event bookings
- [ ] Group booking flow (10+ people)
- [ ] Wedding transfer packages (matching vehicles, decorations)
- [ ] Conference shuttles (Hilton-Denarau-Sheraton-Westin loop)

---

## Idea pile (not committed, just noted)

- Tour + accommodation bundles ("Coral Coast Weekender")
- TripAdvisor / Google review automation (post-trip ask via WhatsApp)
- Automated lost-and-found service (driver finds phone in vehicle, customer notified)
- Surfboard / dive gear hire add-ons
- Pre-trip "what to expect" video sent to customer 24hr before arrival
- Post-trip thank-you email with 10% off return visit
- Partner with Fiji Airways — show booking link in confirmation email
- Lobby tablet app for partner hotels (concierge desk integration)
- Branded merch (caps, water bottles) given to top customers

---

## What we WON'T do

- ❌ Build a separate iOS / Android app — WhatsApp IS our app
- ❌ Compete on price below Bula Taxi (we're premium)
- ❌ Build a marketplace for other operators (we're a vertical brand, not Booking.com)
- ❌ Add cryptocurrency payments (no demand, regulatory headache)
- ❌ Sell flights or hotel rooms (out of scope; partner with those instead)

---

## How to read this roadmap

- **NOW** = doing right now this week
- **NEXT** = next 2 weeks, next sprint
- **SOON** = in active planning, 1–3 months out
- **LATER** = strategic direction, 3–12 months
- **IDEA PILE** = noted but not committed

When something ships, move it to `BUILD_LOG.md` and tick it off here.
