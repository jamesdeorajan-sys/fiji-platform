# Marau — smallest production-integration release package

2026-09-29. Issue #54. **Planning/documentation only — no code, no production change, no real-guest import, no live send in this document or its preparation.** Round-25 iPhone actual-device acceptance (`c995b2c`, Worker `6f51d76c-6b0d-40ad-88c3-0ae0c332fec5`) is preserved as PASSED and unaffected by anything below.

> **ROUND 26 CORRECTION, recorded 2026-09-29.** The first version of this document (commit `da1c7da`) contained real inaccuracies, caught before James spent time on them: it restated a STALE "source not present in this checkout" claim that round 13 had already corrected; it proposed the real cancel/change `booking_events.event_type` shape as still-unknown when a direct, read-only inspection (below) shows the real code's transition table exactly matches what `real_booking_sync.js` already assumes; it treated "staff authentication is built" as if that meant Marau could already confirm a real reservation, when in fact Marau's staff workflow only ever writes to Marau's OWN mirror — this document now makes explicit that a genuinely new write path is required; and it handed James ten technical decisions that were actually engineering calls this document should make itself, rather than genuine business decisions only he can make. This version corrects all of that using direct, read-only inspection of the real deployed system (evidence below, each item marked by how it was obtained), replaces the prior "James needs to decide" framing with one concrete recommended design, and narrows the outstanding items to the business decisions that are genuinely his alone.

## 0. What changed since the first draft, and how it was verified

Everything below was obtained this round, read-only, from three independent sources — each claim below states which:
- **Live production D1** (`nadi-marketplace-db`, `0ec1cd84-fcda-4f7f-8337-0fb70fe1a512`, same Cloudflare account as every other Vakaviti property) — schema and aggregate-only queries (table names, column definitions, `COUNT`/`GROUP BY`/`DISTINCT` on non-identifying columns). No individual guest row, name, phone, or booking id was read or is reproduced anywhere in this document.
- **The real Worker's own source**, `nadi-marketplace/worker/worker.js` (5,647 lines) — present in this repository on branch `ceo/p0-notification-reconcile` (already checked out in an existing local worktree from earlier work), not on `main` and not on Marau's own branch. This corrects round 12's "not present in this git checkout at all" — that was true only of the branches round 12 searched, not of the repository as a whole, exactly as round 13 already noted; this document had regressed to the stale phrasing.
- **`wrangler deployments list --name nadi-dispatch-api`** — the actual live deployment history of the real Worker, independent of both of the above.

### The deployed-revision gap, open since round 22, is now closed

The live `nadi-dispatch-api` Worker's current version is `8c1fa242-bf63-432b-bded-cf6f13b07cbf`, deployed 2026-09-27T11:11:51Z, tagged to commit `2125a34`. `git merge-base --is-ancestor 30c6187 2125a34` confirms `30c6187` — the commit every Marau round since 13 has cited as "the real source" — is a direct ancestor of what is actually live, and `git diff 2125a34 30c6187 -- nadi-marketplace/worker/worker.js` is empty: the file is byte-identical between the two. **Everything rounds 13–25 traced from `30c6187` is confirmed to be what is actually running in production**, not merely what is in the repository's history. This is a first-hand deployment-history check, kept explicitly separate from the repository read below, per instruction.

### The event-type coverage question, answered from source, not from a DISTINCT query

A read-only `SELECT DISTINCT event_type, new_status FROM booking_events` against the real database returns only six rows: `created→pending`, plus four notification-bookkeeping types (`admin_notification_sent/failed/skipped_idempotent`, `admin_short_alert_sent`, `driver_broadcast_sent`) with no status. **No `accepted`, `en_route`, `completed`, or `cancelled` event has ever been recorded.** A `GROUP BY status` on `bookings` explains why: of every real booking today, 198 are `pending` and 1 is `completed` — **zero have ever reached `accepted`**. Taken alone, a DISTINCT query over this data would wrongly suggest the confirm/cancel/en-route paths don't need handling — exactly the trap the instruction warned against. Reading the actual source resolves it correctly: `handleDriverAcceptBooking` and `handleAdminManualAssign` both write `status='accepted'` and call `logBookingEvent({eventType:'accepted', ...})`; a status-transition table at the real `handleDriverBookingStatus` (`accepted: ['en_route','completed'], en_route: ['completed']`) governs the rest and also calls `logBookingEvent` on every transition; and a real cancel handler exists and does the same for `cancelled`. **`real_booking_sync.js`'s own `REAL_EVENT_TYPES` (`created`, `accepted`, `en_route`, `completed`, `cancelled`) already matches this exactly** — round 13's original mapping was correct; it was simply never provable from production data, because the real confirm/cancel/complete code paths have not yet been exercised on any real booking. That is a genuine, useful finding in its own right (see §7, Phase 3) — not a defect in Marau's design.

