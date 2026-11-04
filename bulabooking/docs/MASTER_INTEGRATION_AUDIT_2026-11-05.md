# BulaBooking master integration audit — 5 November 2026

Status: READ-ONLY AUDIT + DOCUMENTATION; NO DEPLOYMENT. Scope: original marketplace decisions through Sprint 12, checked against current development-branch files. This is a gap register, not a claim of complete repository-wide code review.

## Binding product decisions
1. Open, fair access for legitimate Fiji tour/activity operators including competitors; zero BulaBooking tour commission, disclose external fees.
2. Operators control accurate FJD prices and fulfil their own experiences. Support per-person, per-group and transport-inclusive packages. Never invent facts, prices, availability, licences, reviews or badges.
3. Verified/pending/unverified trust statuses; unverified discovery is allowed with disclosure, but transaction eligibility needs minimum safety and compliance checks. Link to operator-supplied social profiles with attribution; do not merge external reviews into first-party ratings.
4. Booking is only a REQUEST until operator acceptance. Pay on arrival only when explicitly supported. Dedicated standalone transfer affiliate NAT/FijiDash disclosed; tours with included transport allowed.
5. Real completed-booking reviews, transparent moderation including legitimate negative feedback, operator-approved response drafts, no fake scores.
6. Mobile-first PWA, easy onboarding, clear guest experience, SEO/AI discovery, operator dashboards, auditability and 24/7 human escalation only when operationally proven.
7. No production changes without explicit CEO approval. Isolated staging, test evidence and rollback mandatory.

## Inventory checked
README.md; docs/BUILD_PLAN.md; package.json; booking-contract.mjs; d1-booking-ledger.mjs; migrations/0001_booking_ledger.sql; migrations/0002_booking_transitions.sql; .github/workflows/bulabooking-foundation-checks.yml. Prior session commits/readbacks also cover operator trust, directory, reviews, growth agent, analytics and support contracts. This review did not execute the full test suite or prove CI success.

## P0 integration blockers
- **P0-01 Authentication**: no verified session issuance, operator/staff roles, tenant membership enforcement at API boundary, CSRF/rate limits, guest access control or consent workflow.
- **P0-02 Database migration proof**: migration files committed but not applied/tested in isolated D1. Must verify trigger execution, atomic batch rollback, capacity release, duplicate keys and last-seat concurrency with real D1.
- **P0-03 Audit attribution**: transition trigger hardcodes actor_type='system_transition'; authenticated operator/staff user ID not recorded. Implement attributable audit and immutable provenance without trusting client actor IDs.
- **P0-04 End-to-end booking**: public booking API, guest status link, operator dashboard, accept/decline/timeout, human fallback, delivered email/WhatsApp notifications, reconciliation and outbox worker not connected.
- **P0-05 Price semantics**: ledger quote uses slot.price_fjd_cents * quantity; group and vehicle packages need authoritative price-basis-aware quotes, taxes/fees/inclusions and immutable quote snapshot. Do not publish misleading totals.
- **P0-06 Compliance**: operator safety/licence/insurance where applicable, cancellation/refund policy, liability/consumer disclosures, privacy, data retention and incident process not implemented.
- **P0-07 Testing**: CI workflow committed but no successful run confirmed; npm dependency lockfile missing. No full integration, tenant isolation, accessibility or device tests.
- **P0-08 Revenue truth**: authoritative booking and operator outcome reporting is absent; event counters cannot substitute for unique persisted bookings.

## P1 product and growth integrations
- **P1-01 Onboarding**: Facebook-first mobile operator signup; identity, contact, account ownership, licence/insurance, photo rights, booking terms, verification appeal and approval workflow.
- **P1-02 Listing CMS**: approved operator facts, FJD price, price basis, pickup/meeting point, availability, photos and rights, itinerary, inclusions/exclusions, cancellation, accessibility and multilingual drafts.
- **P1-03 Social proof**: approved Facebook/Instagram/TikTok/YouTube/TripAdvisor/website links; link ownership, safety, timestamp and external rating policy. Do not present operator-supplied links as verified.
- **P1-04 Verified reviews**: completed-booking invitation and one-review-per-booking DB constraint; authenticated submit, moderation with policy reason and appeal, public negative reviews, response approval, aggregates and audit.
- **P1-05 Operator PWA**: inbox, accept/decline, reminders, inventory, service completion, staff fallback, analytics, alerts and accessible low-bandwidth UX.
- **P1-06 Guest journey**: destination/category search, maps, filters, clear FJD prices, checkout and pending/accepted states, itinerary, support and consent-aware cross-sell.
- **P1-07 AI**: real provider-assisted listing creation, factual review and multilingual translation, photo guidance, FAQ and growth insights; operator approval and AI audit logs. Current growth-agent module is a deterministic checklist, not a deployed LLM.
- **P1-08 Analytics**: server-authoritative unique bookings and operator/listing funnel, consent and event dedupe, GA4/GSC/Bing ingestion, AI-referral observation (not fictional AI rankings), verified attribution.
- **P1-09 Search**: crawlable public SSR/SSG, canonical/sitemap/robots, legitimate structured data, internal linking, verified operator identity, images, CWV, localisation and link previews.
- **P1-10 Operations**: notification delivery receipts, retries/dead-letter, human queue, dispute/fraud workflow, availability reconciliation and SLA tracking.

## P2 integrations and competitive advantages
- NAT/FijiDash standalone transfer affiliate through explicit versioned interface, optional guest handoff and independent tour ranking; no cross-system write without approval.
- Optional approved channel managers and distribution partners, explicit external fees and booking ownership, no unsanctioned scraping.
- Shareable operator mini-sites, QR links, trackable social/creator referrals, destination discovery, AI-assistant-compatible structured data and documented APIs, subject to real API access.
- Bula.app cross-sell and loyalty integration only after consent, account linkage, wallet accounting and booking reconciliation are defined. Never claim FJ$500 credit as funded or available without approved economics.

## Priority acceptance path
A. Lock MVP contracts and decide FJD per-person/group pricing model; add deterministic price tests.
B. Build isolated D1 migration test harness and run CI with confirmed pass/fail evidence.
C. Implement authenticated operator + guest sessions and tenant-scoped API, then atomic attributable booking actions.
D. Run two-last-seat concurrency, idempotency, failed-outbox, cancellation, timeout and notification tests.
E. Deliver real provider onboarding and a published, verifiable tour listing.
F. Deliver request -> operator accept -> guest notified -> completed -> verified review on isolated staging.
G. Connect authoritative dashboards, search analytics, AI-assisted operator growth and disclosed transfer affiliate.
H. Conduct privacy, accessibility, security, commercial, rollback and CEO release review.

## Release gates
NO production deployment, DNS changes, payments, real alerts or migrations. Production remains untouched. An untested GitHub commit is not a functioning product. Record CI, database, staging screenshots and actual test outputs before declaring completion.
