# Marau Stage 1 — Codex review fixes

Codex independently reran commit `a7b712e33dade8aadf5695926c08373d1fd1c4df` (247 engine + 27 Marau tests, all passing) and found 5 acceptance failures through additional checks beyond the original suite. Each is reproduced with a regression test, then fixed, below. All fixes stay on `ceo/marau-stage1-preview`; no scope beyond these five was added.

## 1. Guest access — P0

**Finding:** `POST /preview/bookings` with an existing guest's phone and a different email returned the existing guest's access token; `GET /preview/trip` then exposed their earlier booking.

**Root cause:** `findOrCreateGuestSession` matched on `guest_contact_key` (normalized phone) alone.

**Fix:** every booking submission now always creates its own new `guest_sessions` row (`createGuestSession`). A phone match against a different, still-valid session no longer grants any access — it opens a `guest_link_requests` row instead (migration `0012`). Linking requires **verified ownership**: the 6-digit verification code is only ever readable via `GET /preview/trip/link-requests`, authenticated with the *older* (candidate) session's own access token — modelling "only the real phone/email owner receives it" without a real SMS/email provider (mocked delivery, as instructed). The new session then calls `POST /preview/trip/link` with that code to merge the older session's bookings into itself and revoke the older token. A wrong code is rejected (`400 INVALID_CODE`); a link request can be revoked by its rightful (candidate) owner (`POST /preview/trip/link-requests/:id/revoke`); an expired request (10-minute TTL) can never be completed even with the right code.

**Tests:** `marau_codex_fixes.test.mjs` §1 (6 tests) — cross-guest access denied by email mismatch, denied even on an exact phone+email match without explicit linking, immediate access still covers the new booking itself, the code is unreadable to the attacker session and only readable to the candidate session, wrong-code rejection, revocation, and expiry.

## 2. Vehicle/time exclusivity — P0

**Finding:** two offers backed by different movements assigned to the same vehicle with overlapping windows both confirmed (200/200).

**Root cause:** `vehicle_time_claims`' `PRIMARY KEY` is on `source_movement_id` — it only prevents the *same* movement being claimed twice, never a different movement on the same vehicle.

**Fix:** new tables `vehicle_windows` (0013, records which vehicle + window a movement or an ordinary booking is assigned to — this data doesn't exist anywhere in Issue #54's own schema, consistent with that issue's long-standing "no vehicle/driver identity in practice" gap) and `vehicle_allocations` (0014, the actual guard). The exclusivity check is a single `INSERT ... SELECT ... WHERE NOT EXISTS (... overlap condition ...)` statement — atomic because SQLite/D1 evaluate one statement under a single internal write lock, the same principle `casOfferStatus`'s conditional `UPDATE` already relies on, applied to a range-overlap condition instead of equality (a `UNIQUE` constraint can't express "no overlapping range"). `handleAdminConfirmDealRequest` now: (a) requires a `vehicle_windows` row for the offer's movement at all — **unknown vehicle/availability blocks confirmation** (`409 VEHICLE_UNKNOWN`), never assumed safe; (b) still claims `vehicle_time_claims` first (same-movement guard, kept as defense in depth); (c) then claims `vehicle_allocations` (the real overlap guard); (d) rolls back both claims if any later step fails (offer CAS, fill), so a failed attempt never strands a lock a legitimate retry can't get past. `handleAdminDecideBooking` (ordinary booking confirmation) uses the same `vehicle_allocations` table when a booking has a recorded vehicle assignment, so an offer and an ordinary booking correctly compete for the same vehicle/time.

**Tests:** `marau_codex_fixes.test.mjs` §2 (6 tests) — the exact reproduction (different movements, same vehicle, overlapping windows → now exactly one winner), a same-vehicle-non-overlapping-windows control (both must succeed, proving the guard is about overlap not the vehicle alone), unknown-vehicle block, offer-vs-ordinary-booking competition, and a rollback/retry proof.

## 3. Expired/unapproved deals — P1

**Finding:** an expired `ACTIVE` offer still appeared in `GET /preview/deals` and in `/preview/assist` recommendations.

**Root cause:** listing, recommendation, request, and confirmation each had their own ad hoc eligibility check; the listing/recommendation ones never checked `expires_at`, and both treated `VALIDATED` as good enough to show (VALIDATED only means "required fields present," not "approved for publication" — `ACTIVE` is the state Issue #54's own state machine reserves for that).

**Fix:** one function, `evaluateOfferEligibility()` (`offer_eligibility.js`), used by all four touchpoints: requires `status === 'ACTIVE'` (not `VALIDATED`), `expires_at` in the future, positive inventory, and a finite price at/above `absolute_floor` when set.

**Tests:** `marau_codex_fixes.test.mjs` §3 (3 tests), plus `marau_assist.test.mjs`'s `rankOffersForGuest` unit tests rewritten to assert VALIDATED/DISCOVERED/expired offers never surface.

## 4. Booking retries — P1

**Finding:** submitting the browser form's payload twice created two bookings with two different references (201/201).

**Root cause:** the guest app never generated a `client_booking_ref`; the server minted a fresh random one whenever the field was absent, so a retry always looked like a brand-new booking to the (already-correct) idempotency mechanism.

**Fix:** `client_idempotency.js` — `getOrCreateClientBookingRef(storage, randomSource)` generates a key once and persists it (a fresh one on the very first call, the SAME one on every call after until `clearClientBookingRef()` runs post-success). Its source is embedded verbatim into the guest app's `<script>` (via `.toString()` splicing in `pages.js`), so the browser runs the exact code this file's own unit tests exercise, not a hand-copied duplicate. Server-side, `booking_conflict.js#findPayloadMismatch` compares a resubmitted key's payload against the stored one; a genuine retry (identical fields) still returns the existing booking (200), but a reused key with different fields is rejected (`409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`, listing which fields differ) rather than served or silently overwritten.

**Tests:** `marau_codex_fixes.test.mjs` §4 (6 tests) — the client-side function reproducing/reusing a key across simulated reload, an HTTP-level test using the actual client-generated key to prove the real double-submit path (not just a manually-supplied ref), and the conflicting-payload rejection.

## 5. WhatsApp handoff — P1

**Finding:** the main "Talk to our team on WhatsApp" button only showed a toast; the per-deal handoff constructed a real, clickable `https://wa.me/...` link.

**Fix:** both paths now go through one composer (`whatsapp_handoff.js`) and are shown in an in-page mock panel (`renderMockWhatsApp()` in `pages.js`) with a copy-to-clipboard button — neither constructs a `wa.me` URL or navigates anywhere. A new endpoint, `POST /preview/trip/whatsapp-handoff`, composes a message from the guest's own soonest booking (reference, route, vehicle, status) for the main button; the deal handoff (unchanged in substance, just re-routed to the mock panel) still carries the deal reference and price.

**Tests:** `marau_codex_fixes.test.mjs` §5 (3 tests) — the served guest app's HTML contains no `wa.me`/WhatsApp-navigation string anywhere, the main handoff composes a real message containing the booking reference, and the composer degrades safely with no booking.

## Test results

| Suite | Result |
|---|---|
| `smart-return-trigger-fill/test/*.test.js` (Issue #54 engine, unaffected) | **247/247 pass** |
| `marau/test/*.test.mjs` (Stage 1 preview, now including all 5 fixes) | **49/49 pass** (27 original + 22 new/rewritten) |
| **Total** | **296/296 pass** |

No production binding, migration, or network call was added or exercised — the network guard's file-scoped assertion (zero real `fetch` calls) still holds across every test file.
