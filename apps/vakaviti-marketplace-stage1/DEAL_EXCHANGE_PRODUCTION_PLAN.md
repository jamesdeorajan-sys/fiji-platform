# Live Deal Exchange — Production Resource Plan

Status: **NOT YET AUTHORIZED. NOT YET CREATED.** Written so the exact sequence is agreed before
anyone runs it, matching the same discipline as PR #21's `OPPORTUNITY_PIPELINE_PRODUCTION_PLAN.md`.
Nothing in this file has been executed against production.

## Current state

- Preview database: `vakaviti-live-deal-exchange-preview-db`, id `3f9a36c7-829c-4f9d-8af0-bb5332860f4b`. Isolated, feature-branch-only.
- Production `wrangler.toml` (on `ceo/vakaviti-marketplace-stage1` as of this writing): **no `DEAL_EXCHANGE_DB` binding at all.**
- The router (`deal-exchange-ui.ts`) fails closed on two independent conditions - binding absence (503) and `DEAL_EXCHANGE_PUBLIC_ENABLED !== 'true'` (503) - so a future merge that brings the binding but not the flag still serves nothing publicly.
- Existing marketplace routes (`/deals` Class B hub, `/admin/*`, etc.) have zero dependency on `DEAL_EXCHANGE_DB` and remain fully healthy with it absent - confirmed by construction (no shared import touches it).

## Exact sequence for a future, separately authorized production rollout

1. **CEO authorization to proceed** - distinct from "the architecture is accepted," per this engagement's standing rule.
2. **Create the dedicated production database**: `vakaviti-live-deal-exchange-db` - a brand-new id, never reusing the preview id.
3. **Export/checkpoint the existing production Stage 1 D1** (`vakaviti-marketplace-stage1-db`) immediately before touching anything, exactly as done before every prior migration this engagement.
4. **Rehearse all Deal Exchange migrations** (0001-0003) against a disposable database, same as Milestone 1's rehearsal.
5. **Apply only the Deal Exchange migrations** to the new production database - never touch existing Stage 1 tables.
6. **Verify zero fixtures** in the new production database (it will be empty by construction - re-verify before trusting it).
7. **Add the production binding** to `wrangler.toml`, pointing at the new production database id - `DEAL_EXCHANGE_PUBLIC_ENABLED` stays unset/false at this point.
8. **Deploy without enabling public routes** - the binding exists, the flag doesn't, so `/explore` etc. 503 in production even though the code path exists.
9. **Run authenticated/read-only verification** against the real production binding shape (real D1 query checks, not just unit tests against a preview).
10. **Enable public routes** by setting `DEAL_EXCHANGE_PUBLIC_ENABLED = "true"` in a separate, explicit deploy - this is the actual go-live moment, deliberately decoupled from every step before it.

## Rollback procedure (at any point after step 10)

- Set `DEAL_EXCHANGE_PUBLIC_ENABLED` back to unset/false and redeploy - immediately takes every public route back to a 503 without touching data.
- Full rollback: remove the `[[d1_databases]]` block for `DEAL_EXCHANGE_DB` and redeploy - the router's own guard means this alone fully disables the feature.
- The production database itself is never deleted by a rollback - only unbound/disabled. Data remains intact and re-attachable.
- No rollback step is ever performed automatically - requires the same explicit human authorization as the original deployment.
