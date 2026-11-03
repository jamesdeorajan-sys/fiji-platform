# Driver PWA v2 — Gate 1.5 isolated Cloudflare proof: runbook (revision 2 — operational hardening)

**Status: PACKAGE PREPARED AND LOCALLY VALIDATED. NOT DEPLOYED. NOT ATTACHED. Nothing in this file has been run against Cloudflare.**
Everything under "REQUIRES EXPLICIT GO" waits for the final GO review. Gate 2 (first real notification to driver ID 1) remains **HOLD** and is not part of this package.

Isolated resources (already exist, empty / zero-binding): D1 `driver-v2-gate15-isolated-20261103` = UUID `fe5eba69-b654-40cb-bf80-4b9a37c03f0c`; Worker `driver-v2-gate15-isolated`.
Never touched: `nadi-dispatch-api`, `nadi-marketplace-db` (`0ec1cd84-fcda-4f7f-8337-0fb70fe1a512`), NAT, FijiDash, Bula, any booking, any production secret/route/schedule.

## 0. The one command (after GO)
```
export CLOUDFLARE_ACCOUNT_ID=…  CLOUDFLARE_API_TOKEN=…  GATE15_ACCOUNT_SUBDOMAIN=<account workers.dev subdomain>
node cloudflare/orchestrator/run_remote.mjs            # writes evidence/gate15/remote-<UTC timestamp>/ ; exit 0 only on PASS
```
`run_remote.mjs` is the **only** supported way to run the remote proof. It is a thin launcher over `orchestrator.mjs` + `cloudflare_driver.mjs` (both locally rehearsed and unit-tested with a fake cloud). The isolated D1 name/UUID are **pinned in code** (`src/safety.js`, `wrangler.toml`, and enforced by `assert_package_safe.mjs`); there is no flag, argument or environment variable that supplies a database id (`GATE15_D1_ID`, `D1_DATABASE_ID`, … are refused outright).
Token scope needed: Workers Scripts:Edit (isolated worker only is not expressible in Cloudflare scopes, so the code guards every mutating call against the pinned worker path), D1:Edit, Account Settings:Read, Zone:Read (routes), Workers Routes:Read.

## 1. State machine (exact order)
| # | Step | Mutates? | If it fails |
|---|---|---|---|
| 1 | **preflight** — package safety assertion (UUID pin, deny-list, schema hash), credentials present, no identity overrides | no | `STOPPED_NO_MUTATION` |
| 2 | **BEFORE snapshot** (read-only): all Workers `modified_on/etag`; `nadi-dispatch-api` bindings, cron schedules, secret **names**, deployments; every zone's Worker routes (NAT/FijiDash/customer); Worker custom domains; all D1 identities; isolated Worker state + its shell version id. Any single read failing, or an unknown shell version id, or a non-pristine isolated Worker → STOP | no | `STOPPED_NO_MUTATION` — **no remote mutation** |
| 3 | **isolated D1 identity** — two independent lookups (by pinned name, by pinned UUID) must each return exactly `driver-v2-gate15-isolated-20261103` / `fe5eba69-b654-40cb-bf80-4b9a37c03f0c`; production name/UUID refused explicitly; mismatch, duplicate, case-variant → STOP | no | `STOPPED_NO_MUTATION` |
| — | ---- mutation begins; from here teardown is mandatory ---- | | |
| 4 | apply isolated schema (`d1 execute <pinned name> --remote`) + marker check | isolated D1 | failure path |
| 5 | create isolated `GATE15_CONTROL_TOKEN` (random, piped on stdin, never in argv/logs) | isolated Worker | failure path |
| 6 | deploy isolated Worker (`--name` pinned) | isolated Worker | failure path |
| 7 | enable workers.dev **for the isolated Worker only** | isolated Worker | failure path |
| 8 | functional proof (identity, D1 primitives, boundaries, PII, audit atomicity, busy rule, staff collisions) | isolated D1 | failure path |
| 9 | **STAGE A**: 10 contested races → checkpoint | isolated D1 | failure path |
| 10 | **STAGE B**: 50 more races → same checkpoint | isolated D1 | failure path |
| 11 | **STAGE C**: 200 more races → same checkpoint (only if A and B fully green) | isolated D1 | failure path |
| 12 | final invariant/readback | no | failure path |
| 13 | after evidence → teardown (§3) → post-teardown snapshot → production diff | see §3 | — |

**Checkpoint (identical at every stage; assertions are never weakened between stages):** global invariants over the whole isolated DB (no double accept, no orphan assignment, complete audit trail, one active trip per driver); per race: exactly one server-confirmed winner, losers 409, exactly one `DRIVER_ASSIGNED` event, exactly one ACCEPTED offer, every losing offer SUPERSEDED; zero real sends; zero wallet/commission change; zero non-placeholder phones; zero non-synthetic bookings.

**Failure path (any failure after step 3):** capture failure evidence → remaining stress stages recorded `SKIPPED` (never run) → teardown immediately → post-teardown snapshot → production diff → verdict `FAILED/HOLD`. The proof Worker is never left exposed because a test failed.

