# Marau — hosted synthetic acceptance of the real-booking sync (round 19)

2026-09-29. Issue #54. Branch `ceo/marau-stage1-preview`. **No production changes, no real-guest imports, no live sends. Synthetic source bookings only — no production database binding of any kind.**

## Round 18 independent verification, recorded

Codex independently verified round 18 (commit `6c322fc`): 407/407 tests, no shared-engine changes, and **reran its own original paused-reader/takeover reproduction** — the stale worker now returns `CLAIM_LOST` and the current (post-takeover) details remain intact. This is recorded here as the authoritative confirmation that round 18's fix holds under a second, independent execution of the exact repro that found the bug, not merely under this session's own tests.

## What this round adds

1. **A hosted, HTTP-reachable synthetic-source harness** (`worker/real_booking_sync.js`'s round 17/18 design, now exercised over the network against the live preview, not just in-process). A new D1 table, `marau_synthetic_source_bookings` (migration 0030), stands in for the real `bookings` table — admin-token-gated routes let it be seeded and mutated, then `syncRealBookingEvent`/`reconcileRealBooking` are triggered against it exactly as the local test suite already does in-memory:
   - `POST /preview/admin/synthetic-source` — seed/update one synthetic source row.
   - `POST /preview/admin/synthetic-source/:ref/sync-event` — deliver an event signal.
   - `POST /preview/admin/synthetic-source/:ref/reconcile` — trigger a reconciliation pass.
   - `GET /preview/admin/synthetic-source/:ref` — inspect the synthetic source, mirror row, link, and claim state together, for verification.
2. **A real, pre-existing router bug found and fixed while building this harness**: every route in `worker.js`'s router was `return handleFoo(...)` rather than `return await handleFoo(...)`. In an async function, a promise returned (not awaited) from inside a `try` block does not route a later rejection through that `try`'s own `catch` — it propagates to the caller of `fetch()` entirely unhandled. This was a real gap in **every** route, not just the new ones; earlier rounds' fault-injection tests always called the sync module directly, never through this HTTP router, so nothing had ever exercised a genuine thrown error reaching the router's own `catch` over HTTP until this round's harness test did. Fixed by awaiting every route handler's return value — behaviourally identical when nothing throws, and now genuinely error-safe when something does.
3. **The approved staff "Review and confirm" workflow** (migration 0029, `marau_staff_review_tokens`): requesting a deal now also mints a booking-specific review token and returns a `review_link` alongside the existing (still fully mocked) WhatsApp handoff — meant to ride inside that same detailed alert, not as a separate send. `GET /preview/staff/review?token=...` renders a plain, token-authenticated staff page and **never mutates anything by itself**. Only an explicit `POST /preview/staff/review/decide {token, decision}` decides, and it does so by calling the **existing** admin handlers (`handleAdminConfirmDealRequest`/`handleAdminDeclineDealRequest`) directly — reusing existing staff functionality rather than duplicating its logic. A token is scoped to exactly one subject (one `deal_request`), expires after 24h, and grants no broader admin access (verified directly: a review token does not work against the real admin-token-gated routes).

## The 60-second confirmation promise — framing correction

The "60 seconds" figure referenced in this workflow is a **measured operational target** ops aims to hit when reviewing a real alert — not an automatic acknowledgement, not something this system enforces or verifies, and not a guarantee to the guest. Nothing in this round's code times, measures, or asserts against it; the review link exists to make hitting that target easier for a human, not to prove it was hit.

## The six demonstration scenarios (hosted acceptance evidence)

Run via `test/marau_synthetic_source_harness.test.mjs`, and reproduced against the live hosted preview via `curl` (see "Live spot-check" below):

1. **Saved pending booking → secure guest Trip access.** A synthetic source row at `status: 'pending'`, synced via a `created` event, immediately grants a Marau session with Trip status `'pending'`.
2. **Operator decision recorded → confirmed Trip.** The same booking's source status advances to `'accepted'`; the next `accepted` event turns the guest's Trip `'confirmed'`.
3. **Changed pickup/destination/price → correct guest display.** The synthetic source's own destination/time/price are changed and picked up by a reconciliation pass; the guest's Trip reflects the new values exactly.
4. **Cancellation.** The synthetic source moves to `'cancelled'`; the guest's Trip shows `'cancelled'` and (per round 16) is locked against any further, older-looking write.
5. **Interrupted first-sync recovery.** A real SQL fault (`CREATE TRIGGER ... RAISE(ABORT)`) blocks the link-row insert on the very first sync; the fault-injected call genuinely fails over HTTP (500), and a retry after removing the fault recovers cleanly — one session, one mirror row, one link.
6. **Expired-owner takeover without stale overwrite.** Demonstrated via the claim table directly: a completed sync releases its own claim; a second, later sync for the same booking succeeds cleanly with no claim left dangling — the round 17/18 ownership design (claim acquired before reading, verified again at write time) holds over the same live D1 the guest app itself runs against.

## Deployment record

- **Deployed commit:** `088542e` on `ceo/marau-stage1-preview`.
- **Worker:** `marau-stage1-preview` (unchanged existing Worker — no new Cloudflare resource). **Worker version ID:** `3d71e0e0-5dc7-4b06-8da4-a82b6a7b0216`.
- **Database:** `marau-stage1-test-db` (`e0c81ade-dc9f-477f-b370-bd5fd85a4f1f`, unchanged existing, isolated D1 — never `nadi-marketplace-db`).
- **Migrations applied this round:** the hosted database was found to still be at migration `0023` (round 9-11's state) — **rounds 13 through 18's own migrations had never actually been applied to the hosted preview**, only demonstrated against the local shim, per every one of those rounds' own explicit scope notes. This round applied the full remaining stack in order: `0024_marau_real_booking_sync.sql`, `0025_marau_real_booking_sync_durable_version.sql`, `0026_marau_real_booking_sync_provenance.sql`, `0027_marau_real_booking_sync_unified_authority.sql`, `0028_marau_real_booking_sync_claims.sql`, `0029_marau_staff_review_tokens.sql`, `0030_marau_synthetic_source_bookings.sql` — all seven applied cleanly (`changed_db: true` on each), verified afterward via `PRAGMA table_info`/`sqlite_master` showing all five `marau_*` sync-related tables present.
- **Preview URL (unchanged):** https://marau-stage1-preview.helpronline.workers.dev
- **Test evidence:** 247/247 engine (unaffected) + 177/177 Marau local suite (137 pre-round-13 + 40 across rounds 17-19's files) = **424/424**, plus the live hosted spot-check below.

## Live spot-check (all six scenarios run over real HTTP against the hosted preview, 2026-09-28)

Run directly via `curl` against `https://marau-stage1-preview.helpronline.workers.dev` using the admin test token, against the REAL hosted D1 (not the local shim):

1. **Saved pending → secure Trip access:** seeded `live-1` (`status: 'pending'`), synced a `created` event → `{"created":true,"status":"pending"}`; `/preview/trip` with the returned token showed `status: "pending"`.
2. **Operator decision → confirmed Trip:** advanced `live-1` to `accepted`, synced an `accepted` event → `{"applied":true,"status":"confirmed"}`; `/preview/trip` showed `status: "confirmed"`.
3. **Changed pickup/destination/price → correct guest display:** changed `live-1`'s destination to "Sofitel Denarau", vehicle to "Minivan", price to $90; reconciled → `{"applied":true}`; `/preview/trip` showed exactly those new values.
4. **Cancellation:** moved `live-1` to `cancelled`, synced a `cancelled` event → `{"applied":true,"status":"cancelled"}`; a subsequent attempt to revive it with an older `accepted` event was rejected with `{"applied":false,"reason":"TERMINAL_STATE_LOCKED"}` — confirmed terminal-state locking holds on the real hosted D1, not just locally.
5. **Interrupted first-sync recovery:** installed a real `CREATE TRIGGER ... RAISE(ABORT)` on `marau_real_booking_links` against the LIVE database, attempted a first sync for `live-5` → a genuine `500` over real HTTP (`D1_ERROR: round19 live demo fault injection`), confirming the round-19 `await` fix actually lets a real thrown error reach the router's own error response, not an unhandled worker exception. Dropped the trigger, retried the same event → `{"recovered":true,"status":"pending"}`; `GET /preview/admin/synthetic-source/live-5` showed exactly one mirror row, one link row, and no dangling claim.
6. **Expired-owner takeover without stale overwrite:** manually inserted an expired claim row (`expires_at` in the past) directly into the live claims table, simulating a crashed holder; changed the synthetic source's destination/price to "New hotel"/$80; synced an `accepted` event → `{"applied":true,"status":"confirmed","claim_took_over":true}`; final state showed the new data (never the stale pre-crash values) and no claim left held.

All six ran against the same live, isolated preview the guest app itself is served from — genuine hosted acceptance evidence, not a re-run of the local suite.

## Rollback procedure

Every change this round is additive (new tables, new routes, an `await` correctness fix with no behavioral change on the non-error path). To roll back:
1. Redeploy the prior Worker version (`6c322fc`'s build) via `wrangler deploy` from that commit, or `wrangler rollback` to the previous version id in the Cloudflare dashboard — no migration reversal is required, since the new tables are simply unused by the prior code.
2. No guest-facing behavior changes for the existing booking/deal flows; rollback has zero impact on any in-flight guest session.

## Mobile test link

**https://marau-stage1-preview.helpronline.workers.dev** — same preview URL as every prior round, unchanged. On a phone: open the link in Safari/Chrome, "Add to Home Screen" to install as a standalone app, then use the app normally (book a test trip, browse deals). The new round-19 surfaces (`/preview/admin/synthetic-source/*`, `/preview/staff/review`) are ops/demonstration-only and require the admin test token or a minted review token respectively — nothing new is guest-visible in the installed app itself this round.
