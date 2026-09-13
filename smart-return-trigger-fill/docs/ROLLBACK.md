# Rollback plan

Issue #54, branch `ceo/smart-return-trigger-fill-shadow`.

## Current blast radius: zero

Nothing in this branch is deployed, wired to a live D1 binding, or reachable
from any storefront's live code path. `createD1Store` in `src/db.js` is
written but never called. No `wrangler.toml`/`wrangler.jsonc` was added, so
there is no Cloudflare resource for this branch to have touched.

Rollback today is: **delete the branch**. Nothing else changes.

```bash
git branch -D ceo/smart-return-trigger-fill-shadow
git push origin --delete ceo/smart-return-trigger-fill-shadow   # if it was ever pushed
```

## If Stage 2 later applies the migrations to a real D1 database

Once `migrations/0001`–`0004` are run against a real D1 instance (an
explicit, separate, CEO-approved step — not part of this branch), rollback
becomes:

```sql
DROP TABLE IF EXISTS experience_credit_eligibility;
DROP TABLE IF EXISTS route_price_truth;
DROP TABLE IF EXISTS smart_offers;
DROP TABLE IF EXISTS movements;
```

Run in that order (reverse of creation, respecting the foreign keys from
`smart_offers`/`experience_credit_eligibility` back to `movements`). Because
every row this system will ever write in Stage 1 is shadow-mode-only and
never becomes the write target of a live storefront, dropping these tables
cannot corrupt or lose any real booking — the real booking of record stays
wherever the storefront that took it already stores it.

## If Stage 2 later wires a storefront to read `route_price_truth`

That wiring should ship as its own reviewable change with its own rollback
(e.g. a feature flag or a revert commit on the storefront's own repo path),
independent of this branch's rollback above.
