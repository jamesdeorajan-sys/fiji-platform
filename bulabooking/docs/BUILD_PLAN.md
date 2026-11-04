# Delivery plan and acceptance gates

## Sprint 0: Read-only contracts and threat model
Inventory NAT/FijiDash APIs and active release branches. Confirm ownership/legal entity before making Fiji-owned claims. Verify booking/payment regulations, tourism licensing, privacy, cancellation and operator safety requirements. Establish separate marketplace data boundary.

## Sprint 1: Marketplace MVP
Astro listing pages; verified operator onboarding; tenant-scoped authentication; FJD immutable quotes; inventory availability and atomic reservation logic; idempotent create booking; booking state machine; operator accept/decline; email/notification queues; retries/dead-letter queue; staff fallback.

## Sprint 2: AI-assisted operator tools
Upload description/photo -> AI draft title, inclusions, FAQs, structured metadata and translations. All factual claims derived from operator inputs; operator approves publication. AI can suggest SEO but cannot invent claims or change prices/availability. Abuse and content moderation.

## Sprint 3: Revenue and distribution
Integrate dedicated NAT/FijiDash transfers via documented versioned interface, with disclosed affiliation and opt-in. Preserve operator included transport. Add attribution, GA4/GSC, server-side event validation and consent handling.

## Sprint 4: Pilot and launch
Independent operator applications open to all. Verify identity, required credentials, insurance where applicable and experience fulfilment. Accessibility WCAG 2.2 AA target; Core Web Vitals; 320/390/430px; SEO and schema; data isolation tests; fraud/rate limits; cancellation/refund cases; email deliverability; backups; rollback.

## Must-pass before production
- Unauthorized operator cannot read/change another operator's listings/bookings.
- Duplicate requests never create duplicate bookings.
- Two guests cannot reserve the last capacity slot.
- AI never confirms a pending booking or fabricates availability.
- Staff escalation fires on operator timeout; alerts are monitored.
- Guest data is private and retention/deletion workflows work.
- No live payment or booking notification before approved integration.
- No production deploy without explicit CEO approval.
