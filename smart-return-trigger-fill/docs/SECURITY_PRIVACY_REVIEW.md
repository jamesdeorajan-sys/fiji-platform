# Security / privacy review

Issue #54, branch `ceo/smart-return-trigger-fill-shadow`.

## PII posture: deliberately none in the ledger

The `movements` table (migrations/0001) has no name, email, phone number,
or physical address column. The only customer-linking fields are:

- `booking_reference` — opaque, meaningful only inside the storefront that
  issued it.
- `flight_number` — arguably semi-identifying in combination with a date,
  but standard for airport-transfer logistics and already visible to the
  operator today.

This was a deliberate scope choice, not an oversight, and it is the single
biggest **open question for CEO policy input** (see item 16 in
`CEO_RELEASE_REPORT.md`): ops-side WhatsApp coordination will eventually
need *some* way to reach the customer, and that detail has to live either
(a) only in the originating storefront's own system, looked up by
`booking_reference` when a human needs it, or (b) added to this ledger
later as an explicit, reviewed decision. Stage 1 assumes (a).

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
