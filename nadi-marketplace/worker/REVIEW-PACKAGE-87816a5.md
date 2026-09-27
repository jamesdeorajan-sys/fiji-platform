# Independent review package: `ceo/p0-notification-reconcile` @ `627290685928db6f0bb1e77e5f49f8cab57cbe37`

For Codex. NOT deployed, no migration applied. Continues PR #55 (`ceo/p0-admin-notification-retry-fix`, head `8020996`) + deployed `f33cba0` (return/add-on sanity fix, unmodified). Supersedes the earlier package written against `87816a5` (kept for history: `87816a5` had two gaps Codex independently reproduced, both fixed in this head — see "What changed since 87816a5" below).

## Get the exact source
```
git fetch origin ceo/p0-notification-reconcile
git checkout 627290685928db6f0bb1e77e5f49f8cab57cbe37
cd nadi-marketplace/worker
sha256sum worker.js ../migrations/milestone36-admin-notification-retry-state.sql ../migrations/milestone37-driver-broadcast-claim-state.sql
```
Expected: `worker.js` = `b8627540ded696c48e066ab655f9b67e39ddd545110559da5632bf37cf139768`; `milestone36...sql` = `66b9f9cc7fa2709a1492ae173b5ff419f8122dbcc44f38defd88d56c9a363e31`; `milestone37...sql` = `9cfb79f6aa38229330dd99d7378f18456f205bef00a1f5563f63373ac12f9d76`.

## Run the tests — EXPLICIT FILE LIST ONLY, never a wildcard
`pricing.test.js` makes **real HTTP calls to `api.nadiairporttransfers.com`** (see its own header comment). `*.test.mjs`/`*.test.js` wildcards silently include it. Every command below names files explicitly.
```
cd nadi-marketplace/worker
node --test admin_notification_retry.test.mjs notification_reconcile.test.mjs notification_fencing.test.mjs broadcast_bounded.test.mjs departure_dispatch.test.mjs driver_broadcast_recovery.test.mjs pricing-steps.test.mjs return-addon-sanity.test.mjs booking-handoff.test.js
```
Expected: `tests 87`, `pass 86`, `fail 0`, `skipped 1` (the skip is pre-existing and unrelated to this branch; confirm by running the same explicit list against `f33cba0`, where the same file also skips 1).

Also: `node --check worker.js` (syntax) and `npx wrangler deploy --dry-run` (confirms it bundles; do not remove `--dry-run`).

Focused runs, by concern:
```
node --test notification_reconcile.test.mjs        # base reconcile: replay re-notifies, duplicate protection, legacy seeding, short-alert independence  -> 10 tests
node --test notification_fencing.test.mjs          # attempt-ownership fencing, monotonic SENT, concurrent replays, crash recovery, backoff/cap           -> 7 tests
node --test broadcast_bounded.test.mjs             # driver-broadcast bound/concurrency, eligibility, first-accept protection unchanged                   -> 9 tests
node --test driver_broadcast_recovery.test.mjs     # the two Codex-reported gaps (reproduced, then fixed) + overlapping-sweep safety                       -> 6 tests
node --test departure_dispatch.test.mjs            # characterization only: dispatch of a hotel-to-airport booking (no behaviour change)                  -> 4 tests
node --test admin_notification_retry.test.mjs      # PR #55's own original suite, kept and still passing                                                  -> 3 tests
node --test pricing-steps.test.mjs return-addon-sanity.test.mjs booking-handoff.test.js  # pre-existing suites, unaffected                                 -> 48 tests
```