### Two further things this inspection found, used directly in §1–§5 below

1. **A real, existing per-guest WhatsApp confirmation send already exists at the exact moment a booking is accepted** — `GUEST_DRIVER_ASSIGNED_TEMPLATE = 'vakaviti_guest_driver_assigned'`, sent to `booking.guest_phone` from inside `handleDriverAcceptBooking`/`handleAdminManualAssign` themselves. There is no equivalent guest-facing send at booking *creation* time (pending). `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID` are set as real Worker secrets, not test placeholders (confirmed by `wrangler.toml`'s own comment, corrected in an earlier session from "not-yet-set").
2. **`nadi-dispatch-api` already runs, in production, a proven monitoring/rollback pattern**: a `*/5 * * * *` Cron Trigger calls `runHealthCheckAlert`, which is edge-triggered (alerts only on a healthy↔unhealthy transition, tracked in a `platform_settings` key) and sends a real WhatsApp template (`vakaviti_ops_health_alert`) to a configured `admin_alert_phone` setting. A separate daily cron backs up to R2. `admin_login_tokens` (schema-only read: `id`, `token`, `expires_at`, `created_at`) is a shared, expiring magic-link table — **not per-operator identity**; there is no existing per-operator staff system to simply reuse, correcting an implicit assumption in the first draft.

## 1. Recommended smallest integration design

One design, not several options — every piece below reuses something already built and hosted-verified in the isolated preview, or an already-proven pattern from `nadi-dispatch-api` itself.

### 1a. Immediate pending guest access

Unchanged from round 14's original design, already built: the moment `real_booking_sync.js` mirrors a real booking's own `created`/`pending` signal, the guest's session (`guest_sessions`, keyed by contact) exists and their Trip is readable — **before any driver or admin has acted**. Nothing new required here.

### 1b. Secure guest-link delivery

**Smallest design: piggyback the Marau Trip link on the existing `vakaviti_guest_driver_assigned` WhatsApp send**, as one additional template parameter, at the exact point `handleDriverAcceptBooking`/`handleAdminManualAssign` already message the guest. This needs zero new WhatsApp Business template (no new Meta approval), reuses the real, already-configured `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID` secrets, and rides on a send that already goes to the guest's own real phone number today.

**Explicit, named tradeoff, not a defect:** because this is the *accept-time* template, a guest in `pending` (immediate access per §1a exists mechanically, but the guest has no link yet) won't actually see their Trip until a driver/admin accepts. A creation-time send would need a brand-new guest-facing template and Meta approval — out of scope for "smallest." This is Decision (b) in §8.

### 1c. Authenticated staff confirmation into the authoritative booking system — the write path made explicit

**This is the piece the first draft got wrong by omission.** Marau's existing staff-review workflow (rounds 19–22, hosted-verified) authenticates a staff member and records their decision — but today it writes ONLY to Marau's own mirror (`marau_test_bookings`, `marau_staff_decisions`). **A read-only mirror cannot itself confirm a real reservation.** The real confirmation only exists once `nadi-dispatch-api`'s own `bookings.status` actually transitions — and that only happens through `handleDriverAcceptBooking`/`handleAdminManualAssign`, both gated by `requireAdmin` (a real bearer `ADMIN_TOKEN` or the magic-link mechanism).

**The smallest correct design:** Marau's staff "Confirm" action, on submit, makes one authenticated server-to-server call to `nadi-dispatch-api`'s own real admin-gated confirm endpoint (the same one `handleAdminManualAssign` already serves), using a credential issued for this purpose (§8, Decision a) — **never the browser, never the guest, never Marau's own admin token**. Only after that real call succeeds does Marau record the operator's name in `marau_staff_decisions` — as an **audit record of what Marau asked for and got**, never as the confirmation itself. If the real call fails, Marau's own decision endpoint must report that failure plainly (not a local success) and the reservation remains genuinely unconfirmed — exactly the same "never silently invent success" discipline round 22's commit-boundary fix already established for Marau's own synthetic-source workflow, now applied to the real one.

### 1d. Current-state sync and recoverable failures

No new design needed: `real_booking_sync.js`'s claim-based, read-then-apply sync (rounds 13–19, hosted-fault-injection-verified through round 22) is reused as-is. Its `reader` parameter — today only ever a test double — gets a real implementation that issues the same read-only queries already demonstrated safe against `nadi-marketplace-db` in this round's own inspection. Its trigger becomes a Cron Trigger, at a cadence matching the pattern `nadi-dispatch-api` already runs on the same account (its own sweeps run every 5–15 minutes). Terminal-state stickiness, generation fencing, and per-booking claims (rounds 16–18) already make a failed or interrupted sync self-healing on the next tick — this was the entire point of that multi-round design effort, and it applies unchanged here.

## 2. Preserving the existing WhatsApp booking loop — and what happens if Marau fails

**No part of the driver-broadcast, admin-notification, or guest-template WhatsApp loop lives inside Marau, is called by Marau, or is gated by Marau in this design.** Every real send (`driver_broadcast_sent`, `admin_notification_sent`, `vakaviti_guest_driver_assigned`, `vakaviti_guest_en_route`) originates from `nadi-dispatch-api`'s own handlers and crons, entirely inside its own Worker.

**If Marau's Worker, D1, or the new sync cron fails entirely:** real bookings still get created, broadcast to drivers, accepted, messaged to guests via the existing real templates, and completed — completely unaffected, because none of that machinery has ever called into Marau (§1c's one new call is Marau calling *out*, never the reverse). What stops working, and only until Marau recovers: (1) Marau's own Trip display stops receiving new state (guests using it see stale data, not wrong data — sync only ever writes what it freshly reads); (2) Marau's staff "Confirm" shortcut is unavailable, so staff fall back to `nadi-dispatch-api`'s own existing driver/admin-assign flow directly — the exact flow they use today, with zero new dependency introduced on it. Marau is additive to the existing loop, never a chokepoint in it.

