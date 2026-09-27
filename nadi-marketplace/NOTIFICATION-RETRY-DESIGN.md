# Admin-notification delivery: design, recovery and rollout (issue #59)

Branch `ceo/p0-notification-reconcile`; continues PR #55 (`ceo/p0-admin-notification-retry-fix`). NOT deployed, migration NOT applied.
Preserves the deployed return/add-on sanity repair (`f33cba0`): no line touching `assertSanePricing`, `computeAuthoritativePrice` or `applyExtras` changed.

## What is stored
`admin_notification_state` (one row per booking, migration `milestone36-admin-notification-retry-state.sql`, additive, `IF NOT EXISTS`):
`state` NOT_ATTEMPTED | ATTEMPTING | FAILED_RETRYABLE | SENT, `attempt_count`, `last_outcome`, `last_error`, `last_provider_status`, `wamid`, `updated_at`.
`booking_events` keeps the audit trail: `admin_notification_sent | failed | skipped_idempotent | superseded | duplicate_delivery | exhausted`, `admin_short_alert_sent | failed`.

## Concurrency: attempt ownership (fencing)
* **Claim** is one atomic statement `UPDATE ... SET state='ATTEMPTING', attempt_count=attempt_count+1 ... RETURNING attempt_count`. Only one caller can win; the number returned is that attempt's ownership token. A stale claim (ATTEMPTING and `updated_at` older than 120 s) can be reclaimed, which increments the token.
* **Failure completion is fenced**: applies only `WHERE state='ATTEMPTING' AND attempt_count = <my token>`. An older attempt finishing late changes nothing and is recorded as `admin_notification_superseded`.
* **Success is monotonic**: a provider-confirmed delivery from ANY attempt sets SENT (`WHERE state != 'SENT'`); SENT is never left. If the row was already SENT the second delivery is recorded as `duplicate_delivery`.
* Reproduced on `e9f9f99` before the fix (both orders): old failure after new success, and new failure after old success, each downgraded SENT to FAILED_RETRYABLE. Tests: `notification_fencing.test.mjs` (all pass now).

## What recovers a booking if the guest NEVER retries
`waitUntil` is not a scheduler; a killed isolate loses its work. Recovery is the existing `*/5 * * * *` cron (no new schedule, no `wrangler.toml` change): `sweepAdminNotifications()` re-attempts bookings from the last 24 h with no confirmed alert that are:
1. no state row and >= 3 min old (the worker died before/at the claim: "saved but never notified"),
2. FAILED_RETRYABLE and past backoff (5, 10, 20, 40, 60 min by attempt count),
3. ATTEMPTING with a stale claim.
Max 6 attempts; on the cap it records `admin_notification_exhausted` once and raises one escalation (`source guest, app_issue, booking_id`) visible in the existing escalation flow. Batch of 10 per run. Same claim as a guest replay, so a sweep and a replay cannot both send. Worst-case latency to a retry: <= 5 min plus backoff. If the state table is absent (migration not applied) the sweep logs and does nothing (the direct-send fallback still covers first creation).

## Outcomes are distinguishable
`last_outcome` and each failed event carry `outcome`: `PROVIDER_REJECTED` (Meta returned an error status, `possibly_delivered=false`), `TIMEOUT_UNKNOWN` (no answer in 8 s, Meta may still have accepted it, `possibly_delivered=true`), `NETWORK_ERROR` (`possibly_delivered=true`), `NOT_CONFIGURED`. All are retryable; only the possibly-delivered ones can cause a duplicate alert on retry.

## Duplicate-alert risk (accepted, documented)
Chosen bias: a rare duplicate alert over a silent booking. A duplicate can occur when: (a) an attempt timed out or hit a network error but Meta had accepted it and a retry then sends again; (b) a stale-claim reclaim happens while the original attempt is still running and both deliver (recorded as `duplicate_delivery`); (c) the isolate dies after Meta accepted but before the state/event was written. It cannot occur for a booking already SENT (existing bookings with an `admin_notification_sent` event are seeded SENT). Alerts are provider ACCEPTANCE only, never proof that anyone read them.

## Driver broadcast (added after independent review request, issue #59)
Reproduced first: with the driver-template sends stalled, `POST /bookings` never returned (the broadcast was awaited, sequential and unbounded, before the alerts and before the guest response); 7 of the 9 tests in `broadcast_bounded.test.mjs` failed on `5e1a280`, while eligibility and first-accept already passed.
* `sendWhatsAppTemplate` (driver and guest templates) is bounded like the alert sends (8 s; timeout = `TIMEOUT_UNKNOWN`).
* With an execution context the driver broadcast, short alert and full notification are three independent jobs in one `ctx.waitUntil`, started together: a driver-message failure or stall cannot delay the guest response or the admin notification. The response still reports `matched_drivers` (best-effort count; a failed read no longer fails an already-saved booking) plus `deferred: true`. Without a context (offline tests) they run sequentially in the original order with per-driver `results` as before. No client reads the `broadcast` field.
* Driver sends are concurrent (3 stalled drivers cost ~1 timeout, not 3) and every driver's outcome is recorded (`driver_broadcast_sent|failed`, with `driver_id`, `outcome`, `possibly_delivered`).
* Recovery (`sweepDriverBroadcasts`, same `*/5` cron): only bookings still `pending` and unassigned, 3-60 min old. Drivers whose send failed and who never received one are retried (max 3 tries each); if no outcome was recorded at all (worker died first) the initial broadcast is performed once. A driver who already received it is never messaged again. `GET /driver/jobs` remains an independent path for any online in-zone driver.
* UNCHANGED and re-tested: eligibility (`findMatchingOnlineDrivers`: verified + online + zone includes `pickup_zone`), zone check on accept (403), first-accept protection (exactly one winner, the rest 409), the job feed.
* Also: exhausted notification rows are excluded from the sweep batch (they could otherwise occupy all 10 slots).
* Validation against a real D1 engine (not production): a scratch D1 database was created, exercised with synthetic rows and deleted; `UPDATE ... RETURNING attempt_count` returns the token, a fresh claim returns no row, a stale claim is reclaimed (token 2), the old attempt's failure completion changes 0 rows, `SENT` is never downgraded. The Worker-binding shape (`.first()` on `UPDATE ... RETURNING`, `.run().meta.changes`) was exercised on workerd's local D1 via `wrangler dev --local`.

