# Vakaviti Marketplace — Stage 1

Purpose: build the replacement experience marketplace and partner-acquisition surface before any production-domain cutover.

## Stage 1 outcomes
- Public Fiji operator directory with neutral unclaimed/not-yet-verified states.
- Claim-business flow.
- Founding Partner acquisition page.
- Canonical Operator/Product/Offer/Evidence model in D1.
- Booking-state placeholder sufficient for tracked requests without pretending a request is a confirmed booking.
- Clear separation between public discovery and Vakaviti verification.
- Transport-attachment fields reserved for Fiji Dash integration.

## Explicitly not Stage 1
- No migration of BookFijiTours production traffic.
- No production DNS change.
- No automatic Vakaviti Verified status.
- No direct Google Things to do integration.
- No automatic provider payouts.
- No replacement of Fiji Dash.
- No replacement of FTT/WordPress transaction systems until booking-authority reconciliation is complete.

## Preview-first domain strategy
Deploy this application first to a new Cloudflare preview Worker/domain, seed candidate operators, test claim/onboarding flows, and measure provider response. Only after CEO stage gate approval should the existing BookFijiTours domain be pointed at the new application or fronted through a controlled routing layer.

## Cutover gates
1. D1 backup and schema migration tested.
2. At least 25 candidate operator profiles reviewed.
3. Claim flow tested end-to-end.
4. At least 5 real providers successfully claim/onboard in preview or controlled pilot.
5. Commercial claims on launch pages are evidence-backed.
6. Existing BookFijiTours URLs have redirect/canonical preservation plan.
7. Booking destinations and attribution are mapped.
8. Rollback to current site is documented and tested.
9. CEO approval recorded in the Decision Ledger.

## Local setup
1. `npm install`
2. Create D1 database `vakaviti-marketplace`.
3. Replace `database_id` in `wrangler.toml`.
4. `npm run db:migrate:local`
5. `npm run dev`

## Architectural rule
Facts have one authority; public-source extraction only creates candidate evidence. AI may collect and normalize facts but cannot verify them by itself.