## 3. Trip-display-only is a proposed limited pilot, not Stage 1 completion

Restated plainly, because it matters: shipping §1–§2 above only ever proves the display/access/sync/staff-confirm mechanics for a small number of real, consenting guests' *trip status*. It is not, and is not proposed as, satisfying Marau's actual Stage 1 objective ([[m13-boat-transfer-release-gating]], the staged-deployment-formula memory), which is deals — matched offers via Issue #54's Smart Return engine. Deals remain entirely gated on that engine's own, separate, still-open ops-verified-availability gap (`smart-return-trigger-fill/docs/OPS_VERIFIED_MOVEMENTS_CONTRACT.md`), which nothing in this release package touches or advances. This pilot is a smaller, separable proof of the access/sync/confirm mechanics — not a reduced version of Stage 1's actual goal, and not a step that should be read as "Stage 1, mostly done."

## 4. Staff authentication and monitoring — recommended designs, not open questions

**Staff authentication:** adopt the same pattern `nadi-dispatch-api` already runs in production today — a single break-glass `ADMIN_TOKEN` bearer secret plus short-lived magic-link tokens (an `admin_login_tokens`-shaped table), the same shape Marau's own preview already approximates with its shared `MARAU_ADMIN_TEST_TOKEN`. This is a real, already-proven pattern for a small operations team, not a from-scratch design — building genuine per-operator identity is not warranted for a first, small-scale pilot and is not recommended here.

**Monitoring:** mirror `nadi-dispatch-api`'s own exact, already-working pattern — a Cron Trigger health check, edge-triggered (alert only on a healthy↔unhealthy transition, tracked the same way in a settings table), sending to a real destination via the same `sendHealthAlertWhatsApp`-style mechanism and template family. This is not a new tool to select; it is the same one already running in this account.

**Rollback**, mechanically ready already: pausing the new sync Cron Trigger stops Marau's mirror from advancing (no guest-facing change, since guests still read whatever Marau last had); revoking a session's `access_token_revoked` (wired and tested since round 24, cookie-aware since round 25) stops that guest's access instantly; neither ever touches `nadi-marketplace-db`, since Marau's only write into it is the one explicit, auditable call in §1c.

## 5. Actionable implementation sequence, with acceptance checks

Every phase below is buildable and testable in isolation against synthetic data before Phase 6; nothing here has been executed.

