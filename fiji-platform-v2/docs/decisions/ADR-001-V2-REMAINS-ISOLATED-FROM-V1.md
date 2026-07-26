# ADR-001: V2 remains isolated from V1

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

Phase 0 needs a safe, testable foundation with explicit source-of-truth boundaries.

## Decision

V2 must never bind to, deploy over, route to, or mutate V1. Separate V2 resources are mandatory.

## Consequences

Prevents accidental coupling and requires explicit migration work.
