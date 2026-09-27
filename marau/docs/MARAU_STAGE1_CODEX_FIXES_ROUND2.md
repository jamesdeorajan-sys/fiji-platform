# Marau Stage 1 — Codex's second independent review, round 2 fixes

Codex independently reran commit `a0ffe49` (296/296 passing). Additional checks exposed 6 bounded acceptance failures. Each is reproduced with a regression test, then fixed, below — all on the same branch, no scope broadened. All evidence here is against `test/d1_sqlite_shim.mjs` (a real SQLite engine enforcing real constraints), kept explicitly distinct from any deployed Cloudflare D1 evidence — none exists for this branch (deployment remains blocked; see the review package §9).

## 1. Atomicity across allocation, offer state and request state

**Finding:** Codex injected a failure at the final `deal_requests` UPDATE. Result: offer left `FILLED`, request left `REQUESTED`, allocation count zero, and a retry returned `409` permanently.

**Root cause:** the previous `rollback()` only ever deleted the `vehicle_allocations`/`vehicle_time_claims` rows — it never reverted the **offer's own status**. A failure after `holdOffer`/`fillOffer` had already succeeded left the offer permanently `FILLED` with nothing pointing back to a live request, and `evaluateOfferEligibility` (requiring `ACTIVE`) then rejected every future confirmation attempt outright.

**Fix:** `rollback()` now also reverts the offer's status back to `ACTIVE` from either `FILLED` or `HELD`, via the same generic `store.casOfferStatus()` primitive `holdOffer`/`fillOffer` already use internally — calling it directly for a transition outside those helpers' own forward-only names is exactly what a compensating action is. A test-only hook, `env.__TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__` (never present outside `marau_codex_fixes_round2.test.mjs`), reproduces the exact injection point.

**Tests:** the failure is injected, then the offer/request/allocation/claim state is checked (all correctly reverted), then a real retry (without the injected fault) is confirmed to succeed — proving the original permanently-stuck 409 no longer occurs. A second test confirms the compensating action never touches an unrelated offer's own state.

## 2. Simultaneous same-key booking submissions

**Finding:** two truly simultaneous submissions of the same `client_booking_ref`: one successful save, one uncaught `UNIQUE`-constraint error, and two sessions (an orphan left behind).

**Root cause:** the previous flow SELECTed for an existing booking and only created a session + did a plain `INSERT` if none was found. Two simultaneous requests both saw "not found," both created their own session, and both attempted the plain `INSERT` — one succeeded, the other threw uncaught (`client_booking_ref` is `UNIQUE`), leaving its session orphaned.

**Fix:** every submission now always creates a session first (the FK requires one before the booking row can exist), then attempts `INSERT OR IGNORE` — the winner is decided atomically by SQLite/D1 itself, never by an earlier read. Whichever request loses the race deletes its own now-unused session — and, critically, first deletes **any** `guest_link_requests` row referencing that session as *either* `new_session_id` **or** `candidate_session_id` (a genuine race can have the *other*, concurrently-racing request find *this* session as its own phone-match candidate before this one loses — deleting the session before that row would fail the foreign key rather than cleanly remove it; this exact ordering bug was caught by the regression test itself before being fixed).

