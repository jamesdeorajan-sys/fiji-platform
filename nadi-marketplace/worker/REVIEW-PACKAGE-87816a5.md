# Independent review package: `ceo/p0-notification-reconcile` @ `2125a340a5a77788b2bdd4cdb403cac0e0b77940`

For Codex. **NOT deployed, no migration applied.** Continues PR #55 (`ceo/p0-admin-notification-retry-fix`, head `8020996`) + deployed `f33cba0` (return/add-on sanity fix, unmodified). History: `87816a5` (initial driver-broadcast bound/concurrent fix) had two Codex-reported gaps, fixed at `6272906`/`ab25dce`; that head had three further Codex-reported regressions, fixed at `30c6187`/`a4ba994`; Codex independently verified that head clean (93 passed, 1 skipped, outbound networking disabled) except one test-harness leak, fixed at this head, `2125a34`. Filename kept as `REVIEW-PACKAGE-87816a5.md` for a stable link across revisions.

## RELEASE COMMIT
**`2125a340a5a77788b2bdd4cdb403cac0e0b77940`** on branch `ceo/p0-notification-reconcile`. This is a test-only commit — `nadi-marketplace/worker/worker.js` is byte-identical to the previously-verified `a4ba994`/`f75c413` head (sha256 `2780149db71c68f9d327f49f1d501ea5c6a92f0a92de826c8a29151632a6e56e`, unchanged). Nothing in the Worker source changed to fix the leak; only test files and the new `network_guard.mjs` helper did.

## Get the exact source
```
git fetch origin ceo/p0-notification-reconcile
git checkout 2125a340a5a77788b2bdd4cdb403cac0e0b77940
cd nadi-marketplace/worker
sha256sum worker.js ../migrations/milestone36-admin-notification-retry-state.sql ../migrations/milestone37-driver-broadcast-claim-state.sql
```
Expected: `worker.js` = `2780149db71c68f9d327f49f1d501ea5c6a92f0a92de826c8a29151632a6e56e`; `milestone36...sql` = `66b9f9cc7fa2709a1492ae173b5ff419f8122dbcc44f38defd88d56c9a363e31`; `milestone37...sql` = `9cfb79f6aa38229330dd99d7378f18456f205bef00a1f5563f63373ac12f9d76` (both unchanged since first added).

## What changed at this head: the test-harness leak, fixed (Codex independent verification of `f75c413`)
Codex's own run of `f75c413` was clean at the Worker-behaviour level (93 passed, 1 skipped, outbound networking disabled) and separately flagged one test-harness leak: in `driver_broadcast_recovery.test.mjs`, the "preserved: eligibility, assignment checks and the 3-attempt retry cap still hold" test called `m.restore()` (reverting the fetch mock) **before** `POST /driver/bookings/:id/accept` — that endpoint sends a real guest WhatsApp message (`sendGuestDriverAssignedWhatsApp`, awaited inline by `handleDriverAcceptBooking`) on its way to a 200 response, so the call reached the real, unmocked `fetch`.

**Fixed:**
- The mock now stays active for the entire test body (wrapped in `try/finally`), restored exactly once, after the accept call and everything else has run.
- The initial booking creation now uses a real `ctx` (not a discarding stub) whose captured `waitUntil` work is `await`ed via `ctx.flush()` before the test proceeds, instead of letting it race in the background uncontrolled.
- **New: `network_guard.mjs`**, wired into every offline ESM test file in this directory. `installNetworkGuard()` sets `globalThis.fetch` to a function that both throws (most code paths fail loudly) *and* independently records every unmocked call in a module-level log; a file-scoped `after()` hook asserts that log is empty once all of that file's tests finish. This is what makes an unmocked outbound attempt fail the run **even when Worker code itself catches and swallows the resulting error** (e.g. `sendHealthAlertWhatsApp`'s own `try/catch`) — the assertion doesn't depend on any individual test noticing.
- **Verified the guard actually works**, not just trusted: the exact leak was temporarily reintroduced, the guard's `after()` hook failed the run with the real unmocked URL (`POST https://graph.facebook.com/v19.0/p/messages`) in its message, then the fix was restored and the suite reran clean.
- `booking-handoff.test.js` (CJS, intentionally live only when `NADI_API_BASE_TEST` is set) is unchanged — offline it registers a single skip and never touches `fetch`, so no guard was needed there.

