# BulaBooking review and trust system — design review

## Implemented as pure modules
Verified completed-booking eligibility, rating range and text validation, draft-only review submission, moderation-state transitions, published verified-review aggregates and operator response drafting contract.

## Non-negotiable production requirements
- Authenticate guest via booking-linked one-time token or account with expiry and revocation; never expose booking lookup by guessable ID.
- Database UNIQUE(booking_id) for one first-party review per eligible booking, and a transaction validating completed, non-test booking and guest identity.
- Moderation must be policy-based, logged and appealable; do not suppress genuine negative reviews solely due to rating. Show clear review policy and disclose incentives if any.
- Display review count, verified-booking label and rating only for real published reviews. No fake seed ratings, imported unattributed reviews or fabricated testimonials.
- Operators can publicly respond but cannot edit ratings. AI responses require approval, especially negative feedback.
- Flag personal information, threats and unsafe content for review. Retain original and moderation history in access-controlled storage with privacy retention.
- Structured review data must comply with applicable search engine eligibility and markup rules; no guarantee of review rich results.
- Review invitation after completed booking and guest consent, not immediately after booking request. Do not gate review invitations based on expected sentiment.
- Distinguish tour review from NAT/FijiDash transfer review; preserve attribution to the actual service provider.

## Audit of earlier foundation
1. Existing modules are not connected to a persistent API, authentication, live inventory or actual notifications.
2. In-memory reservation simulator cannot guarantee cross-Worker inventory safety.
3. Existing analytics event aggregates can mislead if duplicate lifecycle events are counted as separate bookings; authoritative booking records must drive final booking counts and financial figures.
4. The listing draft is not a verified public listing and lacks approved inclusions, cancellation terms, image ownership and availability.
5. 24/7 support availability must be measured from real roster/heartbeats, not assumed.
6. No tests or Astro builds were executed in the earlier GitHub-only iterations.
7. New review code is domain logic, not an operational review submission or moderation service.

## Next implementation gates
- Run node tests and Astro build in CI; correct failures.
- Add migrations for bookings, immutable audit, verified reviews and moderation actions; require unique booking review.
- Add authenticated booking-backed review endpoint and moderation queue.
- Add provider dashboard showing published review metrics and booking conversions.
- Build staging-only, transaction-safe booking backend and provider/guest auth.
- Validate Google/Bing metrics and observed AI referrals from real sources before reporting.
