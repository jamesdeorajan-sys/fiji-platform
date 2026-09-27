# Marau Stage 1 — Codex's fourth independent review, round 4 fixes (release completion)

Codex independently reproduced 323/323 passing tests at commit `4d44fbd` and inspected the committed screenshots. This round closes the three remaining acceptance gaps named in the mission ("MARAU — STAGE 1 RELEASE COMPLETION"), then re-attempts isolated Cloudflare D1 and browser acceptance. No new features, no production changes, no live sends.

> **CORRECTION (round 5, `MARAU_STAGE1_CODEX_FIXES_ROUND5.md`):** this document's "Remaining release blockers" section originally claimed *"no code-level blocker remains"* for confirmation integrity. That was wrong — a fifth independent review found a genuine concurrency gap in exactly this area (an admin's `reconcile-confirmation` call was mistaken for exclusive ownership of a still-in-flight confirm attempt, letting the original resume and commit `CONFIRMED` after reconcile had already unwound its allocation). Fixed in round 5 via attempt-level fencing; see that document for the full write-up. Left here, uncorrected in place, per this repo's own convention of marking prior entries superseded rather than rewriting them.

## 1. Confirmation integrity

**Finding:** Codex rejected `INSERT INTO confirmation_attempts` with a SQLite trigger. Result: uncaught error, guest Trip **CONFIRMED**, offer **ACTIVE**, zero allocations and zero audit rows. A late failure plus failed offer compensation also left the guest Trip CONFIRMED with zero allocations.

**Root cause:** round 3's design used the request's own status transition (`deal_requests.status = 'CONFIRMED'`) as the mutual-exclusion write itself — made as the very first commit, before any real side effect. Any failure after that write, however trivial, left the guest-visible status lying about what had actually happened.

**Fix — a non-final claim state, decoupled from `deal_requests.status`:**

