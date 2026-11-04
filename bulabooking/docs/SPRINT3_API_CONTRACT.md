# Sprint 3 — proposed API and event contracts (not deployed)

## Trust boundaries
- Guest -> public API: rate limit, bot protection, server validation, explicit privacy consent.
- Operator -> authenticated API: secure session + tenant-scoped authorization on every query.
- Staff -> separately authenticated staff console with audit logs and least privilege.
- AI provider: only minimum necessary approved operator content; no customer personal information or private verification documents.
- NAT/FijiDash: separate integration credentials, versioned interface, explicit attribution and privacy notices.

## Draft API (not implemented)
POST /v1/operator/applications -> pending verification, never auto-verified.
POST /v1/operator/experiences/draft -> tenant-scoped operator data.
POST /v1/operator/experiences/:id/ai-draft -> rate-limited AI proposal only.
POST /v1/operator/experiences/:id/approve -> operator approval plus verification checks.
GET /v1/experiences/:slug -> published, verified, publicly bookable only.
POST /v1/bookings -> immutable server-generated quote, transactional inventory reservation and idempotency.
POST /v1/operator/bookings/:id/accept -> authenticated operator and atomic transition.
POST /v1/operator/bookings/:id/decline -> authenticated operator and atomic transition.
GET /v1/bookings/:id -> guest token scope, never public indexing.

## Event outbox
booking.requested -> operator notification; booking.accepted -> guest confirmation; booking.expired -> staff escalation; booking.cancelled -> inventory release; transfer.intent -> NAT/FijiDash handoff. Events need durable outbox, retries, deduplication, dead-letter monitoring and correlation IDs.

## Safety and fairness
No AI-automated acceptance without operator-authorized capacity and rules. AI drafts do not publish automatically. No scraped competitor content or invented ratings. Platform-owned transfer affiliation disclosed. Neutral tour ranking. Tour operators may provide their own included transport.

## Missing implementation before usable pilot
Authenticated sessions, CSRF protection, persistent database migrations, inventory locking, quote expiry, encrypted guest data, transactional outbox, message provider, AI provider integration, photo storage/moderation, consent/retention/deletion, tests against D1 and real browser, monitoring and rollback.
