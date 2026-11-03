# Driver PWA v2 — Gate 1.5 package evidence (prepared + locally validated; NOT deployed) — 2026-11-03

**Classification: TESTED_NOT_LIVE → package READY_FOR_REVIEW.** The remote Cloudflare proof has **not** been run. Gate 2 remains **HOLD**.
Code under test: commit **`e852fce11537449bdeffd8421e77814ac5b1cbc8`** on `ceo/driver-pwa-v2-gate1-isolated` (the commit that follows contains only these evidence files and docs). Schema SHA-256 `e4b34d1de73235c78a5d0c9011642d3b42221a962365c4b76e4dea80dc9204c2`. Dry-run Worker bundle SHA-256 `29197f34352a2df2916f8661a791166aa55386fa2886c5ba1985fd072d751215` (66,230 bytes; sole binding `env.DB (driver-v2-gate15-isolated-20261103)`).

## 1. Policy delta (CEO decisions in AGENT_SYNC) — implemented
| Rule | Implementation | Proof |
|---|---|---|
| Driver with an ACTIVE assigned trip (`accepted`/`en_route`) gets no new immediate offer; first launch only, no scheduled stacking | eligibility query excludes busy drivers; sweep withdraws stale open offers of newly-busy drivers (`SUPERSEDED`, reason `DRIVER_HAS_ACTIVE_TRIP`); Accept refuses (pre-check **and** SQL claim guard) with new stable code `DRIVER_HAS_ACTIVE_TRIP` (HTTP 409); offers of a busy driver are shown `actionable:false` | G40–G43, G42b (50 same-driver two-booking races), G48 (100 overlapping bookings), G49 |
| After COMPLETED the driver is eligible again | status leaves the active set | G41, remote-proof step "previously busy driver eligible again" |
| Stale/replayed state cannot make an active driver win | G42 (service + HTTP 409), SQL guard inside the claim UPDATE | G42, G42b, mutant M6c |
| `DELIVERY_RECEIPT` = transport only; never engagement | new column `delivery_receipt_at`; engagement is **separate**: `engaged_at` + `engagement_source ∈ {VIEW, SESSION}` | G44 |
| At 120 s lack of engagement broadens dispatch even if delivered; originals stay actionable to 180 s; first valid accept wins; ≥180 s ⇒ `HUMAN_FALLBACK_REQUIRED` | sweep target: PRIORITY 1; GRACE 1 if engaged *or* receipt, else 2; ESCALATED 1 if engaged else 1+2; the old "unengaged offer dies at 120 s" rule was **removed** — the 180 s envelope is the only expiry | G45, G46, G47, updated G10/G11/G13/G17/G18 |

Existing Gate 1 requirements: all still pass (G01–G39 intact; five test expectations were *updated* to the new CEO policy and are listed in the commit — G11, G13, G17, G18, G27; G15/G38 now free finished drivers between races).

## 2. Local results (exact counts)
| Run | Result |
|---|---|
| `tests/gate1.test.mjs` (G01–G39 incl. G16b, G37-meta) | 38 tests, 38 pass, 0 fail, 0 skip |
| `tests/stress.test.mjs` (G37 100 journeys, G38 200 races, G38b 100 fallbacks, G39) | 4/4. **100/100 journeys; 0 double assignments; 0 forbidden pre-assignment PII; 0 unexpected sends; 0 lost transitions; 200/200 races one winner** (`evidence/stress-summary.json`) |
| `tests/gate15_policy.test.mjs` (G40–G49, G47b) | 12/12; G48 busy-aware stress: 100 overlapping bookings/6 drivers → 0 offers to busy drivers, 0 busy wins, 0 double assignments, max 1 active trip/driver, 74 stale busy accepts rejected (`evidence/gate15-policy-summary.json`) |
| `cloudflare/tests/safety.test.mjs` (isolation negative controls) | 23/23 |
| Phone-viewport browser/PWA (390×844, slow network) | 15/15 |
| Stability: whole deterministic set repeated | 40/40 clean runs after the fix (before the fix: 4 failures in 25) |
| **Real-HTTP proof on local workerd** (`run_local_validation.sh`, wrangler 4.156.2 `--local`, loopback only) | **45/45 checks; 200 contested races × 6 concurrent HTTP requests = 1,200 race requests (400×200 ASSIGNED, 800×409 ASSIGNMENT_ALREADY_TAKEN), 0 violations; winners d1=72 d2=67 d3=61; 1,915 HTTP requests total** (`local-workerd-results.json`, `local-workerd-run.txt`) |

