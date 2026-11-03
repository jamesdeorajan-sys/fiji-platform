# Driver PWA v2 — Gate 1 (ISOLATED, synthetic, TESTED_NOT_LIVE)

Implementation + proof of the Driver PWA v2 Gate 1 contract recorded in `docs/AGENT_SYNC.md`
(offer model, adaptive 3-minute dispatch, PII rule, lifecycle, critical-audit atomicity, diagnostics).
**Not a deployment. Not a migration. No production binding, hostname, secret, send path or real driver data.**
Gate 2 (one synthetic job to the real driver-1 phone) is HOLD pending explicit CEO GO.

* Evidence, gate matrix, defects, open items: `evidence/GATE1-EVIDENCE.md`
* Run: `node --no-warnings --test tests/gate1.test.mjs tests/stress.test.mjs` (Node 22, no network)
* Try the PWA locally: `node server/dev_server.mjs` then open the printed `127.0.0.1` URL (synthetic data, in-memory)
