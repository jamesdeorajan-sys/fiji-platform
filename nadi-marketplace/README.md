# Nadi Airport Transfers — Driver Marketplace (Phase 1)

Staging build. See `Nadi_Airport_Phase1-Build-Spec.md` for the full Phase 1 spec.

## Resources

| Resource | Name | ID | Notes |
|---|---|---|---|
| D1 database | `nadi-marketplace-db` | `0ec1cd84-fcda-4f7f-8337-0fb70fe1a512` | 11 tables (10 from spec Section 2 + `driver_login_tokens`, Milestone 2) |
| Worker | `nadi-dispatch-api` | — | `worker/worker.js`, bindings: `DB`, `DOCS` (R2), `ADMIN_TOKEN`, `DOC_SIGNING_SECRET` |
| Pages project | `nadi-marketplace-staging` | `466f9191-2a8c-474c-861f-d6433b8da2b9` | Connected to Git (`nadi-marketplace-phase1-staging` branch, output dir `nadi-marketplace/staging-site`), auto-deploy on push |
| R2 bucket | `nadi-marketplace-driver-docs` | — | Created, bound to `nadi-dispatch-api` as `DOCS`. Empty (test objects created and cleaned up during verification). |

## Isolation — confirmed, zero shared state with production

- Separate D1 database from `vakaviti-kb` (`e697a253-e5fc-4201-939c-9aaeca6c5278`).
- Separate Worker script from `fiji-chat-widget` — `nadi-dispatch-api`'s only bindings are `DB`
  (D1) and two secrets (`ADMIN_TOKEN`, `DOC_SIGNING_SECRET`), both generated fresh for this Worker.
  No KV, no Vectorize, no AI, no shared secrets with `fiji-chat-widget`.
- Separate Pages project from `nadiairporttransfers.com`'s existing project — not touched.
- No route, custom domain, or DNS record points at any of this milestone's resources.
- `workers/chat-widget/worker.js` was not opened or modified. The WhatsApp send logic in this
  Worker is a new, independent implementation against the same Meta Cloud API pattern — not a
  shared function, no dependency on that file.

## Milestone 1 — staging skeleton (done)

All 10 spec-Section-2 tables created and verified live via `PRAGMA table_info()`. `platform_settings`
seeded (`fuel_auto_apply='false'`, `fuel_confirmed_accurate_count='0'`).

## Milestone 2 — driver onboarding + admin approval queue

### What's built and verified

- **`GET /zones`** — public, returns the 16 real zones (seeded from `ftt-booking-site/src/app.js`
  `ROUTES_DATA.area` — the actual live data behind nadiairporttransfers.com's routes table, chosen
  over the coarser 9-item `areaServed` schema.org list after checking with James directly since it
  affects real driver-dispatch matching later). Verified live, correct 16 values returned, and
  confirmed loading correctly in the join form via a real browser test.
- **`POST /drivers`** — public join-form submission endpoint. Validates all fields (including
  photo MIME type/size, zone names against the real `zones` table), uploads 3 photos to R2, inserts
  a `drivers` row (`status='pending'`) and a linked `vehicles` row. **Not yet live-testable
  end-to-end — see R2 blocker below.** Correctly returns a graceful `503` right now
  (`"Document storage not available"`) rather than a confusing crash, verified live.
- **`GET /admin/drivers?status=pending`** — admin-only (`Authorization: Bearer <ADMIN_TOKEN>`),
  lists drivers with signed, time-limited (1 hour) document URLs — not public bucket URLs. Verified
  live: returns `401` with no/wrong token, `200` with the correct token.
- **`POST /admin/drivers/:id/approve`** and **`POST /admin/drivers/:id/reject`** — admin-only,
  update `drivers.status` to `verified`/`rejected`. Approve also creates a `wallets` row, generates
  a magic-link token in `driver_login_tokens`, and attempts a WhatsApp send.
- **`GET /admin/docs/:key`** — HMAC-signed (`DOC_SIGNING_SECRET`), expiry-checked document serving
  route. This is how "signed/temporary R2 URLs, not public buckets" is implemented — R2 buckets
  stay fully private; the Worker itself gates access.
- Driver join form (`staging-site/driver-join.html`) and admin approval queue
  (`staging-site/admin-drivers.html`) — both built, both verified working live in a real browser
  against the real deployed Worker (zones loading, admin login gate authenticating with the real
  token, correct empty-state rendering).

### Real gap found and resolved: the join form's fields don't include a vehicle plate

