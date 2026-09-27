# Independent review package: `ceo/p0-notification-reconcile` @ `87816a5f8e32686cb4518a3cacf0b379f7db9308`

For Codex. NOT deployed, migration NOT applied. Continues PR #55 (`ceo/p0-admin-notification-retry-fix`, head `8020996`) + deployed `f33cba0` (return/add-on sanity fix, unmodified).

## Get the exact source
```
git fetch origin ceo/p0-notification-reconcile
git checkout 87816a5f8e32686cb4518a3cacf0b379f7db9308
cd nadi-marketplace/worker
sha256sum worker.js ../migrations/milestone36-admin-notification-retry-state.sql
```
Expected: `worker.js` = `ebf217a1bce77dbaa44a9923601a54da138dcf1cb2a843524096e6ac3c08e8b8`; `milestone36-admin-notification-retry-state.sql` = `66b9f9cc7fa2709a1492ae173b5ff419f8122dbcc44f38defd88d56c9a363e31`.

## Files changed vs `f33cba0` (deployed return/add-on repair)
```
 nadi-marketplace/NOTIFICATION-RETRY-DESIGN.md                            |  45 ++
 nadi-marketplace/migrations/milestone36-admin-notification-retry-state.sql |  85 ++++
 nadi-marketplace/worker/admin_notification_retry.test.mjs               | 488 +++++++++++++++++++++
 nadi-marketplace/worker/broadcast_bounded.test.mjs                      | 177 ++++++++
 nadi-marketplace/worker/departure_dispatch.test.mjs                     | 102 +++++
 nadi-marketplace/worker/notification_fencing.test.mjs                   | 183 ++++++++
 nadi-marketplace/worker/notification_reconcile.test.mjs                 | 231 ++++++++++
 nadi-marketplace/worker/worker.js                                       | 478 +++++++++++++++++---
 8 files changed, 1730 insertions(+), 59 deletions(-)
```
`git diff f33cba0 87816a5 -- nadi-marketplace/worker/worker.js` for the exact code diff. Confirm 0 lines touching `assertSanePricing`, `computeAuthoritativePrice`, `applyExtras`, `applyTripTypeMultiplier` (the deployed pricing repair).

## Run the tests (offline, no network, no live D1)
```
cd nadi-marketplace/worker
node --test *.test.mjs *.test.js
```
Expected: `tests 91`, `pass 90`, `fail 0`, `skipped 1` (the skip is pre-existing, unrelated to this branch — confirm by running the same command on `f33cba0` where it also skips 1).

Focused runs, by concern:
```
node --test notification_reconcile.test.mjs   # base reconcile: replay re-notifies, duplicate protection, legacy seeding, short-alert independence, offline path        -> 10 tests
node --test notification_fencing.test.mjs     # attempt-ownership fencing, monotonic SENT, concurrent replays, crash recovery, backoff/cap, outcome classification    -> 7 tests
node --test broadcast_bounded.test.mjs        # driver-broadcast bound/concurrency/recovery, eligibility, first-accept protection unchanged                          -> 9 tests
node --test departure_dispatch.test.mjs       # characterization only: what a hotel-to-airport booking's dispatch actually does (no behaviour change)                -> 4 tests
node --test admin_notification_retry.test.mjs # PR #55's own original suite, kept and still passing                                                                  -> 3 tests
node --check worker.js                        # syntax
npx wrangler deploy --dry-run                 # confirms it bundles; do not remove --dry-run
```

## What to verify (per the CEO's instruction)
1. **Attempt-ownership fencing** — `notification_fencing.test.mjs`, tests "REPRO 1"/"REPRO 2"/"old success after reclaim". Read `claimAdminNotificationAttempt()` (returns `attempt_count` via `UPDATE ... RETURNING`) and the completion blocks in `attemptAdminNotification()` (`WHERE state='ATTEMPTING' AND attempt_count = ?` for failure; `WHERE state != 'SENT'` for success).
2. **Monotonic SENT / duplicate-alert handling** — same file, "old success while the new attempt is in flight" test; confirms a second real delivery is recorded as `admin_notification_duplicate_delivery`, never re-sent, never downgrades state.
3. **Crash recovery without a guest retry** — "worker terminated after saving" test (notification) and "RECOVERY: worker killed before any driver was messaged" test (broadcast). Both simulate a mid-request failure, then drive `worker.scheduled({cron:'*/5 * * * *'}, ...)` directly.
4. **Backoff and exhaustion** — "guest never retries after a FAILED alert" test: no immediate retry, escalating backoff (5/10/20/40/60 min, `adminNotificationBackoffSeconds`), 6-attempt cap (`ADMIN_NOTIFICATION_MAX_ATTEMPTS`), exactly one `admin_notification_exhausted` event + one `createEscalation` call, no further attempts after the cap.
5. **Driver-broadcast recovery and retry concurrency** — `broadcast_bounded.test.mjs` in full. Key tests: "hanging driver sends must not hold the guest response", "driver sends run concurrently and are each bounded", "a driver whose message failed is retried by the cron sweep ... capped at 3 tries" (only the failing driver is retried; a driver who already received it is never re-messaged; no retries once the job is accepted), "eligibility is unchanged", "first-accept protection ... unchanged" (three simultaneous accepts -> exactly one 200, two 409).
6. **`UPDATE ... RETURNING` on real D1 (not production data)** — reproducible steps in `NOTIFICATION-RETRY-DESIGN.md` ("Driver broadcast" section, last paragraph): a scratch D1 database was created via `wrangler d1 create`, exercised with 2 synthetic rows through the exact claim/reclaim/fence SQL, then deleted via `wrangler d1 delete`; separately, the Worker-binding call shape (`.first()` on the RETURNING update, `.run().meta.changes`) was exercised on workerd's local D1 via `wrangler dev --local` with a throwaway Worker. Neither touched `nadi-marketplace-db`. Recommend Codex repeat this independently (a fresh scratch D1, not reused) rather than trust this report alone.

## Rollout order (unchanged; nothing here authorizes any of it)
1. This independent review.
2. Apply `milestone36-admin-notification-retry-state.sql` to `nadi-marketplace-db` (additive, `IF NOT EXISTS`, order-independent of the Worker deploy per the missing-table fallback).
3. Deploy the Worker. Rollback `f5640b11-39f7-42ec-810c-be6d0052a768`, then `80de8469-0fb6-4784-8b66-c199bd5ef7f2`.
4. Watch for `admin_notification_superseded`, `admin_notification_duplicate_delivery`, `admin_notification_exhausted`, `driver_broadcast_failed` event rates.
All four steps need James's separate approval.
