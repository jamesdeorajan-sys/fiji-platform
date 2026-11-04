# BulaBooking — Fiji marketplace foundation

Status: **isolated prototype, NOT production ready**. No DNS, Cloudflare, NAT, FijiDash, WordPress, payments or live bookings changed.

## Product contract
- Open applications for ALL legitimate Fiji operators, including competitors.
- Zero tour-booking commission; operator owns tour price and fulfils experience.
- FJD source-of-truth; no invented prices, availability, reviews or operator verification.
- Book now/pay later only where operator explicitly permits; booking is PENDING until accepted.
- Dedicated transfers provided by affiliated NAT/FijiDash, transparently disclosed. Tours with included pickup remain allowed.
- AI drafts listings and translations from operator-provided facts; operator approves before publishing.
- Do not claim automatic global ranking or guaranteed bookings.
- Human escalation for safety, disputes, refunds, fraud and failed operator response.

## Proposed stack
Astro static/SSR hybrid for crawlable public pages; Cloudflare Workers API; D1 for marketplace metadata; R2 for approved images; Queues for event-driven notifications; Turnstile + rate limits for public submissions; operator PWA. Integrate NAT/FijiDash via versioned APIs only after contract review.

## MVP workflows
1. Operator application -> identity/business/safety checks -> verified account.
2. AI-assisted listing draft -> operator reviews FJD price, capacity, pickup, cancellation -> publish.
3. Guest search -> immutable quote -> idempotent booking request -> operator alert -> accept/decline -> guest status notification.
4. Operator timeout -> staff escalation; never silently confirm.
5. Eligible separate transfer offer -> NAT/FijiDash handoff; independent tour ranking unaffected.

## Non-negotiable gates
Authorization on every operator record; no cross-tenant data access; consent and privacy notices; image rights; audit log; webhook signatures; idempotency; booking state machine; retention policy; accessibility; SEO; rollback; test fixtures isolated from production.

## Initial implementation
- `src/pages/index.astro`: static landing prototype.
- `schema.sql`: initial marketplace tables with tenant ownership and booking lifecycle.
- `docs/BUILD_PLAN.md`: phases and acceptance criteria.

## Local preview
From `bulabooking/`, run `npm install` then `npm run dev`. Do not deploy until the API and booking controls are implemented and tested.