The spec's field list for the join form (`name, phone, vehicle type, vehicle photo, license photo,
insurance photo, zone(s)`) has no plate number, but `vehicles.plate` is `NOT NULL` in the verified
schema. Added `plate` as a required form field — a vehicle-based marketplace needs it for real
dispatch/compliance, and the alternative (a placeholder value sitting in a production `NOT NULL`
column) is worse. Flagging this explicitly since it's a deviation from the literal spec field list,
not a silent change.

### End-to-end verification — real evidence, all independently re-checked via D1/R2 API (not just trusting endpoint responses)

1. Submitted a real driver application (`POST /drivers`, real JPEG files) → `201`, `driver_id: 1`.
2. Independently listed the R2 bucket directly — 3 real objects present (`vehicle.jpg`,
   `license.jpg`, `insurance.jpg`, 1617 bytes each).
3. Independently `SELECT`ed the `drivers` and `vehicles` rows — `status='pending'`, correct
   `zones` JSON, correct R2 keys stored, `plate` correctly saved.
4. Fetched a real signed doc URL from `GET /admin/drivers` — downloaded object is byte-identical to
   the originally uploaded file. Confirmed a tampered signature and a missing signature both get a
   real `403` — the bucket is not readable without a valid signed URL.
5. Submitted a second application (`driver_id: 2`) to test Reject independently from Approve.
6. `POST /admin/drivers/1/approve` → `200`. Independently `SELECT`ed: `status='verified'`, a
   `wallets` row was created (`balance_fjd=0`), a `driver_login_tokens` row was created (7-day
   expiry).
7. `POST /admin/drivers/2/reject` → `200`. Independently `SELECT`ed: `status='rejected'`.
8. Re-fetched `GET /admin/drivers?status=pending` — correctly empty, both records moved out of the
   pending queue.
9. **Cleanup**: both test driver/vehicle/wallet/token rows deleted, both sets of R2 test objects
   deleted. Re-verified via `SELECT COUNT(*)` (all 4 tables at `0`) and a fresh R2 bucket listing
   (empty) — not just trusted because the delete calls returned success.

### WhatsApp magic-link send — code-reviewed only, not live-tested (James's choice)

Built against the same Meta Cloud API pattern as `fiji-chat-widget`'s `sendWhatsAppNotification`
(same endpoint shape, same request body), but implemented independently in this Worker — that file
was never touched. **`WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID` secrets are deliberately not set on this
Worker** — James chose to skip a live-fire test since the platform's token is already known broken
(Meta error 190), so there was no live evidence to gain from testing against a token everyone
already knows fails. The code correctly detects this and returns
`{"attempted": false, "reason": "WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not configured on this Worker."}`
rather than crashing — verified this fallback path structurally, not via a live Meta API call.
**No WhatsApp failures in this build trace back to a bug in this milestone's code** — there's
nothing to attribute yet, since a real send was never attempted. Once the platform token is fixed,
setting the same two secrets on this Worker and testing Approve is the natural next step.

### Pages Git connection — done by James via the dashboard OAuth flow

Confirmed via a direct API test that a Direct-Upload project's `source` can't be switched to Git via
the API alone (`"You cannot update the source object in a Direct Uploads project."`) — genuinely
needed the dashboard OAuth step. James connected it: repo `fiji-platform`, branch
`nadi-marketplace-phase1-staging`, output directory `nadi-marketplace/staging-site`, auto-deploy on
push. This README update's push is the first commit since that connection — should trigger the
first real deployment.

### Admin token

Generated fresh for this Worker, given to James directly (not committed to git, not in this file).

## Milestone 3 — driver PWA login, job feed, dispatch broadcast (spec Sections 4 & 6)

### Lesson applied from the WhatsApp investigation, not rediscovered

Both new WhatsApp sends (driver login link, booking broadcast) use `type: 'template'` from the
start — `sendWhatsAppTemplate()` replaces the old free-form-text `sendMagicLinkWhatsApp()` body.
Neither driver logins nor dispatch broadcasts have an open 24h customer-service window (the driver
hasn't messaged the business first), so free-form text would hit the exact silent-drop failure
diagnosed the same night. Two templates drafted for James to submit via WhatsApp Manager's UI (the
Graph API route is a confirmed dead end for this WABA — not retried):

**`vakaviti_driver_login`** (Utility, `en_US`) — `{{1}}` driver name, `{{2}}` login link.
**`vakaviti_booking_broadcast`** (Utility, `en_US`) — `{{1}}` pickup zone, `{{2}}` destination zone,
`{{3}}` vehicle type, `{{4}}` fare, `{{5}}` driver app link.

Neither is approved yet, so both sends currently error (or report "not configured" — this Worker
still doesn't have `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID` set, same as Milestone 2). That's expected,
not a bug — every other part of the pipeline (D1 state, atomic accept, job matching, broadcast
targeting) was verified independently of whether the WhatsApp send itself succeeds.

### What's built and verified — new endpoints on `nadi-dispatch-api`

- **`POST /driver/login`** — phone → generates a fresh `driver_login_tokens` row, attempts the
  template send. Always returns a generic message regardless of whether the number is registered
  (avoids confirming/denying which phones are drivers).
- **`GET /driver/me`**, **`POST /driver/online`** (toggle + zone reselection), **`GET /driver/jobs`**
  (pending bookings matching the driver's *online* zones, empty list with a note if offline).
- **`POST /driver/bookings/:id/accept`** — atomic
  `UPDATE ... WHERE assigned_driver_id IS NULL AND status = 'pending'`, `meta.changes` tells you if
  you won.
- **`POST /driver/bookings/:id/status`** — `en_route`/`completed`, ownership-checked
  (403 if the booking isn't yours) and transition-checked (409 on an invalid jump, e.g. re-sending
  `en_route` twice).
- **`POST /admin/test-booking`** — admin-only, inserts a real `bookings` row and broadcasts to every
  online + verified + zone-matching driver. Real guest-widget integration is still out of scope.
- Driver auth (`requireDriver()`) reuses the `driver_login_tokens` row itself as the bearer
  credential, valid until `expires_at` — no separate session system, per the Milestone 2 schema.

### Driver PWA (`staging-site/driver-app.html`)

Login screen (phone entry) → magic-link URL param consumed into `localStorage` → online/offline
toggle with zone multi-select → job feed → Accept → active-job panel with En Route/Completed
buttons. **A real bug found and fixed during verification**: the status-button rendering code used
`\\'` (double-backslash) instead of `\'` inside a JS string literal, which silently killed the
*entire* inline script (confirmed via `typeof init` → `undefined` in the live browser before the
fix) — the page rendered but nothing was interactive, no console error surfaced. Fixed by switching
to `addEventListener` instead of string-built `onclick` attributes, which also removes the
escaping hazard entirely rather than just patching this one instance.