## 2. Verdicts
* `PASS` — every stage green **and** teardown complete **and** before/after diff proves production untouched **and** the isolated Worker is back to its zero-binding shell.
* `FAILED/HOLD` — a proof stage failed (or a mutation step failed); cleanup completed; production proven untouched.
* `HOLD / INVESTIGATE` — any unexplained production difference, or teardown/restoration incomplete, or no comparison possible. Takes precedence over `FAILED/HOLD`. Never PASS.
* `STOPPED_NO_MUTATION` — failed before step 4; nothing was changed anywhere.

## 3. Teardown (exact order, best-effort per step, every step recorded, never deletes the D1 or the Worker)
1. disable workers.dev for `driver-v2-gate15-isolated`
2. delete `GATE15_CONTROL_TOKEN` from that Worker
3. re-verify the isolated D1 identity again, then remove all Gate 1.5 schema/data (`gate15_teardown.sql`) and confirm zero user tables
4. restore the Worker to its original zero-binding shell (`wrangler rollback <shell version id captured in the BEFORE snapshot>`)
5. verify no schedule, no custom domain, no route points at the isolated Worker
6. collect final resource evidence (post-teardown snapshot, same shape as BEFORE)
7. compare production before/after

## 4. What the diff proves (and what it cannot)
Compared, must be identical: every Worker other than the isolated one (`modified_on`, `etag`; includes `nadi-dispatch-api`); `nadi-dispatch-api` bindings, schedules, secret names, deployments; every D1 other than the isolated one (identity, incl. `nadi-marketplace-db`); the complete set of zone routes (NAT, FijiDash, customer) and Worker custom domains; none may reference the isolated Worker. Isolated side must be quiescent: workers.dev off, no secrets, no bindings, no schedules, D1 identity unchanged.
**Disclosure:** *customer bookings* are proven untouched only indirectly (the code path never has a binding to, or a credential for, the production D1; `nadi-marketplace-db` identity and `nadi-dispatch-api` deployment are unchanged). Counting rows in production D1 would itself be production access, which this plan forbids.

## 5. Evidence (per stage, independent — separates an infrastructure limit from a correctness failure)
`00-preflight` · `01-before-snapshot` · `02-d1-identity` · `10-functional` · `11-stage-A-10-races` · `12-stage-B-50-races` · `13-stage-C-200-races` · `20-final-invariant` · `21-after-evidence` (or `21-failure-evidence`) · `30-teardown` · `31-post-teardown-snapshot` · `32-production-diff` · `99-verdict` (all `.json`). Each proof stage file records checks, latency, status/code histograms. A stage that fails on HTTP 429/5xx/D1 limit errors is an **infrastructure limit**; a failed invariant/assertion with healthy responses is a **correctness failure**.

## 6. Local validation (safe now; touches no Cloudflare account)
```
cd driver-v2
node cloudflare/scripts/assert_package_safe.mjs                    # "ok": true
bash cloudflare/scripts/run_local_validation.sh                    # unit + suites + staged proof on local workerd
node cloudflare/orchestrator/rehearse_local.mjs happy             # full orchestration, 10→50→200, fake cloud + local workerd
node cloudflare/orchestrator/rehearse_local.mjs inject-B          # deliberately corrupts local DB before stage B: must stop, skip C, tear down, FAILED/HOLD
```
(`WRANGLER_BIN=/path/to/wrangler` avoids `npx`.) The rehearsals use the real orchestrator and real driver logic, with the Cloudflare API replaced by an in-memory fake and every `--remote` wrangler command translated to its local equivalent.

## 7. Safety rules enforced (unchanged from rev 1, plus)
* Build time: Worker name, single D1 binding `DB`, `database_name` **and `database_id` must equal the pinned values** (placeholder or any other UUID refused), production names/ids/hosts refused, no routes/crons/vars/services/KV/R2/queues/AI, `workers_dev=false`, no network/messaging/scheduler code, schema hash.
* Runtime (each request): env only `DB` (+ isolated control token); host `localhost` or `driver-v2-gate15-isolated.<acct>.workers.dev`; identity-marker row and exact table allow-list in the bound DB (a production DB fails closed with 503).
* Orchestration: every wrangler argv and every mutating API path is checked against the pinned names before it is issued; deleting the D1 or the Worker is not expressible; secret values never appear in argv or logs.

## 8. What local validation cannot prove (UNKNOWN until the remote run)
Real D1 semantics under load and per-invocation query limits (plan-dependent); true multi-isolate concurrency (locally one workerd process); remote clock/latency vs the ±3 s boundary margins; workers.dev routing/TLS; `wrangler rollback` behaviour when restoring the shell on the real account; exact Cloudflare API response shapes consumed by the snapshot module (written to the documented schema, exercised only against the fake).

## ===== REQUIRES EXPLICIT GO — do not run before =====
Run §0 exactly once. If the verdict is anything but `PASS`, do not re-run; read `99-verdict.json` and `32-production-diff.json` first. Deleting the isolated D1/Worker is a separate decision for James.

*Superseded (kept, not deleted):* `scripts/collect_remote_evidence.sh`, `scripts/diff_production_snapshots.mjs` — replaced by `orchestrator/snapshot.mjs` + `orchestrator/diff.mjs`.
