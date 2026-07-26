# Fiji Platform V2 — Phase 0

An isolated, strict-TypeScript foundation for the traveler and transport lifecycle:

`Guest → Destination → Fare / Quote → Booking → Dispatch → Driver → Wallet → Messaging`

This directory does not bind, deploy, migrate, or modify V1. Phase 0 contains contracts, a forward-only canonical D1/SQLite migration, architecture decisions, isolation/operations documentation, and pure/schema tests—no production domain implementation.

## Local validation

Requires Node.js 24+ (for the built-in SQLite test adapter).

```sh
npm test
npm run typecheck
npm run format
npm run build
```

Do not run Wrangler deployment commands. The committed database identifier is fake and production is intentionally unconfigured.
