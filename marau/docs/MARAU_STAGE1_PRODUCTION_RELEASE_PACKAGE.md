# Marau — smallest production-integration release package

2026-09-29. Issue #54. **Planning/documentation only — no code, no production change, no real-guest import, no live send in this document or its preparation.** Written the same day James confirmed actual-device acceptance of the round-25 fix (`c995b2c`, Worker `6f51d76c-6b0d-40ad-88c3-0ae0c332fec5`) — the last outstanding item from `docs/MARAU_STAGE1_PRODUCTION_INTEGRATION_PLAN.md` (round 12/13) and `MARAU_STAGE1_REAL_BOOKING_SYNC.md` (rounds 13-18) that was still open.

This document does not re-derive that plan from scratch. It states, component by component, **what is already built and verified in the isolated preview**, **what the smallest real release would still need**, and **which decisions are James's alone to make** before any of it touches production. Where this document's account of "what's built" differs from the round-12 plan, that is because rounds 13-25 actually built and hosted-verified most of what round 12 only proposed — this document reflects that, not a new design.

## 0. What "smallest" means here

The smallest release is a **trip-display-only** pilot for a small number of real, consenting guests — not deals. Deals depend on Issue #54's Smart Return engine, which itself still depends on the ops-verified-availability gap documented in `smart-return-trigger-fill/docs/OPS_VERIFIED_MOVEMENTS_CONTRACT.md` (open since 2026-09-14, unrelated to anything Marau does). This document does not propose closing that gap — it is out of scope for this release package, exactly as `MARAU_STAGE1_PRODUCTION_INTEGRATION_PLAN.md` §6 already established. **Decision 9 below asks James to confirm this scoping still holds.**

## 1. Real booking connection

**Built and hosted-verified (rounds 13-19, re-verified every round since):** `worker/real_booking_sync.js` — `syncRealBookingEvent`/`reconcileRealBooking` take a bare signal (event or snapshot), acquire a real per-booking ownership claim (`marau_real_booking_claims`, migration 0028), read the CURRENT authoritative booking through an injected `reader` function (synthetic in every test today; would be a real read-only D1 query against `bookings` in production), and apply only that freshly-read data — never a caller-supplied payload. Terminal-state stickiness (`cancelled`/`completed` lock a row permanently) and generation fencing are defense-in-depth on top of the claim itself. First-sync is idempotent and self-healing (`createOrRecoverOwnedRow`) even under fault injection on the link-insert. All of this has been demonstrated against the isolated hosted D1 with real `CREATE TRIGGER ... RAISE(ABORT)` fault injection, not just the local SQLite shim — see `MARAU_STAGE1_HOSTED_SYNC_ACCEPTANCE.md`.

**What a real release still needs, and is NOT yet built:**
1. An actual `reader` implementation that queries the REAL `nadi-marketplace-db` (not the synthetic harness) — this file's `reader` parameter is currently only ever a test double.
2. A real credential/binding that can read `bookings`/`booking_events` in `nadi-marketplace-db` from Marau's own Worker. `nadi-dispatch-api`'s own source is not present in this checkout (confirmed by exhaustive search, round 12) — this connection point sits at a repo/ownership boundary this document cannot resolve unilaterally.
3. A decision on what actually calls `syncRealBookingEvent`/`reconcileRealBooking` in production — a scheduled Cloudflare Cron Trigger polling recent `booking_events`, or a push from `nadi-dispatch-api` itself (a webhook), or something else. Nothing currently invokes either function outside tests.
4. **The traced, still-open gap from round 12/13, never yet closed:** the real cancel/change `booking_events.event_type` shape has never been enumerated against the real schema (only `'accepted'`/`'created'`/`'en_route'`/`'completed'`/`'cancelled'` are assumed, per `REAL_EVENT_TYPES` in `real_booking_sync.js` — this list itself has never been cross-checked against a live `SELECT DISTINCT event_type FROM booking_events` on the real database). Confirming trip-display for confirmed bookings can proceed without this; cancellation/change display cannot, safely, until this one query is actually run.
5. **Also still open from round 22's own checkpoint, restated every round since without ever being done:** confirming the DEPLOYED (not merely repository) revision of the real `nadi-dispatch-api` Worker — everything above is verified against a repository read (`git log --all`, commit `30c6187`), never against what is actually running in production right now.

## 2. Secure guest-link delivery

