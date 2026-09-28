# Marau Stage 1 — round 8: integration and independent review of Codex's lifecycle fix

2026-09-28. Issue #54. Branch: `ceo/marau-stage1-preview`.

## Provenance

Codex produced local commit `067ede79b8fdf3409c83f8249f05953fce3c6f03` on top of round 7's `0fee8a1` (`fix(marau): enforce resource ownership across confirmation recovery`). Codex's own push to `ceo/marau-stage1-preview` failed — credentials were unavailable in that environment. James supplied the patch as a file (`MARAU-067ede79-lifecycle.patch`).

**Verification before applying:** `origin/ceo/marau-stage1-preview` was fetched and confirmed still at exactly `0fee8a1` — the branch had not advanced since round 7, so there was no newer work to preserve or reconcile against. The patch was applied with `git am --3way` on an isolated review branch (`review/marau-lifecycle-067ede79`) checked out from `0fee8a1`; it applied cleanly with no conflicts, and `git diff 0fee8a1 HEAD --stat` matched the patch's own stated diffstat exactly (447 insertions, 332 deletions across the same 5 files). Codex's original authorship (`Codex <codex@openai.com>`) was preserved through `git am`.

## Independent verification of test evidence

| Suite | Result |
|---|---|
| `smart-return-trigger-fill/test/*.test.js` | **247/247 pass**, independently re-run |
| `marau/test/*.test.mjs` | **125/125 pass**, independently re-run (114 prior + 11 new in `marau_lifecycle_completion.test.mjs`) |
| **Total** | **372/372 pass** — matches Codex's reported count exactly |
| `git diff 973bac2 -- smart-return-trigger-fill` | **empty** — independently confirmed the shared Issue #54 engine has zero changes across rounds 6, 7, and 8 |

The full suite was re-run three times in a row to check for flakiness in the new concurrency tests (which use real promise barriers and SQL-statement-level pause hooks rather than timing sleeps) — all three runs passed 125/125 with no flakes.

## Independent code review

Each of the six areas named for review was traced through the actual resulting code (not just the diff) and cross-checked against its own regression test:

1. **No compensation after confirmation commits.** The round-7 commit boundary is fully preserved: the final `deal_requests` write is checked for `changes === 1`, and the subsequent audit write (`setPhase('DONE')`) lives in its own try/catch, entirely separate from the try/catch whose `catch` calls `rollback()`. An audit-only failure still cannot reach the compensation path. Additionally, `reconcile-confirmation` now checks `request.status !== 'REQUESTED'` **before** attempting any ownership takeover at all — a terminal request never even acquires a recovery token, let alone touches a resource. Verified against the patch's own real-SQL-trigger tests (`DONE` rejected via `RAISE(ABORT)`, and separately via `RAISE(IGNORE)` to prove the affected-row check — not just exception handling — is what catches a silently-ignored write).

2. **Original journal identity survives repeated recovery.** `journal_attempt_id` is written exactly once, at claim creation, and is never the target of any `UPDATE` anywhere in the reachable code (confirmed by inspection — the only write to that column is the initial `INSERT`). `reconcile-confirmation` looks the journal up by `journal_attempt_id`, never by the rotating `attempt_token`. Verified against a real-SQL-trigger test that fails a first reconcile's own audit write (`ROLLED_BACK` rejected), confirming the claim still carries the same `journal_attempt_id` afterward and a second reconcile can still find and finish it.

3. **Compensation proves ownership of the specific resource.** This is the genuine structural gap round 7 left open: its ownership model was entirely request-scoped (`attempt_token`/`journal_attempt_id` on the *claim*), but `smart_offers` is the one resource table not intrinsically scoped to a single request — nothing stopped a reconciler working on request A from touching an offer that a *different*, legitimately-confirmed request B actually holds. This round adds `smart_offers.marau_attempt_id` (migration `0023`) — set atomically in the same `UPDATE` that transitions an offer to `HELD`/`FILLED`, cleared atomically when it returns to `ACTIVE` — and every offer-touching statement (hold, fill, and compensation) now requires `marau_attempt_id` to match the claim's own `journal_attempt_id`, not just that some claim with a matching `attempt_token` exists. `vehicle_time_claims` and `vehicle_allocations` did not need the equivalent fix: both already carry an intrinsic `claimed_by_request_id`/`subject_id` column tying each row to exactly one request at creation, so no cross-request ambiguity was possible there in the first place — confirmed by inspection, not merely assumed. Verified against the "two guest requests targeting the same offer" test, which asserts the non-holder's reconciliation leaves the confirmed holder's request/offer/allocation/movement-claim rows byte-for-byte (`deepEqual`) unchanged.

