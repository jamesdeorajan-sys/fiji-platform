# Fiji AI Ecosystem Vision

**Status:** Architecture and product direction only. Fare Service Phase 2 is not authorized.

## Purpose and roles

ComeToFiji is the traveler-facing Fiji travel operating system: the trusted place to discover, plan, quote, book, arrive, experience, review, and return. Lagi is its intelligence layer. Lagi interprets intent and orchestrates approved services; it does not own operational truth.

Fiji Tour Transfers is the initial operational transport provider. Nadi Airport Transfers is the airport-transfer commercial brand. Approved operators, accommodations, activity providers, travel sellers, and other partners participate through the partner network under common identity, consent, commercial, quality, and audit controls.

Git owns implementation truth. D1-backed authoritative services own operational truth. WhatsApp is a communication channel, never the system of record. AI does not own pricing, bookings, dispatch, or payments.

## Traveler lifecycle and core flow

The lifecycle is:

> Discovery → Planning → Knowledge → Pricing → Quote → Booking → Arrival → Experience → Review → Repeat Travel

The service flow is:

> Traveler → ComeToFiji → Lagi → Authoritative Knowledge → Fare Service → Quote Service → Booking Service → Operator and Dispatch → Communications → Review and Repeat Travel

Booking API publication is a blocking dependency: no surface may imply that a booking exists until the Booking Service has persisted it.

## Ecosystem layers

1. **Experience:** ComeToFiji web and approved channel experiences, including WhatsApp communications.
2. **Intelligence:** Lagi intent understanding, retrieval, comparison, itinerary generation, and service orchestration.
3. **Authority:** knowledge, destination, fare, quote, booking, partner, lead, dispatch, payment, communication, profile, and review services.
4. **Operations:** Fiji Tour Transfers and approved partner operators, dispatch, fulfillment, and support.
5. **Trust:** shared identity, consent, privacy, authorization, audit, observability, and incident controls.
6. **Implementation:** versioned code, schemas, configuration, tests, and decisions in Git and GitHub-visible review records.

## Commercial moat

The moat is not a chatbot or copied content. It is a verified Fiji knowledge graph joined to deterministic commercial authorities, local operating capability, partner supply, consented traveler context, immutable quote and booking evidence, and verified post-trip feedback. Every completed journey improves coverage and service quality without allowing generated prose to become fact.

## Smallest viable Stage 1 release

Stage 1 remains deliberately small: a narrow ComeToFiji discovery and planning journey, Lagi grounded in approved public knowledge, lead capture to one Lead Service, and a handoff to the existing approved transfer workflow for a tightly limited Nadi corridor. It introduces no autonomous price, payment, dispatch, or booking claims. Booking API publication remains blocking, and any price shown must come from the currently approved authority. Production requires James's explicit approval.

## Three-year architecture

- **Year 1 — foundations:** publish authority contracts and governance; establish curated knowledge; publish the Booking API; connect one lead authority; then, only after a separate gate, build one Fare and Quote authority and migrate a small transfer path.
- **Year 2 — controlled network:** add partner onboarding, broader destinations and transport inventory, consented profiles, verified reviews, operator tools, and measured multi-channel communications through the same authorities.
- **Year 3 — composable Fiji platform:** extend the governed service graph across more islands, accommodations, activities, packages, and repeat-travel experiences while preserving shared identity, pricing, booking, consent, and audit foundations.

Each year separates architecture, implementation, verification, staging, and production approval.

## Future revenue branches

Potential branches include transfer commission, partner referrals, accommodation and activity packages, cruise excursions, premium itinerary assistance, partner software, sponsored placements with disclosure, loyalty and repeat-travel offers, and aggregated privacy-safe market insight. These are options, not approvals. No branch may bypass shared identity, consent, partner, pricing, quote, booking, payment, review, or audit authorities.

## Near-term boundaries

The first commercial release stays small. Fare Service Phase 2 must not begin until James approves its implementation gate. Nothing in this vision deploys runtime code, changes D1, publishes an API, or authorizes production.
