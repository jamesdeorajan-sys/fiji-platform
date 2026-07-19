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

## Milestone 4 — wallet lockout, commission accrual, max-hours cap (spec Section 4 remainder)

### Before writing anything: verified the live schema, didn't assume it

Ran `PRAGMA table_info()` directly against the live `nadi-marketplace-db` for `drivers`, `wallets`,
and `wallet_transactions` before touching any migration. `wallets.balance_fjd` and
`wallet_transactions.amount_fjd`/`type` already existed from Milestone 1's schema, matching the
spec exactly — no `balance_cents` mismatch, no CREATE needed for either table. The only real gap:
nothing tracked the mandatory rest gap after a max-hours-cap forced-offline. Migration:
`migrations/milestone4-schema.sql` — `ALTER TABLE drivers ADD COLUMN forced_offline_until TEXT`,
plus three new `platform_settings` rows (`wallet_lockout_threshold_fjd=-150`,
`max_hours_rest_gap_hours=8`, `default_commission_rate=0.15` — all three confirmed with James
before writing the migration, not assumed). Applied via `wrangler d1 execute --remote`, verified
live afterward with an independent `SELECT`/`PRAGMA`, not just trusted because the apply command
reported success.

### What's built — new logic in `worker/worker.js`

- **`accrueCommission(env, booking)`** — called from `POST /driver/bookings/:id/status` only when a
  booking transitions to `completed` **and** `payment_method = 'cash'` (test plan Section 9 is
  explicit that only cash trips accrue wallet debt; prepay is Stripe/Phase 3, out of scope). Uses
  the booking's own `commission_rate` if set, else falls back to `platform_settings.
  default_commission_rate`. Writes the `wallet_transactions` row and the `wallets.balance_fjd`
  update in a single `env.DB.batch()` so a partial write can't happen.
- **`enforceWalletLockout(env, driverId)`** — reads the live `wallets` row (never a cached balance)
  and compares against `platform_settings.wallet_lockout_threshold_fjd`. Wired into both
  `POST /driver/online` (going online) and `POST /driver/bookings/:id/accept` — both return a real
  `403` with the current balance and threshold in the body, not a generic error.
- **`enforceMaxHoursCap(env)`** — finds every online driver whose current stint has reached
  `max_hours_cap`, forces them offline, and sets `forced_offline_until` using
  `platform_settings.max_hours_rest_gap_hours`. `POST /driver/online` checks this column and
  returns `403` with `resting_until` if a driver tries to go online before the gap has passed.
  Called from **both** the new `scheduled()` export (Cron Trigger, `*/15 * * * *`, added to a new
  `worker/wrangler.toml` — none existed before this milestone, previous deploys had no committed
  config) and a new admin-only `POST /admin/max-hours-sweep` endpoint — one shared implementation,
  not two that could drift apart. The admin endpoint doubles as a legitimate manual override, not
  just a test hook.

### Real evidence — every claim below independently re-checked via a direct D1 `SELECT`, not just trusted from an API response

1. **Commission accrual**: real test driver approved via the live `/admin/drivers/:id/approve`
   endpoint (wallet auto-created at `balance_fjd=0`), brought online, a real `$100 FJD` cash test
   booking created via `/admin/test-booking`, accepted, taken through `en_route → completed`. API
   response reported `commission_fjd: 15, new_balance_fjd: -15` (default 15% rate, since this test
   booking had no per-booking `commission_rate`) — independently `SELECT`ed both `wallets.balance_fjd`
   (`-15`) and the new `wallet_transactions` row (`amount_fjd: -15, type: 'commission_owed'`)
   directly, not just trusted the response body.
2. **Wallet lockout**: `wallets.balance_fjd` pushed to `-160` via a direct D1 `UPDATE` (past the
   `-150` threshold). `POST /driver/online` → real `403`, full response body:
   `{"error":"Wallet balance below the allowed threshold...","balance_fjd":-160,"threshold_fjd":-150}`.
   A second real booking created and `POST /driver/bookings/:id/accept` attempted while still locked
   out → also a real `403` with the same balance/threshold detail.
3. **Max-hours cap — logic correctness**: `drivers.online_since` set to 13 hours ago via direct D1
   `UPDATE` (`max_hours_cap` default is 12). Called `POST /admin/max-hours-sweep` →
   `forced_offline_driver_ids: [1]`. Independently `SELECT`ed the driver row:
   `online=0, online_since=NULL, forced_offline_until` set to exactly 8 hours after the sweep ran.
   Confirmed the rest-gap block works too: `POST /driver/online` while resting → real `403`,
   `{"error":"Resting after reaching your max-hours cap.","resting_until":"..."}`.
4. **Max-hours cap — the actual Cron Trigger, not just the function it calls**: reset the same
   driver back into an over-cap online state, then made **zero** further calls to the Worker and
   polled D1 directly every ~25 seconds for 12 minutes. The driver flipped to `online=0` at
   `13:30:09`, exactly on the `*/15 * * * *` boundary, with `forced_offline_until` correctly set —
   proof the real, deployed Cloudflare Cron Trigger fired on its own and invoked `scheduled()`
   correctly, not just that the underlying function works when called directly.
5. **Cleanup**: test driver, vehicle, wallet, wallet_transactions row, both test bookings, and the
   login token all deleted. Re-verified via `SELECT COUNT(*)` across all six affected tables —
   every one back to `0`, not just trusted because the delete statements reported success.

### Operational note

`ADMIN_TOKEN` was rotated during this milestone's testing (the original Milestone 2 token's value
was never committed anywhere and wasn't available to authenticate test calls) — a fresh token was
generated and set via `wrangler secret put`, given to James directly, not committed to git or this
file. Any tooling using the old admin token (e.g. `staging-site/admin-drivers.html` sessions) will
need the new one.

## Milestone 5 — driver wallet-view UI, fuel index automation (spec Section 7)

### Wallet-view UI (Section 4, left open from Milestone 4)

New `GET /driver/wallet` (worker.js) — balance, locked state (reusing Milestone 4's
`enforceWalletLockout` so the PWA and the accept/go-online gates can never disagree), and the 50
most recent `wallet_transactions` rows. `staging-site/driver-app.html` gets a Wallet button in the
topbar and a collapsible panel. Also surfaces the `403` body (`balance_fjd`/`resting_until`) as a
real alert on a failed go-online attempt instead of silently reverting the toggle with no
explanation.

Real evidence: real driver approved via the live admin API, real `wallet_transactions` rows
inserted directly in D1, pushed through the Pages auto-deploy pipeline (polled the live URL for the
new markup before testing — didn't assume push meant deployed), opened in an actual browser with
the driver's real login token, read the rendered DOM via `get_page_text` — showed the exact balance
and transaction rows from D1. Balance then pushed to `-$200` via direct D1 `UPDATE`, reloaded —
locked banner rendered with the real threshold value from the live API. All test data (driver,
wallet, 2 transactions, login token) deleted, re-verified at `0`.

### Fuel index automation (Section 7) — real research changed the design before any code was written

The spec assumes "Worker fetches FCCC petroleum page, parses latest price." Checked the actual live
page (`https://fccc.gov.fj/petroleum/`, resolves to `.../master-price-list/petroleum/`) before
writing anything: prices are not in a scrapeable table — each week's price is a legal-notice PDF
(`Petroleum Prices (No. N) Order YYYY`), and each PDF has **6 geographic schedules** × 4 fuel types
× Bulk/Drum sale × Retail/Wholesale columns. Downloaded and read the actual current PDF (LN 89/26,
No. 6 Order 2026) to confirm this — real text, not a scanned image, so parsing is technically
possible, but "which of ~48 numbers in this PDF is the fuel index" is a genuine ambiguity the spec
doesn't resolve. Stopped and confirmed with James before writing code: **Schedule 1** (Viti Levu,
within 3km of a public road — covers all 16 operating zones), **Gasoil (diesoline)**, **Retail**,
**Bulk Sale**; and — since building a PDF-parsing pipeline in a Worker with no build step is real
new complexity with real misparse risk on financial data — **detect-and-notify only**, not full
automated extraction. The Worker never asserts a price as fact; a human reads the PDF and submits
the number.

