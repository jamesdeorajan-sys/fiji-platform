# Driver PWA v2 — Gate 1.5 isolated Cloudflare proof: runbook

**Status: PACKAGE PREPARED AND LOCALLY VALIDATED. NOT DEPLOYED. NOT ATTACHED. Nothing in this file has been run against Cloudflare.**
Everything below the line "REQUIRES EXPLICIT GO" must wait for James / ChatGPT review of the package.
Gate 2 (first real notification to driver ID 1) remains **HOLD** and is not part of this package.

Resources (already created, empty / zero-binding): D1 `driver-v2-gate15-isolated-20261103`, Worker `driver-v2-gate15-isolated`.
Never touched by this package: `nadi-dispatch-api`, `nadi-marketplace-db`, NAT, FijiDash, Bula, any booking, any production secret or route.

## 0. What the package is
| Piece | File |
|---|---|
| Worker config (one D1 binding, no routes/crons/vars/services, workers.dev off) | `wrangler.toml` |
| Worker entry (runtime isolation checks → HTTP surface of the Gate 1 service) | `src/worker.js` (+ unchanged `../src/service.js`, `../src/http.js`) |
| Isolation guards (deny-list, host allow-list, DB identity marker, foreign-table refusal) | `src/safety.js` |
| Capture-only adapters (rows, never messages) | `src/d1_capture.js` |
| Test-control surface (closed unless the isolated Worker has its own token secret; synthetic rows only) | `src/control.js` |
| Schema (Gate 1 fixture + identity/capture/probe tables), SHA-256 recorded | `schema/gate15_d1_schema.sql`, `.sha256` (built by `scripts/build_schema.mjs`) |
| Teardown SQL | `schema/gate15_teardown.sql` |
| Build-time safety assertion | `scripts/assert_package_safe.mjs` |
| Real-HTTP proof runner (D1 primitives, boundaries, PII, audit atomicity, races) | `scripts/gate15_proof.mjs` |
| Read-only Cloudflare evidence + before/after production-untouched diff | `scripts/collect_remote_evidence.sh`, `scripts/diff_production_snapshots.mjs` |
| One-command local validation (loopback workerd, local SQLite D1) | `scripts/run_local_validation.sh` |

## 1. Local validation (safe now; touches no Cloudflare account)
```
cd driver-v2
node cloudflare/scripts/build_schema.mjs                 # prints the schema SHA-256
node cloudflare/scripts/assert_package_safe.mjs          # must print "ok": true
bash cloudflare/scripts/run_local_validation.sh 200      # suites + 200 real-HTTP races on local workerd
```
`wrangler dev --local` runs the real Worker bundle in workerd against a local SQLite-backed D1 on 127.0.0.1. It is a strong packaging/behaviour check, **not** a substitute for the remote proof (see "What local cannot prove").

## 2. Safety rules enforced (build-time and runtime)
* Build time (`assert_package_safe.mjs`, exit 1 on any violation): Worker name must equal `driver-v2-gate15-isolated`; exactly one D1 binding named `DB` with `database_name = driver-v2-gate15-isolated-20261103`; production names (`nadi-marketplace-db`, `nadi-dispatch-api`, `vakaviti-kb`, `marau-stage1-test-db`, `fiji-chat-widget`, `vakaviti-monitor`), the known production D1 id, and production hostnames are refused anywhere outside the deny-list; no routes, crons, vars, services, KV/R2/queues/AI bindings; `workers_dev=false`; no `fetch(`/sockets/email/messaging-provider/`scheduled`/cron code in the Worker or the core service; schema hash must match the recorded value.
* Runtime (every request, before any query): environment may contain only `DB` (+ the isolated control token); hostname must be `localhost` or `driver-v2-gate15-isolated.<account>.workers.dev` (all production hostnames refused); the bound database must contain the identity marker row and **only** the expected tables — a production database fails here and the Worker answers `503 ISOLATION_ASSERTION_FAILED` without reading anything else.
* Configuration cannot carry a production database id/name: the only accepted values are the isolated name and a UUID that is not on the deny-list (and the marker check backs this up at runtime).
* Notifications are rows in `gate15_capture` whose `CHECK (suppressed = 1)` and `CHECK (real_send = 0)` make a recorded real send impossible; there is no network client in the bundle (global `fetch` is replaced by a thrower; the build scan forbids network constructs).

## ===== REQUIRES EXPLICIT GO (James / ChatGPT) — do not run before =====