4. **Final-status, journal, and claim-release writes enforce current ownership and check affected rows.** Traced every one of reconcile's own writes: the `CONFIRMED`-finish write, the `DECLINED`-finish write, every `writeJournal` call, and `release()` (the claim deletion) each carry an `attempt_token`-matching `EXISTS` (or direct) condition in the same statement as the write, and every call site checks `.meta.changes` explicitly rather than assuming success. `decline` was also given its own `decisionToken` (round 7 left decline's claim with no `attempt_token` at all) specifically so a resumed decline can be told apart from a reconciler that has since taken over the same claim.

5. **Overlapping reconcilers cannot overwrite completed decisions.** The takeover itself is a single `UPDATE ... WHERE attempt_token IS ? AND journal_attempt_id IS ?` CAS (using SQL's `IS` for correct NULL-safe comparison in one unified statement, replacing round 7's branching NULL-vs-value takeover logic) — only one concurrent caller's CAS can ever match a given prior state. Verified against three distinct staggered-reconciler tests: a takeover racing the original's own commit, a takeover racing another takeover's own rollback-journal write, and a takeover racing another takeover's own final-status write — in every case the loser's subsequent writes are proven to affect zero rows and the winner's final state is asserted unchanged (`deepEqual`) by the loser's later, harmless retry.

6. **Legacy resources with unproven ownership remain flagged for manual recovery.** `inspect()` explicitly separates `ownsOffer` (offer's `marau_attempt_id` matches this claim's `journal_attempt_id`) from `unknownOffer` (offer is `HELD`/`FILLED` but carries no `marau_attempt_id` at all — i.e. a resource this tracking mechanism cannot attribute to any specific attempt, whether from a pre-migration-0023 legacy write or an inconsistent state). An `unknownOffer` is never assumed to be this request's to compensate; it is left entirely untouched and reported as `RECONCILIATION_FAILED` with `reconciliation_needed: true`, forcing manual investigation rather than an automated guess. Migration `0023` itself documents the same discipline for its one-time backfill: it only sets `journal_attempt_id` where a confirmation_attempts row can be matched directly by `attempt_id`, and deliberately does not attempt to infer ownership for any pre-existing `HELD`/`FILLED` offer.

No correctness issues were found. The fix is scoped exactly as claimed: the shared Issue #54 engine is untouched (confirmed by the empty diff, not merely the commit message's claim), no messaging/network code was touched, and no production, domain, or brand changes are present.

## Whether R01 can close

**Not yet — and this checkpoint does not claim it does.** This round closes the specific gaps rounds 6 and 7 left open (statement-level ownership, stable journal identity, the commit boundary, and now resource-level ownership beyond the request scope) with real fault injection and complete state assertions, independently re-verified. But the honest pattern across rounds 4 through 8 has been that each round's fix has revealed a further, previously-undetected gap under the next round's independent review. This round's own checkpoint document explicitly declines to claim "no code-level blocker remains" or public-release approval, and this integration review does the same: R01 is meaningfully more complete than it was — the resource-level ownership gap closed here was real and worth closing — but declaring it fully closed is exactly the claim that has been wrong twice already. The appropriate status is: significantly hardened, independently re-verified against the stated evidence, not yet declared final.

## Remaining gates, unchanged

1. **Cloudflare D1/Workers deployment** — still blocked on James completing the OAuth sign-in step from round 5 (not touched this round, per instruction: a separate prerequisite, not the only blocker).
2. **Isolated Cloudflare D1 acceptance** (including migrations and concurrency behavior against a real D1 binding, not the SQLite shim) — explicitly still required per this round's own scope note, not something passing local tests can substitute for.
3. **Real device install acceptance** — unchanged from rounds 4–7.
4. Passing local tests, however thorough, does **not** authorize public release — this round's own checkpoint says so explicitly, and this integration review agrees.

## Scope preserved

Isolated preview branch, synthetic test D1, mocked messaging — unchanged. No new features, no production/domain/brand changes, no Issue #59 changes, no main-branch update beyond the same `docs/AGENT_SYNC.md` checkpoint pattern already established for every prior round.
