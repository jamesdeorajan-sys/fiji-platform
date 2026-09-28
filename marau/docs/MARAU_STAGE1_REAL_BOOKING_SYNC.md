# Marau — corrected real-booking sync contract, demonstrated synthetically (round 13, corrected further round 14)

2026-09-28. Issue #54. Branch `ceo/marau-stage1-preview`. **No production writes, no real-guest import, no live send.** Everything in this document runs only against the isolated `marau-stage1-test-db` shape (locally, the same `node:sqlite` shim every other Marau test already uses) and synthetic source rows shaped like the real `bookings`/`booking_events` tables.

> **ROUND 14 CORRECTION, recorded 2026-09-28.** Codex's independent review of round 13 (commit `41c9ba4`, confirmed 401/401 existing tests passing, no shared-engine changes) found five further bounded, concrete defects in the round-13 implementation itself (not the round-12 plan) — all five are now fixed in `worker/real_booking_sync.js` and demonstrated with real SQL fault injection and a deterministic concurrency barrier (no reliance on real thread timing). **Some claims below, written for round 13, are now superseded — read the round-14 section first, then treat anything below that conflicts with it as historical record of what round 13 actually did, not the current behavior:**
> 1. **Round 13 wrongly gated real-booking sync on acceptance.** The actual requirement — restated explicitly this round — is that a saved real booking grants secure **pending** Trip access immediately, the same moment the real system saves it, never waiting for a human to accept it. Round 13's `PENDING_NOT_SYNCED` behavior (skip a `pending`/`created` event entirely) is now REMOVED; a `created` event (`new_status: 'pending'`) runs through the identical first-sync path as any other event, granting immediate access with Marau status `'pending'`.
> 2. **Round 13's ordering check was READ-then-WRITE, not atomic — a real, demonstrated bug.** A later event, paused between its own read and write, could silently overwrite a still-newer event's state (proven with a deterministic repro, not a flaky race). Fixed by moving the ordering check into the UPDATE's own `WHERE` clause, evaluated atomically by SQLite/D1 at write time. Also: round 13's `source_event_ordinal` was fed by an invented per-test counter, not a real, durable value — renamed/replaced with `source_event_id`, meant to be populated from the real `booking_events.id`.
> 3. **Round 13's first-sync creation was not durably recoverable.** A failure on the LAST of its three writes (the link-row insert) left an orphaned session and an unlinked booking, and a naive retry created a SECOND session and failed with `DUPLICATE_CLIENT_BOOKING_REF` — reproduced directly with a real fault-injected `CREATE TRIGGER` on `marau_real_booking_links`. Fixed with an idempotent, deterministic-ref recovery check run before any new session is ever created.
> 4. **Round 13's later-event handling only ever touched status/provenance columns.** A changed pickup time, route, vehicle, or price on a later, validated source snapshot never reached the guest's Trip. Fixed — every field-carrying apply now writes the full current snapshot, gated by the same atomic, validated ordering.
> 5. **Round 13 validated `event_type` alone, not the whole event.** A recognized `event_type` paired with an inconsistent `new_status` (e.g. `accepted` + `garbage`) still silently advanced the stored ordering/provenance fields. Fixed with full event validation (type/status consistency, a real durable version, and booking-association) run strictly before any database write.
>
> See `worker/real_booking_sync.js`'s own header for the complete, corrected rationale behind each fix, and `test/marau_real_booking_sync.test.mjs` for the round-14 tests (`round14/1` through `round14/5`, plus a re-verification of every round-13 correction that still holds and a full corrected end-to-end demonstration).

## Why this round exists

Round 12 traced the real booking-write path but, in proposing *how* Marau would connect to it, made several concrete design mistakes — some of them regressions against security and policy decisions this codebase had already made and documented. This round's job was to catch and fix each one before any of it became code that could be mistaken for a real proposal, then prove the corrected version actually works, synthetically, in isolation.

## The seven corrections

### 1. Verified-ownership access is reused, never bypassed

Round 12 proposed: *"looks up or creates a `guest_sessions` row keyed by that booking's real contact (phone)... A second real booking by the same guest reuses the same session."* This is precisely the P0 vulnerability `worker.js`'s `createSessionAndOfferLink` already exists to prevent — its own header comment documents the original bug directly: *"a booking submission used to hand out an EXISTING session's access token whenever the supplied phone alone matched one — a new booking could silently inherit a stranger's session (and their prior bookings) just by guessing/knowing their phone number."*

**Corrected design** (`worker/real_booking_sync.js`): the sync module never looks a session up by phone. It re-associates a later event with an existing session **only** via an explicit prior row in a new `marau_real_booking_links` table, keyed by the real booking's own stable reference — never by contact details. The very first sync of a given real booking calls the exact same `createSessionAndOfferLink` a guest's own submission calls (now exported from `worker.js` for reuse, not re-implemented), so a genuine same-phone earlier session still only ever produces the existing verified **link offer**, never direct reuse.

