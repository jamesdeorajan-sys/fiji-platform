# Sprint 16 — accommodation monthly specials (staging contract only)

## Why
Enable Fiji accommodation providers to submit time-limited, operator-approved FJD promotions and earn visibility without permanently discounting their standard rooms.

## Offer fields
Provider identity and approval; title; accommodation type, room type, max occupancy, verified promotional rate, rate basis (night/stay/person), taxes/fees, included meals/transport, cancellation, booking start/end, separate stay date window, blackout dates, available inventory, minimum nights, photo rights, full terms, price history substantiation and disclosure of any external fees.

## Time correctness
All offer timestamps must be offset-aware ISO 8601. Fiji-local month boundaries use Pacific/Fiji (UTC+12 in Nov 2026); compute boundaries from calendar dates and convert to UTC on server. Offer expires at the exact exclusive end timestamp, and checkout MUST recheck against trusted server time and inventory. Never rely on a cached page or an AI prompt to enforce expiry.

## Status and SEO
Draft, scheduled, active, expired, paused, withdrawn. The contract currently returns indexable=false after expiry; actual SEO behaviour must be deliberate: for a permanently useful accommodation page, keep evergreen canonical content indexed and replace the expired promotion with a clear expired label and current offers. For a disposable promotion URL, noindex after expiry and remove from active sitemap. Do not return 404 for a legitimate evergreen hotel page or retain expired Offer structured data.

## Distribution and guest trust
Link monthly specials from accommodation pages and genuine destination guides. Guest request remains pending until provider confirms; do not imply live inventory without integration. Publish genuine discount claims only when documented against a valid reference price; never invent scarcity, percentage savings, or previous rates. Give operator controls to pause/withdraw instantly.

## Missing integration gates
Real operator authentication, staff review, accommodation-specific inventory/room rate engine, database persistence, email/outbox, cancellation and tax rules, offer approval workflow, checkout price/expiry enforcement, sitemap/structured-data wiring, GSC/Bing baseline and actual provider onboarding. No production deployment.

## Launch idea
Bula Monthly Specials: this-month booking deadline, potentially later stay dates, transparent Fiji-time cutoff, FJD price, operator identity and exact conditions. AI may draft copy and suggest promotions but cannot fabricate a deal or silently change the rate.
