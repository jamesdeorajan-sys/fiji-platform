# Independent review package: `ceo/p0-notification-reconcile` @ `a4ba994183c98251c9c1992a64cbfa27b9a0d781`

For Codex. NOT deployed, no migration applied. Continues PR #55 (`ceo/p0-admin-notification-retry-fix`, head `8020996`) + deployed `f33cba0` (return/add-on sanity fix, unmodified). History: `87816a5` (initial driver-broadcast bound/concurrent fix) had two Codex-reported gaps, fixed at `6272906`/`ab25dce`; that head had three further Codex-reported regressions, fixed at `30c6187`/`a4ba994` (this head). Filename kept as `REVIEW-PACKAGE-87816a5.md` for a stable link across revisions.

## Get the exact source
```
git fetch origin ceo/p0-notification-reconcile
git checkout a4ba994183c98251c9c1992a64cbfa27b9a0d781
cd nadi-marketplace/worker
sha256sum worker.js ../migrations/milestone36-admin-notification-retry-state.sql ../migrations/milestone37-driver-broadcast-claim-state.sql
```
Expected: `worker.js` = `2780149db71c68f9d327f49f1d501ea5c6a92f0a92de826c8a29151632a6e56e`; `milestone36...sql` = `66b9f9cc7fa2709a1492ae173b5ff419f8122dbcc44f38defd88d56c9a363e31`; `milestone37...sql` = `9cfb79f6aa38229330dd99d7378f18456f205bef00a1f5563f63373ac12f9d76` (unchanged since it was first added).

## Run the tests — explicit file list, env vars unset, never a wildcard
Two files make real HTTP calls and must stay excluded/gated:
- `pricing.test.js` — always makes live calls to `api.nadiairporttransfers.com` (its own header comment says so). Never include it.
- `booking-handoff.test.js` — makes live calls **only if `NADI_API_BASE_TEST` is set** in the environment; otherwise it self-skips (this is the "1 pre-existing skip" seen throughout). **Explicitly unset it before running offline.**
```
cd nadi-marketplace/worker
unset NADI_API_BASE_TEST ADMIN_TOKEN
node --test admin_notification_retry.test.mjs notification_reconcile.test.mjs notification_fencing.test.mjs broadcast_bounded.test.mjs departure_dispatch.test.mjs driver_broadcast_recovery.test.mjs driver_broadcast_regressions2.test.mjs pricing-steps.test.mjs return-addon-sanity.test.mjs booking-handoff.test.js
```
Expected: `tests 91`, `pass 90`, `fail 0`, `skipped 1`.

Also: `node --check worker.js` (syntax) and `npx wrangler deploy --dry-run` (bundles; do not remove `--dry-run`).

Focused runs, by concern:
```
node --test notification_reconcile.test.mjs           # base reconcile: replay re-notifies, duplicate protection, legacy seeding, short-alert independence  -> 10 tests
node --test notification_fencing.test.mjs             # attempt-ownership fencing, monotonic SENT, concurrent replays, crash recovery, backoff/cap           -> 7 tests
node --test broadcast_bounded.test.mjs                # driver-broadcast bound/concurrency, eligibility, first-accept protection unchanged                   -> 9 tests
node --test driver_broadcast_recovery.test.mjs        # gap 1 (missing per-driver outcome), gap 2 (batch starvation v1), gap 3 (overlapping sweeps)          -> 6 tests
node --test driver_broadcast_regressions2.test.mjs    # regression 1 (legacy send reconciliation), 2 (cap not atomic), 3 (candidate-window starvation v2)    -> 4 tests
node --test departure_dispatch.test.mjs               # characterization only: dispatch of a hotel-to-airport booking (no behaviour change)                  -> 4 tests
node --test admin_notification_retry.test.mjs         # PR #55's own original suite, kept and still passing                                                  -> 3 tests
node --test pricing-steps.test.mjs return-addon-sanity.test.mjs booking-handoff.test.js  # pre-existing suites, unaffected (with NADI_API_BASE_TEST unset)   -> 48 tests
```

