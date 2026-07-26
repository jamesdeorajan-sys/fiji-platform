# ADR-002: D1 is the canonical transactional store

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

Phase 0 needs a safe, testable foundation with explicit source-of-truth boundaries.

## Decision

D1 stores canonical guest, quote, booking, dispatch, driver, wallet, message metadata, audit, and platform records.

## Consequences

Cross-aggregate writes must respect SQLite/D1 transactional limits.