## Run the tests — explicit file list, env vars unset, never a wildcard
Two files make real HTTP calls and must stay excluded/gated:
- `pricing.test.js` — always makes live calls to `api.nadiairporttransfers.com`. Never include it.
- `booking-handoff.test.js` — makes live calls **only if `NADI_API_BASE_TEST` is set**; otherwise self-skips. **Explicitly unset it before running offline.**
```
cd nadi-marketplace/worker
unset NADI_API_BASE_TEST ADMIN_TOKEN
node --test admin_notification_retry.test.mjs notification_reconcile.test.mjs notification_fencing.test.mjs broadcast_bounded.test.mjs departure_dispatch.test.mjs driver_broadcast_recovery.test.mjs driver_broadcast_regressions2.test.mjs pricing-steps.test.mjs return-addon-sanity.test.mjs booking-handoff.test.js
```
Expected: `tests 91`, `pass 90`, `fail 0`, `skipped 1`, **zero network-guard leak assertions**. Also `node --check worker.js` and `npx wrangler deploy --dry-run`.

## MIGRATION ROLLOUT — `milestone36` + `milestone37` (not applied; both need James's separate approval before this step)
Apply **both** to `nadi-marketplace-db`, in either order (each has its own missing-table fallback in the Worker code, so the Worker and the migrations are order-independent of each other):
```
cd nadi-marketplace
npx wrangler d1 execute nadi-marketplace-db --remote --file migrations/milestone36-admin-notification-retry-state.sql
npx wrangler d1 execute nadi-marketplace-db --remote --file migrations/milestone37-driver-broadcast-claim-state.sql
```
Both are additive (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) — zero changes to `bookings`, `booking_events`, `drivers` or any existing table; safe to re-run; nothing reads either new table until the new Worker is deployed. `milestone37`'s claim logic also reconciles any `driver_broadcast_sent` history that predates it (including sends made by the *old* Worker in the gap between applying this migration and deploying the new code — see regression 1 above), so applying the migration first, ahead of the Worker deploy, is safe.

## WORKER DEPLOY
Deploy `worker.js` from `2125a340a5a77788b2bdd4cdb403cac0e0b77940` (or later, if amended after this review) to `nadi-dispatch-api`.
**Rollback: version `f5640b11-39f7-42ec-810c-be6d0052a768`** (currently live, source `f33cba0`). Earlier rollback if needed: `80de8469-0fb6-4784-8b66-c199bd5ef7f2`.
After deploy, watch for `admin_notification_superseded`, `admin_notification_duplicate_delivery`, `admin_notification_exhausted`, `driver_broadcast_failed` event rates in `booking_events`.

## What to verify (cumulative)
1. **Attempt-ownership fencing** (admin + driver) — `notification_fencing.test.mjs`, `driver_broadcast_recovery.test.mjs` ("OVERLAPPING" tests).
2. **Monotonic SENT / duplicate-alert handling** — same files.
3. **Crash recovery without a guest retry** — "worker terminated after saving" / "REGRESSION 3 REPRO" (drives `worker.scheduled` directly).
4. **Backoff, exhaustion, and the retry cap (atomic in the claim)** — `notification_fencing.test.mjs` + `driver_broadcast_regressions2.test.mjs` "REGRESSION 2".
5. **Driver-broadcast recovery, retry concurrency, legacy reconciliation, candidate-window coverage** — `broadcast_bounded.test.mjs` + `driver_broadcast_recovery.test.mjs` + `driver_broadcast_regressions2.test.mjs` together.
6. **`UPDATE ... RETURNING` on real D1 (not production data)** — steps in `NOTIFICATION-RETRY-DESIGN.md` ("Driver broadcast" section): a scratch D1 database was created via `wrangler d1 create`, exercised, then deleted via `wrangler d1 delete`; the Worker-binding call shape was also exercised on workerd's local D1 via `wrangler dev --local`. Neither touched `nadi-marketplace-db`. Recommend Codex repeat this independently.
7. **Test-harness integrity** — `network_guard.mjs` is in place file-wide; recommend Codex spot-check by temporarily breaking one mock's `finally` and confirming the guard's `after()` hook fails that file's run.

## Rollout order (nothing here authorizes any of it — each step needs James's separate approval)
1. This independent review of `2125a34`.
2. Apply `milestone36-admin-notification-retry-state.sql` and `milestone37-driver-broadcast-claim-state.sql` to `nadi-marketplace-db` (see MIGRATION ROLLOUT above).
3. Deploy the Worker (see WORKER DEPLOY above). Rollback `f5640b11-39f7-42ec-810c-be6d0052a768`.
4. Watch event rates as listed above.
