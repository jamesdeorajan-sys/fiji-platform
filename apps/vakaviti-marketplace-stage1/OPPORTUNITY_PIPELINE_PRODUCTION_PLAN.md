# Deal Opportunity Pipeline — Production Resource Plan

Status: **NOT YET AUTHORIZED. NOT YET CREATED.** This document exists so the exact sequence is
agreed before anyone runs it, not improvised at merge time. Nothing in this file has been
executed against production.

## Why this document exists

Cloudflare Workers Builds was empirically tested on this project (2026-08-24) and confirmed to
read only the **top-level** `wrangler.toml` config for both preview and production branch
deploys — a named `[env.preview]` block was tried and the resulting build's bindings did not
include it. There is therefore no config-level way to make the `OPPORTUNITY_DB` binding
"preview-only" automatically. The binding in the current `wrangler.toml` (pointing at the
isolated preview database) will merge into production exactly as written unless this sequence is
followed first.

## Current state

- Preview database: `vakaviti-opportunity-pipeline-preview-db`, id `7779e1ae-46be-44f7-abbd-1178cf46f145`. Isolated, feature-branch-only, contains zero real data as of this report (all test fixtures removed — see the PR #21 hardening report).
- Production `wrangler.toml` (on `ceo/vakaviti-marketplace-stage1` as of this writing): **no `OPPORTUNITY_DB` binding at all.** Confirmed repeatedly throughout this work.
- Discovery-integration hook (`deal-agent.ts`) and the admin console (`opportunities-admin-ui.ts` / `src/opportunities.ts`) both fail closed — silently no-op — whenever `OPPORTUNITY_DB` is absent or misconfigured. This is what keeps production safe *today*, not any config trick.

## Exact sequence for a future, separately authorized production rollout

1. **CEO authorization to proceed** — a distinct, explicit decision, separate from "the architecture is accepted in principle." Do not start step 2 without it.
2. **Create the real production database** via the D1 API: `vakaviti-opportunity-pipeline-db` — a brand-new UUID, never the preview database's id.
3. **Apply `migrations/opportunity/0001_opportunity_pipeline.sql` to that new database only**, via the same direct-D1-API method used for the preview database (never the app's `db:migrate:remote` chain, which does not include this migration file). Take two independent pre-migration exports first if the database is not empty at that point (it will be, since it is brand new — but re-verify before running).
4. **Update `wrangler.toml`**: change `database_id` under the `OPPORTUNITY_DB` binding from the preview id to the new production id. Remove the pre-merge-checklist comment block once this is done (it will no longer apply).
5. **Re-run the full test/QA suite** (executable TypeScript tests, authenticated console QA, mobile QA, CSRF/Origin/auth tests) against the real production binding shape before the merge is allowed to actually deploy — not just against the preview database.
6. **Merge and deploy**, confirming immediately after: deployment/version IDs, 100% traffic, bindings list includes `OPPORTUNITY_DB` pointing at the new production id (not the preview id), `/api/health` 200, existing marketplace routes unaffected, Cron unchanged.
7. **Only after step 6** does the Cron-triggered discovery-integration hook begin writing real opportunity data — verify the very first tick's output before trusting steady-state operation.

## Rollback procedure (at any point after step 6)

- Remove the `[[d1_databases]]` block for `OPPORTUNITY_DB` from `wrangler.toml` (or point it at a nonexistent id) and redeploy. Both integration points fail closed on absence — this alone fully disables the feature without touching the Lane B deal pipeline, operators, products, or enquiries.
- The real production `vakaviti-opportunity-pipeline-db` itself is never deleted by a rollback — only unbound. Its data (opportunities, lifecycle events, replies) remains intact and re-attachable later.
- No rollback step in this document is ever performed automatically by AI — any rollback requires the same explicit human authorization as the original deployment, per this engagement's standing rule.