- New table `deal_decision_claims` (migration `0019`): a single `INSERT OR IGNORE` keyed on `request_id` is now the *only* write that races confirm against decline. It carries no guest-visible meaning by itself.
- `deal_requests.status` now **stays `'REQUESTED'` for the entire duration of a confirm attempt** and is written to `'CONFIRMED'` only as the **literal last statement**, after every real side effect (movement claim, vehicle allocation, offer hold/fill) **and** the durable `confirmation_attempts` audit write have already succeeded. "Expose CONFIRMED only after successful completion" is now structurally true, not just intended.
- The claim-audit `INSERT` itself is now *inside* the try/catch that `rollback()` guards — Codex's exact injection (failing that specific insert) is caught cleanly: nothing substantive has happened yet, so rollback only needs to release the decision claim.
- **Claim/journal interruption gap closed:** if an attempt dies partway (anything short of a terminal phase), the `deal_decision_claims` row is deliberately left in place — it blocks a fresh confirm/decline attempt from racing in, returning `409 CONFIRMATION_INTERRUPTED` with the stalled phase and an actionable `recovery_action` naming the exact endpoint to call.
- **New endpoint:** `POST /preview/admin/deal-requests/:id/reconcile-confirmation` (admin-only, same `requireAdmin` fence as every other ops action). It inspects the **real** current state directly (existence of the movement claim, the vehicle allocation, and the offer's actual status) — never trusts the recorded `phase` alone, which could itself be stale — and always resolves to a definite outcome: either the confirmation genuinely completed (finish marking it) or it did not (fully unwind whatever partial state exists, freeing the claim for a clean retry). "Recording ROLLBACK_FAILED alone is insufficient" is closed by this endpoint, not by a passive log entry.
- `GET /preview/admin/deal-requests` now also surfaces `reconciliation_needed`, `stalled_phase` and `stalled_detail` per request, so a stalled attempt is visible in the normal ops list, not only by querying `confirmation_attempts` directly.
- The mutual-exclusion claim now runs **before** the eligibility/price/vehicle pre-checks (not after) — a stalled prior attempt can itself leave the offer in a state (e.g. still `FILLED`) that would otherwise make those checks fail with a confusing, unrelated error instead of naming the real problem.

**Tests** (`marau_codex_fixes_round4.test.mjs`): Codex's exact reproduction (a real SQLite trigger rejecting the audit insert) — `deal_requests.status` stays `REQUESTED`, offer stays `ACTIVE`, zero allocations, zero audit rows, and the request is cleanly retryable once unblocked; a late failure **plus** a failing compensating step — status still never flips to CONFIRMED, a further attempt is blocked with `CONFIRMATION_INTERRUPTED` and the recovery action, and the reconcile endpoint fully resolves it (`ROLLED_BACK_TO_REQUESTED`) after which a fresh confirm succeeds; the admin list surfaces `reconciliation_needed`; reconcile on a healthy request is a clean no-op; mutual exclusion still holds via the new table under a concurrent confirm+decline race. An existing round-3 test that had asserted the *old* (now-rejected) behaviour — `deal_requests.status === 'CONFIRMED'` after a failed rollback — is updated to assert the new, correct behaviour (`'REQUESTED'`, claim still held) with an explanatory note, rather than left contradicting the new design.

## 2. Pickup accuracy

**Finding:** the render function still selects an old cancelled booking as "Next pickup." Under `TZ=UTC`, input `2026-10-01T12:00` displayed as midnight on 2 October in Fiji.

**Fix — one shared default-selection rule, used by both client and server:**

- New module `booking_selection.js`: `selectDefaultBooking(bookings, nowIso)` — soonest **upcoming ACTIVE** booking; if none is upcoming, the most recent **past** active booking; only if there is no active booking at all, the soonest booking regardless of status (never render nothing). `ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed', 'confirmed_unallocated']`.
- The guest app's pickup card (`pages.js`) now uses this rule for the **default** selection while the switcher still lets the guest select *any* booking, including cancelled/declined history — "retain selectable history" is unaffected.
- `POST /preview/trip/whatsapp-handoff` now uses the same rule as its own default, and additionally accepts an optional `booking_id` in the request body so the composed summary always matches whichever booking the guest currently has selected in the switcher — the client now sends its `selectedBookingId` with every handoff request.
- **Fiji time normalization:** new module `fiji_time.js` — `normalizePickupDatetime(raw)` treats an already-zoned value (ending in `Z` or a numeric offset) as a real UTC instant (idempotent no-op), and a naive `"YYYY-MM-DDTHH:MM[:SS]"` value as **Fiji local wall-clock time**, converting it to the correct UTC instant via `Intl.DateTimeFormat(..., { timeZone: 'Pacific/Fiji', timeZoneName: 'shortOffset' })` (real tzdata, not a hardcoded `+12:00` — degrades correctly if Fiji ever observes DST again). Applied in `handleCreateBooking` (booking creation) and in both `handleChangeRequest` (at request time) and `handleAdminDecideChangeRequest` (at apply time) for a change request's `pickup_datetime` — idempotent normalization at both points means a resubmitted, unchanged time is a safe no-op, never a second, compounding shift.
- **A second, real bug found and fixed while implementing this:** `booking_conflict.js`'s `findPayloadMismatch` (the retry-vs-different-payload check) still re-parsed an incoming `pickup_datetime` with the same naive `new Date(value).toISOString()` — correct for the already-stored (already-normalized) side of the comparison, but wrong for the freshly-submitted raw side, which is meant as Fiji time. This made **every genuine retry look like a payload mismatch** (a spurious 12-hour difference), which surfaced as a cascade of unrelated-looking 409s across nearly every pre-existing retry/idempotency test the moment normalization was applied at the write path. Fixed by routing both sides of the comparison through the same `normalizePickupDatetime`.

**Tests:** `selectDefaultBooking` unit tests (never picks an earlier-timestamped cancelled booking over a real upcoming active one; falls back to the most recent past active booking, never a declined one); the WhatsApp handoff summarizes the upcoming active booking over an older cancelled one, and accepts an explicit `booking_id`; the exact TZ=UTC reproduction (`"2026-10-01T12:00"` must store as `"2026-10-01T00:00:00.000Z"`, and display back as noon on 1 October, not midnight on 2 October); idempotency on already-zoned input; booking creation and change-request application both normalize correctly, including the "unchanged-time resubmission" case.

## 3. Installed-app acceptance

**Finding:** `start_url: "/"` plus fragment/sessionStorage access does not establish that install → close → reopen securely returns to the correct trip. Icon assets were incomplete.

**Fix:**

- **Token persistence:** the guest access token is now persisted to **both** `sessionStorage` and `localStorage`. An installed PWA relaunches at the static `start_url: "/"` with no `#tok=` fragment and a fresh top-level launch context (no carried-over `sessionStorage`) — `localStorage` is per-origin, device-local storage that *does* survive that relaunch. `getToken()` now falls back to `localStorage` when `sessionStorage` is empty and there is no fragment; `setToken()`/`clearToken()` (and revoke) write/clear both. The token is **never** embedded in the shared `manifest.json` — that file is static and identical for every guest. Server-side revocation (`access_token_revoked`) remains the sole authoritative check regardless of any client-cached value.
- **Proof, not just a claim:** `docs/screenshots/capture_round4.mjs` demonstrates the actual mechanism — a fresh page navigates to `/` with `sessionStorage` explicitly cleared first (simulating the exact installed-relaunch condition), then reloads; the trip still renders (`07-installed-reopen-recovers-trip.png`), proving `localStorage` — not the fragment, not `sessionStorage` — is what carried the recovery. A genuinely fresh browser context (no storage at all) correctly falls back to the synthetic-entry start screen (`08-fresh-no-token-shows-start.png`), proving the recovery isn't just the app always showing a trip.
- **Real icon assets:** `render_icons.mjs` (Playwright + the cached Chromium build already used for screenshots — no other image-rendering library exists in this environment) rasterizes the existing brand-mark SVG into real PNGs: `192×192` and `512×512` (manifest, `any` + `maskable`), and a `180×180` **opaque** variant with no corner-rounding baked in (iOS applies its own mask, and iOS Safari does not reliably honour an SVG touch icon) for `apple-touch-icon`. Embedded as base64 constants (`icon_assets.js`) and served at `/icon-192.png`, `/icon-512.png`, `/icon-180.png` with real `image/png` content-type and PNG magic-byte verified in tests. `manifest.json`'s `icons` array and the guest app's `<link rel="apple-touch-icon">` both updated to reference them (the original `/icon.svg` is kept too, for browsers that prefer it).

**Tests:** the served script's `getToken`/`setToken`/`clearToken` reference both storages (string-presence checks against the actual served HTML, not a hand-written duplicate); a direct reproduction of the storage-fallback logic proves an empty `sessionStorage` + no fragment still recovers from `localStorage`; revoke/clear removes it from both, and server-side revocation is enforced regardless of any cached client value; the manifest references the real PNGs and never carries a token; both new PNG routes return real PNG bytes (magic-byte checked) with the correct content-type; the served HTML's `apple-touch-icon` link points at the PNG, not the SVG.

## Test results

| Suite | Result |
|---|---|
| `smart-return-trigger-fill/test/*.test.js` (Issue #54 engine, unaffected) | **247/247 pass** |
| `marau/test/*.test.mjs` (Stage 1 preview, round 4 fixes included) | **92/92 pass** (76 prior + 1 pre-existing round-3 test updated for the superseded early-CONFIRMED design + 15 new in `marau_codex_fixes_round4.test.mjs`) |
| **Total** | **339/339 pass** |

## Cloudflare D1 deployment and browser acceptance

Re-attempted this round, same as every prior round:

```
$ npx wrangler whoami
X [ERROR] A request to the Cloudflare API (/accounts) failed.
  Invalid access token [code: 9109]
```

**Exact blocker:** Cloudflare error code **9109** ("Invalid access token") on the very first authenticated call (`/accounts`), from a fresh `npx wrangler` invocation in this environment. This is not a network/proxy issue — the request reaches Cloudflare and gets a definite auth rejection.

**Required supported authentication step from James:** either (a) run `wrangler login` from a machine/session that can complete the interactive OAuth browser flow and have the resulting credentials available to this environment, or (b) supply a scoped Cloudflare API token (Workers Scripts: Edit, D1: Edit, for the target account) as the `CLOUDFLARE_API_TOKEN` environment variable. Without one of these two, no real Cloudflare D1 or Workers deployment evidence can be produced from this environment — every prior round has hit the identical blocker, and this round confirms it is unchanged.

**What stands in for it, honestly labelled as such:** all evidence in this and every prior round is against `test/d1_sqlite_shim.mjs` (Node's built-in `node:sqlite`, running the real migration SQL, enforcing real `UNIQUE`/`CHECK`/`FOREIGN KEY`/`PRIMARY KEY` constraints) and `test/local_preview_server.mjs` (a throwaway Node HTTP server running the actual `worker.js` fetch handler against that same shim) — never a real Cloudflare binding, never described as one.

## Remaining release blockers

1. **Cloudflare D1/Workers deployment** — blocked on authentication (see above); no code-level blocker remains.
2. **Real browser/device acceptance beyond this environment's Playwright/Chromium** — a genuine "Add to Home Screen" install flow (as opposed to the localStorage-survival proof given here) can only be exercised on a real mobile device or a full desktop browser with install support, neither available in this sandboxed environment.
3. Everything else named in this round's mission (confirmation integrity, pickup accuracy, installed-app token/icon completion) is now closed and covered by regression tests.
