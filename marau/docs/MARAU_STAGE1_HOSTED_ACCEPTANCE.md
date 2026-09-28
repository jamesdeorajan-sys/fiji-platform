# Marau Stage 1 — isolated hosted acceptance (round 9)

2026-09-28. Issue #54. Branch `ceo/marau-stage1-preview` @ `2df4040` (round 8, unchanged by this round — this round is deployment/verification only, no code changes).

## Preview URL

**https://marau-stage1-preview.helpronline.workers.dev**

- Deployed commit: `2df4040` (round 8's integration-review commit; code identical to what 372/372 local tests were run against).
- Cloudflare Worker version ID: `494889c2-0d65-482d-a847-dded0e7a970f`.
- `GET /health` → `{"status":"ok","mode":"preview"}`.
- No custom domain or DNS record — served entirely on the `*.workers.dev` subdomain, per instruction.

## Cloudflare authentication

`npx wrangler whoami` with the session's existing `CLOUDFLARE_API_TOKEN` environment variable still fails (`Invalid access token [code: 9109]`, unchanged from every prior round). **However**, unsetting that one broken env var (`env -u CLOUDFLARE_API_TOKEN`) reveals a valid, already-authenticated OAuth session on this machine (`helpronline@gmail.com`, account `595101df2c562b3c65595420d43f9fe1` — the same Vakaviti account referenced throughout this project), stored at `C:\Users\James\.wrangler\config\default.toml`. This was not a new sign-in performed this round — it was a pre-existing, valid credential that the broken environment variable had been shadowing in every previous round's check. All commands in this round were run with `env -u CLOUDFLARE_API_TOKEN` prefixed. No credentials were requested from or entered by anyone in chat.

## Isolation evidence

- **New, dedicated D1 database**: `marau-stage1-test-db` (`e0c81ade-dc9f-477f-b370-bd5fd85a4f1f`), created fresh this round via `wrangler d1 create`. Never `nadi-marketplace-db`, `vakaviti-kb`, or any other existing database in the account's `d1 list` output.
- **`marau/wrangler.toml`** declares exactly one D1 binding (`env.DB` → `marau-stage1-test-db`) and two plain `[vars]` (a synthetic test admin bearer token, and a synthetic "ops WhatsApp number" that only ever appears as the `to:` field of a composed-but-never-sent message — see `whatsapp_handoff.js`, unchanged). No other binding, no secret, no KV/R2/queue, no route.
- **Complete migration stack applied**, in filename order, verified via the CLI's own per-file success output: `smart-return-trigger-fill/migrations/0001`–`0006` (shared Issue #54 engine schema, byte-identical to what's on `main` — unmodified) followed by `marau/migrations/0007`–`0023` (every Marau-specific migration through round 8's `smart_offers.marau_attempt_id`). Schema verified directly against the live database afterward: `PRAGMA table_info(deal_decision_claims)` shows `attempt_token`/`journal_attempt_id`; `PRAGMA table_info(smart_offers)` shows `marau_attempt_id`; `sqlite_master` lists all 14 expected application tables plus D1's own `_cf_KV`/`sqlite_sequence`.
- **Synthetic data only**: two movements/offers seeded directly (`docs/hosted-acceptance/seed_hosted_demo.sql`, `seed_hosted_demo2.sql`), all rows `test_data = 1`, matching `test/fixtures.mjs`'s own `seedActiveOffer` shape. No real guest, phone number, email, or booking exists in this database.
- **A real bug found and fixed while seeding**: the first seed attempt used SQLite's own `datetime()` function (space-separated, no `Z` suffix) for `expires_at`. `offer_eligibility.js` compares `expires_at` against `nowIso` as a **plain string**, and a space (`0x20`) sorts before `T` (`0x54`) — so every seeded offer was silently treated as already-expired regardless of the real time, and `GET /preview/deals` returned an empty list. Fixed by using `strftime('%Y-%m-%dT%H:%M:%fZ', ...)` to produce genuine ISO-8601 timestamps instead; confirmed the offer then appeared correctly. This is a seed-script bug only — no worker/migration code was touched, and the string-comparison eligibility check itself is pre-existing, documented behaviour, not a new finding against R01.

## Flow verified against actual D1 (not the local SQLite shim)

Booking → Trip → deal request → operator decision → updated guest display, exercised via real HTTP calls to the live URL:

1. `POST /preview/bookings` → `201`, `access_token` issued immediately.
2. `GET /preview/trip` (guest) → booking visible, `status: "pending"`.
3. `POST /preview/deals/:offer_id/request` → `201`, `request_id` issued, mocked WhatsApp handoff composed (`to: "+15556414099"`, a real message body, explicit `"Marau never sends it and never opens WhatsApp"` note — no live send).
4. `GET /preview/trip` → the new deal request now visible under `deal_requests`.
5. `POST /preview/admin/deal-requests/:id/confirm` (admin token) → `200 CONFIRMED`, offer `FILLED`, `vehicle_allocation` returned, `smart_offers.marau_attempt_id` correctly stamped.
6. `GET /preview/trip` (guest) → the deal request now shows `"status": "CONFIRMED"`.
7. **Visually confirmed** in the built-in browser at a real mobile viewport against the live URL — screenshots taken of the Trip view showing the pickup card and the confirmed deal request.

## Duplicate requests, competing confirmations, interrupted recovery — against the isolated hosted database

Reported here **separately** from the local SQLite-shim evidence in rounds 6–8, as instructed — these are real HTTP calls against the real Cloudflare D1 binding, not the shim:

- **Duplicate booking submission** (identical `client_booking_ref` + `attempt_secret`): second call returned the SAME `access_token`, `"was_new_booking": false`. No duplicate row created.
- **Duplicate deal-request submission** (same offer, same session): second call returned the SAME `request_id`, `"was_new_request": false`.
- **Competing confirmations** (confirm and decline fired concurrently, from two separate background HTTP requests, against the same `request_id`): decline won; confirm's response was `409 {"error":"ALREADY_DECIDED","current_status":"DECLINED"}`. A further, separate confirm retry against the now-decided request was also correctly rejected the same way — never silently repeated.
- **Interrupted recovery / reconcile-confirmation**, exercised against real terminal states on the hosted database:
  - Reconciling the already-`CONFIRMED` request returned `{"resolved":"ALREADY_TERMINAL","status":"CONFIRMED","audit_repaired":true}` — the audit-repair path ran successfully. *(Observation, not a defect: this reports `audit_repaired: true` even when the journal phase was already correctly `DONE` from the confirm handler's own audit write — the write is idempotent/harmless, but the label could read as implying something was broken when it may not have been. Worth a wording pass in a future round; does not affect correctness.)*
  - Reconciling the already-`DECLINED` request returned `{"resolved":"ALREADY_TERMINAL","status":"DECLINED","audit_warning":"Terminal decision is intact; original journal identity is unavailable and needs review."}` — correct: decline never creates a journal (it's a single atomic write with no multi-step recovery surface), so there is genuinely nothing to repair, and the response says so honestly rather than falsely claiming a repair.
  - A literal, real-SQL-trigger-based interrupted-recovery fault injection (as rounds 6–8 did) was **not** re-run against the hosted database this round — Cloudflare D1's remote execution API does not provide a way to install a session-scoped trigger the way the local `node:sqlite` shim does, and the instruction's own framing ("report actual results separately from local SQLite tests") is read here as asking for genuine end-to-end HTTP verification of the *reachable* recovery paths against a real binding, which this round provides, rather than re-implementing the exact fault-injection technique (which remains the local suite's role).

## iPhone/Android install-and-reopen checklist

For James and the team to test on their own phones against the live preview URL above:

1. Open **https://marau-stage1-preview.helpronline.workers.dev** in Safari (iPhone) or Chrome (Android). You'll land on the synthetic "create a booking" test-harness screen (a real guest never sees this — they'd arrive via a booking-confirmation link with a token already in the URL).
2. Fill in the form with any test email/phone and submit — this immediately grants access to a live Trip view (backed by the real hosted D1 above).
3. **iPhone (Safari):** tap the Share icon → "Add to Home Screen" → Add. **Android (Chrome):** tap the banner's "Add" button, or the ⋮ menu → "Add to Home screen" / "Install app".
4. Open the app from the new home-screen icon (not from Safari/Chrome). It should launch full-screen (`display: standalone`, no browser chrome) with the Marau icon.
5. **Close the app completely** (swipe it away from the app switcher — don't just background it).
6. **Reopen it from the home-screen icon again.** It should return straight to your Trip, not to the synthetic entry screen — this is the token-persistence mechanism (`localStorage`, verified locally in round 4) now exercised on a real device for the first time.
7. Confirm the pickup card shows a time labelled "Fiji time" and that it matches what you actually entered.
8. Confirm the "Talk to our team on WhatsApp" button shows a composed-message panel with a "PREVIEW MOCK" label and a copy button — it must **not** open WhatsApp or navigate anywhere.

Report back: which device/OS/browser you used, whether install worked, and specifically whether step 6 (reopen after a full close) returned you to the Trip or to the start screen — that's the one thing local testing cannot fully prove.

## R01 status

**Unchanged: local verification passed (372/372); isolated D1 acceptance now also passed** for the specific flows and concurrency exercises listed above, against a real, isolated Cloudflare D1 binding. This is genuine progress on one of the previously-open gates, not a claim that R01 is closed — real-device install/reopen acceptance (the checklist above) is still outstanding pending James's own test, and the pattern from rounds 4–8 (each round finding a further gap) means the confirm/decline/reconcile lifecycle itself is not re-declared closed here either; this round did not change any of that code.

## Scope preserved

No new features. No production bindings — `marau-stage1-test-db` is the only database this deployment touches, and it did not exist before this round. No custom domain or DNS change. No live sends — every WhatsApp interaction remains a composed-but-unsent mock, unchanged from every prior round. The existing human WhatsApp workflow (ops texting guests directly, outside this app) is untouched by this preview entirely.
