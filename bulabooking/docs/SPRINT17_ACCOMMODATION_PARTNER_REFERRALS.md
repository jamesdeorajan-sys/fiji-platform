# Sprint 17 — accommodation promotion and direct partner referrals

## Binding CEO decision
BulaBooking is an AI-driven accommodation promotional resource, NOT a hotel booking engine. Accommodation providers retain their own website, real-time availability, reservation confirmation, guest payments, cancellation and inventory. Do not build hotel checkout, hotel booking records, payment collection or room-allocation integrations for this vertical.

## Journey
Approved operator submits real promotion, FJD rate, price basis, validity dates, stay dates, terms, official HTTPS booking URL and proof of booking-domain control. Staff approves. BulaBooking promotes the offer and clearly labels 'Book direct with accommodation'. Guest leaves BulaBooking to check current availability and reserve on the provider site. No guarantee of live availability or final price on BulaBooking.

## Offer expiry
Use trusted server time with offset-aware timestamps. On expiry stop special CTA and label expired; keep evergreen accommodation page if useful, remove outdated offer structured data and active sitemap promotional entries. Operator may pause or withdraw.

## Analytics
Track privacy-conscious outbound referral events with campaign/listing/partner IDs and consent rules. Distinguish impressions and outbound clicks from bookings. Confirmed bookings and revenue only if the provider voluntarily returns verified conversion records or approved attribution integrations. Avoid leaking guest identifiers in outbound URLs.

## Trust, compliance and commercial
Approve booking URL against verified provider-controlled HTTPS origin to avoid phishing/open redirects. Check destination before each redirect server-side and after edits. Disclose affiliations, sponsored placement and any promotional fees; never imply all operators are verified or claim #1 without substantiation. Maintain zero tour commission decision separately; accommodation promotion commercial model needs CEO approval.

## AI opportunity
Operator-approved AI listing copy, destination FAQs, translations, quality scoring, seasonal offer suggestions and SEO metadata. AI must not invent discounts, scarcity, occupancy, availability, reviews or hotel prices. Prioritise real, original provider content and helpful destination context.

## Current code status
Pure referral contract and tests only; no operator dashboard, URL ownership verification service, live analytics, indexing or deployment. Existing Sprint 16 accommodation-specials code uses 'bookable' terminology and must be retired or adapted for promotion-only flows. No production changes.
