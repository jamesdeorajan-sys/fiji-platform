# Vakaviti Marketplace Stage 1 — Recovery Checkpoint

This document is the rebuild procedure for Stage 1 if the Worker, D1 database, or both disappeared.
It is written so the application can be recreated from Git plus a secure runtime backup, without
relying on chat history, local scratch files, or undocumented Cloudflare dashboard state.

## Git

- Repository: `jamesdeorajan-sys/fiji-platform`
- Branch: `ceo/vakaviti-marketplace-stage1`
- Application root: `apps/vakaviti-marketplace-stage1`

## Cloudflare Worker

- Worker name: `vakaviti-marketplace-stage1`
- Required bindings (declared in `wrangler.toml`):
  - `DB` — D1 binding
  - `AI` — Workers AI binding
  - `ENVIRONMENT` — plain text var, value `preview`
- Required secret (set separately, never committed):
  - `ADMIN_TOKEN` — gates every `/api/admin/*` route. Value is never stored anywhere in Git, and this document never records it.

## D1

- Database name: `vakaviti-marketplace-stage1-db`
- Database ID (current instance): `f2753057-4319-404d-bcda-84cccd288fe1`
- A fresh rebuild will get a **new** database ID from Cloudflare — update `wrangler.toml`'s `database_id` to match before deploying. Do not assume the old ID will exist again.

### Canonical schema initialization sequence

