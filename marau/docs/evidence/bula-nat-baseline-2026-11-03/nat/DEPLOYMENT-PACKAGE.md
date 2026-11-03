# NAT read-only SOURCE + DISCOVERY deployment package — PREPARED, NOT EXECUTED

Worker: `nadi-dispatch-api` (D1 `nadi-marketplace-db` 0ec1cd84-fcda-4f7f-8337-0fb70fe1a512). Public base: https://api.nadiairporttransfers.com. Build tool pinned: **wrangler 4.156.2** (`npx wrangler@4.156.2 deploy --dry-run --outdir <dir>`).

## 1. BASELINE = CURRENT PRODUCTION (re-proved 2026-11-03, read-only)
| Item | Value |
|---|---|
| Current production worker.js (fetched live via the Cloudflare read-only API, multipart part `worker.js`, 264,477 bytes) | sha256 `04203dd3599e9e5cdbdd5d4b8686a65e00b4ea9a983c4dafa3e70ed6a5a69287` |
| Baseline (commit `99c1aef2805636883d6f0e40aed1df204d0a857b`, tag `nat-prod-baseline-04203dd3`, rebuilt three times) | sha256 `04203dd3599e9e5cdbdd5d4b8686a65e00b4ea9a983c4dafa3e70ed6a5a69287` — **identical** |
| Candidate (commit 951ef46, tag `nat-source-discovery-candidate-ae00bd7c`, rebuilt 3×, deterministic) | sha256 `ae00bd7c238aafc763aabca7fecc8307e3ce8103df66b9e21932a08444ecc788` |

## 2. Exact diff (baseline → candidate)
Source: +68 lines / −0 in `nadi-marketplace/worker/worker.js` (`nat-source-discovery.diff`), plus the new test file. Bundle: 0 lines removed, 56 added (`bundle-baseline-vs-patched.diff`). Added: two route dispatch blocks, `requireSourceRead`, `handleSourceReadBooking`, `handleSourceRecentBookings`.

## 3. Impact statement
| | |
|---|---|
| Routes affected | **Added only:** `GET /admin/bookings/recent` and `GET /admin/bookings/<digits>`. The baseline has no GET `/admin/bookings/<id>` route, so nothing is shadowed; every other path reaches exactly the same code as before (proved by the differential test on 18 existing routes: status, body and database effect identical). |
| Schema changes | **NONE** (no migration, no index; discovery uses the bookings PRIMARY KEY). |
| D1 data changes | **NONE** (the new handlers contain no INSERT/UPDATE/DELETE; tested byte-identical database before/after, incl. bad-parameter and unauthorised requests). |
| Booking-flow changes | **NONE** (`POST /bookings`, quote, negotiate, assignment, notifications untouched). |
| Rentals changes | **NONE** (rental.mjs / rental_console.mjs / `/rental-enquiries` / `/admin/rentals*` untouched; rentals suite passes; differential test covers them). |
| Secret changes | **ONE ADDED:** `SOURCE_READ_TOKEN` (new; set only at step F). `ADMIN_TOKEN` and every existing secret unchanged. |
| Bindings / crons / vars | unchanged (wrangler.toml byte-identical). |

## 4. Security properties (all tested)
Only `SOURCE_READ_TOKEN` is accepted; master `ADMIN_TOKEN` and admin login tokens are refused; unset or empty secret ⇒ 401 for everyone (fail closed); GET only; the single-booking route returns exactly 20 whitelisted fields (no guest name, notes, IP, payment method, attribution); the discovery route returns only `id, created_at, status`, max 100 per call; no logging of secrets or guest data; kill switch = delete the secret.

## 5. Rollback targets
* **Before deploying**, record the current version id: `npx wrangler@4.156.2 deployments list` (note the top entry; this is the **platform rollback target**).
* **FAST KILL (seconds, no redeploy):** `npx wrangler@4.156.2 secret delete SOURCE_READ_TOKEN` ⇒ both new routes answer 401 to everyone.
* **FULL ROLLBACK (exact baseline):** either `npx wrangler@4.156.2 rollback <recorded-version-id>` or redeploy tag `nat-prod-baseline-04203dd3` (`git checkout nat-prod-baseline-04203dd3 && cd nadi-marketplace/worker && npx wrangler@4.156.2 deploy`) — the rebuild is byte-identical to `04203dd3…` (verify with `--dry-run` first). Rollback needs no data or schema action.
