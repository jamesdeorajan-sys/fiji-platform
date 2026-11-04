# Sprint 14: attributable operator booking transitions

Changes: 0003_attributed_booking_transitions.sql; operator-booking-service.mjs; operator-booking-service.test.mjs.

- Migration requires actor_id and actor_role for every status transition and atomically records them in immutable booking events.
- Operator adapter requires a trusted session with authenticated=true, role=operator, operatorId and actorId; conditional update matches tenant, booking ID and prior status.
- Direct actor metadata changes without a status transition are blocked. Existing 0002 lifecycle guards still apply.
- No live identity provider or verified session issuer is connected. A fabricated session object passed to the adapter would be unsafe. Only trusted middleware may call this function.
- 0003 migration is not executed against SQLite or D1 yet. Existing test suite not executed. Do not infer CI success.
- Operator membership revocation, audit record integrity, API authentication, CSRF and rate limits remain release blockers.
- Group and vehicle pricing (Sprint 13) remains disconnected from the 0001 booking ledger; do not use that ledger for these price bases.
- Next gate: real D1 integration and concurrency tests, authenticated operator identity provider, notification delivery and working staging journey.
- No production deployment, DNS change or migrations without explicit CEO approval.
