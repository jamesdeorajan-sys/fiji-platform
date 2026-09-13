# Security / privacy review

Issue #54, branch `ceo/smart-return-trigger-fill-shadow`.

## PII posture: no direct PII, enforced in code (updated 2026-09-13)

The `movements` table (migrations/0001, 0006) has no name, email, phone
number, or physical address column. Per the CEO's 2026-09-13 decision, the
customer-linking fields are:

- `booking_reference` — opaque, meaningful only inside the storefront that
  issued it.
- `booking_contact_ref` (migrations/0006) — nullable, opaque pointer back
  to the originating storefront's own secure booking/customer record.
  Never a name, phone number, email, or WhatsApp number.
- `flight_number` — arguably semi-identifying in combination with a date,
  but standard for airport-transfer logistics and already visible to the
  operator today.

This is enforced by code, not just convention: `model.js#normalizeMovementInput`
throws a `ValidationError` if the raw ingestion payload carries any of
`customer_name`, `name`, `first_name`, `last_name`, `customer_email`,
`email`, `customer_phone`, `phone`, `phone_number`, `mobile`,
`whatsapp_number`, or `whatsapp` — ingestion is rejected outright, not
silently stripped. `booking_contact_ref` itself is additionally rejected
if it looks like an email address or phone number (regex check), as a
defense-in-depth measure against someone stuffing PII into the "opaque
ref" field by mistake. See `test/pii_guard.test.js`.

Reaching an actual customer (e.g. for a WhatsApp match/hold conversation)
is assumed to happen by looking `booking_contact_ref` (or
`booking_reference`) up in the originating storefront's own system — this
subsystem is never the place that PII lives.

## Synthetic data discipline

Every fixture in `test/fixtures/synthetic_movements.js` and every row built
in a test carries `test_data: true`. `model.js#normalizeMovementInput`
**requires** `test_data` to be explicitly `true` or `false` — there is no
default, so a caller cannot accidentally ingest a real-looking row without
consciously tagging it.

## No outbound network calls anywhere in this branch

- `src/whatsapp_cards.js` builds a string. It does not call `fetch`,
  `wa.me`, or any Meta/WhatsApp API.
- `src/matcher.js`, `src/pricing.js`, `src/offers.js`, `src/board.js` are
  pure functions over in-memory data.
- `src/db.js#createD1Store` is the only file that would talk to
  infrastructure, and nothing calls it in this branch.

## Least-privilege note for Stage 2

When a real D1 binding is eventually wired (`env.SMART_RETURN_DB`), scope
its Cloudflare Pages/Workers binding to only the worker(s) that need it —
not a broad account-wide D1 credential — and do not reuse the production
booking database's binding for this shadow-mode ledger, so a bug here can't
touch a real booking table.

## Atomic-write safety (see CEO_RELEASE_REPORT.md for detail)

- Movement ingestion is idempotent via a `UNIQUE` constraint on
  `idempotency_key` (`INSERT OR IGNORE`, memory-store equivalent in
  `db.js#insertMovementIfNew`).
- Offer status transitions are single conditional `UPDATE ... WHERE status
  = ?` statements (`db.js#casOfferStatus`), so two concurrent requests for
  the same offer can only ever have one succeed.

## What this review does NOT cover

- Authentication/authorization for whoever eventually calls these
  functions from a real HTTP endpoint — no endpoint exists yet in this
  branch (the 7-day board is a plain function, `src/board.js`, not an
  exposed route).
- Rate limiting / abuse protection — not applicable until there's a real
  endpoint.