## 3. Defect found and fixed during Gate 1.5 (not waived)
**G14 flake (≈16 %)**: a concurrent duplicate tap on the driver's *own* just-won booking could return `DRIVER_HAS_ACTIVE_TRIP` instead of an idempotent `ASSIGNED` replay (the tap had read the offer before the winner committed and then saw the winner's trip as "another active trip"). State was always consistent; the result code was wrong. Fix: the busy check excludes the booking the Accept is about. Regression test G49 (200 chaos trials); 40/40 clean repeats.

## 4. Mutation checks on the new rules (tests can fail)
| Mutant | Caught by |
|---|---|
| eligibility ignores busy drivers | G40, G41, G43, G48 |
| busy rule removed from Accept entirely | G42, G42b, G48 |
| accept pre-check removed but SQL claim guard kept | *equivalent mutant* (defence in depth; result code identical) |
| stale busy offers not withdrawn by sweep | G42 |
| DELIVERY_RECEIPT treated as engagement at 120 s | G45, G46 |
| unengaged original killed at 120 s | G11, G45 |
| VIEW / SESSION no longer recorded as engagement | 11 tests incl. G46 |
| booking-level first-wins SQL guards removed (remote runner) | **not detected by the HTTP runner**: the earlier pre-check and offer-level guards mask it; it *is* detected by the deterministic mid-batch hook test G16b. The remote proof therefore adds staff-assignment/cancellation collisions but cannot reproduce a mid-batch flip — disclosed. |

## 5. Package contents and enforced safety (see `cloudflare/RUNBOOK.md`)
Binds **only** `driver-v2-gate15-isolated-20261103` (name checked at build time; identity marker + exact table set checked at runtime before any request); refuses `nadi-marketplace-db`, `nadi-dispatch-api`, the known production D1 id and every production hostname (23 negative-control tests); no routes, crons, vars, services, other bindings; `workers_dev=false`; no network client (bundle contains exactly one `fetch`: the Worker entry; global `fetch` replaced by a thrower); notifications are capture rows whose schema CHECKs forbid a recorded real send; synthetic bookings only (`id ≥ 9,000,000,000`, `SYN-GATE1-` refs); placeholder driver phones `+000-GATE1-…`; wallet baseline asserted unchanged; test-control endpoints return 404 unless the isolated Worker has its own `GATE15_CONTROL_TOKEN`.

## 6. Evidence the remote run will produce (commands in RUNBOOK §3–§6)
resource identity, D1 identity, Worker bindings, routes/subdomain state, schedules, custom domains → `collect_remote_evidence.sh` (GET-only); schema hash (file + remote readback); test commit SHA (in results JSON); real D1 results + concurrency + D1 readback + zero-send + wallet/phone/synthetic assertions → `gate15_proof.mjs`; production-untouched → before/after snapshot diff; teardown/rollback → RUNBOOK §7 + `schema/gate15_teardown.sql` (verified locally: user tables → 0).

## 7. Zero-side-effect statement for THIS preparation
No Cloudflare API call, no `wrangler login`, no remote D1 access, no deploy, no secret, no route, no workers.dev change, no message of any kind was made. wrangler was used only with `--local` (loopback workerd, throw-away local SQLite) and `deploy --dry-run` (offline bundle). The only network use was `npm install wrangler` into a scratch directory outside the repository. `nadi-dispatch-api`, `nadi-marketplace-db`, NAT, FijiDash, Bula and all bookings were not touched or queried.

## 8. UNKNOWN / not proven (no hidden waivers)
* **Real Cloudflare D1** semantics (batch atomicity across the real service, partial unique index, `INSERT OR IGNORE…SELECT`, `json_extract`) are proven on the local D1 implementation only. They become proven only when step 5 of the runbook is run on the isolated D1.
* **True multi-isolate / multi-colo concurrency**: locally the 6 simultaneous HTTP requests of a race reach one workerd process. The remote run is the real test.
* **Remote boundary timing** uses ±3 s margins on the real clock (57/63/117/123/177/183 s); exact-millisecond boundaries are proven only in the deterministic suite.
* **D1 plan limits** (queries per invocation, writes) unknown; 200 races ≈ 2,000 requests; `GATE15_RACES` is adjustable without weakening assertions.
* **Control token**: the proof needs one isolated-Worker secret (`GATE15_CONTROL_TOKEN`); creating it is part of the approval-gated deploy steps and it is deleted at teardown.
* Carried from Gate 1: synthetic competitor drivers 2..N (placeholders), simulated PWA photo capture, no real WhatsApp adapter, no R2, no staff fallback console.
