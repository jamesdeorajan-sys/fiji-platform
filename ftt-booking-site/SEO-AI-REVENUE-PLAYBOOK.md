# Fiji Dash SEO + AI Revenue Optimisation Playbook

## Operating rule
Use the existing Fiji estate only. Do not create a new site, brand, domain, DNS route or speculative platform as part of this optimisation sprint.

## Revenue objective
Maximise completed bookings, not traffic volume. Every optimisation should improve one of four outcomes:
1. more qualified discovery,
2. higher booking intent,
3. better booking conversion,
4. higher revenue per traveller through return transfers and tour/activity cross-sell.

## Today's priority clusters
### Cluster A — Nadi Airport / Denarau
Primary transaction surface: Fiji Dash / Nadi Airport transfer pages.
Priority pages: Port Denarau, Hilton, Sheraton, Sofitel, Radisson.
Commercial intent: airport transfer, resort transfer, ferry connection, return transfer.

### Cluster B — Natadola
Primary transaction surfaces: Fiji Dash for transfer; Fiji Tour Transfers for horse riding/tours.
Supporting authority: ComeToFiji Natadola destination guide.
Commercial intent: InterContinental transfer, Natadola Beach, horse riding, local experiences, private transport.

### Cluster C — Coral Coast
Primary transaction surfaces: Outrigger, Warwick, Naviti and related Fiji Dash route pages; Fiji Tour Transfers for activities.
Supporting authority: ComeToFiji Coral Coast guide.
Commercial intent: airport transfer, horse riding, private day tours, family activities, return transfer.

### Cluster D — Cruise / Port Denarau
Primary transaction surfaces: Port Denarau transfer page and Fiji Tour Transfers cruise activity inventory.
Commercial intent: airport-to-marina transfer, ferry connection, shore excursion, pre/post-cruise private transport.

### Cluster E — Long haul
Primary transaction surfaces: Pacific Harbour, Suva, Nausori and related route pages.
Commercial intent: private long-distance transfer, airport connection, resort transport.

## Existing-estate role separation
- Fiji Tour Transfers: tours, activities, private experiences and transfer cross-sell.
- Fiji Dash / Nadi Airport Transfers: transaction-first airport and point-to-point transport.
- ComeToFiji: destination and trip-planning acquisition.
- Vakaviti / Lagi: local knowledge, operator discovery and AI conversational layer.
- Specialist sites: narrow niche authority only; route qualified traffic to the most relevant money page.

Do not publish near-identical pages across domains solely to chase the same keyword.

## AI-search standard
For transaction pages expose accurate, crawlable facts:
- provider / brand
- exact origin and destination
- FJD price or clear quote path
- passenger / luggage capacity
- estimated distance and journey time
- flight-delay handling
- modification / cancellation terms where applicable
- direct booking URL
- WhatsApp fallback
- canonical URL
- structured data only when it accurately reflects the live offer

Explicitly permit OAI-SearchBot and OAI-AdsBot where commercially appropriate. Keep llms.txt aligned with the live route inventory and use it to direct agents to the strongest existing transaction and destination pages.

## Conversion standard
A money page should answer within one mobile viewport:
- What route/experience is this?
- What does it cost or how do I get the exact price?
- How many people/bags fit?
- How long does it take?
- What happens if my flight is late?
- What do I press to book now?

Primary CTA: Book / Get price.
Secondary CTA: WhatsApp.

## Attribution standard
Before scaling paid campaigns, persist first-touch and last-touch attribution through the booking session for Google, Meta, ChatGPT/AI, ComeToFiji, Vakaviti/Lagi, WhatsApp/referral, direct and other sources. Never put customer PII in attribution URLs. Full implementation rules are in `ATTRIBUTION-SPEC.md`.

## Revenue flywheel
Discovery → route/experience page → quote/booking → human confirmation → fulfilment → return transfer/tour upsell → genuine review → stronger discovery → next booking.

## Daily scorecard
Track by source:
- qualified enquiries
- booking submissions
- confirmed bookings
- gross booking value
- contribution after operator payout/ad spend
- enquiry-to-booking conversion
- average booking value

Traffic, impressions and rankings are diagnostic metrics, not the final KPI.

## Guardrails
- no new websites
- no DNS changes in optimisation work unless separately approved
- no production deployment without regression checks
- no customer-specific booking pages indexed
- no change to booking confirmation truth model