Run in this exact order against a new, empty preview D1 database (this is what `package.json`'s `db:migrate:remote` script does):

1. `schema.sql` — base tables: `operators`, `products`, `offers`, `evidence`, `claims`, `bookings`
2. `migrations/0002_candidates.sql` — `candidate_operators`, `candidate_sources`, `candidate_claims`, `review_actions`
3. `migrations/002_ai_orchestration.sql` — `ai_jobs`, `human_gates`, `provider_copilot_sessions`, `ai_suggestions` (depends on `operators` existing from step 1)
4. `migrations/0003_product_candidates.sql` — `product_candidates`, `verification_readiness`, `transport_candidates`
5. `migrations/0004_revenue_mvp.sql` — adds `image_url` to `operators` and `products`, creates `enquiries`

All statements across all five files are `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / additive `ALTER TABLE ADD COLUMN` — safe to re-run, no drops.

## Workers AI

- Current model: `@cf/meta/llama-3.1-8b-instruct-fp8`
- The shared model constant lives in `src/ai.ts` as `export const DEFAULT_MODEL`. `src/products.ts` imports it from there — there is intentionally only one place this string is defined, to avoid the exact bug fixed earlier (a duplicated hardcoded model string in `products.ts` going stale independently).

## Build

- Install: `npm install`
- Typecheck: `npm run typecheck` (runs `tsc -p tsconfig.json`)
- Wrangler dry run / config validation: `npm run validate:config` (`wrangler deploy --dry-run --outdir .wrangler-dry-run`)
- Deploy mechanism: Cloudflare Workers Builds, connected via Git integration to this repository/branch. A push to `ceo/vakaviti-marketplace-stage1` under `apps/vakaviti-marketplace-stage1/**` triggers `.github/workflows/vakaviti-marketplace-stage1-ci.yml` (typecheck + config validation) and, separately, Cloudflare's own Workers Build (`wrangler deploy` from the app root).
- Application root for all commands: `apps/vakaviti-marketplace-stage1`

## Isolation

Two unrelated Cloudflare Pages projects share this GitHub repository and, by default, watch every branch/path:
`nadi-marketplace-staging` and `vakaviti-lagi-public`. Both have a Pages **Build watch paths → Exclude paths** entry (set on both their Production and Preview environments) of:

```
apps/vakaviti-marketplace-stage1/*
```

This is a Cloudflare Pages dashboard setting, not something in this repo's files — if either project is ever recreated or its settings reset, this exclusion must be re-added manually in the Cloudflare dashboard (Pages project → Settings → Build watch paths, for both the Production and Preview environment selector states) or isolation will silently regress and every Stage 1 push will trigger builds on those unrelated projects again. Verified empirically: pushes to this branch produce Cloudflare deployment records for both projects with `is_skipped: true, skip_reason: "path_config"`.

## Public Preview

Current preview URL: `https://vakaviti-marketplace-stage1.helpronline.workers.dev`

This is **preview infrastructure only** — a `workers.dev` subdomain, not the eventual branded production domain. All pages set `<meta name="robots" content="noindex,nofollow">` for this reason. Do not treat this URL as permanent; a future branded-domain launch is a separate, explicitly-authorized step.

---

## What Git Does NOT Back Up

The repository captures code, schema, and migration files only. It does **not** contain:

- Cloudflare secret values (`ADMIN_TOKEN`)
- Live D1 rows (real operators, products, offers, enquiries, AI job records)
- Cloudflare API token credentials
- Cloudflare account authentication/session state
- Runtime deployment history (version IDs, deployment timestamps)
- Future real customer/operator data as the marketplace grows

These must be recreated or restored from backup separately — see below.

## D1 Backup / Export Procedure

**Method used for this checkpoint:** Cloudflare's D1 REST export API (`POST /accounts/{account_id}/d1/database/{database_id}/export`, polled with the returned bookmark until `status: "complete"`), which produces a full SQL dump and a short-lived signed download URL.

- Backup filename: `vakaviti-marketplace-stage1-db_20260818T123259Z.sql`
- Timestamp: 2026-08-18T12:32:59Z
- Row/table coverage: full dump, all 18 tables (17 application tables + `enquiries`)
- Storage location: delivered directly to James as a file download in this session — **not committed to Git**, and not left in any session-local temporary storage (deleted after handoff). James is responsible for placing it in a durable private location (encrypted drive, private cloud storage, password manager vault, etc.).
- Content note: at export time, `claims` and `evidence` (the two tables capable of holding personal contact details) were both empty — this backup contains no personal/customer data, only business-level operator/product records and non-identifying enquiry attribution rows (operator/product/channel/timestamp only, no enquirer name/phone/email).

**Repeatable command for future backups** (requires a Cloudflare API token with D1 Read):

```
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/f2753057-4319-404d-bcda-84cccd288fe1/export
Body: {"output_format":"polling"}
```
Poll the same endpoint with `{"output_format":"polling","current_bookmark":"<bookmark from previous response>"}` until `status` is `"complete"`, then download `result.signed_url` (expires in 1 hour) before it lapses. Once `claims`/`evidence` tables contain real personal data, exports must be stored only in a secure private location — never committed to this public repository.

## Current Live Inventory Snapshot (counts only, 2026-08-18)

| Table | Row count |
|---|---|
| `operators` | 1 |
| `products` | 5 |
| `enquiries` | 3 |
| `candidate_operators` | 0 |
| `ai_jobs` | 4 |
| `claims` | 0 |
| `evidence` | 0 |

No customer-identifying data is recorded in this document — counts and schema structure only.

## Secret Recovery

After any disaster recovery, `ADMIN_TOKEN` must be recreated — never restored from any prior value:

1. Generate a new strong random secret locally (e.g. 32 bytes of cryptographically random hex), never reusing a previously exposed or old token
2. Set it via Cloudflare Worker secret management: `PUT /accounts/{account_id}/workers/scripts/vakaviti-marketplace-stage1/secrets` with `{"name":"ADMIN_TOKEN","text":"<new value>","type":"secret_text"}` (or `wrangler secret put ADMIN_TOKEN` if using the CLI)
3. Verify auth behavior post-restore: `GET /api/admin/human-gates` with no header → expect `401`; with a wrong token → expect `401`; with the correct new token → expect `200`

## Disaster Recovery Test Plan

If this Worker and D1 disappeared tomorrow:

1. Checkout `ceo/vakaviti-marketplace-stage1` from Git
2. Create a new, isolated Worker named `vakaviti-marketplace-stage1`
3. Create a new, dedicated D1 database (do not reuse or attach to any existing production D1)
4. Apply migrations in order: `schema.sql` → `0002_candidates.sql` → `002_ai_orchestration.sql` → `0003_product_candidates.sql` → `0004_revenue_mvp.sql`
5. Configure the `DB` binding in `wrangler.toml` to the new database ID
6. Configure the `AI` binding
7. Set `ENVIRONMENT=preview` in `wrangler.toml`
8. Create a new `ADMIN_TOKEN` secret (never reuse an old/exposed value)
9. Deploy (`wrangler deploy` or via Workers Builds Git integration)
10. Restore D1 data from the secure backup (re-run the exported SQL statements against the new database)
11. Test homepage (`/`) — expect 200
12. Test operators/products (`/operators`, `/experiences`, and their detail pages) — expect 200, real inventory visible
13. Test WhatsApp enquiry (`/enquire/:operatorSlug?product=:slug`) — expect a `302` to the correct `wa.me` link, and a new row in `enquiries`
14. Test AI (`/api/admin/ai/enrich-candidate` and `/api/admin/products/digitise`, admin-authenticated) — expect `200`, no deprecated-model errors
15. Confirm Nadi/Lagi isolation — re-verify `path_excludes` on both Pages projects (this setting lives in Cloudflare, not Git, and must be manually re-added if either project is recreated)
16. Confirm no production routes/custom domains are attached to the new Worker — `workers.dev` only until an explicit future authorization
