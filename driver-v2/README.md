# Driver PWA v2 — Gate 1 (ISOLATED, synthetic, TESTED_NOT_LIVE)

Implementation + proof of the Driver PWA v2 Gate 1 contract recorded in `docs/AGENT_SYNC.md`
(offer model, adaptive 3-minute dispatch, PII rule, lifecycle, critical-audit atomicity, diagnostics).
**Not a deployment. Not a migration. No production binding, hostname, secret, send path or real driver data.**
Gate 2 (one synthetic job to the real driver-1 phone) is HOLD pending explicit CEO GO.

* Evidence, gate matrix, defects, open items: `evidence/GATE1-EVIDENCE.md`
* Run: `node --no-warnings --test tests/gate1.test.mjs tests/stress.test.mjs` (Node 22, no network)
* Try the PWA locally: `node server/dev_server.mjs` then open the printed `127.0.0.1` URL (synthetic data, in-memory)

## Gate 1.5 (isolated Cloudflare proof package — PREPARED, NOT DEPLOYED)
* Policy delta: busy-driver eligibility and DELIVERY_RECEIPT-vs-engagement (tests G40–G49 in `tests/gate15_policy.test.mjs`).
* Package: `cloudflare/` — read `cloudflare/RUNBOOK.md`; evidence index `evidence/gate15/GATE15-PACKAGE-EVIDENCE.md`.
* Local validation (no Cloudflare account): `bash cloudflare/scripts/run_local_validation.sh 200`.
