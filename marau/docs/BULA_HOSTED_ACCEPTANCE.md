# Bula Happiness — hosted acceptance runbook (isolated synthetic candidate)

Resources (the ONLY ones created/changed): D1 `bula-acceptance-synthetic-1` (id in `wrangler.bula.toml`) and Worker `marau-bula-acceptance` (workers.dev only; no routes, DNS or custom domains). Existing Marau previews and production are untouched.

## Three different credentials — never confused
1. **Cloudflare deployment credential**: the wrangler login (OAuth) already on James's PC, or the connected Cloudflare connector. A new API token is requested only if both prove insufficient. Cloudflare API tokens cannot be scoped to a Worker/database that does not exist yet; a token limited to *Workers Scripts:Edit + D1:Edit on this account* is the narrowest available, and is not requested at all unless needed.
2. **App admin secret** `MARAU_ADMIN_TEST_TOKEN`: generated with `crypto.randomBytes(32)` by `bula/ops/run_acceptance.mjs`, stored at `~/.bula-acceptance/secrets.json` (mode 0600, outside any repo), pushed to Cloudflare through wrangler **stdin** (never argv/env/chat/GitHub).
3. **Per-staff tokens** (ceo / ops / approver): random 256-bit, same file; they are bootstrapped through the admin secret and are the only way to act as a named person.
The phone link/QR is written only to local files on James's PC; evidence output is redacted (no tokens, no addresses).

## Run (one command, on the PC where wrangler is logged in)
`node run_acceptance.mjs <bundleDir> all` = prepare secrets → apply ordered schema to the NEW database only → deploy → run `hosted_acceptance.mjs` → write `evidence.json`.
Steps can be run singly: `prepare | schema | deploy | accept | lockdown`.

## What the hosted run proves
- **SQL-level rollback**: with `BULA_FAULT_HARNESS=on`, a request header (valid only with the harness key) replaces statement *k* of the D1 batch by SQL that genuinely fails, for **every** position of the reserve, confirm and cancel batches; stock, credit and holds must be unchanged. A JS throw is not used.
- **Lost response** is separate: server commits, reply is replaced by 504, retry must replay.
- 12-way race on 3 seats; 6-way idempotent retry; parallel cancels; ownership and forged-staff refusal; role enforcement; cutoff before/after; **cron** publishing an approved offer with no request calling the publisher (`*/15`). The 06:00 UTC (18:00 Fiji) firing itself is observed only on the next real 18:00 and is reported separately.
- Independent DB-side verification through the Cloudflare connector (table/row counts, invariants).
Not exercised hosted: outbox lease interruption (no provider/capture sender can exist in a deployed Worker; covered locally only) — stated, not claimed.

## Flags (acceptance configuration, exactly)
ON: SYNTHETIC_TEST, CHECKOUT, CREDITS, EDITION_PUBLISH, FAULT_HARNESS. OFF: OUTBOX, EMAIL_SEND. `BULA_SYNTHETIC_TEST` no longer enables any feature by itself (tested: synthetic on + all feature flags off is inert, including `scheduled()`). `lockdown` redeploys with every feature flag and the harness OFF.

## After acceptance
Order: phone testing → evidence collected → `lockdown` (flags off, harness off) → rotate/revoke the secrets file → only then, with James's separate approval, scoped cleanup (delete Worker, then database). Nothing is torn down before then.

## Installed Home Screen app (device pairing)
iOS gives a Home Screen app its own storage, so it never has the Safari link. `BULA_DEVICE_PAIRING=on` (acceptance only; `lockdown` turns it off) enables a one-time connect code: Safari (or staff via `run_acceptance.mjs . pair`) issues an 8-character code (10 minutes, single use, stored hashed); the installed app redeems it once and receives its own 256-bit device key (stored hashed, 30-day expiry, individually revocable, void when the guest session is revoked). The key resolves to the SAME guest: same party and wallet, no second guest or credit grant. Migration `0047` (three small tables) is applied by `resume`/`all`/`migrate` only if its tables are absent, only to the isolated database. The manifest remains static (`start_url=/bula`, no credential).
