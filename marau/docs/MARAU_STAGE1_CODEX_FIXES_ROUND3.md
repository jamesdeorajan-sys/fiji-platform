# Marau Stage 1 — Codex's third independent review, round 3 fixes

Codex independently reproduced 313/313 passing tests at commit `b69933e`. This round's findings split into correctness (fixed first, per instruction) and product/design completion (applied after). All on the same branch, no new features, no production changes, no live sends.

## Correctness

### 1. Remove the unauthenticated 60-second token-recovery exception

**Finding:** Codex replayed a fresh reference/payload (no auth header, no time delay) and still received the access token, then read the Trip successfully. The round-2 fix's 60-second "retry grace window" proved nothing — an attacker who captures a reference and payload can replay them immediately, well inside any window.

**Fix:** the time window is removed entirely. A resubmission of an existing `client_booking_ref` now recovers direct access ONLY if the caller presents:
- the same `attempt_secret` the original request carried — a **separate**, client-generated random value (see `client_idempotency.js`), never returned in any API response, never derived from or combined with the public-looking reference/payload; or
- a valid `Authorization` bearer for that exact session (already-authenticated ownership).

Anything else — including an instant replay — gets no token, only a `recovery_offer` through the same verified-ownership link mechanism used for a phone match.

**A real bug found while implementing this fix:** `client_idempotency.js`'s functions referenced a shared module-level `const STORAGE_KEY` from inside their own bodies. That is invisible to every test importing them as normal ES modules (where the constant is in scope), but `pages.js` embeds each function via `.toString()` — the constant does **not** survive that extraction, so the real browser would have thrown `ReferenceError: STORAGE_KEY is not defined` the first time a guest actually submitted the booking form. This had never been exercised end-to-end in a real browser before now. Fixed by making every embedded function fully self-contained (the storage key inlined as a literal inside each one). A new regression test reproduces the exact embedding mechanism (`new Function(fn.toString() + ...)`) rather than importing the functions normally, so this class of bug can't recur silently.

**Tests:** an immediate, zero-delay, unauthenticated replay gets no token; the correct `attempt_secret` (not timing) recovers direct access; a missing or wrong secret does not; the spliced-script regression; a check that the served HTML actually calls the new function and includes `attempt_secret` in the request body.

### 2. Make competing decisions mutually exclusive

**Finding:** a concurrent confirm and decline against the same deal request both returned HTTP 200 with contradictory decisions.

**Root cause:** both handlers read `status !== 'REQUESTED'` via a plain `SELECT` with no atomicity between the check and either write.

**Fix:** the request's own status transition is now itself a single atomic `UPDATE ... WHERE request_id = ? AND status = 'REQUESTED'`, in both `handleAdminConfirmDealRequest` (as the very first commit, before any vehicle/offer side effect) and `handleAdminDeclineDealRequest`. SQLite/D1 serialize writes, so only one of two racing CAS attempts can ever succeed; the loser gets a clean `409 ALREADY_DECIDED` immediately, before touching anything else.

**Tests:** a concurrent confirm+decline pair on the same request — exactly one wins, the stored state agrees with whichever one did; ten simultaneous confirm attempts on one request still yield exactly one success.

### 3. Complete atomicity or durable recovery

**Finding:** a failure at the final request update, combined with a failure during compensation, left the offer `FILLED`, the request `REQUESTED`, an allocation still held, and a thrown error — "compensating writes alone do not establish atomicity."

**Fix:** a new `confirmation_attempts` table (migration `0018`) durably records every confirm attempt that gets past the mutual-exclusion CAS, updating its `phase` (`CLAIMING_MOVEMENT` → `CLAIMING_VEHICLE` → `HOLDING_OFFER` → `FILLING_OFFER` → `DONE`, or `ROLLED_BACK` / `ROLLBACK_FAILED`) as it proceeds. `rollback()` now independently try/catches **each** compensating write (offer status, allocation release, movement-claim release) so one failing step never blocks the others, and only reverts the request's own status back to `REQUESTED` (genuinely safe to retry) if **every** compensating write fully succeeded. If any compensating write itself throws, the phase becomes `ROLLBACK_FAILED` with the failure detail recorded, the request is deliberately **left** wherever it was (its true state can't be safely assumed), and the API response says `reconciliation_needed: true` rather than implying it's safe to retry.

Two test-only hooks (never present on any real `env`) reproduce both halves of Codex's exact scenario: `__TEST_INJECT_FAILURE_BEFORE_FINAL_UPDATE__` (the main operation fails after every real side effect already succeeded) and `__TEST_FAIL_ROLLBACK_STEP__` (a named compensating write also fails during recovery from that).

**Tests:** a normal success reaches `DONE`; a late failure alone is fully reverted, durably recorded as `ROLLED_BACK`, and safely retryable; a late failure **plus** a failing compensating step is recorded as `ROLLBACK_FAILED`, the request is left `CONFIRMED` (not silently reverted), the other two compensating steps still completed independently, and the response says reconciliation is needed; a rollback failure on one request never touches a completely unrelated offer/request.

## Product/design completion

### 4. Optional home-screen installation

Approved Stage 1 scope, independent of (deferred) credits. Restored: an install invitation banner in the Trip view ("Add Marau to your home screen — get back to your trip in one tap"), a real `manifest.json` (`name`, `short_name: "Marau"` alone per the design reference's own instruction, `display: "standalone"`, theme/background colours matching the app palette) served at `/manifest.json`, and an icon (`/icon.svg`, a placeholder rendering of the same brand mark used in the header — a production icon set should replace it before any real launch) referenced from both the manifest and `<link rel="apple-touch-icon">`. The banner wires the standard `beforeinstallprompt` flow on Chrome/Android and falls back to manual "Share → Add to Home Screen" guidance where that event never fires (Safari/iOS), and hides itself entirely once already running in standalone (installed) mode.

### 5. Fiji time, a real booking switcher, no internal IDs in guest copy

- **Fiji time:** the pickup card now formats every date/time with `Intl.DateTimeFormat(..., { timeZone: 'Pacific/Fiji' })` (handles Fiji's own DST rules automatically, rather than a hardcoded UTC+12 offset) and labels it explicitly "Fiji time" next to the displayed time — a guest opening their trip from anywhere else in the world no longer silently sees their own device's local time substituted for the real pickup time.
- **Booking switcher:** the round-2 build only showed a "+N more bookings" hint with no way to view them. Multiple bookings now render as a horizontal strip of selectable pills (each labelled by date and route); selecting one re-renders the pickup card for that specific booking.
- **No internal IDs in guest copy:** the deal-requests list used to render `Ref: <offer_id> (movement <source_movement_id>)` directly to the guest. Removed — those fields stay in the underlying data (used by the AI assistant and available to ops) but are never rendered as visible guest-facing text.

## Test results

| Suite | Result |
|---|---|
| `smart-return-trigger-fill/test/*.test.js` (Issue #54 engine, unaffected) | **247/247 pass** |
| `marau/test/*.test.mjs` (Stage 1 preview, round 3 fixes included) | **76/76 pass** (65 prior, after 3 tests updated/consolidated for the reverted `confirmed_unallocated` policy and the removed grace window + 14 new in `marau_codex_fixes_round3.test.mjs`) |
| **Total** | **323/323 pass** |

See the screenshots in `marau/docs/screenshots/` for live, persistent (committed, not chat-described) evidence of the design completion items.