**Built and now device-verified (rounds 4, 24, 25; confirmed on James's real iPhone 2026-09-29):** `guest_sessions` (migration 0007), keyed by normalized guest contact, one session per guest regardless of booking count. Client-side `getToken()` recovers across four independent, redundant mechanisms — URL hash fragment, `sessionStorage`, `localStorage`, and (since round 24, fixed round 25) a `marau_tok` cookie, all written together by `setToken()` and all cleared together on revoke. `requireGuestSession` (server) accepts either an `Authorization` header or the same cookie, with identical revocation checking (`access_token_revoked`) either way. Access is never recoverable from a booking reference, email, or phone match — only the guest's own already-issued opaque token, via any of the four mechanisms.

**What a real release still needs:**
1. **The actual delivery channel decision.** This mechanism assumes a guest already has the link — nothing in Marau today sends it. Per `MARAU_STAGE1_PRODUCTION_INTEGRATION_PLAN.md` §2, the smallest approach rides on whatever channel already delivers the real booking confirmation today (SMS/WhatsApp/email) — no new Marau-initiated send. **James needs to confirm which existing channel that is** and who owns adding the Marau link to it (likely `nadi-dispatch-api`'s own confirmation flow, not this codebase).
2. Production secrets: `MARAU_ADMIN_TEST_TOKEN` is currently a plaintext `[vars]` value in `wrangler.toml`, acceptable only because this preview holds zero real data. Production needs `wrangler secret` (or equivalent) for anything token-shaped, plus a real token-rotation plan.
3. A production Cloudflare resource — its own D1 and Worker, isolated from `marau-stage1-test-db`/`marau-stage1-preview` (which stay preview-only forever) and from `nadi-marketplace-db` (Marau never gets write access to system A — every integration point in §1 is read-only). Not yet created.

## 3. Staff authentication

**Built and hosted-verified (rounds 19-22):** a booking-specific, time-limited (`marau_staff_review_tokens`, 24h expiry) review link, minted only into the admin-token-gated listing (never the guest's own response — this was a P0 fixed in round 20). Deciding via that link (`POST /preview/staff/review/decide`) additionally requires real staff authentication — the same admin bearer token every other admin route requires (header, or a form field for the no-header review-link flow) — token possession alone is explicitly insufficient, by design, since round 20's fix. A confirmed reservation requires a driver/vehicle already on record (`DRIVER_NOT_ASSIGNED` otherwise) and records the deciding operator's name in a dedicated audit table (`marau_staff_decisions`), durably, inside the same atomic write as the underlying state transition (round 22's commit-boundary fix) — never lost to a later, independent write failure.

**What a real release still needs:**
1. **Per-operator credentials.** Today's admin auth is ONE shared bearer token for every staff member. A real deployment needs individual operator identity, not a shared secret — this has not been designed at all. **James needs to decide** whether this reuses an existing internal auth/identity system elsewhere in the Vakaviti account, or needs a small new one built (e.g., per-operator API keys minted and revocable independently).
2. A decision on whether the review-link workflow (tap a link, enter a shared/per-operator token, decide) is the intended production staff UX, or whether staff should instead work from an existing internal tool/dashboard that then calls the same underlying confirm/decline logic. The underlying logic (`real_booking_sync.js` + the staff-decision endpoints) does not care which UX sits in front of it.

## 4. Existing WhatsApp handoff

**Built, unchanged, and explicitly staying mocked in preview indefinitely:** `whatsapp_handoff.js`'s composer produces guest-readable text with full internal linkage preserved as structured fields — no network call, no real send, ever, in preview. This is intentional and this document does not propose changing it.

**The one real, guest-initiated integration ever proposed (round 12 §4, still not built, still not decided):** a "Talk to our team" action on the guest's own Trip view opening `wa.me/<the existing real ops WhatsApp number>?text=<the same composed summary, URL-encoded>` — the guest's own tap, their own WhatsApp client, the **existing**, already human-staffed number. Not an automated send, not a bot, no new number, no write to `bookings`/`booking_events`. Entirely optional; nothing else in this release depends on it either way.

**What a real release still needs:**
1. **A yes/no decision from James** on whether to build this at all for the first release, versus leaving the guest's Trip view display-only with no outbound action.
2. If yes: the real ops WhatsApp number to use (today's preview uses a synthetic test number, `+15556414099`, purely as a mocked `to:` field — never dialled).

## 5. Monitoring and rollback

**Not built at all today** — this is the least-mature component of the five. `wrangler.toml` confirms no `[triggers]`/crons exist yet (needed for §1's sync job regardless of monitoring), and there is no health check, error alerting, or usage dashboard for any part of Marau's infrastructure.

**What a real release needs, at minimum, before any real guest:**
1. **Monitoring.** This project's other live properties already have basic health/error monitoring (see `[[p0-incident-fijidash-release-2026-09-26]]`) — the smallest step is parity with whatever pattern those already use, not a new tool. **James needs to confirm which existing monitoring setup to extend**, since this document doesn't have visibility into it from this checkout.
2. **Rollback.** Structurally cheap by design, once built: the real-booking sync job/cron can be paused instantly with no guest-facing change (§1), and any guest's `access_token` can be revoked instantly via the existing `access_token_revoked` mechanism (already wired and tested since round 24, now also cookie-aware) without ever touching `bookings`/`booking_events`, since Marau never writes to system A. **What's missing is not the mechanism but the runbook** — a written, agreed procedure for who pulls which lever, and under what conditions, has not been drafted. **James needs to name who is on call** for a real pilot before it starts.

## 6. Isolation constraint carried forward, unconditionally

Restated from `MARAU_STAGE1_PRODUCTION_INTEGRATION_PLAN.md` §5, unchanged: no real guest's data is ever copied into `marau-stage1-test-db` or any other synthetic/preview database, at any phase, for any reason. A real-guest pilot only ever runs against a new, dedicated production Cloudflare resource (D1 + Worker), once it exists and every item above has an answer.

## 7. Acceptance checks — already satisfied, not re-proposed

Round 12 §7 proposed six synthetic-data acceptance checks before any real-guest step. Rounds 13-25's own test suites and hosted-D1 fault-injection verification (`MARAU_STAGE1_HOSTED_SYNC_ACCEPTANCE.md`, `MARAU_STAGE1_REAL_BOOKING_SYNC.md`) have since covered all six directly: idempotent first-sync, same-guest session reuse, read-only status mirroring under real fault injection, live revocation enforcement (cookie- and header-based), no PII fields ever mirrored, and full end-to-end demonstration against the isolated hosted D1 — including, as of round 25, on real iPhone hardware. **These checks do not need to be repeated; the open items are exclusively the five components above and the decisions in §8.**

## 8. Remaining decisions — James's alone

Nothing below can be resolved by writing more code against the isolated preview; each requires a real answer, a real credential, or a real resource this document cannot create on its own authority.

1. **Real-data read access.** How does Marau's production Worker actually read `nadi-marketplace-db`'s `bookings`/`booking_events` — a direct cross-Worker D1 binding, a small read-only API `nadi-dispatch-api` exposes, or something else? This depends on who maintains that Worker (its source isn't in this checkout).
2. **Sync trigger mechanism.** Scheduled polling (a Cron Trigger) versus a push/webhook from `nadi-dispatch-api` on write.
3. **The cancel/change event-type gap.** Run one real, read-only `SELECT DISTINCT event_type FROM booking_events` against production before cancellation/change display goes live — still never done, restated every round since 13.
4. **Deployed-revision confirmation.** Verify what's actually running on the live `nadi-dispatch-api` Worker, not only what's in its repository history — still never done, restated every round since 22.
5. **Guest-link delivery channel.** Which existing confirmation message (SMS/WhatsApp/email) carries the Marau link, and who adds it.
6. **Per-operator staff authentication design.** Reuse an existing identity system, or build a small new one — and who the actual staff operators are.
7. **The `wa.me` guest-initiated handoff.** Build it for this release or not; if yes, the real ops WhatsApp number.
8. **Production Cloudflare resource creation.** Explicit go-ahead to create the new isolated D1 + Worker (distinct from the preview and from `nadi-marketplace-db`).
9. **Monitoring ownership.** Which existing monitoring setup this extends, and who is on call for rollback.
10. **Scope confirmation.** That this first release remains trip-display-only, with deals explicitly deferred behind Issue #54's own separate, still-open ops-verified-availability gap (unchanged from round 12 §6) — not something this release attempts to also close.

Nothing above is proposed for execution. This document exists so each decision can be made explicitly, one at a time, rather than assumed.
