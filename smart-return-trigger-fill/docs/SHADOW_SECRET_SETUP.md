# SMART_RETURN_SHADOW_SECRET — server-side injection requirements

This document is instructions only. **No secret value is generated, printed,
committed, or exposed anywhere in this repository or by any script in
`smart-return-trigger-fill/`.**

## What it's for

`src/production_adapter.js`'s `computeOpaqueBookingRef()` uses this secret as
an HMAC-SHA-256 key to turn a real `bookings.id` into an opaque, non-reversible
reference (`sr_...`) before it ever appears in a movement, a shadow report, or
any log. Without a real key, the adapter fails closed
(`SHADOW_SECRET_NOT_CONFIGURED`) rather than falling back to an unkeyed hash or
a hardcoded value — see `production_adapter.js`'s own header for the full
rationale, and `test/production_adapter.test.js` for the fail-closed tests.

## Requirements for the real value

- **Generate it with a real CSPRNG**, at least 32 bytes (256 bits) — e.g.
  `openssl rand -base64 32` run locally by whoever holds it, or
  `crypto.getRandomValues(new Uint8Array(32))` in a one-off Node/browser
  console session. Never derive it from anything guessable (a booking id, a
  date, a project name).
- **Never commit it.** Not to this repo, not to a `.env` file that gets
  committed, not to a Slack message, not to this document, not to a CEO
  report. It exists only in the secret stores below.
- **Never let this module print or return it.** `computeOpaqueBookingRef()`
  and `mapConfirmedBookingToMovementInput()` only ever return the *derived*
  `shadowRef` — confirmed by test, never the key itself.
- **Rotating it changes every future opaque ref.** That's expected and safe
  (idempotency is per-run, keyed to whatever secret was active at ingest
  time) — but if a real shadow ledger is ever persisted across runs (Stage 2,
  `createD1Store`), rotating the secret means new refs won't match old ones
  for the same booking. Not a concern for Stage 1's in-memory, single-run
  shadow reports.

## Where it should live

**Local / Node shadow runs (this branch, Stage 1):**
Set it as a real environment variable in the shell that runs
`scripts/live_shadow_report.js`, never in a checked-in file:

```bash
export SMART_RETURN_SHADOW_SECRET="$(openssl rand -base64 32)"
node scripts/live_shadow_report.js --input path/to/confirmed_bookings.json
```

The CLI reads only `process.env.SMART_RETURN_SHADOW_SECRET` — see
`scripts/live_shadow_report.js`. If it's unset and there are rows to
evaluate, the script refuses to run (`process.exit(1)` with a clear message)
rather than proceeding unkeyed.

**Stage 2 / Cloudflare Worker (not wired up in this branch — `createD1Store`
exists but is never invoked here):**
Use a real Wrangler secret, never a `vars` entry in `wrangler.toml` (`vars`
are plaintext in the deployed bundle; `secret`s are encrypted at rest and
never appear in `wrangler.toml` or a dashboard variable list):

```bash
npx wrangler secret put SMART_RETURN_SHADOW_SECRET
# paste the real value when prompted — never as a command-line argument
# (shell history) and never as a --var flag
```

The Worker would then read it as `env.SMART_RETURN_SHADOW_SECRET` (raw
string or bytes, matching what `computeOpaqueBookingRef`'s
`normalizeKeyBytes()` already accepts) and pass it through the same
`shadowSecret` option this module already exposes — no adapter code change
needed to move from Node/env-var to Worker/Wrangler-secret, only the
injection point changes.

## Fail-closed guarantees already tested

- `computeOpaqueBookingRef(booking, sourceSite, null | undefined | '')` → `null`
- `mapConfirmedBookingToMovementInput(..., { shadowSecret: undefined })` → `{ ok: false, reason: 'SHADOW_SECRET_NOT_CONFIGURED' }`
- `runLiveShadowReport(rows, { shadowSecret: undefined })` with `rows.length > 0` → throws before evaluating anything
- No fallback path exists anywhere in this module that produces a ref without a real key — confirmed by reading the full source, not just the tests.

## What to do if the secret is ever suspected to have leaked

Treat it like any other credential: rotate it (generate a new one, update
wherever it's injected), and be aware every `shadowRef` computed since the
leak is derived from the compromised key and should be considered
reversible by whoever has it (a leaked key + the real `bookings` table lets
someone recompute `computeOpaqueBookingRef` forward for any booking id and
match it against a leaked report — the opaque ref only protects against
someone who does NOT have the key).
