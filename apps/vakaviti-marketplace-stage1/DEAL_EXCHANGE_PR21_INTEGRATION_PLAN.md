# Live Deal Exchange × PR #21 (Opportunity Pipeline) — Integration & Rebase Plan

Status: not started. This document exists so the eventual integration is a deliberate step, not
something either branch backs into. Supersedes nothing in `DEAL_EXCHANGE_INTEGRATION_CONTRACT.md`
(Milestone 1) - this is the execution sequence for that same disabled contract.

## Sequence

1. **PR #21 finishes its own hardening** (independent of this branch - see PR #21's own hardening
   reports for status).
2. **CEO separately approves PR #21.** This is a distinct authorization from anything in this
   document or in Milestone 1-4's acceptance.
3. **PR #21 merges to `ceo/vakaviti-marketplace-stage1` first.** This branch (`ceo/vakaviti-live-deal-exchange`)
   is not touched by that merge - it was branched from production before PR #21 existed and
   contains none of PR #21's files.
4. **Rebase this branch (PR #22) onto the post-merge production HEAD.** Expect no real conflicts,
   since the two branches touch disjoint files (`opportunit*.ts`/`opportunity_*` tables vs.
   `deal-exchange-*.ts`/`deal_exchange_*` tables) - the only shared file either branch modifies is
   `src/index.ts` (route mounting) and `wrangler.toml` (bindings), both additive.
5. **Resolve the integration against PR #21's FINAL contract**, not the one assumed in Milestone 1 -
   re-verify `deal_offer_candidates`' exact shape and `review_status` values as they exist after
   PR #21's own review process, since hardening may have changed field names or added constraints
   this document doesn't yet know about.
6. **Re-run every Deal Exchange test** (vitest + Playwright) against the rebased branch - a clean
   rebase is not sufficient proof; the full suite must pass against the new base.
7. **Verify no duplicate schema/status/control surfaces** - confirm `deal_exchange_offers` never
   duplicates `opportunities`' lifecycle states, `deal_exchange_owned_products` never duplicates
   `candidate_operators`, and the admin/visitor surfaces remain genuinely separate (PR #21 =
   private opportunity console; this branch = public visitor journey).
8. **Return for final merge authorization** - a distinct decision from every prior milestone
   acceptance in this branch's history.

## What this branch will NOT do before that sequence completes

- Copy any PR #21 code, type, or table definition "to get started early" - the disabled contract
  stays disabled, and no shortcut duplicates PR #21's tables under a different name.
- Assume PR #21's current (possibly still-hardening) shape is final - the rebase step explicitly
  re-verifies rather than trusts a stale assumption.
