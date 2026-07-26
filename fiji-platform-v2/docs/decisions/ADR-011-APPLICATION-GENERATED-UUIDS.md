# ADR-011: Application-generated UUID v4 identifiers

## Status

Accepted.

## Decision

V2 generates UUID v4 identifiers with the Web Crypto API before persistence. UUIDs are text-compatible with the schema, globally safe across Workers, require no database round trip, and can be replaced through the `IdGenerator` contract in tests.

## Consequences

IDs do not encode creation order. Ordering always uses an explicit canonical timestamp plus a deterministic tie-breaker.
