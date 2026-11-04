# Sprint 12 — authenticated operator actions, staging candidate

The 0002 migration adds SQL lifecycle guards, automatic audit and outbox events, and protections against deleting booking history. The operator service uses a trusted authenticated session's operator ID and conditional UPDATE to accept/decline pending bookings or complete accepted bookings.

## Critical limitations
- Not deployed or tested against D1; database migration must be verified against actual SQLite and D1.
- Current audit trigger records actor_type='system_transition'; it does not yet record the authenticated human actor ID. Production release is BLOCKED until attributable operator/staff actor IDs are persisted atomically in the audit record.
- Actual identity provider, operator membership, session expiry, CSRF protection and rate limits remain to be built.
- Operator cancellation, refunds, timeouts, guest communication and operator reassignment require policy and workflow.
- Outbox delivery worker and retries are not implemented; an outbox row is not proof a guest was notified.
- Status transitions do not constitute payment capture or completed fulfilment.
- Add database concurrency and failure-injection tests before staging rollout.
- Never apply migrations to NAT/FijiDash D1 or any production database without CEO approval.