**Tests:** two truly simultaneous submissions (`Promise.all`) of the same reference and payload: neither crashes, both resolve, both get the same access token, exactly one session exists for that phone, exactly one booking row exists. A second test reproduces the harder case (an earlier session on the same phone, so the losing side's own link-offer check also fires) to prove the FK-ordering fix specifically.

## 3. Retry recovery vs. private-trip authorization

**Finding:** an unauthenticated replay of a booking reference plus matching field values returned the session's access token outright — anyone who merely knew (or guessed, or observed in a log) a reference and its values could recover full private trip access.

**Fix:** a resubmission of an existing reference with a matching payload is now split into two cases:
- **Within `RETRY_GRACE_MS` (60s) of the original row's `created_at`**, or when the caller already presents a valid `Authorization` bearer for that **exact** session: direct access is returned (preserves "immediate access to a newly saved request" for a genuine reload/timeout/double-click retry, and is harmless for a caller who already holds full access anyway).
- **Otherwise:** no access token is returned. A `recovery_offer` is issued instead, reusing the **same verified-ownership linking mechanism** as a phone match (§ from the previous round): a fresh, otherwise-empty session, mergeable only once the verification code — readable solely via the **original** session's own token — is supplied.

A caller presenting *someone else's* valid token on an old, settled booking gets the same recovery treatment, never access to a trip that isn't theirs.

**Tests:** a replay of a backdated (settled) booking with no auth header gets no token, only a `recovery_offer`; that offer is then shown to complete through the identical link-request/code mechanism (the replaying session cannot read the code, only the original session can); a fresh (in-grace-window) resubmit still gets direct access; presenting the correct session's own token always works regardless of age; presenting a *different*, valid token never unlocks someone else's settled booking.

## 4. Unknown-vehicle rule enforced consistently

**Finding:** ordinary booking confirmation succeeded without an allocation, with no distinct signal that it happened without one.

**Fix:** an ordinary booking confirmed with **no** recorded `vehicle_windows` row now writes the distinct status `confirmed_unallocated` (migration `0016`, which recreates `marau_test_bookings` with a widened `CHECK` constraint — SQLite cannot `ALTER` a `CHECK` in place, so this uses the same `_new`/rename technique already established elsewhere in this codebase for an identical reason), never plain `confirmed`. Offer confirmation is unchanged — an unknown vehicle there still hard-blocks (`409 VEHICLE_UNKNOWN`), since an offer is specifically claiming capacity from an *already-assigned* movement, unlike an ordinary booking.

**Tests:** an allocated booking confirms as `confirmed`; an unallocated one confirms as `confirmed_unallocated`; the two are asserted distinct, never conflated.

## 5. Unknown/invalid commercial floors + stale price

**Finding:** `evaluateOfferEligibility` treated a `NULL absolute_floor` as "no floor to violate" rather than "floor unknown, cannot safely proceed" — the same class of gap Issue #54's own `COMMERCIAL_PRICING_STATUS.HOLD_UNKNOWN_ECONOMICS` exists to prevent.

**Fix, part one (unknown floor):** eligibility now requires a genuine, finite, non-negative `absolute_floor`; `NULL`, negative, or `NaN` all resolve to `UNKNOWN_FLOOR`, never a silent pass.

**Fix, part two (approved-price provenance / stale price):** `deal_requests` now snapshots the price and floor the guest actually saw at request time (`requested_price`, `requested_floor` — migration `0015`). Confirmation re-checks the offer's **current** price and floor against that snapshot and refuses (`409 PRICE_CHANGED_SINCE_REQUEST`) if either has moved since the request — a stale or changed commercial term is never silently honoured at whatever the offer happens to say "now."

**Tests:** a `NULL`/negative/`NaN` floor is rejected at the eligibility layer directly; a price change after request blocks confirmation; a floor change after request blocks confirmation even if the shown price didn't move; an unchanged price/floor still confirms normally.

## 6. The omitted sixth finding — deal requests in the Trip view

**Finding:** the trip view showed only `bookings`, never the guest's own deal requests in any state.

**Fix:** `GET /preview/trip` now also returns `deal_requests`, scoped to the guest's own session, in every state (`REQUESTED`, `CONFIRMED`, `DECLINED`, `WITHDRAWN`), each carrying **authoritative current offer fields** (joined live from `smart_offers`, not copied at request time — `origin_zone`, `destination_zone`, `vehicle_class`, `current_price`, `offer_status`, `offer_expires_at`) alongside the **price provenance** the guest actually saw when they requested it (`requested_price`, `requested_floor`), and `source_movement_id` so the shadow-leg movement each deal traces back to is never lost.

**Tests:** three requests in three different end-states (`REQUESTED`, `CONFIRMED`, `DECLINED`) all appear with correct status, offer linkage and source lineage; a separate test proves `current_price` reflects live data distinct from the guest's originally-requested price after an ops price change.

## Test results

| Suite | Result |
|---|---|
| `smart-return-trigger-fill/test/*.test.js` (Issue #54 engine, unaffected) | **247/247 pass** |
| `marau/test/*.test.mjs` (Stage 1 preview, round 2 fixes included) | **66/66 pass** (49 prior + 17 new in `marau_codex_fixes_round2.test.mjs`, plus 1 existing test's status assertion corrected for finding 4) |
| **Total** | **313/313 pass** |

The concurrency test for finding 2 was run 5 additional times in a loop with no flakiness observed.
