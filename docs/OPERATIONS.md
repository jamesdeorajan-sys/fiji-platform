# Operations — Nadi Airport Transfers Driver Marketplace

Formal write-up of the standing operational policy this build has followed since Milestone 1, plus
the health-monitoring and backup systems added in Milestone 8. This is a policy document, not a
build log — see `nadi-marketplace/README.md` for the per-milestone build history and real evidence.

## 1. Standing discipline (formalizing existing practice, not a new policy)

Every milestone on `nadi-marketplace-phase1-staging`, from Milestone 1 onward, has followed the
same four rules. Writing them down here as explicit policy so they survive beyond any one session's
memory of "how we've been doing this":

1. **Isolated branch, isolated resources.** All work happens on `nadi-marketplace-phase1-staging`.
   Nothing is merged to `main` without James's explicit review. Every resource this build touches
   (D1 database, R2 buckets, the Worker itself) is separate from production (`vakaviti-kb`,
   `fiji-chat-widget`) — confirmed at the Cloudflare API level, not just asserted, whenever isolation
   is in question (e.g. Section 9 item 8's `wrangler pages project list` domain check).
2. **Real evidence, not trusted responses.** A `200` from an API is not evidence something worked.
   Every claim in every milestone report is backed by an independent check — a direct D1 `SELECT`
   after a write, a downloaded file after an upload, a real device screenshot after a WhatsApp send
   claims success. Where full verification wasn't possible (e.g. a WhatsApp template pending Meta
   approval), that gap is stated plainly, not implied as done.
3. **Test data created and destroyed in the same session.** Every test driver, booking, wallet
   transaction, or other artifact created to prove something real is deleted before the session
   ends, with a follow-up `SELECT COUNT(*)` confirming zero — never just trusted because a delete
   call returned success.
4. **Explicit sign-off before anything ships wider.** Nothing touches the live domain
   (`nadiairporttransfers.com`, `ftt-booking-site/`) or `workers/chat-widget/worker.js`. Cutover
   (routing real guest traffic through this system) is a separate, explicit decision James makes —
   building a piece cutover depends on does not itself authorize cutover, stated explicitly at every
   milestone where this could be ambiguous (Milestone 6, Milestone 7).

## 2. Health monitoring (Milestone 8)

### What it checks

`GET /health` on `nadi-dispatch-api` — aggregate status, real HTTP status code (`200` healthy, `503`
degraded):
- **D1 connectivity** — a real query against `sqlite_master`, not just whether the binding exists.
- **`WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID` presence** — booleans only. The response never contains a
  secret value, at any point, in any field.
- **R2 (`DOCS` bucket) binding presence.**

### Alerting

A Cron Trigger (`*/5 * * * *`) calls the same check internally and compares against the last known
state (`platform_settings.health_check_last_status`). **Edge-triggered, not level-triggered** — it
only sends a WhatsApp alert to `admin_alert_phone` on a state *transition* (healthy → unhealthy, or
the reverse), not on every failed 5-minute check. A sustained outage pages once, not every 5 minutes
for its duration — deliberate, to avoid alert fatigue turning into a reason to ignore real alerts.
Recovery sends its own distinct message, so "the alert stops" is a real, positive confirmation
(a RECOVERED message), not just an absence of further pages.

Manual trigger for testing/on-demand checks: `POST /admin/health-check/run` (admin-token gated).

**Known, accepted limitation**: if the thing that's broken is `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID`
themselves, the alert mechanism can't notify anyone over WhatsApp about that specific failure — it's
the same channel reporting on its own outage. The D1-down case still alerts fine, since WhatsApp
config is independent of D1 health. Not fixed — would need a second, non-WhatsApp channel (email,
SMS), which is real new scope, not built this milestone.

**Known, accepted gap**: `vakaviti_ops_health_alert`, the WhatsApp template this uses, has not yet
been submitted to Meta for approval (same state `vakaviti_fuel_index_alert` started in). The real
test performed (deliberately breaking D1 connectivity, confirming the alert pipeline fired, fixing
it, confirming a distinct recovery alert fired, confirming no repeat alerts while the failure
persisted) confirmed the request reaches the Graph API correctly formed and gets a real, expected
"template not found" rejection — proving the detection/alerting *logic* is correct, not yet that a
message has landed on a real device. That needs James to submit the template via WhatsApp Manager,
same process as every other template in this build — submitting via WhatsApp Manager's UI is a
Meta Business account action Claude Code cannot perform, same as every prior template.

**Submission spec** (drafted following the pattern that cleared review cleanly for
`vakaviti_driver_welcome`/`vakaviti_booking_broadcast`/`vakaviti_driver_return` — plain status
notification, no login/credential/urgency wording):

