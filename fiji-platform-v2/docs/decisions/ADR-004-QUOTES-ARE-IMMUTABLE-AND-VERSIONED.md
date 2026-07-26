# ADR-004: Quotes are immutable and versioned

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

Phase 0 needs a safe, testable foundation with explicit source-of-truth boundaries.

## Decision

A quote preserves pricing version, currency, expiry, standard fare, and separate flexible fare/components. Issued quotes are never updated as repricing.

## Consequences

Changes produce a new quote and remain auditable.
