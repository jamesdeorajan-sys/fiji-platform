# Marau — production-integration plan for the existing booking and human WhatsApp loop (REVISED)

2026-09-28. Issue #54. Planning document only — **no code, no production change, no real-guest import, no live send in this document or its preparation.** This revision supersedes the round-11 draft of the same name; nothing in the round-11 "implemented today" table changes, but every "still required" item below is now traced to an exact real-system source rather than described generically, per this round's instruction.

## 0. Scope correction from the prior draft

The round-11 draft treated "the real booking system" as one undifferentiated thing. It is not. There are **three separate real systems**, and this plan keeps them separate throughout:

| System | What it is | Where it lives |
|---|---|---|
| **A. The live booking store** | `bookings` / `booking_events` / `negotiation_requests` / `geocoded_addresses` tables in the real `nadi-marketplace-db` D1 (Cloudflare account `595101df2c562b3c65595420d43f9fe1`), written by the real dispatch worker (`nadi-dispatch-api`, referenced throughout this repo's docs as `nadi-marketplace/worker/worker.js`) via `createBookingRecord`, `logBookingEvent`, `handleDriverAcceptBooking`, `handleAdminManualAssign` | **Not present in this git checkout at all** — confirmed by an exhaustive search (`find . -iname "*nadi-marketplace*"` and `-iname "worker.js"` across the whole repo returns none of that worker's own source; only two `wrangler.toml` files exist anywhere in this repo — `ftt-booking-site/src/wrangler.toml`, a static-site Pages config with no D1 binding, and `marau/wrangler.toml`, Marau's own isolated preview). It is deployed and operated separately from this checkout. |
| **B. Issue #54's Smart Return / Trigger Fill engine** | `movements` / `smart_offers` / `route_price_truth` tables, driven by `discoverOffer`/`validateOffer`/`activateOffer` in `smart-return-trigger-fill/src/` | In this checkout, on this branch. Explicitly documented as disconnected from A: `smart-return-trigger-fill/docs/ROUTE_PRICE_TRUTH_CONTRACT.md` states outright *"No storefront is connected to this contract yet,"* *"Not wired to NadiAirportTransfers.com's live booking JS,"* *"Not wired to any Cloudflare D1 binding."* A bridge module exists (`smart-return-trigger-fill/src/production_adapter.js`, "SHADOW MODE") that maps A's real, human-confirmed rows into B's shape, but it makes **no network or database call itself** — nothing currently invokes it against real data on any schedule. |
| **C. Marau's own preview store** | `marau_test_bookings` / `guest_sessions` / `deal_requests` etc. in the isolated `marau-stage1-test-db`, written only by Marau's own `/preview/bookings` test-harness form | This branch, this round's own tables. Zero real guests, zero connection to A or B today. |

**This is the direct answer to requirement 1's "distinguish the live booking store from Issue #54's movement/offer engine":** A (the live booking store) and B (the Smart Return engine, which Marau's deals feature is built on) are two different, currently-disconnected systems, and Marau's own booking record (C) is a third, also disconnected from both. A trip-display integration (this plan's proposal) only ever needs to read from A. A deals integration needs B, which itself still needs the ops-verified-availability data B has been missing since 2026-09-14 (`smart-return-trigger-fill/docs/OPS_VERIFIED_MOVEMENTS_CONTRACT.md`: *"The real database cannot supply it today... 0 `accepted` events, 1 driver, 1 vehicle, bookings `pending` 106 / `completed` 1"* as of 2026-09-21). Those are independent problems; this plan does not conflate them (see §6).

## 1. The real booking-write path and authoritative fields (traced, not assumed)

Source: `smart-return-trigger-fill/src/production_adapter.js` (a "CEO SAFETY-CORRECTION ROUND, 2026-09-14" reviewed module, whose header states its claims were "Confirmed by grep across every `status = 'accepted'` occurrence in worker.js, not assumed") and `smart-return-trigger-fill/docs/FIRST_READ_ONLY_RUN_PLAN.md` (documents the exact read-only SQL already run against the real `nadi-marketplace-db` on 2026-09-21).

**Authoritative confirmation trigger:** a booking is genuinely, humanly confirmed only when `bookings.status = 'accepted'` **and** a matching `booking_events` row exists with `event_type = 'accepted'`, `new_status = 'accepted'`, `booking_id` equal to the booking's own id, and `actor` matching `^(admin|driver:\d+)$` — i.e. reached only via `handleDriverAcceptBooking()` or `handleAdminManualAssign()`, never on creation (`'pending'`), a quote, or a notification send.

**Authoritative fields on `bookings`** (columns actually read; there is no passenger-count or duration column — both are known, documented gaps, not oversights):
`id`, `status` (`pending`/`accepted`/`completed`/…), `pickup_zone`, `destination_zone`, `vehicle_type`, `pickup_date`, `pickup_time` (Fiji-local wall clock, not UTC — `production_adapter.js`'s `zonedTimeToUtcIso` exists specifically because an earlier version read these naively as already-UTC), `quoted_amount`, `assigned_driver_id`, `created_at`. Passenger count, where it exists at all, comes only from a joined `negotiation_requests.passengers` row (negotiated bookings only); trip duration, where it exists at all, comes only from `geocoded_addresses.duration_text` (custom-address quotes only, Google Routes format `"1234s"`). Neither is ever defaulted or guessed — both are left `null`/absent when the source row doesn't exist.

**Preserved, unchanged by this plan:** `logBookingEvent`'s own audit trail, the driver-accept and admin-manual-assign code paths themselves, and — critically — the existing automated notifications and the human WhatsApp operations that already run off real bookings today. Nothing in this plan touches `nadi-dispatch-api`'s write path; every integration point below is a **read**.

## 2. Secure Marau access after a successful real booking save — no duplicate guest entry

Marau already has the exact mechanism this needs, unused so far: `guest_sessions` (migration `0007_marau_guest_sessions.sql`) is keyed **per guest identity** (`guest_contact_key`, a normalized phone — deliberately "the same identifier Lagi and the real dispatch Worker already use," per that migration's own comment), not per booking, specifically so one guest with several bookings gets exactly one session. It already carries `access_token`, `access_token_revoked`, and a `test_data` flag.

**The integration point:** when a real booking reaches `bookings.status = 'accepted'` (system A, §1), a session-issuing step — run by whoever already has real D1 read access, exactly as `FIRST_READ_ONLY_RUN_PLAN.md`'s Step 1 query already describes — looks up or creates a `guest_sessions` row keyed by that booking's real contact (phone), mints (or reuses) its `access_token`, and hands the guest a Marau trip link carrying that token, delivered through whatever channel already delivers the real booking confirmation today (SMS/WhatsApp/email — all pre-existing, none of which this plan changes). **No new form.** The guest never re-types a booking; Marau reads the real `bookings` row(s) for that `guest_contact_key` directly. A second real booking by the same guest reuses the same session — no duplicate guest entry, by construction of the existing `guest_contact_key` index (`idx_guest_sessions_contact_key`).

**What this requires that does not exist yet:** (a) a real, one-way read path from `bookings`/`booking_events` into `guest_sessions`/a Marau `bookings`-mirror table — today nothing calls `production_adapter.js` against real rows; (b) a decision on where that read runs (a scheduled Worker cron against A, reading only `accepted` rows, is the smallest shape — no write access to A is ever needed); (c) the actual link-delivery channel decision, which is explicitly **not** a new Marau send — it rides on the existing confirmation message.

## 3. How an operator's real decision reaches the guest's Marau Trip

Requirement 3 is explicit that "WhatsApp conversation alone is not a database update," and that is exactly the gap: today, an operator's WhatsApp reply to a guest is not written anywhere machine-readable. The **only** machine-readable record of an operator decision on a real booking is the same one identified in §1 — a `booking_events` row (`event_type`, `new_status`, `actor`, `created_at`), written by `handleDriverAcceptBooking`/`handleAdminManualAssign` (confirm/assign) or whatever the real cancel/change path writes (not yet traced in this checkout — see gap below).

**The integration point:** the same read step from §2, re-run periodically (or triggered by the same mechanism that already notifies the guest today), diffs each linked real booking's current `bookings.status`/latest `booking_events` row against what Marau's own mirrored copy last showed, and updates only Marau's **display** row (Marau's `marau_test_bookings.status`-shaped mirror, not systems A or B) when they differ. This is a **read-and-mirror**, never a write back to A. Marau's Trip view already renders `status` correctly for every state it currently supports (`pending`/`confirmed`/`confirmed_unallocated`/`declined`/`cancelled` — see migration `0016`); the only new work is populating that mirror from real events instead of the test harness.

**Traced gap, not yet closed:** `production_adapter.js`'s own header documents the confirm/accept path in full but does not document a real **cancellation** or **change** event shape — `booking_events.event_type` values beyond `'accepted'` have not been enumerated against the real schema in this checkout. This must be confirmed (a further read-only `SELECT DISTINCT event_type FROM booking_events`, the same kind of query already run for `FIRST_READ_ONLY_RUN_PLAN.md`'s Step 1) before "operator cancels/changes" can be mirrored — "confirmed" can be built first, "declined/cancelled/changed" needs this one additional real-schema check.

## 4. WhatsApp: preserve the existing team/contact, plan a guest-initiated handoff only

No change to the existing WhatsApp workflow is proposed. Marau's mocked composer (`whatsapp_handoff.js`) already produces guest-readable text with full internal linkage preserved as structured fields (round 11) — that stays mocked in preview, unchanged.

**The one real, guest-initiated integration this plan proposes (not yet built, not yet decided):** a "Talk to our team" action on the guest's own Trip view that opens `wa.me/<the existing ops WhatsApp number>?text=<the same composed summary, URL-encoded>` — i.e. the guest, by their own tap, opens **their own** WhatsApp client and starts a conversation with the **existing** team number. This is categorically different from anything Marau has been asked not to build: it is not an automated send, not a bot, not a new number, and does not touch `bookings`/`booking_events` at all — it is a convenience link the guest chooses to use, landing in the exact same human-staffed WhatsApp thread that already exists. It remains entirely optional and does not gate any other part of this plan; Marau's mocked composer can stay mocked in preview indefinitely regardless of whether this is ever turned on.

## 5. Production data isolation, admin authentication, access revocation, monitoring, rollback — required BEFORE any real-guest pilot

None of this exists yet for a production Marau. In order:

1. **Isolation.** A real Marau needs its **own** production D1 and Worker, distinct from both `marau-stage1-test-db`/`marau-stage1-preview` (which stay preview-only forever) and `nadi-marketplace-db` (Marau never gets write access to A — every integration point above is read-only against A). This is a new Cloudflare resource, not yet created, requiring its own migration rollout (the same 23-migration stack, reviewed the same way).
2. **Admin authentication.** Today's preview admin auth is a single shared bearer token (`MARAU_ADMIN_TEST_TOKEN`, a `[vars]` plaintext value — acceptable for an isolated preview, not for production). A real deployment needs per-operator credentials, not a shared secret — this has not been designed.
3. **Access revocation.** Already exists structurally (`guest_sessions.access_token_revoked`) but is not yet wired to anything — no admin action currently sets it, and no code path checks it beyond storage. Both need building.
4. **Monitoring.** None of Marau's infrastructure currently has health checks, error alerting, or usage dashboards — parity with what this project's other live properties already have (per [[p0-incident-fijidash-release-2026-09-26]], those properties do have this) is a real, unbuilt gap.
5. **Rollback.** For a production Marau this means: the real-booking read job can be paused instantly (stop the cron/trigger — no guest-facing change), and any issued `access_token` can be revoked instantly (once #3 above is wired) without touching `bookings`/`booking_events` at all, since Marau never writes to A. This makes rollback structurally cheap **once #3 is built** — it is not yet.

**Explicit, unconditional constraint carried into every later phase of this plan:** no real guest's data is ever copied into `marau-stage1-test-db` or any other synthetic/preview database, at any phase, for any reason. A real-guest pilot only ever runs against the production resource described in item 1 above, once it exists.

## 6. Trip-display integration is separable from deal/inventory integration — this is a staged proposal, not a reduced objective

Sections 2–3 above (real booking → secure Trip display → operator-decision mirroring) depend **only** on system A (§0) — the real `bookings`/`booking_events` tables. They do not require system B (the Smart Return engine) to be wired to anything, and do not require the ops-verified-availability gap (`OPS_VERIFIED_MOVEMENTS_CONTRACT.md`) to be closed at all.

Deals, by contrast, are Marau's Stage 1 objective as originally scoped ([[m13-boat-transfer-release-gating]] and the staged-deployment-formula memory both establish deals as the actual release goal) and depend on B, which depends on the still-open ops-verified-availability gap — a precondition entirely outside Marau's own scope to close. **A trip-only pilot (§7) is proposed here strictly as a smaller, separable first step that proves the display/access/isolation mechanics in §2–5 without waiting on B's own unrelated gap — it does not replace, narrow, or substitute for the Stage 1 deals objective**, which remains gated on the same OPS_VERIFIED_MOVEMENTS_CONTRACT precondition it always was, independent of anything in this plan.

## 7. Demonstration plan: synthetic data first, in isolation — exact source mappings, changes, and acceptance checks

Everything in this section runs **only** against `marau-stage1-test-db` (isolated preview) plus a **new, separate, still-synthetic** mirror of system A's shape — never the real `nadi-marketplace-db` — until this section's checks all pass and a further, explicit go-ahead is given.

**Exact source → destination mapping** (per §1's real column names):

| Real source (`bookings`/`booking_events`, read-only) | Marau destination | Notes |
|---|---|---|
| `id` | opaque linkage only (via a `computeOpaqueBookingRef`-style keyed reference, never the raw id) | mirrors `production_adapter.js`'s own existing privacy design |
| `status='accepted'` + matching `booking_events` row | `marau_test_bookings.status = 'confirmed'` (or `'confirmed_unallocated'` if no `assigned_driver_id`) | only trigger; never `'pending'` |
| `pickup_zone`, `destination_zone` | `marau_test_bookings.pickup_zone`, `.destination_zone` | direct copy, real zone names already match (`Nadi Airport`, `Denarau`, …) |
| `vehicle_type` | `marau_test_bookings.vehicle_type` | direct copy |
| `pickup_date` + `pickup_time` (Fiji-local) | `marau_test_bookings.pickup_datetime` (UTC ISO) | via `zonedTimeToUtcIso`, already built and tested in `production_adapter.js` |
| `quoted_amount` | `marau_test_bookings.quoted_amount` | direct copy |
| guest phone (normalized) | `guest_sessions.guest_contact_key` | lookup-or-create, per §2 |
| — (no passenger/duration column) | not mirrored | matches system A's own known gap; never guessed |
| `guest_name`/`guest_phone`/`guest_email`/`flight_number`/notes | **never read into the mirror** | matches `production_adapter.js`'s own existing privacy line: "never reads guest_name, guest_phone, guest_email, flight_number, or notes off the real booking row" |

**Required new code (not yet written):** (a) a read job that runs `FIRST_READ_ONLY_RUN_PLAN.md`'s Step 1 query (or the production equivalent) and calls `mapConfirmedBookingToMovementInput`-*adjacent* logic — a new, Marau-specific mapper reusing the same field derivations but writing to `marau_test_bookings`/`guest_sessions` shape, not `movements` shape, since this is system A → Marau's own display store, not A → B; (b) the lookup-or-create-session step from §2; (c) the status-diff mirroring step from §3; (d) the `access_token_revoked` wiring from §5 item 3.

**Acceptance checks, all against isolated synthetic data before any real-guest step:**
1. A synthetic row shaped exactly like a real `bookings`+`booking_events` accepted pair (same column names, synthetic values) is read and produces exactly one `guest_sessions` row and one mirrored booking — re-running the same input is idempotent (no duplicate session, no duplicate booking), reusing this round's own idempotency test pattern.
2. A second synthetic booking for the **same** `guest_contact_key` reuses the existing session (no duplicate guest entry) — direct test of §2's claim.
3. A synthetic status change (`accepted` → a synthetic cancel event) updates only the Marau mirror's display status, never touches the synthetic "real" source rows — direct test of §3 being read-only.
4. `access_token_revoked = 1` on a session immediately fails a subsequent `/preview/bookings` (or production equivalent) auth check — direct test of §5's revocation claim actually being wired, not just present as a column.
5. No `guest_name`/`guest_phone`/`guest_email`/`flight_number`/notes field appears anywhere in the mirrored row or in any log line produced by the read job — direct test of the privacy line in the mapping table above.
6. The whole path is demonstrated end-to-end against the isolated `marau-stage1-test-db` (or a fresh, equally isolated database created for this purpose) with fully synthetic "system A" input data, before touching anything real.

Only once all six pass, and James gives explicit further go-ahead, does §5's production resource creation begin — and only after that does a single real, consenting guest ever appear anywhere in this plan, per §5's unconditional constraint.

## Summary of what changed from the round-11 draft

The round-11 draft was directionally correct (a "smallest step," phased, nothing executed without go-ahead) but treated "the real booking system" as one thing to be pointed at later. This revision traces it to the exact real tables/columns/code paths (§1), specifies the guest-access mechanism concretely using an existing, already-built Marau table (`guest_sessions`, §2), makes explicit that no WhatsApp conversation is itself a database update and names the one real signal that is (`booking_events`, §3), proposes a guest-initiated `wa.me` handoff as the only real WhatsApp-adjacent change (not required, not decided, §4), enumerates the production pre-pilot checklist item by item (§5), separates trip-display from deals so the latter's precondition gap is not confused with the former's readiness (§6), and gives exact source-to-destination field mappings plus six concrete, synthetic-data-only acceptance checks (§7) — nothing here has been executed; no production change, real-guest import, or live send has occurred in preparing it.