**Schema** (`migrations/milestone5-schema.sql`): `fuel_index` and `fuel_index_pending` already
existed (Milestone 1) but were verified empty on the live DB — no baseline existed to diff against.
Seeded `fuel_index` with the **real, current** figure read directly from the live PDF: Schedule 1,
Gasoil, Retail, Bulk Sale = **$3.39/L**, effective 1 July 2026 (source:
`https://fccc.gov.fj/wp-content/uploads/2026/06/LN-89-FCCC-Price-Control-Petroleum-Prices-No.-6-Order-2026.pdf`).
This is a one-time bootstrap of an empty table, not a "change" — the ≥5% confirm gate only applies
once a prior baseline exists. Also added `platform_settings.fuel_index_last_seen_order` (dedupes
weekly notifications for the same still-unconfirmed order) and `platform_settings.admin_alert_phone`
— left **empty deliberately**, since no real phone number for fuel alerts was given and guessing one
risks messaging the wrong real person; both `checkFuelIndexUpdate()` and the submit handler no-op
cleanly with a clear reason until it's set, same pattern as the unset `WHATSAPP_TOKEN`.

**What's built** — `worker/worker.js`:
- **`checkFuelIndexUpdate(env)`** — weekly Cron Trigger (`0 12 * * 6` = Saturday 12:00 UTC = Sunday
  00:00 Fiji time, added to `worker/wrangler.toml` alongside Milestone 4's `*/15 * * * *`;
  `scheduled()` now branches on `controller.cron`). Fetches the live FCCC page, regex-matches the
  first `Petroleum-Prices...pdf` link (confirmed via a real fetch that this is reliably the newest
  order — real HTML source order, not assumed), compares its filename against
  `fuel_index_last_seen_order`. On a new order: updates the setting and WhatsApps
  `admin_alert_phone` a link to the PDF asking them to read Schedule 1/Gasoil/Retail/Bulk and submit
  it. Never touches `fuel_index` or `fuel_index_pending` itself — no price is known at this stage.
