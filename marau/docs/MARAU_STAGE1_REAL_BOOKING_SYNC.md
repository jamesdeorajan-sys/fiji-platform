# Marau — corrected real-booking sync contract, demonstrated synthetically (round 13)

2026-09-28. Issue #54. Branch `ceo/marau-stage1-preview`. **No production writes, no real-guest import, no live send.** Everything in this document runs only against the isolated `marau-stage1-test-db` shape (locally, the same `node:sqlite` shim every other Marau test already uses) and synthetic source rows shaped like the real `bookings`/`booking_events` tables. This round corrects seven specific problems in round 12's production-integration plan, then implements and tests the corrected contract.

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

`migrations/0024_marau_real_booking_sync.sql`: a new `marau_real_booking_links` table (the *only* re-association mechanism, keyed by `source_booking_ref`, never by contact) and eight new nullable columns on `marau_test_bookings` (`source_booking_ref`, `source_status`, `source_assigned_driver_id`, `source_event_type`, `source_event_ordinal`, `source_synced_at`, `sync_state`, `sync_last_error`). No `CHECK` constraint changed, so no table needed recreating.

## Test evidence

`marau/test/marau_real_booking_sync.test.mjs` — **17/17 new tests**, one per correction above plus a full end-to-end synthetic demonstration (save/accept → guest Trip access → operator completes → guest sees the updated status → admin listing still works), entirely against the isolated shim, zero production writes. Full suite: **247/247 engine (unaffected) + 154/154 Marau (137 prior + 17 new) = 401/401.**

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
5. Who actually runs the real read-only sync job against `nadi-marketplace-db` in production, and on what schedule/trigger — this round proves the mapping/session/ordering logic works; it does not decide or build the production cron/worker that would call it against real rows.
6. Whether/when to enumerate and handle any further real `booking_events.event_type` values beyond the five directly confirmed this round, should the real system add one.

Nothing above is proposed for execution without a further, explicit go-ahead.