## What changed at this head (three Codex-reported regressions against `6272906`/`ab25dce`, fixed)
1. **Migration/legacy send history.** A driver already notified via a legacy `driver_broadcast_sent` event (pre-`milestone37`, or written by an old Worker in the migration-to-deploy gap) was re-sent, because the new table starts empty and the claim unconditionally seeded `NOT_ATTEMPTED`. `driver_broadcast_regressions2.test.mjs`, "REGRESSION 1 REPRO" — seeds 3 legacy sent events, applies `milestone37` mid-test, confirms the sweep now sends 0 driver messages. Fix: `claimDriverBroadcastAttempt` backfills from `booking_events` on first insert, seeding `SENT` when a historical send exists.
2. **Retry cap not enforced atomically.** A stale `ATTEMPTING` row already at `attempt_count = 3` could still be reclaimed for a 4th send — the cap was only checked by the sweep's own pre-filter, and only for `FAILED_RETRYABLE`. "REGRESSION 2 REPRO" seeds that exact stale row and confirms 0 sends now, `attempt_count` unchanged. Fix: `attempt_count < DRIVER_BROADCAST_MAX_TRIES` is now inside the claim's own `UPDATE ... WHERE` clause.
3. **Candidate-window starvation, still not fixed by widening `LIMIT`.** 200 already-complete pending bookings followed by a 201st needing work: with a static `ORDER BY id LIMIT 200`, the 201st is never in the window, ever — raising the number only raises the threshold. "REGRESSION 3 REPRO" reproduces exactly this and confirms the 201st is reached within 2 sweeps now. Fix: a rotating cursor in `platform_settings` (`driver_broadcast_sweep_cursor_id`, no new migration) — each tick continues from where the last stopped, wrapping around once past the highest id.

Read `git diff 6272906 a4ba994183c98251c9c1992a64cbfa27b9a0d781 -- nadi-marketplace/worker/worker.js` for the exact code diff. `git diff f33cba0 a4ba994183c98251c9c1992a64cbfa27b9a0d781 -- nadi-marketplace/worker/worker.js` for the diff against the deployed baseline — confirm 0 lines touching `assertSanePricing`, `computeAuthoritativePrice`, `applyExtras`, `applyTripTypeMultiplier`.

## What to verify (cumulative, per every prior instruction)
1. **Attempt-ownership fencing** (admin + driver) — `notification_fencing.test.mjs`, `driver_broadcast_recovery.test.mjs` ("OVERLAPPING" tests).
2. **Monotonic SENT / duplicate-alert handling** — same files.
3. **Crash recovery without a guest retry** — "worker terminated after saving" / "REGRESSION 3 REPRO" (drives `worker.scheduled` directly).
4. **Backoff, exhaustion, and the retry cap (now atomic)** — `notification_fencing.test.mjs` + `driver_broadcast_regressions2.test.mjs` "REGRESSION 2".
5. **Driver-broadcast recovery, retry concurrency, legacy reconciliation, and candidate-window coverage** — `broadcast_bounded.test.mjs` + `driver_broadcast_recovery.test.mjs` + `driver_broadcast_regressions2.test.mjs` together.
6. **`UPDATE ... RETURNING` on real D1 (not production data)** — steps in `NOTIFICATION-RETRY-DESIGN.md` ("Driver broadcast" section): a scratch D1 database was created via `wrangler d1 create`, exercised, then deleted via `wrangler d1 delete`; the Worker-binding call shape was also exercised on workerd's local D1 via `wrangler dev --local` with a throwaway Worker. Neither touched `nadi-marketplace-db`. Recommend Codex repeat this independently.

## Rollout order (unchanged; nothing here authorizes any of it)
1. This independent review.
2. Apply `milestone36-admin-notification-retry-state.sql` **and** `milestone37-driver-broadcast-claim-state.sql` to `nadi-marketplace-db` (both additive, `IF NOT EXISTS`, order-independent of the Worker deploy per each's own missing-table fallback).
3. Deploy the Worker. Rollback `f5640b11-39f7-42ec-810c-be6d0052a768`, then `80de8469-0fb6-4784-8b66-c199bd5ef7f2`.
4. Watch for `admin_notification_superseded`, `admin_notification_duplicate_delivery`, `admin_notification_exhausted`, `driver_broadcast_failed` event rates.
All four steps need James's separate approval.