1. **Production resource creation.** New, isolated Marau D1 + Worker (distinct from `marau-stage1-test-db`/`marau-stage1-preview`, which stay preview-only forever, and from `nadi-marketplace-db`, to which Marau never gets direct write access). Full existing migration stack (0007–0032) applied and verified, exactly as already done for the preview. Real secrets via `wrangler secret`, never plaintext `[vars]`.
   *Acceptance:* the new Worker serves the same isolated-preview test suite (455/455) against the new, empty production D1, proving the schema/migration path is clean.
2. **Real sync, read-only.** Wire `real_booking_sync.js`'s `reader` to the real, read-only queries demonstrated in §0 against `nadi-marketplace-db`; wire a Cron Trigger at the recommended cadence.
   *Acceptance:* a real 'pending' booking (a genuine internal/team test booking, never an unconsenting guest) appears in the new production Marau Trip display within one cron interval, with the existing privacy mapping verified directly (no `guest_name`/`guest_email`/`flight_number`/notes field present anywhere in the mirrored row or any log line — the same check round 12 §7 already specified).
3. **Guest-link delivery.** Add the Marau link as a new parameter to the existing `vakaviti_guest_driver_assigned` template call.
   *Acceptance:* the same team test booking, accepted through `nadi-dispatch-api`'s own real flow, delivers a working Marau link to a real, consenting internal phone via the existing WhatsApp send.
4. **Staff write path.** Wire Marau's staff "Confirm" action to the real admin-gated endpoint per §1c, using the credential from Decision (a).
   *Acceptance:* the same team test booking transitions to real `status='accepted'` in `nadi-marketplace-db` as a direct, verified result of a Marau staff action (read-only confirmation via the schema/aggregate techniques in §0 — never by pulling the row's own content); Marau's mirror reflects it within one cron interval; a deliberately-failed real call (fault-injected the same way rounds 13–22 already fault-inject Marau's own synthetic source) is reported to Marau's staff UI as a genuine failure, never a false success.
5. **Monitoring.** New Cron Trigger + health-check alert on the new production Worker, per §4, alerting to the real destination from Decision (c).
   *Acceptance:* a deliberately-induced unhealthy state (e.g., a temporarily revoked D1 binding in a throwaway test, never production) produces exactly one real alert on the transition, and exactly one recovery alert when healthy again — never a repeat alert while still down.
6. **Rollback drill, before any real guest.** Demonstrate, live, against the new production resource with zero real guest data present: pause the sync cron (mirror stops advancing, nothing guest-facing breaks); revoke a live test session's token (immediate 401, verified both via header and cookie per round 24/25's mechanism). Both timed and recorded.
7. **Limited real-guest pilot.** A small, explicit number of real, consenting guests (count and consent process per Decision (e)), trip-display only, staff using the real Marau confirm path from Phase 4, monitoring from Phase 5 live, rollback from Phase 6 armed and rehearsed.

## 6. Isolation constraint, unconditional and unchanged

No real guest's data is ever copied into `marau-stage1-test-db` or any other synthetic/preview database, at any phase, for any reason. Nothing above executes without the explicit go-ahead named in Decision (f).

## 7. Named unresolved business decisions — James's alone

Narrowed from the first draft's ten mixed technical/business items to the ones that genuinely require a business decision or an external go-ahead, not an engineering call this document should make itself:

**(a) Cross-system credential.** Someone who controls `nadi-dispatch-api` (its `ADMIN_TOKEN` secret, or willingness to mint a new, scoped one for Marau) needs to authorize and issue the one server-to-server credential §1c's staff-confirm call needs. If that's you wearing a different hat, this is a go/when decision; if it's someone else, this names who to ask.
**(b) Accept-time-only link delivery, accepted as the smallest tradeoff — or commission a new creation-time template instead** (real Meta template approval lead time, out of scope for "smallest" unless you want it).
**(c) The real destination** (phone/email) for Marau's own production health-check alert — reuse the existing `admin_alert_phone` setting, or a separate one for Marau specifically.
**(d) The optional guest-initiated `wa.me` "talk to our team" action** — build it for this release or leave the Trip view display-only with no outbound action (not required either way).
**(e) Pilot size and consent process** — how many real guests, how they're selected, and how consent for this pilot specifically is obtained and recorded.
**(f) Explicit go-ahead** to begin Phase 1 (create the new production Cloudflare resource) — nothing in §5 starts without it, and this release stays scoped to trip-display-only (§3) unless you say otherwise.

Nothing above is proposed for execution. This document exists so each of these six decisions can be made explicitly, with the engineering already resolved everywhere it could be.
