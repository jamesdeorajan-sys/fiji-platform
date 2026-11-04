# Sprint 11 — isolated D1 booking ledger

Files: migrations/0001_booking_ledger.sql and src/lib/d1-booking-ledger.mjs.

## Transaction boundary
D1 batch runs booking insert, immutable audit event and outbox entry as one transactional unit. A missing slot/price mismatch causes dependent event FK failure and rolls back. SQL triggers enforce available capacity, reserve places, release on eligible terminal state and prevent quote mutation. All prices are FJD integer cents.

## Explicit limitations and safety gates
- This is an untested staging candidate; no migrations have been applied anywhere.
- Caller MUST authenticate guest, enforce consent and rate limits, verify idempotency fingerprint binding to request details, and derive quote from the authoritative slot. Never trust client-provided amount.
- Existing booking lookup by idempotency key must not become a public unauthenticated booking-status endpoint.
- Need durable operator-scoped transition endpoint with permitted state machine and audit/outbox writes in one batch.
- Need separate test booking isolation, guest PII encryption, expiry/reconciliation, outbox delivery and monitoring.
- Migration has to be tested with real SQLite and Cloudflare D1 under simultaneous requests, rollback failures, duplicates, capacity release, refund/cancellation and price changes.
- Do not connect NAT/FijiDash production or deploy without explicit CEO approval.

## Critical release test
Two concurrent requests for the final seat must result in exactly one saved booking and one rejected request; event and outbox counts must match persisted bookings. A failed insert must leave capacity and event tables unchanged.

## Cloudflare reference
https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
