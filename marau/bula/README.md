# bula/ — Bula Happiness isolated candidate (Issue #60)

**Status: isolated candidate. Nothing deployed, no migration applied anywhere, no real guest message, live credits/email/publishing OFF.**
The existing Marau build is preserved; the only edits to `worker/worker.js` are flag-gated/additive (see "Worker touch points").

## Layers
| File | Role |
|---|---|
| `migrations/0044_bula_outbox.sql`, `0045_bula_credit_inventory.sql` | **PROPOSED** additive migrations (kept out of `marau/migrations/` so no apply-all script picks them up) |
| `config.js` | every flag defaults OFF; names only, no secret values |
| `outbox_d1.js` | durable outbox: stable job keys, leases, ambiguity recovery, reconcile sweep, renderers, staff queue, capture sender |
| `inventory_credit.js` | persisted FJ$ credit ledger + inventory reservation; one D1 `batch()` per transition |
| `offers_d1.js` | staff-entered offers (CSV import -> drafts), two-person approval, 18:00 Fiji publisher, guest cards |
| `authority.js` | server-minted confirm/cancel authority (a browser/JSON object can never confirm) |
| `edition.js`, `money.js` | Fiji-time release rules (reuse `worker/fiji_time.js`), integer-cent maths |
| `hook.js` | thin Worker glue: enqueue on saved booking, admin-run dispatcher, `/version.json`, build indicator |
| `ledger.js`, `checkout.js`, `outbox.js`, `bula.test.mjs` | **superseded** in-memory reference model (history only) |
| `OFFER-ENTRY-TEMPLATE.csv`, `OFFER-ENTRY-GUIDE.md` | launch inventory entry |

## Atomicity model (why a conditional UPDATE alone is not used)
Inventory, credit, hold row and ledger rows move in ONE `db.batch()` (D1 batches are transactions). `CHECK` constraints
(`remaining >= 0`, balance parts `>= 0` and summing to `granted`) and a `bula_assert` guard (`changes() = 1` after each guarded
UPDATE) abort and roll back the whole batch if any guard misses. Release/expiry/cancel use SQL state guards + a `settled` flag so
they are exactly-once and crash-resumable (`sweepExpired`).
**Verified on SQLite (node:sqlite) incl. multi-process races. NOT yet verified on hosted D1** — `changes()` inside a D1 batch and CHECK-abort-rollback must be confirmed in hosted isolated acceptance.

## Flags (all default OFF) — kill switches
`BULA_OUTBOX_ENABLED`, `BULA_EMAIL_SEND_ENABLED` (no live sender exists), `BULA_CREDITS_ENABLED`, `BULA_CHECKOUT_ENABLED`, `BULA_EDITION_PUBLISH_ENABLED`, `BULA_SYNTHETIC_TEST`.
Settings: `BULA_WELCOME_CENTS` (default 50000 = FJ$500 synthetic), `BULA_CREDIT_TTL_MS`, `BULA_HOLD_TTL_MS`, `BULA_POLICY_VERSION`, `BULA_GUEST_ORIGIN`, `BULA_STAFF_INBOX`, `BULA_SUPPORT_WHATSAPP` + `BULA_SUPPORT_VERIFIED`, `BULA_BUILD`, `BULA_COMMIT`.

## Worker touch points (the whole diff to existing code)
1. import of `../bula/hook.js`; 2. flag-gated, try/caught `bulaOnSavedBooking` after a NEW booking row is saved; 3. admin-token route `POST /preview/bula/outbox/run`;
4. `GET /version.json` + build indicator in the app shell; 5. `cache-control: no-store` on JSON, `no-cache` on HTML.

## Rollback
Set the flags OFF (instant). Worker version rollback restores the previous code. Migrations are additive (new tables only): leave in place or `DROP TABLE bula_*` (data-destructive; do not run without an export).

## Run
`node --test bula/*.test.mjs` (54 + 3) · full: `NADI_REAL_WORKER_DIR=<checkout of ceo/nadi-booking-read-itinerary>/nadi-marketplace node --test test/*.test.mjs`

## M2 (isolated; unapplied; flags OFF)
- Identity: guest = bearer session only (party derived from the session); staff = admin credential **and** individual staff token → `bula_staff_roles` (migration 0046). Roles: ceo / approver / ops / editor (`ROLE_POLICY` in `offers_d1.js`). The CEO may self-approve only on an audited `offer_approved_ceo_self_approval` path.
- Instant confirmation requires an active, in-date, same-operator, in-scope row in `bula_operator_contracts`; authority is minted server-side, never from request fields.
- `capacity_unit` must match `pricing_basis` (person→seat, party→party, vehicle→vehicle); party/vehicle holds are qty 1.
- Booking mirror: `bula_booking_snapshots` (read-only, provenance, `not_in_source` for fields the source lacks — today passengers/luggage/add-ons/discount).
- Recovery: `recovery.js` sweep repairs missing snapshot/jobs/grant idempotently; guest email waits ≤ 15 min for the grant, then sends without any credit line.
- Screens: `/bula` (guest) and `/bula/staff`; `scheduled()` + `wrangler.bula.toml` crons (flags OFF). See `docs/BULA_HOSTED_ACCEPTANCE.md`, `docs/BULA_PHYSICAL_PHONE_CHECKLIST.md`.
- Dev: `node bula/dev_server.mjs 8799 [--clock-fiji=…]` (simulated clock is labelled), `node bula/mobile_journey.mjs …`.
