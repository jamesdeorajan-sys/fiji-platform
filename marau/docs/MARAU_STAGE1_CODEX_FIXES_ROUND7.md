# Marau Stage 1 — seventh independent review, "COMPLETE CONFIRMATION AND RECOVERY LIFECYCLE"

Codex independently verified 356/356 passing tests at commit `973bac2` and confirmed no shared-engine changes. Round 6's two original race regressions still passed. Two NEW real-SQL fault injections kept R01 open — both reproduced first with actual SQLite triggers (not JS hooks), then closed with complete database-state assertions.

## New fault injection 1 — post-confirmation audit failure

**Finding:** a real SQLite trigger rejects `UPDATE confirmation_attempts` when `NEW.phase = 'DONE'`. Confirming a valid request then produced `HTTP 500 "fully rolled back — safe to retry"` with `reconciliation_needed: true` — but the request was **actually CONFIRMED**, offer **ACTIVE**, allocations **0**, movement claims **0**, decision claims **0**. A real, successful confirmation whose supporting resources were wrongly compensated away, with a response that lied about what had happened.

**Root cause:** the confirm handler's final decisive write (`UPDATE deal_requests SET status = 'CONFIRMED' ...`) and the very next statement (`setPhase('DONE')`, the purely observational audit write) were inside the SAME try/catch block. Once the audit write's trigger threw, the exception propagated to the SAME generic `catch` that calls `rollback()` for genuine pre-confirmation failures — and `rollback()` doesn't check whether the confirmation had already committed; it unconditionally tries to compensate the offer, allocation, movement claim, and decision claim, all of which were still ownership-checked-valid (nothing had actually taken ownership away), so every one of those compensating writes **succeeded** — reverting a booking that was, underneath, genuinely confirmed.

**Fix — a defined, enforced commit boundary:**

