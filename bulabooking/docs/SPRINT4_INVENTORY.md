# Sprint 4 inventory contract and deployment blockers

## Delivered
In-memory reservation simulator to exercise:
- operator-scoped accept/decline
- FJD immutable quote calculation
- request idempotency and conflict detection
- remaining capacity, release on decline/expiry/cancellation
- explicit pending/accepted lifecycle

## NOT delivered
No HTTP endpoints, authentication, persistent D1 schema migration, atomic SQL inventory, production payment, notifications, worker deployment or real operator accounts.

## Required production algorithm
1. Authenticate operator or validate public guest input, consent and rate limits.
2. Server-side calculate quote from approved published inventory and applicable policy; never trust client price.
3. In a single transaction / serialized reservation operation, check remaining capacity and create reservation plus idempotency key and outbox event.
4. Ensure same idempotency key with changed request fingerprint returns conflict, not a different booking.
5. Enforce compare-and-swap state transitions and operator tenant scope in storage, not only UI.
6. Expiry worker releases capacity exactly once; cancelled/declined events are idempotent.
7. Outbox dispatcher sends operator/guest messages with retries, deduplication, signed provider callbacks and dead-letter alerts.
8. Retention, encrypted guest contact data, access audit and deletion flows before handling real people.

## Concurrency caution
Cloudflare Workers may execute on many isolates simultaneously. In-memory Maps and read-then-write D1 operations are NOT adequate to prevent overselling. Validate transaction and conditional-write semantics with a real D1 integration test or use a per-inventory-key Durable Object to serialize reservations, with durable persistence and recovery tests. Do not launch before two-client last-seat stress test and failure-injection tests pass.

## Business rules
All qualified Fiji tour operators may apply, including Vakaviti competitors. Dedicated transfers remain NAT/FijiDash-affiliated with disclosure; tour operators may include their own pickup. Booking is not confirmed until operator acceptance.
