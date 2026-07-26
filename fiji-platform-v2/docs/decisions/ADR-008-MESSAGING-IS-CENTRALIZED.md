# ADR-008: Messaging is centralized

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

Phase 0 needs a safe, testable foundation with explicit source-of-truth boundaries.

## Decision

One engine owns template approval and delivery evidence; messaging cannot implicitly mutate domain truth.

## Consequences

Provider adapters report observations rather than side effects on bookings.