- The instant the final `deal_requests` write reports `changes === 1`, the confirmation has **unconditionally taken effect**. This is now a structural boundary, not a convention: the audit write (`setPhase('DONE')`) is wrapped in its **own, separate** try/catch, entirely outside the main try/catch whose `catch` calls `rollback()`. An audit-only failure can now never reach the compensation path.
- A single best-effort retry is attempted for the audit write (a transient failure shouldn't immediately become a permanent gap).
- If it still fails, the response is **truthful**: `200 CONFIRMED`, with the offer/allocation details exactly as before, plus an explicit `audit_warning` field disclosing that the durable audit record could not be finalized — never a `500` implying the booking was rolled back when it wasn't.
- **Audit-repair behavior**, exercised via `reconcile-confirmation`: when called on a request that is **already** `CONFIRMED` (or `DECLINED`) but whose journal never reached a terminal phase, reconcile now performs a **pure, resource-free label repair** — it looks up the journal by `journal_attempt_id`, fixes its `phase` to match the real outcome, and touches nothing else. No ownership takeover, no resource inspection beyond the label fix — the request is already, verifiably terminal, so there is nothing at risk.

## New fault injection 2 — recovery retry loses original attempt identity

**Finding:** pause confirmation after the offer is `HELD`. Block the compensating `HELD → ACTIVE` revert with a real SQLite trigger. Run `reconcile-confirmation`: it correctly fails (`500 RECONCILIATION_FAILED`). Remove the trigger and reconcile again. Result: `HTTP 200 ROLLED_BACK_TO_REQUESTED` — but the offer **remained HELD**, and the decision claim was **deleted**, leaving a phantom `HELD` offer with no claim left pointing at it, unfixable by anything.

**Root cause:** `attempt_token` **rotates** — every `reconcile-confirmation` takeover replaces it with that call's own recovery token. The SECOND reconcile call read `claim.attempt_token` and used it to look up the journal (`confirmation_attempts WHERE attempt_id = <that token>`) — but by then, `attempt_token` held the **first** reconciler's own recovery token, which was never used as any journal's `attempt_id` anywhere. The lookup found nothing, and "no journal found" was wrongly treated as proof that nothing had happened — the code deleted the claim outright without ever inspecting, let alone reverting, the real (still-`HELD`) offer.

**Fix — two changes together:**

1. **A stable identity, kept separate from the rotating ownership token.** New column `deal_decision_claims.journal_attempt_id` (migration `0022`) is set exactly **once**, at the same moment the confirm handler first establishes `attempt_token` ownership, and is **never** touched again by any reconciler takeover. Every `reconcile-confirmation` call now looks up the journal via this stable column — findable across any number of staggered reconcile attempts, no matter how many times `attempt_token` itself has rotated.
2. **"Missing journal cannot mean nothing happened."** Reconcile no longer treats an unfindable journal row as sufficient proof that no resources exist. It now **always** inspects real resource state directly first — offer status, allocation, movement claim — regardless of whether a journal row can be found at all. Only when the real state shows genuinely nothing (`!movementClaimed && !allocation && !offerHeld && !offerFilled`) is the claim freed outright; otherwise the normal inspect-and-unwind (or finish) path runs against what's really there.

**Also applied — ownership predicates on reconciliation's own final-status/journal writes, and verified affected rows (staggered reconcilers):** every one of reconcile's own writes — the `CONFIRMED`-finish write, the `DECLINED`-finish write, and the journal phase updates — now carries `AND EXISTS (... attempt_token = recoveryToken)` in the same statement, checked for `changes === 1`. If a **staggered second reconciler** raced in and took over mid-way through the first call's own work, every one of the first call's remaining writes now correctly affects zero rows and is reported as `ATTEMPT_STILL_ACTIVE` rather than silently overwriting whatever the new owner is doing. After compensation, reconcile also **re-reads actual resource state** (not just "no exception was thrown") before declaring success, since an ownership-checked compensating write can silently no-op (zero rows, no exception) if superseded mid-unwind — this is what makes `RECONCILIATION_FAILED` honestly distinguish "a real error occurred" from "this call's own recovery was itself superseded."

**Compensation now proves ownership of the SPECIFIC resource being undone**, not merely ownership of the request: `releaseVehicleAllocation`'s `ownership` argument and the movement-claim `DELETE`'s `EXISTS` clause were already scoped this way from round 6; this round adds a companion test proving a completely unrelated, separately-confirmed request's own allocation/claim/offer are provably untouched by reconciling a different, concurrently-stalled one.

## Tests

Both new fault injections are reproduced with **real SQL** — actual SQLite `CREATE TRIGGER ... BEFORE UPDATE ... WHEN ...` statements against the D1 shim — not JS-level hooks standing in for them, per the explicit instruction. Every assertion checks **complete database state** (request status, offer status, allocation count, movement-claim count, decision-claim presence) rather than only response codes.

`marau_codex_fixes_round7.test.mjs`: both new repros reproduced then proven fixed; a staggered-reconciler test (a second reconcile call arriving after the first already fully resolved); a resource-ownership isolation test (reconciling one request never touches a different, concurrently-confirmed request's resources); and an explicit regression test re-running both of round 6's original reproductions unchanged, confirming they still close correctly after this round's rewrite.

| Suite | Result |
|---|---|
| `smart-return-trigger-fill/test/*.test.js` (Issue #54 engine, unaffected — still no shared-engine changes) | **247/247 pass** |
| `marau/test/*.test.mjs` (round 7 fixes included) | **114/114 pass** (109 prior, all unaffected + 5 new in `marau_codex_fixes_round7.test.mjs`) |
| **Total** | **361/361 pass** |

## Scope preserved

Isolated preview branch (`ceo/marau-stage1-preview`), synthetic test D1, mocked messaging — unchanged. No new features. No production, domain, or DNS changes. Cloudflare authentication remains a **separate prerequisite**, not the only blocker — this round did not attempt or touch it, and none of this round's fixes depend on it.

## Remaining gates

1. **Cloudflare D1/Workers deployment** — still blocked on James completing the OAuth sign-in step from round 5/6 (unchanged; not re-attempted this round since the instruction named it a separate prerequisite).
2. **Real device install acceptance** — unchanged from rounds 4–6, kept explicitly separate from the `localStorage`-survival browser evidence.
3. Given the pattern in rounds 4→5 and 5→6 of "closed" claims about this exact confirmation/recovery subsystem being found wrong by the next review, this round's fixes are reported with the same evidence discipline (real fault injection, complete state assertions, preserved prior reproductions) but are, as ever, not declared as a final word absent further independent review.
