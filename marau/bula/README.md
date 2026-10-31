# bula/ — Bula Happiness isolated candidate (Issue #60)
Pure reference modules + tests. **Not wired into worker.js, no migrations applied, no deploy, live sender disabled.**
- `edition.js` 18:00 Pacific/Fiji release logic (reuses `worker/fiji_time.js`), idempotent publisher w/ catch-up.
- `ledger.js` FJ$ integer-cent welcome-credit ledger (separate from earned rewards).
- `checkout.js` bounded inventory+credit reservation (D1 port must use a single conditional UPDATE/transaction).
- `outbox.js` idempotent outbox, capture sender, ambiguous-outcome handling, guest email renderer.
Run: `node --test bula/*.test.mjs`
