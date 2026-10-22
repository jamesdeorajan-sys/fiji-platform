# Proposed additive API/frontend changes — source attribution (Issue #38 Step 3)

**Status: proposed design, CORRECTED per CEO feedback (2026-09-02) and now preview-verified — see `preview-proof-attribution.md` in this same directory. None of this is applied to production. All of it is additive per Issue #36 rule 5/6 — old frontend keeps working unmodified against the new backend; only once that's proven would a frontend be touched, and only under a separate, explicitly authorized release.**

**CORRECTION (was Host-based, now Origin-based):** the original draft of this document derived `storefront_id` from `request.headers.get('Host')`. That's wrong for the live architecture — both public storefronts' frontends call the exact same hardcoded `NADI_API_BASE = 'https://api.nadiairporttransfers.com'`, so a booking placed via `book.fijidash.com` still arrives with `Host: api.nadiairporttransfers.com`. Host cannot distinguish the storefront. Corrected below to use the browser's `Origin` header against a closed allowlist instead — `Origin` reflects the page the guest is actually on, is set by the browser itself (not by `app.js`), and is present on every cross-origin `fetch()` call regardless of the server's CORS policy (confirmed: the live Worker already sends `Access-Control-Allow-Origin: *`, so real browsers are already sending a real `Origin` header on every request today — it's just unread).

## Backend (`nadi-marketplace/worker/worker.js`, `createBookingRecord()` / `handleGuestBookingCreate()`)

1. Accept two new **optional** body fields on `POST /bookings`: `campaign`, `referral_code` — lower-stakes, non-identity, client-suppliable free text. `canonical_source` and `storefront_id` are **never read from the request body at all**, not even as a fallback — see point 2.
2. `resolveStorefrontAttribution(request)` — a new, small, pure function that reads only `request.headers.get('Origin')` against a closed allowlist:
   - `https://book.fijidash.com` → `storefrontId: 'fijidash'`, `canonicalSource: 'fijidash'`
   - `https://nadiairporttransfers.com` → `storefrontId: 'nadiairporttransfers'`, `canonicalSource: 'nadi_airport_transfers'`
   - `https://www.nadiairporttransfers.com` → same as apex
   - anything else (missing, unrecognized, or a future `bookfijitransfers.com` before it's explicitly added) → `storefrontId: null`, `canonicalSource: 'unknown'`
   - This result is computed **before** the body is even parsed for identity purposes and is the only source of truth passed into `createBookingRecord()` — there is nothing for a client to override because nothing client-supplied is ever consulted for these two fields.
3. Non-browser/API traffic (future partner/agent/direct_api sources) is explicitly **not** handled by this mechanism — it falls through to `unknown` exactly like any other unrecognized Origin, until a separate authenticated/signed mechanism is designed and approved. Not built in this release.
4. Generate `vakaviti_booking_id` (`VK-` + 8 uppercase alphanumeric, collision-checked the same way `client_booking_ref` idempotency already works) on every **new** booking only. Not implemented in the preview proof (out of this correction's required scope) — column exists, stays `NULL` until a later release builds the generator.
5. `handleAdminListBookings()` SELECT gains the 5 new columns so `admin-bookings.html` can display them without a second release.

## Frontend (`ftt-booking-site/src/app.js`)

1. Add a small, deterministic `resolveCanonicalSource()` — reads `document.referrer`/a `?campaign=`/`?ref=` query param already present in the URL if one exists, else falls back to `'direct_api'` only if the request is coming from a known partner-integration pattern, else omits the field entirely (server defaults it to `unknown`). **No new tracking pixels, no new third-party scripts** — this reuses information already present in the browser, nothing new is collected.
2. Send `canonical_source`/`campaign`/`referral_code` alongside the existing booking payload fields (additive keys on the same `POST /bookings` call — no new endpoint, no new round-trip).
3. Guest-facing UI: **zero visible change.** Attribution is operational metadata, not something a guest needs to see or confirm.

## Admin (`admin-bookings.html`)

1. Add a `Source` column (storefront + canonical_source, e.g. "FijiDash / direct") next to the existing `client_booking_ref` column.
2. Add a `VK-...` column once the id generator ships, so staff can search by either reference immediately (Issue #37's explicit requirement).

## Rollout order (per Issue #36's release order: database → backend → smoke tests → frontend)

1. Apply the additive migration to an **isolated preview D1** first (never production, this step). **Done in preview — see `preview-proof-attribution.md`.**
2. Deploy backend changes to an isolated preview Worker; confirm old frontend (unmodified) still creates bookings correctly against it — this is the actual backward-compatibility proof, not just an assumption. **Done in preview — Test 7.**
3. Smoke-test all 7 CEO-specified proof cases (known Origins on the same Host resolve differently, unknown/missing Origin → unknown, client-claimed identity is always ignored in both directions, old payload still works). **Done — all 7 pass, see `preview-proof-attribution.md`.**
4. Only then: frontend change (actually sending `campaign`/`referral_code`), admin change, each its own small release per Issue #36 rule 9 ("one revenue surface at a time"). **Not started — no code change of any kind has reached production or any live frontend.**

The backend logic itself is now preview-proven, not just planned. It has not been deployed anywhere real.