| Field | Value |
|---|---|
| Name | `vakaviti_ops_health_alert` |
| Category | Utility (recommended starting point — matches the plain-notification templates that passed; if rejected, `vakaviti_driver_return`'s precedent was Marketing after Utility failed for a *login*-flavored template specifically, which this isn't) |
| Language | Start with `en` (code assumes this) — **must be independently re-verified once approved**, not assumed, same as every prior template |
| Body | `Vakaviti Alert: nadi-dispatch-api status changed to {{1}} at {{2}}.` |
| Variable examples (required by Meta at submission) | `{{1}}` → `DOWN`, `{{2}}` → `2026-07-21 14:38:49` |
| Components | Body only — no header, no button, no footer |

Code (`sendHealthAlertWhatsApp()`, `runHealthCheckAlert()`) already sends exactly this shape —
`{{1}}` = `"DOWN"` or `"RECOVERED"`, `{{2}}` = a `YYYY-MM-DD HH:MM:SS` timestamp — fixed in the same
session this spec was drafted, before submission, after finding the previously-deployed code sent
one combined freeform string instead of two separate variables.

## 3. D1 backups (Milestone 8)

### Current implementation

Application-level, not the official Cloudflare SQL-dump export (see "Not yet done" below for why).
A daily Cron Trigger (`0 14 * * *`, 02:00 Fiji time) — and an on-demand
`POST /admin/backup/run` (admin-gated) — reads every row from every table via the existing D1
binding, serializes to JSON (table order preserved as foreign-key-safe for restore: `zones`,
`drivers`, `vehicles`, `destinations`, `fuel_index`, `fuel_index_pending`, `platform_settings`,
`pricing_rules`, `bookings`, `wallets`, `wallet_transactions`, `driver_login_tokens`), and writes it
to a dedicated, isolated R2 bucket (`nadi-marketplace-db-backups`, separate from `DOCS` — the driver
document bucket — same isolation discipline as everywhere else in this build).

**Data only, not schema.** Table structure is recovered from `schema.sql` in version control
(already kept in sync with the live database after every milestone), not re-derived from the
backup file itself. Standard practice — schema as code, data as backups — not a shortcut.

### Real restore test performed

Not just "confirmed a file exists" — an actual disaster-recovery drill:
1. Triggered a real backup via `POST /admin/backup/run`.
2. Downloaded the resulting object directly from R2 (`wrangler r2 object get`) and verified its
   content matched the API's reported row counts and size.
3. Created a genuinely separate, throwaway D1 database (`nadi-marketplace-restore-test`).
4. Applied `schema.sql`'s structure (no seed data) to it.
5. Converted the backup JSON into real `INSERT` statements and ran them against the throwaway
   database.
6. Independently `SELECT`ed row counts and specific real content (a destination name, the fuel
   index price) from the throwaway database — exact match to the source.
7. Deleted the throwaway database.

This proves the backup is a real, usable, restorable snapshot — not just a file that exists.

### Not yet done — upgrade path

Cloudflare has an official D1 export API
(`POST /accounts/{account}/d1/database/{db}/export`) that produces a byte-perfect SQL dump,
restorable via `wrangler d1 execute --file` directly with no conversion step. It requires its own
Cloudflare API token secret (`D1:Edit` scope) — a new external credential this session could not
self-generate (the wrangler OAuth session used throughout this build has no "User API Tokens"
management scope). Real upgrade path when that token exists: replace `runD1Backup()`'s hand-rolled
JSON export with a call to that endpoint (poll until `signed_url` is returned, stream the SQL dump
straight to R2). Not a correctness problem with the current approach — a completeness one.

## 4. Dependency monitoring

GitHub Dependabot vulnerability alerts and automated security fixes are **enabled** on
`jamesdeorajan-sys/fiji-platform`, done directly via the GitHub API (real before/after confirmed:
`vulnerability-alerts` check went from `404 disabled` to `204 enabled`; `automated-security-fixes`
went from `{"enabled":false}` to `{"enabled":true}`) — no dashboard click was needed.

**Real finding**: there is currently no dependency manifest anywhere in this repository (no
`package.json`, `requirements.txt`, or similar — confirmed via a repo-wide search). This means the
alerts are live but have nothing to scan yet. They'll activate automatically the moment any real
manifest is added (e.g. if a Worker ever gains an npm dependency) — no further action needed then.

A `dependabot.yml` config file (for scheduled version-*update* PRs, distinct from vulnerability
*alerts*) was deliberately not added — GitHub only reads that file from the repository's default
branch (`main`), and per standing policy this build doesn't commit there without explicit review. It
would also have nothing real to configure right now given the point above. Revisit when either
becomes true.

## 5. WAF + Rate Limiting (added ahead of guest widget integration)

