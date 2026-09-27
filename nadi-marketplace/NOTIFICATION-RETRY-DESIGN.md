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

## Rollout order (each step needs James's approval; none done)
1. Independent review of source, migration and tests.
2. Apply `milestone36-admin-notification-retry-state.sql` to `nadi-marketplace-db` (additive). Safe before the Worker: nothing reads it yet. (Verify D1 accepts `UPDATE ... RETURNING` via `.first()` on a scratch row first; D1 supports RETURNING, but this is the one statement shape not exercised by real D1 in the offline tests.)
3. Deploy the Worker (rollback target: current production `f5640b11-39f7-42ec-810c-be6d0052a768`; before that `80de8469-0fb6-4784-8b66-c199bd5ef7f2`). The Worker is order-independent of the migration (falls back to the direct send), but step 2 first gives durable retry from the first booking.
4. Observe: no booking may go without an `admin_notification_sent` event for > ~10 min; `superseded`, `duplicate_delivery` and `exhausted` events are the signals to watch. NO live test booking is part of this plan unless James asks.
Rollback: redeploy the previous Worker version. The table is additive and can be left in place (rows are ignored by the old Worker); dropping it loses only retry state.
