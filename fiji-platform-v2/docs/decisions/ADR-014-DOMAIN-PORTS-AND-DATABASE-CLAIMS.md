# ADR-014: Domain-owned ports and database claims

## Status

Accepted. This refines ADR-012 and ADR-013.

## Decision

Each domain engine owns the repository port it consumes. Domain ports use domain values and operations; they do not expose SQL statements. Persistence owns only technical SQL, D1, transaction, audit, and idempotency infrastructure.

Dispatch acceptance begins by inserting a `dispatch_claims` row. A trigger verifies that the offer is active, belongs to the driver and unassigned dispatching booking, and is not expired. Unique booking and offer constraints make a competing claim fail as a SQL constraint violation. Because the claim, offer update, assignment, event, and audit share one batch, a losing claim aborts the complete batch before success evidence can be written.

Concurrent idempotent mutations first reserve `(scope, idempotency_key)` in `idempotency_claims`. Only the reservation winner invokes the command factory. A matching racer waits for and replays the committed evidence. The reservation remains after completion to close any check/insert race; retention cleanup must remove it together with its evidence. Fingerprints hash recursively key-sorted canonical JSON. `expires_at` marks evidence as cleanup-eligible; evidence remains logically replayable until cleanup deletes it.

## Consequences

Infrastructure adapters implement domain-owned ports. Abandoned idempotency claims require an operational cleanup/recovery policy before production rollout; Phase 1A does not deploy this mechanism.
