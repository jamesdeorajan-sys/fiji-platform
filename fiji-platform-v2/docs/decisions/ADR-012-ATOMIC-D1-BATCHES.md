# ADR-012: Explicit SQL and atomic D1 batches

## Status

Accepted.

## Decision

Repositories expose domain-specific contracts and explicit parameterized SQL. Multi-write invariants use a D1 batch, whose statements form one atomic commit boundary. Conditional ownership writes include the expected current state in their `WHERE` clause.

Audit evidence required by a command is a statement in the same batch. A failed audit insert therefore fails and rolls back the command; required audit evidence never degrades to a best-effort side effect.

## Consequences

There is no ORM or generic repository. Business commands must inspect conditional-write outcomes where ownership is contested, and tests must exercise SQLite rather than only mocks.