### Real evidence — full loop, verified live against the real deployed Worker in a real browser

1. Two real test drivers inserted (`verified`, zone `Denarau`), real `driver_login_tokens` rows
   generated, both authenticated via `GET /driver/me`, both brought online via
   `POST /driver/online`.
2. **Race condition test — the one that actually matters**: fired two truly concurrent
   `POST /driver/bookings/1/accept` requests (one per driver, backgrounded shell processes, not
   sequential). Driver B: `200`, `won: true`. Driver A: `409`, `won: false`, with the `current`
   state shown to A already matching what B received. **Independently re-`SELECT`ed the booking
   row** — `assigned_driver_id = 2`, exactly one winner, no double-assignment.
3. Status flow: `accepted → en_route → completed`, ownership check confirmed (Driver A got `403`
   trying to touch Driver B's booking), invalid re-transition confirmed (`en_route → en_route` →
   `409`). Final state independently re-`SELECT`ed: `status = 'completed'`.
4. Full loop repeated in an actual browser against the live Worker: logged in via the magic-link
   token as a URL param, saw "Online" status persist, a second test booking appeared as a real job
   card, Accept → active-job panel rendered, En Route → Completed both worked, job feed correctly
   emptied at each stage. Screenshots not included here but every state transition was read back
   from the live DOM (`get_page_text`) and cross-checked against direct D1 queries.
5. **Cleanup**: both test bookings, both driver rows, both login tokens deleted. Re-verified via
   `SELECT COUNT(*)` — `drivers`, `vehicles`, `bookings`, `driver_login_tokens`, `wallets` all back
   to `0`.

### Deployed

Pushed to `nadi-marketplace-phase1-staging` — Pages auto-deploy (connected in Milestone 2) picks up
`staging-site/driver-app.html` automatically.

## Explicitly not built this milestone

Wallet view, commission accrual, max-hours cap (rest of spec Section 4), fuel index cron
(Section 7), guest widget fuel-price line (Section 8), real guest booking integration (still
manually-inserted test bookings), cutover (Section 9).

## Branch

`nadi-marketplace-phase1-staging` — not merged to `main`. Awaiting James's review.
