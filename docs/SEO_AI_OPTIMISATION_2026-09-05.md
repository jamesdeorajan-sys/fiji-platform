# Fiji Online Presence Optimisation — 2026-09-05

Status: active optimisation sprint. No new sites. No production deployment in this commit.

## Operating objective
Maximise qualified bookings and AI/search visibility using the existing Fiji web estate.

## Priority sequence
1. Contain public customer-specific booking pages (Issue #44) without affecting generic commercial pages.
2. Make AI/search crawler policy explicit for revenue properties, including OAI-SearchBot and OAI-AdsBot where appropriate.
3. Keep machine-readable route facts consistent with live booking data (prices, distances, destinations, service areas).
4. Strengthen canonical commercial intent around Nadi Airport, Denarau, Coral Coast, Natadola, private transfers and tours.
5. Preserve booking functionality and the server-confirmed booking flow.
6. Add source attribution for AI/search referrals before scaling campaigns.

## Guardrails
- No new domain or site build.
- No DNS changes.
- No D1/schema changes.
- No changes to booking confirmation semantics.
- Existing verified public marketing claims are not a blocker.
- Customer-specific pages must not be indexable.
- All production changes require preview/regression checks before deploy.

## First optimisation patch
- Add explicit OAI-SearchBot and OAI-AdsBot allow rules to `ftt-booking-site/src/robots.txt`.
- Align `llms.txt` with the verified live route inventory and corrected InterContinental Natadola distance already established in merged PR #42.
