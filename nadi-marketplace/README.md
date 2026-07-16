# Nadi Airport Transfers — Driver Marketplace (Phase 1, Milestone 1)

Staging skeleton only. See `Nadi_Airport_Phase1-Build-Spec.md` for the full Phase 1 spec — this
milestone builds infrastructure only (spec sections 1-2), not sections 3-9.

## What this milestone built

| Resource | Name | ID | Notes |
|---|---|---|---|
| D1 database | `nadi-marketplace-db` | `0ec1cd84-fcda-4f7f-8337-0fb70fe1a512` | 10 tables, schema verbatim from spec Section 2 |
| Worker | `nadi-dispatch-api` | — | `worker/worker.js`, `/health` endpoint only |
| Pages project | `nadi-marketplace-staging` | `466f9191-2a8c-474c-861f-d6433b8da2b9` | Created, not yet content-deployed (see below) |

## Isolation — confirmed, zero shared state with production

- Separate D1 database from `vakaviti-kb` (`e697a253-e5fc-4201-939c-9aaeca6c5278`) — different UUID,
  different name, created fresh this milestone.
- Separate Worker script from `fiji-chat-widget` — `nadi-dispatch-api` has exactly one binding
  (`DB` → `nadi-marketplace-db`). No KV, no Vectorize, no AI, no shared secrets.
- Separate Pages project from `nadiairporttransfers.com`'s existing project — not touched, not
  referenced anywhere in this build.
- No route, custom domain, or DNS record points at any of this milestone's resources. Reachable only
  via `nadi-dispatch-api.<subdomain>.workers.dev` and `nadi-marketplace-staging.pages.dev`.
- `workers/chat-widget/worker.js` was not opened or modified in this milestone.

## Schema verification

All 10 tables (`drivers`, `vehicles`, `zones`, `fuel_index`, `fuel_index_pending`,
`platform_settings`, `pricing_rules`, `bookings`, `wallets`, `wallet_transactions`) created and
verified live via `PRAGMA table_info()` against the real D1 database — exact column list matches
spec Section 2. `platform_settings` seeded with `fuel_auto_apply = 'false'` and
`fuel_confirmed_accurate_count = '0'`, confirmed via `SELECT`.

## `nadi-dispatch-api` — what it does today

Health-check only:

```
GET /health
```

Returns whether the D1 binding is live and lists the real tables it can see — this is how schema
connectivity was proven end-to-end, not just "migration ran successfully." No dispatch, booking,
onboarding, or fuel-index logic exists yet — those are explicitly out of scope for this milestone
(spec sections 3-9).

## Pages project — content not yet deployed

`nadi-marketplace-staging` exists as a real Cloudflare Pages project but has no deployment yet.
Cloudflare's direct-upload API requires a content-hashing scheme normally handled by `wrangler pages
deploy`, which wasn't available in this build's environment. Wiring real content in (via GitHub
connection in the dashboard, or `wrangler` once available) is a natural first step of the next
milestone (driver PWA / admin dashboard), not required by this one.

## Explicitly not built this milestone

Driver onboarding form, PWA, admin dashboard, dispatch/broadcast logic, fuel index cron, any change
to the live guest widget, cutover. See spec sections 3-9.

## Branch

`nadi-marketplace-phase1-staging` — not merged to `main`. Awaiting James's review.
