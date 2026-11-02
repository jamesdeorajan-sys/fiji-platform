# 4. Email path — prepared, tested, NOT wired, NOT active, nothing sent

## Architecture (reuses the already-tested outbox; adds one module)
`bula/email_provider.js` (new, **imported by nothing**, so the release bundle is unchanged) plugs into the existing `bula_outbox` dispatcher:
| Requirement | How |
|---|---|
| independent feature flag | `BULA_EMAIL_SEND_ENABLED` (already exists, default off) — separate from outbox/source flags; wiring selects the live sender only when it is on |
| idempotent send | job key (`source_event|recipient|template_version`, UNIQUE in D1) is the provider `Idempotency-Key`; one job → one lease → one send; ambiguous outcomes are **never** auto-resent |
| booking/reference correlation | outbox row keeps `booking_ref`, `session_id`, `job_key`, `provider_id`; header `X-Bula-Ref` = job key |
| delivery status | `provider_accepted_at` (acceptance only) vs `delivered_at` / `bounced_at` set **only** from an HMAC-verified provider webhook (`verifyWebhook` + `applyDeliveryEvent`; first evidence kept) |
| retry policy | failures retry on the 15-min cron up to `outboxMaxAttempts` (5), then stay `failed` for staff; 429 = retry; 4xx = permanent code, visible; 5xx / no response = **ambiguous → human**, no resend |
| failure visibility | staff queue (existing) + `EMAIL_*` health alerts (06) + `[bula][email]` log events (codes only) |
| no duplicate emails | proven: repeat dispatch, reconcile without provider lookup, concurrent leases, 503/timeout |
| restricted test destination | `mode: 'test'` **cannot be constructed without an allow-list** and refuses any other recipient *before* any network call; going `live` needs `BULA_EMAIL_MODE=live` as a deliberate change |
| no guest data in logs | errors/logs are codes + a 12-hex tag of the job key; tests assert no address, subject, link/token or API key appears |
| no real send during build | provider `fetch` is injected in tests; no provider exists or was contacted |

## Tests (`bula/m5_email_provider.test.mjs`, 11/11 in the real repo; wiring `m5_wiring.test.mjs` 5/5 in an unapplied copy; full suite on that copy 588/588)
construction fails closed; allow-list only; request shape; outcome mapping; no leaks; real dispatcher integration (one provider call per job over 3 runs); non-allow-listed guest is failed not sent; no duplicates under 503/timeout and reconcile; webhook signature/delivery/bounce; health check.

## Wiring (UNAPPLIED): `wiring/hook-wiring.UNAPPLIED.diff` (40 lines, `hook.js` only)
Selects the live sender when `BULA_EMAIL_SEND_ENABLED` is on and fails closed to the disabled sender on any config fault, and runs the health check from the cron. Applying it changes the Worker bundle ⇒ it becomes a **new candidate that needs its own gate**; it is deliberately not applied so `1343f866…` stays the exact release candidate.

## Provider/config required (CEO decision)
- A transactional provider with: HTTPS JSON API + bearer key; `Idempotency-Key` support; signed webhooks (delivered/bounced); a verified sending domain (SPF, DKIM, DMARC) under a Vakaviti/Bula address. The module's payload is `{from,to[],subject,text}` (Resend-style); other providers need a ~20-line request adapter.
- Cloudflare-first option: Cloudflare's own email sending, if enabled on James's account. Plain Email Routing `send_email` can only reach *verified destinations*, which suits the CEO test-send but **not** guests.
- Config to create (names only): `BULA_EMAIL_ENDPOINT`, `BULA_EMAIL_API_KEY` (secret), `BULA_EMAIL_FROM`, `BULA_EMAIL_MODE=test`, `BULA_EMAIL_TEST_ALLOWLIST=<CEO address>`, webhook secret.

## Exact test-send plan (for CEO approval; NOT run)
1. Provider + domain verified by James; secret set on `vakaviti-bula-prod` (never in chat).
2. Apply the wiring diff as a new candidate; full suite + gate; deploy to **the acceptance Worker only**.
3. On the acceptance Worker set `BULA_EMAIL_SEND_ENABLED=on`, `MODE=test`, allow-list = CEO address; keep source flags per hosted source step (synthetic booking whose guest email is the CEO address).
4. Expect exactly 2 emails (guest receipt + staff copy) to the CEO address; run the dispatcher 3× — still 2; check `provider_id`, accepted state, webhook delivered evidence; a synthetic guest email *not* on the list must show `failed RECIPIENT_NOT_ALLOWED` with zero provider calls.
5. Abort if any message goes elsewhere, any duplicate, or any token/address in logs. Then set the flag off.
**Production sending: OFF.**
