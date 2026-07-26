# ADR-005: Bookings use a state machine and events

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

Phase 0 needs a safe, testable foundation with explicit source-of-truth boundaries.

## Decision

Booking.state is canonical and each accepted transition appends booking_events. Messages never establish state.

## Consequences

Transition logic must be validated and state/event writes atomic.