## 3. Pre-flight snapshot (read-only)
```
CLOUDFLARE_ACCOUNT_ID=…  CLOUDFLARE_API_TOKEN=<read-scoped>  bash cloudflare/scripts/collect_remote_evidence.sh before
```
Confirms: isolated D1 name→id, Worker bindings (expect none), workers.dev disabled, no schedules, no custom domains, no zone routes; records `modified_on` of all Workers and identity of all D1 databases (metadata only).

## 4. Attach and deploy (exact steps)
1. Copy `wrangler.toml` to a working copy and replace the `database_id` placeholder with the id returned by step 3 for `driver-v2-gate15-isolated-20261103` (nothing else). Run `node cloudflare/scripts/assert_package_safe.mjs <that package root>` again — it must still pass (it refuses the production id).
2. Apply the schema to the isolated D1 only: `wrangler d1 execute driver-v2-gate15-isolated-20261103 --remote --file cloudflare/schema/gate15_d1_schema.sql`. Then verify the hash: `node -e` / `sha256sum cloudflare/schema/gate15_d1_schema.sql` equals `gate15_d1_schema.sha256`, and `wrangler d1 execute … --remote --command "SELECT marker FROM gate15_identity"` returns `driver-v2-gate15-isolated-20261103`.
3. Create the proof-window control secret **on the isolated Worker only**: `wrangler secret put GATE15_CONTROL_TOKEN --name driver-v2-gate15-isolated` (random value; keep it out of logs/chat).
4. `wrangler deploy` from the working copy (`--name driver-v2-gate15-isolated` is already in the file).
5. Turn on the workers.dev URL for **this Worker only** for the proof window (Worker → Settings → Domains & Routes → workers.dev, or `POST /accounts/{id}/workers/scripts/driver-v2-gate15-isolated/subdomain {"enabled":true}`). No custom domain, no route.

## 5. Run the proof
```
GATE15_BASE_URL=https://driver-v2-gate15-isolated.<account-subdomain>.workers.dev  GATE15_CONTROL_TOKEN=<token>  GATE15_RACES=200  GATE15_TARGET=remote-isolated \
  node cloudflare/scripts/gate15_proof.mjs
```
The runner refuses any other host. Output: `evidence/gate15/remote-isolated-results.json` (identity, D1 primitives, duplicate/replayed/stale/expired accepts, 57/63/117/123/177/183 s boundaries on the real clock, human fallback, PII exclusion, audit atomicity via fault-injected triggers, busy-driver rule, staff-assignment/cancel collisions, 200 contested races of 6 concurrent HTTP requests each, global invariants, zero-send, wallet, phone and synthetic-data assertions).
Resource note: ≈ 2,000 requests, each doing ≈ 5–40 D1 statements. If the account's plan caps D1 queries per invocation (free plan: 50), the control calls (`new-booking`, `free-drivers`) are the heaviest — reduce `GATE15_RACES` rather than weakening any assertion.

## 6. Evidence + production-untouched assertion
```
… collect_remote_evidence.sh after
node cloudflare/scripts/diff_production_snapshots.mjs evidence/gate15/remote     # exit 0 and "production_untouched": true required
```

## 7. Teardown / rollback (returns everything to the pre-proof state)
1. Disable workers.dev for the isolated Worker (reverse of 4.5).
2. `wrangler secret delete GATE15_CONTROL_TOKEN --name driver-v2-gate15-isolated`.
3. Empty the isolated D1: `wrangler d1 execute driver-v2-gate15-isolated-20261103 --remote --file cloudflare/schema/gate15_teardown.sql` (drops every Gate 1.5 object; verify `SELECT COUNT(*) FROM sqlite_master WHERE type='table'` shows no user tables).
4. Return the Worker to its zero-binding shell: `wrangler versions list --name driver-v2-gate15-isolated`, then `wrangler rollback <shell-version-id> --name driver-v2-gate15-isolated` (or redeploy the original empty shell).
5. Re-run `collect_remote_evidence.sh after` and `diff_production_snapshots.mjs` to show only the isolated resources ever changed.
6. Deleting the D1 / Worker entirely is a separate, optional decision for James; this package never deletes either.
Nothing in teardown touches `nadi-dispatch-api`, `nadi-marketplace-db`, NAT, FijiDash, Bula or any booking.

## What local validation cannot prove (still UNKNOWN until step 5 runs remotely)
* Real Cloudflare D1 semantics under load (batch transaction behaviour across isolates/colos, latency, per-invocation query limits).
* True multi-isolate concurrency: locally the 6 simultaneous HTTP requests of a race reach one workerd process; remotely they may land on different isolates/locations.
* Remote clock/latency effects on the ±3 s boundary margins (exact-millisecond boundaries are proven in the deterministic suite).
* workers.dev routing/TLS, secret handling, observability, and plan limits.
