# Nadi Airport Transfers — Driver Marketplace (Phase 1)

Staging build. See `Nadi_Airport_Phase1-Build-Spec.md` for the full Phase 1 spec.

## Resources

| Resource | Name | ID | Notes |
|---|---|---|---|
| D1 database | `nadi-marketplace-db` | `0ec1cd84-fcda-4f7f-8337-0fb70fe1a512` | 11 tables (10 from spec Section 2 + `driver_login_tokens`, Milestone 2) |
| Worker | `nadi-dispatch-api` | — | `worker/worker.js` |
| Pages project | `nadi-marketplace-staging` | `466f9191-2a8c-474c-861f-d6433b8da2b9` | Created, content not yet deployed (see Milestone 2 notes) |
| R2 bucket | `nadi-marketplace-driver-docs` | — | **Not yet created — blocked on R2 being enabled account-wide, see below** |

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
  live: returns `401` with no/wrong token, `200` with the correct token (currently `[]`, no
  submissions possible yet without R2).
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

### Blocked: R2 bucket + end-to-end driver creation

**R2 is not enabled on this Cloudflare account at all** — this is an account-level toggle, not a
token permission gap (confirmed via a direct API call: `"Please enable R2 through the Cloudflare
Dashboard."`). **James: Cloudflare dashboard → R2 (left sidebar) → accept the R2 terms/enable it**
(free tier covers 10GB storage, unlikely to cost anything at this scale). Once done, tell Claude
Code and the bucket creation + binding + full end-to-end driver-submission test (real form → real
R2 objects → real `pending` D1 row) can happen immediately — everything else needed for it is
already built and waiting.

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

### Blocked: Pages content deployment needs a dashboard-only step

Confirmed via a direct API test that a Direct-Upload Pages project's `source` cannot be changed to a
GitHub connection via the API (`"You cannot update the source object in a Direct Uploads project."`)
— this requires Cloudflare's OAuth-based GitHub App flow, dashboard-only, same pattern already used
for `vakaviti-lagi-public` and `join.vakaviti.ai` elsewhere in this repo's history.

**James: exact steps —**
1. Cloudflare dashboard → Workers & Pages → `nadi-marketplace-staging`
2. Settings → Builds & deployments → **Connect to Git**
3. Authorize/select the `jamesdeorajan-sys/fiji-platform` GitHub repo (should already be
   authorized, same App used for `vakaviti-lagi-public`)
4. Production branch: **`nadi-marketplace-phase1-staging`** (not `main` — this is still a staging
   branch, not reviewed/merged yet)
5. Build output directory: **`nadi-marketplace/staging-site`**
6. No build command needed — plain static HTML/JS.

Once connected, every push to this branch will auto-deploy the join form and admin queue pages to
`nadi-marketplace-staging.pages.dev`.

### Admin token

Generated fresh for this Worker, given to James directly (not committed to git, not in this file).

## Explicitly not built this milestone

PWA job feed, accept button, dispatch broadcast (spec Section 4 core + 6), wallet view, max-hours
cap (Section 4), fuel index cron (Section 7), guest widget fuel-price line (Section 8), cutover
(Section 9).

## Branch

`nadi-marketplace-phase1-staging` — not merged to `main`. Awaiting James's review.
