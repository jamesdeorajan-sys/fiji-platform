# Marau Stage 1 — preview build review package

Status: isolated preview build complete, tested, NOT deployed to any real Cloudflare account resource. No production decision has been made or implied by this work. James and Codex review this before anything is deployed.

## 1. Exact SHAs and branch

- Base (Issue #54's existing engine, unchanged): `ceo/smart-return-recovery-pilot` @ `62b8ed0f576190d852da46a36883285c18fd6f46`
- This work: branch `ceo/marau-stage1-preview`, created from the SHA above
  - `c955110909f29326db0b55be4ea24ea8da517e41` — fix(issue-54): async store/service defect in offers/ledger/board/pipeline (prerequisite fix, required before this work — see its own commit message for the full defect description and reproduction)
  - `187e82fac498454504154b4048e9809fbfe7f688` — feat(marau): Stage 1 preview — guest trip app, deals, ops confirm, bounded AI
- `main` on `jamesdeorajan-sys/fiji-platform` at the time this work started: `81e64b4e56e002d7d73473dd14c8968059f10463` (Issue #59 notification-reliability release CLOSED). **Unchanged, untouched, not merged into.**
- Notification-reliability release preserved exactly as closed: Worker version `8c1fa242-bf63-432b-bded-cf6f13b07cbf`, source `2125a340a5a77788b2bdd4cdb403cac0e0b77940`, migrations `milestone36`/`milestone37` applied to `nadi-marketplace-db`. Nothing in this work touches that Worker, that database, or any of its migrations.
- Held Issue #59 branches (FijiDash fare-display, 404/SEO/trust, departure-capture, Nadi trust/search) — **not merged, not deployed, not touched** by this work.

## 2. What was verified before building (per the mission's instruction to verify current state, not rely on release notes)

- Re-read `docs/AGENT_SYNC.md` and the latest checkpoints on Issues #54 and #59 at session start.
- Confirmed via `git log`/`git fetch` that `main` was still at `81e64b4` and `ceo/smart-return-recovery-pilot` was still at `62b8ed0` (unchanged since the last documented checkpoint).
- Re-ran Issue #54's existing suite before touching anything: **240/240 pass**, matching AGENT_SYNC's own recorded count for `62b8ed0`.

## 3. The async store/service defect — reproduced and fixed (commit `c955110`)

**Reproduction.** `src/offers.js`, `src/ledger.js`, `src/board.js` and `src/pipeline.js` all consumed `store.*` method results **synchronously**. This was only ever safe because the only store ever exercised in 240 prior tests (`createMemoryStore`) returns plain values. `createD1Store` (also in `src/db.js`, written for Stage 2, never wired or exercised) returns a `Promise` from every method, matching the real Cloudflare D1 API. Called against a Promise-returning store, e.g. `holdOffer`'s `store.casOfferStatus(...)` handed back a pending Promise object with no `.success` property — `undefined` is falsy, so `holdOffer` reported **every** hold attempt as a failure regardless of what the database actually did, while the real write raced on unawaited in the background.

`smart-return-trigger-fill/test/async_store_regression.test.js` is the reproduction: it wraps `createMemoryStore` so every method returns a Promise (same external contract shape as `createD1Store`, no real D1 binding needed) and exercises every affected function. All 7 cases failed before the fix, pass after it, and stay in the suite as a permanent regression guard.

**Fix.** Every exported function in `offers.js`/`ledger.js`/`board.js`/`pipeline.js` is now `async` and awaits every store call. `board.js` additionally resolves route-price-truth lookups into a synchronous `Map` **before** calling the matcher, so `src/matcher.js` (deliberately pure, deterministic, no I/O) never has to become async or know anything about store timing. Every existing caller (4 test files, `scripts/demo.js`, `scripts/live_shadow_report.js`) was updated to `await` the now-async functions.

**Result:** full Issue #54 suite **247/247** (240 original + 7 new regression tests).

## 4. Marau Stage 1 architecture (commit `187e82f`)

```
marau/
  migrations/0007-0011   new tables (see below)
  worker/worker.js        the API + router
  worker/ai_assist.js     bounded, no-network AI assistance
  worker/pages.js         guest app + ops console (static HTML/JS, same Worker)
  wrangler.toml           isolated Worker config (placeholder database_id — see §7)
  test/                   27 tests, real-SQLite-backed D1 shim, network guard
```

Reuses, unmodified except for the defect fix above:
- `smart-return-trigger-fill/src/db.js` (`createD1Store`)
- `smart-return-trigger-fill/src/offers.js` (the CAS offer state machine — `discoverOffer`, `validateOffer`, `activateOffer`, `holdOffer`, `fillOffer`, `expireOffer`)
- `smart-return-trigger-fill/src/ledger.js` (`ingestMovement`, used only by test fixtures here to seed a realistic movement)
- `smart-return-trigger-fill/src/model.js` (`cryptoRandomId`)
- `smart-return-trigger-fill/migrations/0001-0006` (movements, smart_offers, route_price_truth, experience_credit_eligibility — unchanged)

**Lagi is completely excluded.** No file in `marau/` imports, calls, or references any Lagi endpoint, worker, or D1 database. WhatsApp appears only as inert, guest/operator-constructed link data — nothing in this Worker sends a message.

### New tables (migrations 0007-0011, additive, exact SQL in the files themselves)

| Table | Purpose |
|---|---|
| `guest_sessions` | One row per guest **identity** (keyed by normalized phone), not per booking — the same phone always resolves to the same session/access token across bookings and properties, per the mission's "one guest, one session" rule. `access_token_revoked` is the revocation mechanism. `whatsapp_available` is recorded (1/0/NULL), never enforced. |
| `marau_test_bookings` | Isolated test-equivalent of the real booking flow — **not** the real `bookings` table, lives only in this isolated database. `client_booking_ref` is the idempotency key. `guest_email`/`guest_phone` are `NOT NULL` — server-enforced, closing the exact gap Issue #59 flagged as open on the real sites (client-required, not server-enforced). |
| `deal_requests` | "Request this deal" as an **idempotent request**, deliberately not a timed hold (holds/waitlist/credits are deferred). `idempotency_key` = session+offer, so a retry returns the same row. A request never moves `smart_offers.status` by itself. |
| `vehicle_time_claims` | The actual double-sell guard for **different** `smart_offers` rows that trace back to the same `source_movement_id` (the same real vehicle/time). The `PRIMARY KEY` on `source_movement_id` is the entire mechanism — see §5. |
| `booking_change_requests` | A requested change is stored as a proposed diff and **never** applied to the booking until an admin approves it; only 4 whitelisted columns (`pickup_zone`, `destination_zone`, `vehicle_type`, `pickup_datetime`) can ever be written this way — `guest_email`, `guest_phone`, `quoted_amount`, `status`, `client_booking_ref` cannot, even if a change request tries to include them (tested explicitly). |

### API surface (`marau/worker/worker.js`)

| Route | Auth | Notes |
|---|---|---|
| `GET /health` | none | |
| `GET /`, `GET /admin` | none | static guest app / ops console |
| `POST /preview/bookings` | none | server-validates email+phone; immediate `access_token` in the response; idempotent on `client_booking_ref`; resolves-or-creates the guest session by phone |
| `GET /preview/trip` | guest bearer | soonest pickup first, all bookings on the session |
| `POST /preview/trip/revoke` | guest bearer | revokes the token immediately |
| `GET /preview/deals` | none | public browse, `demonstration_data: true`, every deal labelled `DEMONSTRATION DATA` |
| `POST /preview/deals/:offerId/request` | guest bearer | idempotent; rejects a stale/expired offer (`409 STALE_OR_EXPIRED_OFFER`); returns a constructed (never-sent) WhatsApp handoff |
| `POST /preview/bookings/:id/change-request` | guest bearer, own booking only | |
| `POST /preview/assist` | guest bearer | bounded AI — see §6 |
| `GET/POST /preview/admin/*` | admin test bearer (`MARAU_ADMIN_TEST_TOKEN`) | list/confirm/decline deal requests, list/confirm/decline bookings, list/approve/reject change requests |

## 5. The vehicle/time exclusivity guard — the concurrency-critical proof

Issue #54's own `casOfferStatus` already prevents the **same** `offer_id` being held/filled twice (`smart-return-trigger-fill/test/offers_atomicity.test.js`). It does **not** prevent two **different** `smart_offers` rows that both trace back to the same `source_movement_id` — the same real vehicle doing the same real trip — from both being confirmed. Nothing in the existing schema enforced that, and the mission explicitly required proving it before human confirmation.

`vehicle_time_claims.source_movement_id` is a `PRIMARY KEY`. Confirming a deal request (`handleAdminConfirmDealRequest`) inserts a claim row **before** moving the offer's own status; if another offer for the same `source_movement_id` already claimed it, the `INSERT` throws a constraint violation and the confirm attempt is rejected with `409 VEHICLE_TIME_ALREADY_CLAIMED`, leaving the losing `deal_request` exactly as it was (`REQUESTED`, not silently decided).

`marau/test/marau_concurrency.test.mjs` proves this against `marau/test/d1_sqlite_shim.mjs` — a **real** `node:sqlite`-backed store (not a hand-mocked one, not the in-memory store) running the actual migration SQL, so the constraint is enforced by SQLite itself:
- Two different offers, same vehicle, confirmed via `Promise.all`: exactly one wins, the other gets `409`, exactly one `vehicle_time_claims` row exists.
- The loser can still be explicitly declined afterward.
- Confirming an already-decided request is rejected (`409 ALREADY_DECIDED`), not silently repeated.
- Three competing confirmations (two offers × one shared vehicle, one offer requested by two different guests) confirmed simultaneously: still exactly one winner.

## 6. AI scope — what was and wasn't built

`marau/worker/ai_assist.js` makes **no network call and no LLM call of any kind**. Per the mission's explicit instruction ("Do not send customer data to a new AI provider; use synthetic data in preview and identify the proposed production integration for review"), it is a small deterministic rule engine over the guest's own booking rows and the offer rows already returned by `/preview/deals` — nothing else. It cannot invent a price, availability, pickup instruction, or confirmation status because it has no code path that writes a field it wasn't given verbatim from a real row. Every response carries `ai: true`, a plain-language disclosure, and keeps `human_handoff_label: "Talk to our team on WhatsApp"` — and never claims 24/7 staffing.

The file's own header documents the **proposed** production integration (a real Claude API call, server-side only, scoped to just this guest's own rows) as a separate, unimplemented decision requiring James's sign-off on the secret binding, the system prompt, and a rate limit — explicitly not built here.

## 7. Isolation — exact statement

- **No production D1 binding.** `marau/wrangler.toml`'s `database_id` is a literal placeholder (`REPLACE_AFTER_WRANGLER_D1_CREATE`) — this Worker has never been deployed with a real database bound. Creating the real isolated database is `wrangler d1 create marau-stage1-test-db` (not run — see §9, blocked on credentials).
- **No production secret, route, or scheduled trigger.** `MARAU_ADMIN_TEST_TOKEN` and `MARAU_OPS_WHATSAPP_TEST_NUMBER` are test-only values, never a real Meta/WhatsApp credential.
- **No production migration applied anywhere.** Migrations 0007-0011 have only ever run against the in-test SQLite shim.
- **No real network call in any test.** `marau/test/network_guard.mjs` (the same proven pattern as `nadi-marketplace/worker/network_guard.mjs` from the Issue #59 notification-reliability work) replaces `globalThis.fetch` with a function that throws AND records every call, with a file-scoped assertion the log is empty — a leaked/swallowed real send would fail the whole suite, not just go unnoticed.
- **Synthetic contacts only.** Every test fixture email/phone resolves to `*.example.test` addresses and `+1500555*` numbers — nothing that could reach a real person.
- **`main` untouched.** This entire branch (`ceo/marau-stage1-preview`) has not been merged anywhere and has no push performed under this instruction.

## 8. Test results

| Suite | Result |
|---|---|
| `smart-return-trigger-fill/test/*.test.js` (Issue #54 engine, incl. the new async-store regression tests) | **247/247 pass** |
| `marau/test/*.test.mjs` (Stage 1 preview) | **27/27 pass** |
| **Total** | **274/274 pass** |

Both suites run fully offline (`node --test`), with `network_guard`'s `after()` assertion confirming zero real network calls across every Marau test file.

## 9. Deployment status — blocked, not attempted further

This session's Cloudflare credentials are not usable:
```
$ npx wrangler whoami
X [ERROR] A request to the Cloudflare API (/accounts) failed.
  Invalid access token [code: 9109]
```
`wrangler dev --local` (which does not require a valid token) does start and correctly serves the static guest/admin HTML — verified visually in a browser at mobile width (375×812): the booking form and tab navigation render correctly. However, every route that touches the local D1 binding fails with an opaque `internal error` from the local miniflare/workerd D1 implementation in this sandboxed environment — reproduced even on a trivial `CREATE TABLE` via `wrangler d1 execute --local --command`, so it is an environment limitation, not a defect in this code. This blocked a full interactive browser walkthrough (booking → trip → deals → request → admin confirm) against a genuinely running Worker.

**What stands in for that walkthrough:** the 27 `marau/test/*.test.mjs` tests exercise the exact same `worker.js` fetch handler, calling it directly with real `Request` objects against `test/d1_sqlite_shim.mjs` — a real SQLite engine enforcing real constraints, not a hand-rolled mock. This is deliberately a stronger correctness proof than a browser click-through would have been for the concurrency case in particular (§5), which needs `Promise.all`-simultaneous requests that are awkward to stage through a UI.

**What a real preview needs from James:** a working Cloudflare API token/OAuth session for account `595101df2c562b3c65595420d43f9fe1`, after which the remaining steps are: `wrangler d1 create marau-stage1-test-db` → apply all 11 migrations in order → fill in the real `database_id` in `wrangler.toml` → `wrangler secret put MARAU_ADMIN_TEST_TOKEN` → `wrangler deploy`. None of this was run.

## 10. Remaining production decisions (none made or implied by this work)

- The 8 open questions in `BUILD SPEC shadow leg deals.md` (pricing decay model, matching-window definition, cancellation cascade, driver opt-out, no-show definition, cross-property consent, FCCC fare-floor applicability, group-claim limits) remain unanswered and are **not** required for this Stage 1 (none of Stage 1's flows depend on them), but block any stage that would actually price or auto-list a shadow leg from a real booking.
- **Non-WhatsApp follow-up ownership** (an open item from Issue #59, unchanged): `guest_sessions.whatsapp_available` records whether a guest can be reached on WhatsApp, but no owner or channel (call/SMS/email) is defined for a guest who can't be. This preview does not decide it — it only avoids blocking such a guest from booking.
- Which real inventory (if any) should ever populate `smart_offers` for a live Deals tab is unchanged from Issue #54's own blocker: real ops-verified movements, vehicle/driver identity, duration, capacity, payout and floor, none of which exist yet.
- The proposed AI production integration (§6) needs its own review and sign-off before any real key is wired in.
- A real Cloudflare deployment needs the credential/database steps in §9, and — per the mission — a **separate, explicit decision** from James before anything here goes further than this isolated preview.
