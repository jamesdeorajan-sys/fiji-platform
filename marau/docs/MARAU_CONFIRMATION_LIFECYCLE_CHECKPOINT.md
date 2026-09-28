# Marau confirmation and recovery lifecycle checkpoint

2026-09-28. Issue #54. Isolated branch: `codex/marau-confirmation-lifecycle`.

## Base and scope

The requested baseline was `973bac2` (247 engine + 109 Marau tests). During this work the preview branch had already advanced to `0fee8a1308dffc2e96061e548b265e765c4c712b`. This change builds on that round-7 commit, preserving its original reproductions and stable journal identity migration, rather than duplicating it. Its baseline Marau suite passed 114/114 locally.

The round-7 document's claim of lifecycle closure was premature. Its sequential second-recovery test did not exercise overlapping recovery owners; its unrelated-offer isolation test did not prove ownership of a shared offer. Additional tests exposed compensation of another request's confirmed offer, stale journal/release behavior, post-commit recovery audit exceptions, lost recovery identity after a rollback-audit failure, and silent zero-row audit success.

## Changes

- Confirmation claim creation establishes its owner token and immutable journal identity atomically. Recovery replaces only the owner token.
- Migration `0023_marau_offer_attempt_owner.sql` adds `smart_offers.marau_attempt_id`. Holding an offer records its original attempt in the same SQL update. Filling or compensating requires that resource identity AND the current request owner. Owning a different request cannot authorize resetting this offer.
- Resource mutations and recovery takeover require the authoritative request to remain `REQUESTED`. A stale recovery snapshot cannot take over after confirmation commits.
- Reconciliation final-status and journal writes include current ownership predicates and check affected rows. Completing confirmation also verifies supporting resources in the decisive SQL statement.
- Both confirmation paths treat the successful final `CONFIRMED` write as the commit boundary. Failed or silently ignored `DONE` audit writes return truthful confirmation with `audit_warning`; terminal reconciliation repairs only the audit under the recorded owner and journal identity.
- Rollback verifies remaining resources, writes its terminal journal phase before releasing the claim, and checks claim release. Failed compensation or audit retains discoverable identity and requires reconciliation. Missing journal alone never means nothing happened.
- Allocation removal checks subject type and request as well as allocation ID/current owner. Movement removal checks request and resource identifiers. Decline writes/releases use their own token so a resumed decline cannot delete a recovery owner's terminal claim.

## Evidence

Local real-SQLite D1-shaped handler tests: **125/125 Marau + 247/247 engine = 372/372**. Full `smart-return-trigger-fill/` diff against `973bac2` is empty. No shared-engine code or migration changed.

The original round-6 and round-7 reproductions remain unchanged. Eleven additional tests in `test/marau_lifecycle_completion.test.mjs` cover:

1. Two guest requests targeting the SAME offer; recovery of the non-holder preserves every row of the confirmed owner's state.
2. Recovery paused before takeover while original confirmation commits; no terminal state or ownership changes afterward.
3. Recovery paused before its rollback journal write while another recovers and a fresh confirmation completes; stale recovery cannot overwrite or release anything.
4. Recovery commits confirmation while a real SQL trigger rejects `DONE`; truthful success, intact resources, then audit-only repair.
5. SQL-trigger rejection of `ROLLED_BACK`; retained claim/journal identity and successful later recovery.
6. SQL-trigger `RAISE(IGNORE)` for `DONE`; affected-row checks prevent false audit success.
7. Recovery paused before final status while a newer recovery commits; stale final write cannot claim success.
8. SQL-trigger `RAISE(IGNORE)` for HELD-to-ACTIVE; incomplete compensation cannot release ownership or report success.
9. Missing journal with real held resources; inspection and compensation still operate on proven resource ownership.
10. Legacy held resource without a provable owner; manual reconciliation remains required.
11. Superseded decline resumes after recovery; terminal recovery claim is preserved.

New overlap tests use explicit promise barriers around actual SQL statements or existing handler hooks, without timing sleeps. Assertions inspect request, offer, allocations, movement claims, decision ownership and journal state. Existing network guards remain enabled. This is local SQLite evidence, not deployed Cloudflare D1 evidence.

Reproduce from the repository:

```sh
(cd marau && node --test test/*.test.mjs)
(cd smart-return-trigger-fill && node --test test/*.test.js)
git diff 973bac2 -- smart-return-trigger-fill
```

## Migration and release limits

Migration 0023 is additive and applied only to fresh test databases here. It backfills journal identity only where the original token directly matches that request's existing journal. It deliberately does not infer ownership for pre-existing held/filled offers. Such legacy pending attempts remain explicitly blocked for manual investigation; do not reset their resources automatically.

This checkpoint provides a tested candidate for independent review of R01, not public-release approval. No claim of “no code-level blocker remains” is made. Independent review of this change, isolated Cloudflare D1 acceptance (including migrations/concurrency), real-device acceptance and operational release gates remain required. Cloudflare authentication is a separate prerequisite, not the only blocker.

No production migration/deploy, live messaging, main-branch update, Issue #59 change, guest feature or brand change is part of this checkpoint.
