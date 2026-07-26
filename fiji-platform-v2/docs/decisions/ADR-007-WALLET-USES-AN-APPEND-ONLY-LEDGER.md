# ADR-007: Wallet uses an append-only ledger

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

Phase 0 needs a safe, testable foundation with explicit source-of-truth boundaries.

## Decision

Balances change only through immutable wallet_transactions with unique idempotency keys.

## Consequences

Balances are reconcilable; corrections use compensating entries.