## Codex-reproduced gaps in the driver broadcast (issue #59, fixed on top of 87816a5)
Both reproduced first (failing tests against 87816a5, in `driver_broadcast_recovery.test.mjs`), then fixed.

1. **Partial broadcast interruption.** The sweep only recovered drivers with a recorded `driver_broadcast_failed`
   event; a driver the Worker never even attempted (isolate died between one driver's send resolving and the next
   one starting) had no event at all and was silently skipped forever. Fixed with a new durable per-`(booking,
   driver)` claim table, `driver_broadcast_attempts` (migration `milestone37-driver-broadcast-claim-state.sql`,
   additive, `IF NOT EXISTS`, NOT applied), read the same way the admin-notification retry state already is: a
   driver with no row at all is treated as "missing" exactly like one that explicitly failed.
2. **Driver recovery batch starvation.** The sweep's `SELECT ... ORDER BY id LIMIT 10` treated every fetched
   candidate as consuming one of the 10 recovery slots, even when its broadcast was already fully complete. Ten
   older, done-but-still-pending bookings therefore permanently occupied the query window and an eleventh booking
   needing its initial broadcast was never reached, including after repeated sweeps. Fixed by separating the DB
   query window (`DRIVER_BROADCAST_SWEEP_CANDIDATES = 200`, cheap id-only reads) from the recovery-work budget
   (`DRIVER_BROADCAST_SWEEP_WORK_BUDGET = 10`, real re-broadcast calls actually made): a booking with nothing
   outstanding is skipped without consuming the work budget, so a booking that does need work is reached in the
   same tick regardless of how many completed ones precede it, as long as the candidate window covers them.
3. **Found while fixing the above: no atomicity across concurrent sweep ticks, or a sweep overlapping the
   booking's own creation-time broadcast.** The old "read booking_events, decide who's missing, send" sequence had
   no cross-process fencing. Fixed by giving `driver_broadcast_attempts` the same atomic
   `UPDATE ... RETURNING attempt_count` claim `admin_notification_state` already has
   (`claimDriverBroadcastAttempt`): two overlapping sweeps, or a sweep overlapping the initial broadcast, can now
   only ever claim and message a given driver once (`notification_fencing`-style tests: two full concurrent
   `worker.scheduled` ticks against the same booking send each of 3 eligible drivers exactly once; an overlapping
   creation-time broadcast and sweep against the same stalled driver never exceed one send either).
Legacy fallback (migration37 not applied): `claimDriverBroadcastAttempt` catches `no such table` and attempts
unfenced (best-effort, matching the pre-fix behaviour - gap 1 is NOT fixed in this mode, since there is no durable
per-driver state to distinguish "never attempted" from "nothing to report"); the sweep falls back to the same
booking_events-derived computation the pre-fix sweep used. Covered by its own test.
Preserved and re-tested: eligibility (verified + online + zone), the zone check and first-accept protection on
`/driver/bookings/:id/accept`, the 3-attempt retry cap, and that no further sends happen once a booking is accepted.

**Test hygiene note:** `pricing.test.js` makes real HTTP calls to `api.nadiairporttransfers.com` (documented in its
own header comment) and must NEVER be included in an offline wildcard run (`*.test.mjs`/`*.test.js`). Every command
in `REVIEW-PACKAGE-87816a5.md` now names files explicitly; the full offline set is:
`node --test admin_notification_retry.test.mjs notification_reconcile.test.mjs notification_fencing.test.mjs broadcast_bounded.test.mjs departure_dispatch.test.mjs driver_broadcast_recovery.test.mjs pricing-steps.test.mjs return-addon-sanity.test.mjs booking-handoff.test.js`
(87 tests, 86 pass, 1 pre-existing skip, as of this checkpoint).

## Rollout order (each step needs James's approval; none done)
1. Independent review of source, migration and tests.
2. Apply `milestone36-admin-notification-retry-state.sql` to `nadi-marketplace-db` (additive). Safe before the Worker: nothing reads it yet. (Verify D1 accepts `UPDATE ... RETURNING` via `.first()` on a scratch row first; D1 supports RETURNING, but this is the one statement shape not exercised by real D1 in the offline tests.)
3. Deploy the Worker (rollback target: current production `f5640b11-39f7-42ec-810c-be6d0052a768`; before that `80de8469-0fb6-4784-8b66-c199bd5ef7f2`). The Worker is order-independent of the migration (falls back to the direct send), but step 2 first gives durable retry from the first booking.
4. Observe: no booking may go without an `admin_notification_sent` event for > ~10 min; `superseded`, `duplicate_delivery` and `exhausted` events are the signals to watch. NO live test booking is part of this plan unless James asks.
Rollback: redeploy the previous Worker version. The table is additive and can be left in place (rows are ignored by the old Worker); dropping it loses only retry state.
