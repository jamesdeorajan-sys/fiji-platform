# Proposed additive API/frontend changes — source attribution (Issue #38 Step 3)

**Status: proposed design only. None of this is applied. All of it is additive per Issue #36 rule 5/6 — old frontend keeps working unmodified against the new backend; only once that's proven would a frontend be touched, and only under a separate, explicitly authorized release.**

## Backend (`nadi-marketplace/worker/worker.js`, `createBookingRecord()` / `handleGuestBookingCreate()`)

1. Accept three new **optional** body fields on `POST /bookings`: `canonical_source`, `campaign`, `referral_code`. Optional means an old, un-updated frontend (today's `ftt-booking-site/src/app.js`) keeps working with zero changes — every field defaults server-side.
2. Server-side default logic (never trusts the client blindly for the one field that matters most):
   - If `canonical_source` is absent or not one of the 8 approved values → store `'unknown'`, never guess from `Referer`/User-Agent heuristics.
   - `storefront_id` is **not** taken from the request body at all — derived server-side from which hostname the request arrived on (`request.headers.get('Host')`), since that's a fact the server can verify and the client can't be trusted to self-report accurately. Two possible Host values map to `nadiairporttransfers` / `fijidash`; anything else stores `NULL`.
3. Generate `vakaviti_booking_id` (`VK-` + 8 uppercase alphanumeric, collision-checked the same way `client_booking_ref` idempotency already works) on every **new** booking only. Never backfilled onto existing rows in the same release (matches the migration's own rule).
4. `handleAdminListBookings()` SELECT gains the 5 new columns so `admin-bookings.html` can display them without a second release.

## Frontend (`ftt-booking-site/src/app.js`)

1. Add a small, deterministic `resolveCanonicalSource()` — reads `document.referrer`/a `?campaign=`/`?ref=` query param already present in the URL if one exists, else falls back to `'direct_api'` only if the request is coming from a known partner-integration pattern, else omits the field entirely (server defaults it to `unknown`). **No new tracking pixels, no new third-party scripts** — this reuses information already present in the browser, nothing new is collected.
2. Send `canonical_source`/`campaign`/`referral_code` alongside the existing booking payload fields (additive keys on the same `POST /bookings` call — no new endpoint, no new round-trip).
3. Guest-facing UI: **zero visible change.** Attribution is operational metadata, not something a guest needs to see or confirm.

## Admin (`admin-bookings.html`)

1. Add a `Source` column (storefront + canonical_source, e.g. "FijiDash / direct") next to the existing `client_booking_ref` column.
2. Add a `VK-...` column once the id generator ships, so staff can search by either reference immediately (Issue #37's explicit requirement).

## Rollout order (per Issue #36's release order: database → backend → smoke tests → frontend)

1. Apply the additive migration to an **isolated preview D1** first (never production, this step).
2. Deploy backend changes to an isolated preview Worker; confirm old frontend (unmodified) still creates bookings correctly against it — this is the actual backward-compatibility proof, not just an assumption.
3. Smoke-test: a booking with no `canonical_source` sent → stored as `unknown`; a booking with a valid one → stored correctly; `storefront_id` correctly derived from `Host` header in both preview hostnames.
4. Only then: frontend change, admin change, each its own small release per Issue #36 rule 9 ("one revenue surface at a time").

No step above has been executed. This document is the plan, not a change log.
