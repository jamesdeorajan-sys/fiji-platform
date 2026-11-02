# 2. Test results (exact totals)

| Suite | Result | Where run |
|---|---|---|
| Full automated suite (`test/*.test.mjs bula/*.test.mjs`) | **572 / 572 pass, 0 fail** (562 existing + 10 new release-gate tests) | this gate, sandbox, real Worker code + in-memory D1 |
| Runner tests (`bula/ops/run_acceptance.test.mjs`) | **24 / 24 pass** | this gate |
| New `bula/m4_release_gate.test.mjs` | **10 / 10 pass** (invariants checked after every step) | this gate |
| Source-mode acceptance, LOCAL self-test server | **29 / 29 pass** (`local/`) | this gate |
| Phone-size browser journey (390x844, Playwright) | **11 / 11 pass**, no page errors (`browser-phone-390x844/`) | this gate |
| Hosted BASE acceptance (isolated Worker/D1) | **31 / 31 pass**, commit 1343f866 | James's PC, 2026-11-01T15:30:55Z — NOT re-run in this gate |
| Hosted SOURCE-mode acceptance | **29 / 29 pass**, commit 1343f866 | James's PC, 2026-11-01T15:31:29Z — NOT re-run in this gate |
| Physical phone | earlier results by James (see handover doc) | not re-run |

**Honest gap:** the hosted runs could not be repeated from here (no egress to workers.dev/Cloudflare API). I verified the hosted evidence files (commit, counts, zero failures, no secrets) but they are two days old. To repeat them on the PC, from the bundle folder: `node run_acceptance.mjs verify` then `node run_acceptance.mjs resume` (isolated Worker/D1 only). This is a confirmation step, not a blocker.

Coverage map (existing + new tests): guest journey (`m3_journey`, `trip_journey`), staff journey (`m3_trip_queue`), authorization/isolation (`m2_security`, `m3_trip_queue`, m4), source outage/recovery (`m3_source_adapter`, `m2_recovery`, m4), receipt/capture safety (`m3_source_adapter`, `outbox_integration`, m4), duplicate/idempotency (`inventory_credit`, `concurrency`, m4), decline/withdrawal (`m3_trip_queue`, m4), offer import/publish (`offers_d1`, `m2_offers_snapshot`, hosted checks), wallet/credit/capacity invariants (`inventory_credit`, `concurrency`, m4 `invariants()`).