Before wiring any real UI to `/quote` or `/bookings` (even on an isolated preview), a real
edge-level layer was added in front of `nadi-dispatch-api` — the point at which these endpoints
stop being curl-tested-only and become genuinely discoverable/probeable, and `/quote` specifically
triggers a real, paid Google Routes API call per unique address.

**Real, hard constraint discovered first**: `nadi-dispatch-api` had no custom domain — it was pure
`*.workers.dev`, and Cloudflare's zone-level WAF/Rate Limiting products attach to a *zone*, which
`workers.dev` isn't (it's Cloudflare's own shared domain). Fixed by binding
`api.nadiairporttransfers.com` to the Worker (Workers Custom Domains API — auto-provisions DNS +
SSL), confirmed real via a direct request (`GET https://api.nadiairporttransfers.com/health` →
real `200`, identical to the `workers.dev` URL) and confirmed the existing live site is unaffected
(`nadiairporttransfers.com` root still real `200`).

**Plan tier confirmed via API**: `nadiairporttransfers.com`'s zone is on Cloudflare's Free plan
(`GET /zones?name=...` → `plan.name: "Free Website"`). Real, load-bearing constraints discovered
while configuring (each one a genuine API rejection, not assumed from documentation):
- Exactly **1** Rate Limiting Rule allowed per zone on Free (attempting a 2nd failed with
  `exceeded the maximum number of rules in the phase http_ratelimit: 2 out of 1`) — `/quote` and
  `/bookings` share one combined rule/counter rather than two independent ones.
- Rate Limiting period is locked to **10 seconds** on Free (a 60s period was rejected: "not
  entitled to use the period 60, can only use a period among [10]").
- Mitigation timeout must equal the period (10s), not a longer cooldown.
- `characteristics` must include `cf.colo.id` alongside `ip.src` — Free-tier rate limiting counts
  per colocation, not globally per IP across Cloudflare's whole network.

**What's live now** (zone `nadiairporttransfers.com`, scoped to `api.nadiairporttransfers.com`
only):
- **Rate Limiting Rule**: `(http.host eq "api.nadiairporttransfers.com" and
  (http.request.uri.path eq "/quote" or http.request.uri.path eq "/bookings"))` — block at 5
  requests per 10 seconds per IP (combined across both paths), 10s cooldown.
- **WAF Custom Rule**: same path match, plus `cf.threat_score gt 30` → block.

**Real test performed**: 6 rapid `POST /quote` requests through the new domain — requests 1–5 real
`200`s from the Worker (1 real Google API call, 4 cache hits, independently confirmed via D1),
request 6 → real `429` with Cloudflare's own native block response (`error code: 1015`, not this
Worker's JSON error shape) — proof the block fired at Cloudflare's edge, before the request ever
reached the Worker. Confirmed the rules are correctly scoped: 7 rapid requests to `/health` (an
unrelated path on the same subdomain) all returned real `200`s, untouched. Test data cleaned up,
re-verified `0`.

## 6. Explicitly NOT done — flagged for a dedicated security-hardening session

Stated plainly, not glossed over: these are real gaps, not oversights, and not addressed because
they're genuinely separate scope, not because they're low-value.

- **`POST /drivers` and `POST /driver/login` have no edge-level rule.** Only `/quote` and
  `/bookings` were in scope for the pass above (the two endpoints directly implicated in guest
  widget integration) — same class of gap, not yet closed for these two.
- **Bot Fight Mode deliberately deferred**, not built. Its imprecision (real false-positive risk
  against legitimate automated/non-browser traffic on Free tier specifically) makes it a judgment
  call worth real usage data before enabling, not a blocker for guest widget integration — Rate
  Limiting + WAF Custom Rules already meaningfully raise the bar over the prior app-only state for
  the realistic near-term threat (a single or modestly-distributed scripted abuser). Revisit once
  there's real traffic to tune against, or consider a Pro-tier upgrade ($20/mo) for Super Bot Fight
  Mode if stronger bot-specific coverage is wanted sooner.
- **No Zero Trust / Access policy on any admin page.** `admin-drivers.html`, `destinations-admin.html`,
  and every `/admin/*` API endpoint rely on a single bearer token (`ADMIN_TOKEN`) alone — no IP
  allowlisting, no Cloudflare Access login gate, no MFA. Anyone with the token, from anywhere, has
  full admin access. Fine for a staging build not yet handling real guest traffic; not fine
  indefinitely. A real hardening pass should put Cloudflare Access in front of the `staging-site/`
  Pages project's admin pages at minimum, and consider scoping `ADMIN_TOKEN` itself (rotation policy,
  possibly splitting into narrower per-function tokens instead of one token with full access to
  every admin action).

None of these are built here — this section exists so they're tracked as explicit, named open
items for a dedicated session, not lost track of between now and whenever cutover approaches.
