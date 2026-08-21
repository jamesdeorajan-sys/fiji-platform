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
  - `ASSETS` — Workers Static Assets binding, `directory = "./public"` (serves `public/images/*`)
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
6. `migrations/0005_places.sql` — creates `places` and `place_relationships` (canonical Fiji Place Registry, Pilot 6A). Fully additive and independent — the marketplace (`operators`/`products`/`offers`) does not read from these tables and does not depend on them existing.
7. `migrations/0006_place_hardening.sql` — creates `place_evidence`, `place_aliases`, `place_external_mappings` (Place Authority truth hardening, Pilot 6B). Fully additive; none of these three tables can be written to except by fact-level append-only inserts scoped to an existing `place_id` — none of them can mutate `places.id`, `places.place_type`, `places.parent_place_id`, or `places.slug`.
8. `migrations/0007_place_taxonomy.sql` — additive Place Type taxonomy (Pilot 6D-A). Creates `place_types` (reference table) and `place_change_events` (audit trail), and adds a single new nullable column `places.place_type_code TEXT REFERENCES place_types(code)` via a native `ALTER TABLE ADD COLUMN` — proven safe beforehand in a disposable rehearsal D1 database. The pre-existing `places.place_type` column and its CHECK constraint are completely untouched; legacy values (including Nadi's `CITY`) remain exactly as they were. No `places` table rebuild occurred.
9. `migrations/0008_deal_intelligence.sql` — Deal Intelligence pilot. Creates `deal_sources`, `deal_offer_candidates`, `deal_approvals`, `deal_change_events`, `deal_scan_runs`, `deal_source_scans` — all new, all prefixed `deal_`, fully additive and independent. No existing table is touched. Nothing here is read by any existing public marketplace route (`operators`/`products`/`offers`/`enquiries` are entirely unaffected).

   **Note on the migration number gap:** a `0009_deal_scan_run_states.sql` was drafted (to add `TIMED_OUT`/`ABANDONED` to `deal_scan_runs.status`) but abandoned before ever being applied - a disposable-database rehearsal found D1 blocks `DROP TABLE` on a table referenced by another table's foreign key even with `PRAGMA foreign_keys=OFF`, which the planned CHECK-constraint migration depended on. The file was deleted rather than pushed; the equivalent outcome is achieved without a schema change (`status='FAILED'` + `summary_json.failure_reason`). The next real migration is numbered `0010` deliberately, to keep the historical record honest rather than renumber around the gap.

10. `migrations/0010_deal_public_hub.sql` — P1 Human Review Centre + public Live Fiji Deals hub. Adds one nullable column (`deal_offer_candidates.slug`, native `ALTER TABLE ADD COLUMN`, no CHECK change) plus two new isolated tables: `deal_analytics_events` (privacy-safe hub event log) and `deal_enquiries` (deal-specific enquiries, deliberately separate from the real `enquiries` table since a Deal Intelligence candidate's seller/marketer is free text, not yet a resolved real operator). No existing table touched.

11. `migrations/0011_candidate_quality_gate.sql` — P1.2 candidate-quality gate, page classification, URL canonicalization, and deal-identity audit trail. Adds twelve nullable columns (plus two indexes) to the existing `deal_source_scans` table only - a scan that fails the deterministic quality gate in `src/deal-quality.ts` (see `evaluateQualityGates()`) now records its full completeness result there and creates no `deal_offer_candidates` row at all, instead of the pre-P1.2 behaviour of creating a new candidate on any content-fingerprint change regardless of information quality. No CHECK-constraint change was needed anywhere: `deal_offer_candidates.review_status` already allowed `MATERIAL_CHANGE_DETECTED` (from the original `0008` migration) and `deal_change_events.event_type` was already free text - both are reused as-is for material-change handling on an already-known deal, with zero schema risk.

12. `migrations/0012_ceo_provider_fast_track.sql` — P1.3A CEO-confirmed provider fast-track onboarding. One new table only, `provider_ceo_confirmations` - no existing table (`operators`, `products`, `candidate_operators`, `deal_sources`, etc.) is touched. Pilot Partner status is deliberately not a cached column anywhere - it is derived live on every public read from whether an unrevoked row exists here, the same "recompute, never trust a cached flag" discipline as `isPubliclyEligible()`. A partial unique index (`canonical_domain` WHERE `revoked_at IS NULL`) backs the duplicate-provider-confirmation check at the database level, not just in application code.

13. `migrations/0013_provider_enquiry_handler.sql` — P1.3C. One nullable-with-default column, `provider_ceo_confirmations.initial_enquiry_handler` (`'VAKAVITI'` or `'PROVIDER'`, application-enforced, no CHECK constraint added via `ADD COLUMN` deliberately - not worth the risk on a routine additive change). Recording this does not yet change enquiry routing behaviour; every enquiry still goes through the existing Vakaviti-owned `/enquire/:operatorSlug` flow regardless of its value.

14. `migrations/0014_ai_supply_discovery.sql` — P1.3D AI supply discovery, batch review, and rapid publication. Two new tables only: `standing_policies` (the durable, auditable record of James's CEO directive authorizing AI-discovered directory publication - application code has read-only access, never write; a human runs a raw SQL UPDATE to revoke it) and `supply_import_batches` (idempotency/audit ledger for the not-yet-built documentation-to-review importer). No existing table is touched, and deliberately no new `listing_basis`-style column was added to `operators` - AI-discovered-directory-listing vs CEO-confirmed-pilot-partner status is derived live the same way Pilot Partner status already is (absence vs presence of an unrevoked `provider_ceo_confirmations` row); the one new signal, `operators.last_public_check_at`, already existed on the table and is now stamped only by the new Path A promotion path (`promoteCandidateToDirectoryListing()` in `src/candidates.ts`), which is what lets the public template distinguish an AI-discovered listing from any other non-Pilot-Partner operator without a schema change.

15. `migrations/0015_supply_sprint.sql` — P1.4 initial AI supply sprint. Two new tables only, purpose-built for provider-discovery runs rather than reusing the deal-side `deal_scan_runs`/`deal_source_scans` (those are shaped around deal-offer outcomes, not provider-identity outcomes): `supply_sprint_runs` (one row per sprint, tracks batch offset/status/counters) and `supply_sprint_scans` (one row per source processed, full audit trail including weak-page rejections and fetch failures). No existing table is touched.

16. `migrations/0016_supply_sprint_activation_log.sql` — P1.4A activation UX fix. One new table, `supply_sprint_activation_log` - sanitized (booleans + short fixed codes only, never a secret/cookie/token) observability for the login→session→CSRF→Origin→run-creation path itself, filling the gap that meant a blocked or failed activation attempt previously left zero trace anywhere. No existing table is touched.

All statements across all eight files are `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / additive `ALTER TABLE ADD COLUMN` — safe to re-run except the bare `ALTER TABLE ADD COLUMN` statements (in `0004` and `0007`), which are one-time-only by design, consistent with this project's existing migration discipline.

## Workers AI

- Current model: `@cf/meta/llama-3.1-8b-instruct-fp8`
- The shared model constant lives in `src/ai.ts` as `export const DEFAULT_MODEL`. `src/products.ts` imports it from there — there is intentionally only one place this string is defined, to avoid the exact bug fixed earlier (a duplicated hardcoded model string in `products.ts` going stale independently).

## Visual Assets

- Static asset serving: `wrangler.toml` `[assets]` block (`directory = "./public"`, `binding = "ASSETS"`) — Cloudflare's built-in Workers Static Assets feature. No R2, no Cloudflare Images, no external storage; files are bundled with the Worker and served directly from `apps/vakaviti-marketplace-stage1/public/` at their matching path (e.g. `public/images/hero-fiji-leleuvia.webp` → `/images/hero-fiji-leleuvia.webp`), ahead of the Worker's own `fetch` handler.
- Real photography lives under `apps/vakaviti-marketplace-stage1/public/images/` and is fully committed to Git — a repository checkout alone is sufficient to recover every current image file, no separate asset backup needed.
- Full source/license/photographer/retrieval-date record for every third-party photo: `apps/vakaviti-marketplace-stage1/IMAGE-SOURCES.md`. Recreate this file's discipline for any future images — verify the actual source page (not a search thumbnail) before downloading, record it, and never assign stock imagery to an operator's own `image_url` unless it is genuinely theirs.
- Recovery implication: on a full rebuild, `git checkout` alone restores all current visual assets — no external service or manual re-download is required, unlike the D1 rows (which still need the separate secure backup described below).

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
4. Apply migrations in order: `schema.sql` → `0002_candidates.sql` → `002_ai_orchestration.sql` → `0003_product_candidates.sql` → `0004_revenue_mvp.sql` → `0005_places.sql` → `0006_place_hardening.sql` → `0007_place_taxonomy.sql` → `0008_deal_intelligence.sql` → `0010_deal_public_hub.sql` (there is deliberately no `0009` - see the note above) → `0011_candidate_quality_gate.sql` → `0012_ceo_provider_fast_track.sql` → `0013_provider_enquiry_handler.sql` → `0014_ai_supply_discovery.sql` → `0015_supply_sprint.sql` → `0016_supply_sprint_activation_log.sql`
5. Configure the `DB` binding in `wrangler.toml` to the new database ID
6. Configure the `AI` binding
7. Set `ENVIRONMENT=preview` in `wrangler.toml`
8. Confirm the `[assets]` block points at `./public` (this is committed to Git, so a plain checkout already restores it — no extra step needed)
9. Create a new `ADMIN_TOKEN` secret (never reuse an old/exposed value)
10. Deploy (`wrangler deploy` or via Workers Builds Git integration)
11. Restore D1 data from the secure backup (re-run the exported SQL statements against the new database)
12. Test homepage (`/`) — expect 200, hero image loads
13. Test operators/products (`/operators`, `/experiences`, and their detail pages) — expect 200, real inventory visible
14. Test WhatsApp enquiry (`/enquire/:operatorSlug?product=:slug`) — expect a `302` to the correct `wa.me` link, and a new row in `enquiries`
15. Test AI (`/api/admin/ai/enrich-candidate` and `/api/admin/products/digitise`, admin-authenticated) — expect `200`, no deprecated-model errors
16. Confirm Nadi/Lagi isolation — re-verify `path_excludes` on both Pages projects (this setting lives in Cloudflare, not Git, and must be manually re-added if either project is recreated)
17. Confirm no production routes/custom domains are attached to the new Worker — `workers.dev` only until an explicit future authorization