- **`POST /admin/fuel-index/check`** — same function, callable on demand (same shared-implementation
  pattern as Milestone 4's max-hours sweep).
- **`POST /admin/fuel-index/submit`** — admin submits the number they read from the PDF. Computes %
  change vs the live `fuel_index` baseline, inserts a `fuel_index_pending` row (`status='pending'`),
  WhatsApps a summary with the confirm/reject endpoints. Does not touch live `fuel_index`.
- **`POST /admin/fuel-index/pending/:id/confirm`** — the actual state-changing action. This Worker
  has no inbound WhatsApp webhook (every template in this file only ever sends, never receives), so
  "WhatsApp CONFIRM" from the spec is this authenticated endpoint, not literal reply-text parsing —
  Section 5's "admin dashboard... pending changes awaiting confirm" is where a real CONFIRM button
  would eventually live. Writes a new `fuel_index` row (multiplier = price ÷ $3.93/L, the baseline
  referenced in `pricing_rules`'s own spec comment), flips the pending row to `confirmed`, increments
  `fuel_confirmed_accurate_count`. Idempotency-guarded (`409` on a second confirm).
- **`POST /admin/fuel-index/pending/:id/reject`** — flips to `rejected`, no `fuel_index` change.
- **`GET /fuel-index`** — public, read-only, the current live baseline. Built now since Section 8's
  guest-widget line (prepared, see below) needs it.

**Real evidence** — every step run against the actual live worker and the actual live FCCC
government site, not a mock:
1. `GET /fuel-index` → real seeded baseline (`$3.39/L`, `2026-07-01`).
2. `POST /admin/fuel-index/check` against production → correctly found `new_order: false` (matched
   the already-recorded No. 6 order). `platform_settings.fuel_index_last_seen_order` temporarily
   rewound to a fake older filename via direct D1 `UPDATE`, re-ran check → correctly detected
   `new_order: true` with the real PDF URL, self-healed the setting back to the real filename
   (independently re-`SELECT`ed to confirm) — and correctly did **not** attempt a WhatsApp send
   (`admin_alert_phone` unset), same graceful-no-op pattern as every prior WhatsApp integration here.
3. Submitted a real test change (`$3.39 → $3.60`) → API reported `percent_change: 6.19%`, matching
   manual calculation. Confirmed it → independently `SELECT`ed `fuel_index` (2 rows now),
   `fuel_index_pending.status = 'confirmed'`, `fuel_confirmed_accurate_count` incremented to `1`,
   and `GET /fuel-index` returned the new `$3.60` — real state change, not just an API claim.
   Re-confirming the same pending row → real `409`.
4. Submitted a second test change (`$3.39 → $4.50`, 25%) and rejected it → independently confirmed
   `fuel_index` stayed at 2 rows (the reject never touched it) and `GET /fuel-index` still returned
   `$3.60`, not `$4.50`.
5. **Cleanup — this one mattered more than usual**: the confirmed test row was a *fake* price
   ($3.60) that had become the live baseline, not incidental test data. Deleted `fuel_index` id 2,
   both `fuel_index_pending` test rows, and reset `fuel_confirmed_accurate_count` back to `0` (the
   increment was from this test, not a real confirmed cycle). Re-verified via direct `SELECT` and
   `GET /fuel-index` — back to the real `$3.39` baseline, exactly as before testing started.

### Guest widget line (Section 8) — prepared, not deployed

See `section8-guest-widget-fuel-line.md` — this touches the live `ftt-booking-site` repo, not
`nadi-marketplace`, and per instruction is explicitly held back from actual deployment.
`ftt-booking-site/` confirmed untouched via `git status` before and after.

## Section 9 — full test plan, each item run individually with real evidence

All 8 items from the spec, run this session. Full clean-slate confirmed before starting
(`drivers`/`bookings`/`wallets` all `0`).

**1. Full guest booking flow, all currencies, matches existing widget exactly — not live-tested;
reported honestly rather than faked.** Testing this for real means submitting an actual booking
through the live nadiairporttransfers.com/fijitourtransfers.com widget — the same class of action
that created a real, unintended live WooCommerce order in a past session (`docs/BUILD.md`, the
`sentinel_errors` test from the "checkout payment failed" investigation). Nothing in Phase 1 has
touched this flow — confirmed via `git diff --stat main..nadi-marketplace-phase1-staging --
ftt-booking-site/` returning empty (zero lines changed) — so "matches the existing widget exactly"
is trivially true by construction, not something a fresh live test would add confidence to. Did not
risk a real booking to re-prove a byte-for-byte no-op.

**2. Driver signup → admin approve → PWA login, real end-to-end — PASS.** Real multipart join-form
submission (real JPEGs) → `201`. Independently fetched the actual signed R2 doc URL — `200`, 286
bytes, exact match to the uploaded file (not just trusted the admin-list response). Approved via the
real `/admin/drivers/:id/approve` endpoint. Retrieved the real login token from D1, opened
`driver-app` in an actual browser with it — rendered "Test Driver S9", logged in, against the real
deployed Worker and Pages site.

**3. Broadcast dispatch, race-condition claim — PASS, no regression from Milestone 4's lockout
check.** Two real verified drivers, both brought online (confirmed the lockout gate added in
Milestone 4 doesn't false-positive block a fresh $0-balance driver). Real test booking broadcast to
both (`matched_drivers: 2`). Fired truly concurrent `accept` requests (backgrounded, not sequential).
Exactly one winner — independently re-`SELECT`ed the booking row, `assigned_driver_id = 1`, no
double-assignment.

**4. Wallet accrues commission debt on cash-marked completed trip — PASS.** Same booking taken
`accepted → en_route → completed` (cash, $80). API reported `commission_fjd: 12` (15% default rate).
Independently `SELECT`ed `wallets.balance_fjd = -12` and the `wallet_transactions` row
(`amount_fjd: -12, type: 'commission_owed'`) directly.

**5. Wallet lockout triggers past the negative threshold — PASS.** Same driver's balance pushed to
`-155` via direct D1 `UPDATE`. `POST /driver/online` → real `403`,
`{"balance_fjd":-155,"threshold_fjd":-150}` in the body, not a generic error.

**6. Fuel index pending → confirm → live pricing updates, and only after confirm — PASS, both
directions checked.** Submitted a real test change (`$3.39 → $3.55`, 4.7%) — re-checked
`GET /fuel-index` immediately after: still `$3.39`, confirming an unconfirmed submission cannot leak
into live pricing. Confirmed the pending row — re-checked `GET /fuel-index` again: now `$3.55`,
confirming the confirm action is what actually applies it. Test data (the fake `$3.55` row) deleted
immediately after, re-verified `GET /fuel-index` back to the real `$3.39` baseline.

**7. Existing production data/flow untouched throughout — PASS.** `git diff --stat` between `main`
(correctly fetched — an earlier stale local `main` ref briefly made this look wrong; re-fetched and
re-ran against the real `origin/main`) and this branch, scoped to every production path
(`workers/`, `ftt-booking-site/`, `vakaviti-root/`, `vakaviti/`, `pages/`, `partners/`,
`microsites/`) — zero changes. The only diff anywhere near "production" is `docs/BUILD.md` /
`docs/VAKAVITI-BRAIN.md`, and that's `main` having advanced independently since this branch forked
(confirmed the docs-touching commits on this branch all predate Milestone 1's first commit) — not
anything this build did. `workers/chat-widget/worker.js` specifically: zero commits touching it
anywhere in this branch's own history.

**8. Rollback — precondition verified; the literal traffic-revert test doesn't apply yet.** No
cutover has happened, so there is no live traffic currently pointing at `nadi-marketplace` to roll
back from — reported honestly rather than simulating a test that can't meaningfully run pre-cutover.
What **is** verified, directly via the Cloudflare API (`wrangler pages project list`): the
`nadi-marketplace-staging` Pages project's only domains are `nadi-marketplace-staging.pages.dev` and
`driver.vakaviti.ai`; the separate `nadiairporttransfers` project's domains are
`nadiairporttransfers.com`/`www.nadiairporttransfers.com`/`fttlandingpage.pages.dev` — zero overlap.
If `nadi-marketplace-staging` were disabled entirely right now, it would have zero effect on live
guest traffic, because nothing currently routes through it. The real rollback drill (disable staging
mid-cutover, confirm zero guest-visible disruption) is only meaningful after cutover happens, which
per instruction hasn't and won't without explicit sign-off.

### Cleanup

All Section 9 test data (2 drivers, 2 vehicles, 1 booking, wallets, wallet_transactions, login
tokens, 1 fuel_index_pending test row, 1 fuel_index test row) deleted. Re-verified via direct
`SELECT COUNT(*)` — all six driver/booking-related tables at `0`, `fuel_index` back to exactly 1 row
(the real seeded baseline).

## Milestone 6 — public `POST /bookings` (the missing piece cutover-plan.md flagged)

**Building this does not authorize cutover.** It's the endpoint an eventual updated guest widget
would call — cutover itself (pointing the live widget at it) is still James's separate, explicit
sign-off, per instruction. `ftt-booking-site/` was not touched (confirmed below).

### Schema (`migrations/milestone6-schema.sql`)

Verified live `bookings` schema via `PRAGMA` first — no `source_ip` or rate-limit tracking existed
(this is the first public, unauthenticated write endpoint on this Worker; every other write endpoint
is admin- or driver-token-gated, so nothing needed this before). `ALTER TABLE bookings ADD COLUMN
source_ip TEXT`, plus `platform_settings.guest_booking_rate_limit_max=5` and
`guest_booking_rate_limit_window_minutes=10` — configurable without a redeploy, same pattern as
every other tunable in this build.

### What's built — `worker/worker.js`

- **`broadcastBookingToDrivers(env, booking)`** — extracted from `handleAdminTestBooking`'s inline
  broadcast loop so both it and the new public endpoint share one implementation of "who gets
  notified," not two that could drift apart.
- **`POST /bookings`** — public, no admin token. Two trust-boundary decisions, made deliberately
  because this is the first anonymous-caller write endpoint here:
  1. **`settlement_amount_fjd` and `fuel_multiplier_applied` are always server-derived, never taken
     from the request body.** Both feed directly into `accrueCommission()` once a trip completes —
     trusting client-supplied values here would let any anonymous caller manipulate a real driver's
     wallet debt. `quoted_amount`/`fx_rate_at_booking` are still caller-supplied (this endpoint
     doesn't compute fares — `pricing_rules` is still empty/unbuilt, Section 3/6, unchanged scope —
     same trust level `admin-test-booking` already had for those two fields), but
     `settlement_amount_fjd` is computed from them server-side rather than accepted as-is, and
     `fuel_multiplier_applied` is read from the live `fuel_index` table, never the client.
  2. **IP-based rate limit** (`checkGuestBookingRateLimit`) — D1-backed sliding window using the new
     `source_ip` column, no new binding needed. **Exactly what this covers and doesn't, stated
     plainly**: covers a single scripted client hammering the endpoint from one IP. Does **not**
     cover distributed abuse from many IPs, a determined attacker rotating IPs, or anything at
     Cloudflare's own edge/bot-management layer (unconfigured, separate from this). This is app-level
     spam friction, not a security boundary.
  3. Field validation: `guest_phone` required, `vehicle_type`/`payment_method` whitelisted,
     `quoted_currency` must be a 3-letter code, `quoted_amount` bounded (0, 5000], `distance_km`
     bounded [0, 500] if provided, `pickup_zone`/`destination_zone` must exist in the real `zones`
     table (same check `admin-test-booking` and the driver join form already use).

### Real evidence — every claim independently re-checked, not trusted from an API response

1. Real test driver joined (real multipart, real R2 photos), approved, brought online.
2. **Submitted a real booking through `POST /bookings` with zero `Authorization` header at all** —
   real `201`, `settlement_amount_fjd: 90` (= `quoted_amount 90 × fx_rate 1`, matches manual
   calculation), `fuel_multiplier_applied: 1` (matched the live `fuel_index` baseline at the time,
   independently checked via `GET /fuel-index` immediately before), `source_ip` populated with the
   real calling IP. Independently `SELECT`ed the `bookings` row directly — same values, not just
   trusted the response body. `broadcast.matched_drivers: 1` — the online test driver was correctly
   notified.
3. Driver's `GET /driver/jobs` showed the real guest-submitted booking; `POST
   /driver/bookings/:id/accept` → real `won: true` — confirming a guest-created booking flows through
   the exact same, already-tested Milestone 3 accept logic without any special-casing.
4. Validation: an unknown `pickup_zone` and an absurd `quoted_amount` (999999) both → real `400` with
   the specific `errors` array, not a generic failure.
5. **Rate limit — tested for real, not just code-reviewed**: temporarily lowered
   `guest_booking_rate_limit_max` to `2` via direct D1 `UPDATE` for a fast, deterministic test (rather
   than making 5 real submissions to hit the real default). 2nd submission from the same IP → `201`.
   3rd → real `429`, `"Too many booking submissions from this connection..."`. Independently
   `SELECT`ed `COUNT(*) FROM bookings WHERE source_ip = '<real IP>'` — exactly `2`, matching the
   threshold that triggered the block. Restored `guest_booking_rate_limit_max` back to the real
   default of `5` immediately after.
6. **Cleanup**: driver, vehicle, both test bookings (the accepted one + the rate-limit-test one),
   wallet, login token all deleted. Re-verified via `SELECT COUNT(*)` — all six affected tables at
   `0`.

### Protected files — confirmed untouched, against the real `origin/main`

`git diff --stat main..nadi-marketplace-phase1-staging -- ftt-booking-site/` and
`-- workers/chat-widget/` both returned empty. Re-fetched `origin/main` fresh before this check
(same lesson from Section 9 item 7 — a stale local `main` ref will make this check lie).

### Still open (not blockers for this task, flagged as instructed)

- ~~`platform_settings.admin_alert_phone` is still empty~~ — set to `+61478886145` in a later session,
  confirmed via a real `SELECT`, and confirmed both `checkFuelIndexUpdate()` and
  `handleAdminFuelIndexSubmit()` read it live at call time (no code change needed).
- Cutover authorization itself is undecided — this endpoint existing doesn't change that; it's still
  a separate, explicit sign-off whenever James is ready.
- `cutover-plan.md`'s step 2 (deciding whether the WhatsApp-handoff stays as a fallback once
  `app.js` is wired to this endpoint) is a real product decision, not made here — this milestone only
  built the endpoint side.

## Operational update — WHATSAPP_TOKEN / WHATSAPP_PHONE_ID set, real delivery confirmed

The gap that had blocked every WhatsApp send on this branch since Milestone 2 is closed.
`WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` were deliberately never set on this Worker until now —
copying `fiji-chat-widget`'s values wasn't possible (Cloudflare secrets are write-only; `wrangler
secret list` confirmed the same binding *names* exist there but values are never retrievable by
anyone, including James) and would have broken this build's stated zero-shared-secrets guarantee
anyway. James generated a fresh, dedicated Meta System User token via Meta Business Suite (same App
ID `1700903951357623`, same scopes as the one already working on `fiji-chat-widget`) specifically for
`nadi-dispatch-api`, and provided both values directly for `wrangler secret put` — neither was ever
committed to git or written to `wrangler.toml`.

**Real evidence:** re-triggered `vakaviti_driver_return` (`POST /driver/login`) and
`vakaviti_driver_welcome` (`POST /admin/drivers/:id/approve`) against a real test driver — both
returned real `200`s with real WAMIDs from the Graph API. Per the standing discipline on this build, a
`200` isn't treated as delivery proof — James checked his own phone and provided a real screenshot:
both messages arrived, with `vakaviti_driver_welcome`'s `{{1}}` correctly substituted with the real
submitted driver name ("WhatsApp Delivery Test"). Real finding surfaced by that screenshot: messages
arrived from **+1 (555) 641-4099**, not +61 478 886 145 — phone ID `1134456946416024` is bound to
Meta's WhatsApp test/sandbox number for this WABA, not the +61 number referenced elsewhere in the
spec's architecture notes. Worth knowing before assuming the sender identity on a future real send.
Test driver, vehicle, wallet, and login token deleted afterward, re-verified at `0`.

**This test-number finding is now tracked as a hard cutover precondition, not just a note** — see
`docs/BUILD.md`'s "Known Limitation: Test WABA Number" section for the full writeup (why this is
fine for driver-side testing now but not guest-facing cutover, and the exact action required before
then), and item 2 of `cutover-plan.md`'s precondition list, alongside the booking-endpoint work from
Milestone 6.

## Branch

`nadi-marketplace-phase1-staging` — not merged to `main`. Awaiting James's review.
