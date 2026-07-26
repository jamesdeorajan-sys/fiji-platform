# ADR-003: Money uses integer minor units

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

Phase 0 needs a safe, testable foundation with explicit source-of-truth boundaries.

## Decision

All monetary amounts use safe integers plus a three-letter currency; floats are invalid.

## Consequences

Callers must convert only at presentation/provider boundaries.
