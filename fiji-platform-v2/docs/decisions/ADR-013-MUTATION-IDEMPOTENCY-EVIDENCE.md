# ADR-013: Persist mutation idempotency evidence

## Status

Accepted.

## Decision

Mutation identity is `(scope, idempotency_key)`. A SHA-256 request fingerprint and serialized safe result are persisted with creation and expiry timestamps. Matching requests replay the evidence; a different fingerprint returns `IDEMPOTENCY_CONFLICT`.

The idempotency insert joins the domain mutation and required audit event in the same atomic batch. Retention cleanup may delete records only after `expires_at`.