## What changed since `87816a5` (Codex's two reproduced gaps, fixed here)
1. **Partial broadcast interruption.** In `87816a5`, `sweepDriverBroadcasts()` only retried drivers with a recorded `driver_broadcast_failed` event; a driver never even attempted (isolate died between one driver's send resolving and the next starting) had no event at all and was silently never recovered. `driver_broadcast_recovery.test.mjs`, test "CODEX GAP 1 REPRO" — seeds exactly that DB shape (one driver `SENT`, two with zero rows in either `driver_broadcast_attempts` or `booking_events`) and asserts the sweep messages the two missing drivers.
2. **Driver recovery batch starvation.** The sweep's `SELECT ... ORDER BY id LIMIT 10` treated every fetched row as consuming a recovery slot, even a fully-complete one. Ten older, done-but-still-pending bookings permanently occupied the window; an 11th booking needing its initial broadcast was never reached, including after repeated sweeps. Test "CODEX GAP 2 REPRO" reproduces exactly that 10-plus-1 shape and confirms the 11th is reached in the same sweep, and stays done (not re-sent) on a following sweep.
3. **Found while fixing the above:** no atomicity across two concurrent sweep ticks, or a sweep overlapping the booking's own creation-time broadcast — a real duplicate-send risk. Fixed with the same atomic `UPDATE ... RETURNING` claim `admin_notification_state` already uses, now also for `driver_broadcast_attempts` (new migration `milestone37`, additive, `IF NOT EXISTS`, **not applied**). Tests "OVERLAPPING SWEEPS" (two full concurrent `worker.scheduled` ticks against the same booking) and "OVERLAPPING creation-time broadcast and a sweep" both assert each driver is messaged at most once.

Read `git diff 87816a5 627290685928db6f0bb1e77e5f49f8cab57cbe37 -- nadi-marketplace/worker/worker.js` for the exact code diff (new `claimDriverBroadcastAttempt`, the rewritten `broadcastBookingToDrivers` and `sweepDriverBroadcasts`). `git diff f33cba0 627290685928db6f0bb1e77e5f49f8cab57cbe37 -- nadi-marketplace/worker/worker.js` for the diff against the deployed baseline — confirm 0 lines touching `assertSanePricing`, `computeAuthoritativePrice`, `applyExtras`, `applyTripTypeMultiplier`.

**Legacy fallback** (migration37 not applied): `claimDriverBroadcastAttempt` catches `no such table` and attempts unfenced (best-effort — no cross-process fencing in that mode); the sweep falls back to the pre-`milestone37` `booking_events`-derived computation. Gap 1 is **not** fixed in that mode (no durable per-driver state exists to distinguish "never attempted" from "no outcome to report") — this is documented, not hidden, and covered by its own test ("missing-table fallback").

## What to verify (per the CEO's instruction)
1. **Attempt-ownership fencing** — `notification_fencing.test.mjs` ("REPRO 1"/"REPRO 2"/"old success while the new attempt is in flight"). Same pattern now also in `driver_broadcast_recovery.test.mjs` for drivers.
2. **Monotonic SENT / duplicate-alert handling** — same files; a second real delivery is recorded (`admin_notification_duplicate_delivery`), never re-sent, never downgrades state.
3. **Crash recovery without a guest retry** — "worker terminated after saving" (notification) and "RECOVERY: worker killed before any driver was messaged" / "CODEX GAP 2 REPRO" (broadcast). All simulate a mid-request failure, then drive `worker.scheduled({cron:'*/5 * * * *'}, ...)` directly.
4. **Backoff and exhaustion** — `notification_fencing.test.mjs`, "guest never retries after a FAILED alert": no immediate retry, escalating backoff (5/10/20/40/60 min), 6-attempt cap, exactly one `admin_notification_exhausted` event + one escalation.
5. **Driver-broadcast recovery and retry concurrency** — `broadcast_bounded.test.mjs` + `driver_broadcast_recovery.test.mjs` together: bounded sends, concurrent dispatch, missing-driver recovery (gap 1), batch-starvation fix (gap 2), overlapping-sweep safety (gap 3), eligibility/zone-check/first-accept protection/3-attempt cap all unchanged.
6. **`UPDATE ... RETURNING` on real D1 (not production data)** — steps in `NOTIFICATION-RETRY-DESIGN.md` ("Driver broadcast" section): a scratch D1 database was created via `wrangler d1 create`, exercised with synthetic rows through the exact claim/reclaim/fence SQL, then deleted via `wrangler d1 delete`; the Worker-binding call shape (`.first()` on the RETURNING update, `.run().meta.changes`) was also exercised on workerd's local D1 via `wrangler dev --local` with a throwaway Worker. Neither touched `nadi-marketplace-db`. Recommend Codex repeat this independently (a fresh scratch D1, not reused) rather than trust this report alone.

## Rollout order (unchanged; nothing here authorizes any of it)
1. This independent review.
2. Apply `milestone36-admin-notification-retry-state.sql` **and** `milestone37-driver-broadcast-claim-state.sql` to `nadi-marketplace-db` (both additive, `IF NOT EXISTS`, order-independent of the Worker deploy per each's own missing-table fallback).
3. Deploy the Worker. Rollback `f5640b11-39f7-42ec-810c-be6d0052a768`, then `80de8469-0fb6-4784-8b66-c199bd5ef7f2`.
4. Watch for `admin_notification_superseded`, `admin_notification_duplicate_delivery`, `admin_notification_exhausted`, `driver_broadcast_failed` event rates.
All four steps need James's separate approval.
