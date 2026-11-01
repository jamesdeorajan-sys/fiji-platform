# Bula Happiness — hosted D1 acceptance plan (NEW isolated synthetic database)

**Status: NOT RUN. Nothing has been created, deployed or migrated.** Local SQLite evidence (node:sqlite) does not prove hosted D1 behaviour; this plan is how that gap is closed.

## What the hosted run must prove (and the local evidence that does not substitute)
1. **Races**: 12 simultaneous guests on a 3-seat offer → exactly 3 holds, 9 `sold_out`, remaining never < 0 (local: multi-process SQLite only).
2. **CHECK / `changes()` rollback**: a zero-row guarded UPDATE inside `db.batch()` rolls the whole batch back (the `bula_assert` pattern). D1's batch atomicity and `changes()` semantics must be observed, not assumed.
3. **Fault recovery**: an interrupted request mid-reserve leaves no half hold; `sweepExpired` settles it exactly once.
4. **Lease interruption**: outbox job left `sending` → `ambiguous`, never blind-resent (capture sender only; no live sender exists).
5. **Cutoff / replay**: pre-cutover bookings are never enqueued; idempotent re-run of every sweep.
6. **Cron**: `0 6 * * *` fires the publisher at 18:00 Fiji; `*/15` catch-up is idempotent.
7. Cross-party and forged-staff refusals over real HTTPS.

`bula/hosted_acceptance.mjs` automates 1, 7 and the idempotency/credit/cancel checks (self-tested locally against `bula/dev_server.mjs`; 11/11 pass locally — **local only**). Items 2–5 need a hosted-only fault harness (a debug route that throws between batch statements, enabled only on this Worker) — not yet written; it is the next step once the database exists.

## Provisioning permissions needed (James / Cloudflare account owner)
Scoped to account `595101df…`, **new resources only**:
- D1: *create* a database named `bula-acceptance-synthetic-1`, and edit (query/migrate) **that database only**.
- Workers Scripts: *edit* for a **new** Worker `marau-bula-acceptance` (deploy, cron triggers, secrets). No routes, no custom domains, no zone/DNS access.
- A fresh API token with exactly those two scopes, short-lived (≤7 days), not shared with any other preview. The connected Cloudflare tool in this session can list and query D1 but its create scope is unverified; if it cannot create, James runs the two commands below or grants the token.
No KV/R2/Queues/Email Routing/Zero Trust are needed.

## Commands (run only after approval; ordered)
```
wrangler d1 create bula-acceptance-synthetic-1          # paste the NEW id into wrangler.bula.toml
# migrations in this exact order (shared engine 0001-0006, marau 0007-0043, bula 0044-0046):
wrangler d1 migrations apply bula-acceptance-synthetic-1 --remote -c wrangler.bula.toml   # after pointing each migrations_dir in turn
printf '%s' "$(openssl rand -hex 32)" | wrangler secret put MARAU_ADMIN_TEST_TOKEN -c wrangler.bula.toml
wrangler deploy -c wrangler.bula.toml
BASE=https://marau-bula-acceptance.<subdomain>.workers.dev ADMIN=<that secret> SERVICE_DATE=<Fiji date> BOOKING_CUTOFF="<date> HH:MM" node bula/hosted_acceptance.mjs
```
Migration numbering was checked: no remote branch holds Marau migrations ≥ 0044; `0044–0046` are proposed and unapplied anywhere.

## Hosted capture design (synthetic only, short-lived, redacted)
- Guests: `@example.invalid` emails and `+1500555xxxx` numbers only; refs prefixed `acc…`; created by the script, never imported.
- Email: capture sender only (no provider). Evidence output contains booking refs, states, counts and HTTP statuses — **no tokens, no addresses**.
- Credentials: fresh random admin secret unique to this Worker; staff tokens `stf_<run>-<role>` generated per run; none reused from public history; the secret is deleted and the Worker/database removed (by James) after acceptance.
- Flags: all OFF in `wrangler.bula.toml`; the run enables only the flags it needs via `wrangler deploy --var`, then returns them to OFF.

## Not claimed
Hosted D1 behaviour, real cron firing, or any physical-device behaviour. Only what the evidence file shows will be reported as hosted.