**Tests, all passing:** a fresh accepted booking creates one session + one mirrored booking; a second real booking on the same phone gets its own, different session and access token, never the first session's; a shared-phone "attacker" session cannot read the other session's trip, and the verification code stays readable only via the original session's own token.

### 2. Immediate access and confirmed-only ingestion stay separate

Nothing in `handleCreateBooking` (Marau's own guest-facing booking form — immediate access, `status: 'pending'`) was touched. The sync module has a completely separate code path and, critically, **never syncs a real booking that is still `pending`** (`PENDING_NOT_SYNCED`) — so Smart Return-style confirmed-only ingestion and Marau's own guest self-serve access remain visibly two different things, not blurred together. Tested directly.

### 3. Revocation inventory corrected

Round 12 implied revocation still needed wiring. It didn't: `requireGuestSession` already rejects `access_token_revoked = 1` on every protected call, and `/preview/trip/revoke` already sets it — both pre-existing. This round's test exercises the **existing** mechanism against a **protected** endpoint (`/preview/trip`), not the public booking-creation endpoint (which never required a token), and separately asserts `requireGuestSession` itself returns `null` for a revoked token. No revocation code was written this round — none was needed.

### 4. No invented confirmation policy — `confirmed_unallocated` stays dead

Round 12 proposed mapping a real accepted booking to Marau's `'confirmed'` or `'confirmed_unallocated'` depending on the real row's `assigned_driver_id`. Two independent problems with that, both now documented directly in `real_booking_sync.js`'s header:

- `worker.js`'s own history already settled this: a prior round introduced `'confirmed_unallocated'`, and a **later, independent review explicitly reverted it** as an un-sanctioned policy change (`handleAdminDecideBooking`'s own comment: *"this review found that itself needs an explicit operational decision from James before it exists as a policy at all... The 'confirmed_unallocated' value is left in migration 0016's CHECK constraint (harmless — it is simply never written by this handler again)"*). Round 12's proposal would have been the first code anywhere to actually write that dead value.
- The proposed branch is also **structurally impossible** against the real source: reading the current real worker (commit `30c6187`, see correction 6), both real accept paths set `assigned_driver_id` and `status = 'accepted'` in the **same atomic `UPDATE ... WHERE assigned_driver_id IS NULL AND status = 'pending'`** — a real `'accepted'` booking with no assigned driver cannot occur.

**Corrected design:** `mapRealStatusToMarauStatus` maps `accepted`/`en_route`/`completed` to plain `'confirmed'` — always, unconditionally — and never produces `'confirmed_unallocated'`. The source's own vehicle-assignment fact is still recorded, but purely as an informational column (`source_assigned_driver_id`), never used to choose a status value. Tested directly, including a suite-wide assertion that no row anywhere ever has `status = 'confirmed_unallocated'`.

### 5. The guest-account data contract is its own, not the shadow adapter's

Round 12's field-mapping table said *"`guest_name`/`guest_phone`/`guest_email`/`flight_number`/notes — never read into the mirror,"* copying `production_adapter.js`'s privacy line verbatim. That line is correct for the **anonymous, opaque-reference-only** Smart Return ledger, which has no reason to carry a contactable identity — but wrong for a **guest-facing account system**: `guest_sessions.guest_email`/`guest_phone` are `NOT NULL` columns (migration 0007) and Marau's own booking form already requires both.

**Corrected contract:** `guest_email`/`guest_phone` ARE carried through — unavoidably and intentionally, the minimum a real account needs — while fields with no guest-facing purpose today (`flight_number`, `notes`) are still never read into the mirror, and a missing email or phone fails the sync closed (`MISSING_GUEST_CONTACT`) rather than creating an uncontactable session. Tested directly, including a check that `flight_number`/`notes` never appear on the mirror row or leak into the `/preview/trip` response even when present on the synthetic source.

### 6. Traced against the current real source, not just historical documentation

Round 12 said the real `nadi-marketplace/worker/worker.js` was *"confirmed NOT present in this git checkout"* — true only of that one branch's own working tree, not of the repository. `git log --all` finds it: current as of commit `30c6187` on `refs/heads/ceo/p0-notification-reconcile` (2026-09-27, the most recent revision of that file across every branch in this repo). Read directly against that revision:

- Real status lifecycle: `pending -> accepted` (`handleDriverAcceptBooking`/`handleAdminManualAssign`) `-> en_route -> completed`, or `pending`/`accepted -> cancelled` (`handleAdminCancelBooking`, admin-only, blocked once `completed`/`cancelled` — both real terminal states).
- Every transition writes its own `booking_events` row with a genuinely distinct `event_type` (`'accepted'`, `'en_route'`, `'completed'`, `'cancelled'`) — richer than round 12's plan assumed (which only traced `'accepted'`).
- The real `bookings` table's actual `INSERT` (found directly in the current worker source) carries `guest_name`, `guest_phone`, `guest_email`, `client_booking_ref`, `flight_number`, `pickup_date`/`pickup_time`, `notes`, and more — confirming `guest_email`/`client_booking_ref` really are real production columns, consistent with correction 5 above.

`REAL_EVENT_TYPES` in `real_booking_sync.js` reflects this directly-verified set, not an assumption.

### 7. Sync semantics: ordering, failures, and never inferring cancellation from absence

`syncRealBookingEvent` applies an event only if it is genuinely newer than what the mirror already recorded, using a monotonic `source_event_ordinal` (never a bare wall-clock comparison, which retries or clock skew could violate). An older or exact-duplicate event is a documented no-op (`STALE_OR_DUPLICATE_EVENT`) — never an error, never a silent overwrite; tested for both a genuinely-stale replay and an exact duplicate. A malformed or unrecognized `event_type` returns a typed failure and leaves the existing mirror row **completely untouched** (asserted with a full row equality check before/after) — a sync failure must never corrupt or blank out the last known-good state.

Critically: no function in this module ever infers `'cancelled'` from a booking's mere absence from a query scoped to a status subset (e.g. "everything currently accepted," per `FIRST_READ_ONLY_RUN_PLAN.md`'s own Step 1 query). `markMissingFromLatestFeed` sets a **separate** `sync_state` marker (`'MISSING_FROM_LATEST_FEED'`) — never the guest-facing `status`. Only an explicit `'cancelled'` event ever changes `status` to `'cancelled'`; a booking that later reappears in a subsequent pass is re-marked `'IN_LATEST_FEED'` by its next real event. All tested directly, including the reappearance case.

## Schema (additive only, isolated D1)

`migrations/0024_marau_real_booking_sync.sql`: a new `marau_real_booking_links` table (the *only* re-association mechanism, keyed by `source_booking_ref`, never by contact) and eight new nullable columns on `marau_test_bookings` (`source_booking_ref`, `source_status`, `source_assigned_driver_id`, `source_event_type`, `source_event_ordinal` — superseded, see below, `source_synced_at`, `sync_state`, `sync_last_error`). No `CHECK` constraint changed, so no table needed recreating.

`migrations/0025_marau_real_booking_sync_durable_version.sql` (round 14): adds `source_event_id`, the real, durable ordering column `real_booking_sync.js` now actually reads and writes (meant to be populated from the real `booking_events.id`). `source_event_ordinal` is left in place, unused, rather than dropped — no production data to migrate, no reason to risk a table rebuild for a preview-only table.

## Test evidence

`marau/test/marau_real_booking_sync.test.mjs` — **22/22 tests** (round 13's 17 corrected/re-verified in place plus 5 net new round-14 tests covering findings 1-5, including real SQL fault injection via `CREATE`/`DROP TRIGGER` on `marau_real_booking_links` and a deterministic concurrency-barrier repro of the exact stale-write race Codex found — no reliance on real thread timing for either), entirely against the isolated shim, zero production writes. Full suite: **247/247 engine (unaffected) + 159/159 Marau (137 pre-round-13 + 22 in this file) = 406/406.**

## What this round does NOT do

- Does not connect to any real database, real Cloudflare resource, or real network endpoint.
- Does not import, copy, or reference any real guest's data anywhere.
- Does not redeploy any change to the human WhatsApp loop, the existing team/contact, or any notification path.
- Does not decide the still-open questions from round 12's plan (the `wa.me` handoff choice, the production Cloudflare resource, per-operator admin auth, monitoring/rollback tooling) — those remain open, unchanged, explicit release decisions for James.

## Remaining release decisions (unchanged from round 12, restated for clarity)

1. Whether a guest-initiated `wa.me` handoff is ever turned on (still not decided; still not required).
2. When/whether to stand up a real, isolated production Cloudflare D1 + Worker distinct from both preview databases and `nadi-marketplace-db`.
3. Per-operator admin authentication, replacing the shared preview token, before any real-guest use.
4. Monitoring and rollback tooling parity with this project's other live properties.
5. Who actually runs the real read-only sync job against `nadi-marketplace-db` in production, and on what schedule/trigger — this round proves the mapping/session/ordering/recovery/validation logic works; it does not decide or build the production cron/worker that would call it against real rows, and does not decide how a real `booking_events.id` is actually supplied to it as `source_event_id`.
6. Whether/when to enumerate and handle any further real `booking_events.event_type` values beyond the five directly confirmed in round 13, should the real system add one.

Nothing above is proposed for execution without a further, explicit go-ahead.
