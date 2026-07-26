# ADR-006: Dispatch acceptance is atomic

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

Phase 0 needs a safe, testable foundation with explicit source-of-truth boundaries.

## Decision

Acceptance conditionally assigns only when assigned_driver_id is null and accepts one active offer in the same transaction.

## Consequences

Concurrent losers receive a deterministic already-assigned result.
