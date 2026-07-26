# ADR-009: Driver documents use private object storage

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

Phase 0 needs a safe, testable foundation with explicit source-of-truth boundaries.

## Decision

Document bytes belong only in a V2 private object store; D1 holds metadata and verification.

## Consequences

Access requires authorized, expiring retrieval; no public URLs.
