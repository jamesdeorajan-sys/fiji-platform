# Marau Stage 1 — round 10: two bounded isolated-D1 checks against the live preview

2026-09-28. Issue #54. No code changes this round — verification only, against the already-deployed preview at **https://marau-stage1-preview.helpronline.workers.dev** (commit `2df4040`, unchanged).

Both checks use **real SQL fault injection against the live, isolated `marau-stage1-test-db`** (Cloudflare D1 supports `CREATE TRIGGER`/`DROP TRIGGER` via `wrangler d1 execute --remote`, confirmed working) — not JS-level test hooks, which cannot reach a deployed Worker over HTTP. All triggers were created immediately before use and dropped immediately after; `SELECT name FROM sqlite_master WHERE type='trigger'` confirms zero triggers remain on the database at the end of this round. Synthetic data only (`test_data = 1` throughout); no production changes; no live sends (every WhatsApp interaction remained the existing composed-but-unsent mock, unchanged, unexercised by this round's checks).

## Check 1 — recovery from a deliberately prepared interrupted confirmation, including a failed recovery followed by retry

**Preparation:** seeded an isolated movement/offer/vehicle-window (`of_hosted_demo_003`), created a real booking and deal request against it, then installed two real triggers on the live database:
- `block_final_confirm`: rejects `UPDATE deal_requests ... WHERE NEW.status='CONFIRMED'`.
- `block_offer_revert`: rejects `UPDATE smart_offers ... WHERE NEW.status='ACTIVE'` (blocks the compensating revert for *both* `FILLED→ACTIVE` and `HELD→ACTIVE`).

**Step 1 — the interruption itself:** called `POST /preview/admin/deal-requests/:id/confirm` over real HTTP. It reached the final decisive write, which the first trigger rejected; the handler's own `rollback()` then ran and hit the second trigger while trying to revert the offer. Response: `500 CONFIRMATION_FAILED`, `"reconciliation_needed": true`.

**Asserted complete database state after the interruption** (queried directly against the live D1, not inferred from the response):

| Table / column | Value |
|---|---|
| `deal_requests.status` | `REQUESTED` (the blocked final write never took effect) |
| `smart_offers.status` | `FILLED` (stuck — the one compensation the trigger blocked) |
| `smart_offers.marau_attempt_id` | still stamped with the attempt's own token |
| `vehicle_allocations` for this request | **0** (this compensation succeeded independently — untouched by either trigger) |
| `vehicle_time_claims` for this movement | **0** (this compensation also succeeded independently) |
| `deal_decision_claims` | retained, `attempt_token = journal_attempt_id` (not yet taken over) |
| `confirmation_attempts.phase` | `ROLLBACK_FAILED`, `error_detail` names the real trigger error plus `"resource compensation incomplete"` |

This is itself direct, real evidence for "compensation proves ownership of the specific resource being undone" (round 8): even under a genuine partial failure, the allocation and movement-claim compensations — each independently ownership-checked — succeeded on their own, while only the specifically-blocked offer revert stayed stuck.

**Step 2 — the failed recovery:** called `POST /preview/admin/deal-requests/:id/reconcile-confirmation` with `block_offer_revert` **still active**. Response: `500 RECONCILIATION_FAILED`, `"detail": "offer: D1_ERROR: ... SQLITE_CONSTRAINT_TRIGGER; owned resources remain"`.

**Asserted state after the failed recovery attempt — genuinely unchanged, not falsely resolved:** `deal_requests.status` still `REQUESTED`; `smart_offers.status` still `FILLED`; `confirmation_attempts.phase` still `ROLLBACK_FAILED`. One meaningful, expected change: `deal_decision_claims.attempt_token` had rotated to the reconciler's own fresh recovery token, while **`journal_attempt_id` stayed exactly the same value it was before** — direct, live confirmation of round 8's "original journal identity survives repeated recovery" on real infrastructure, not just the local suite.

**Step 3 — the retry, after the underlying issue is actually fixed:** dropped `block_offer_revert`, called `reconcile-confirmation` again. Response: `200 {"resolved":"ROLLED_BACK_TO_REQUESTED"}`.

**Asserted final database state:** `deal_requests.status = REQUESTED`; `smart_offers.status = ACTIVE`, `marau_attempt_id = NULL` (cleared); `vehicle_allocations` for this request = **0**; `vehicle_time_claims` for this movement = **0**; `deal_decision_claims` for this request = **0 rows** (fully freed); `confirmation_attempts.phase = ROLLED_BACK`.

**Sanity close-out:** dropped the remaining `block_final_confirm` trigger and confirmed the SAME request cleanly, end to end, over real HTTP — `200 CONFIRMED`, real allocation created, real offer `FILLED`. The interrupted request is now, provably, in exactly as good a state as one that was never interrupted at all.

## Check 2 — two distinct requests competing for overlapping vehicle availability

**Preparation:** seeded two **distinct** movements/offers (`of_hosted_overlap_a`, `of_hosted_overlap_b`), each with its own `vehicle_windows` row, but both pointing at the **same** `vehicle_id` (`veh_hosted_overlap_shared`) with genuinely **overlapping** windows (A: `[+3h, +7h]`, B: `[+5h, +9h]` — a real two-hour overlap, not merely the same vehicle on unrelated days). Created a real booking and deal request against each.

**Exercise:** fired `POST .../confirm` for **both** requests **concurrently** (two background HTTP requests against the live URL, not sequential calls).

**Result:** A won — `200 CONFIRMED`, real allocation created on the shared vehicle. B lost — `409 {"error":"VEHICLE_TIME_ALREADY_CLAIMED","reconciliation_needed":false}` — correctly self-rolled-back with no reconciliation needed at all (unlike Check 1, nothing here was interrupted; B's own attempt cleanly detected the conflict and compensated itself in the same request).

**Asserted complete database state for both:**

| | A (winner) | B (loser) |
|---|---|---|
| `deal_requests.status` | `CONFIRMED` | `REQUESTED` |
| `smart_offers.status` | `FILLED` | `ACTIVE` (B's own offer was never touched — only the shared *vehicle* was contested, not B's offer identity) |
| `smart_offers.marau_attempt_id` | stamped | `NULL` |
| `vehicle_allocations` on the shared vehicle | **exactly 1** (A's own) | — |
| `vehicle_time_claims` for A's/B's own movement | 1 (A's) | 0 (B's released) |
| `deal_decision_claims` | retained (`CONFIRM`) | **0 rows** (fully freed — clean self-rollback) |
| `confirmation_attempts.phase` | `DONE` | `ROLLED_BACK` |

Exactly one allocation exists on the contested vehicle at the end — the exclusivity guard (round 2's original P0 finding) holds correctly end-to-end through the full round 6–8 ownership stack, verified fresh against real hosted D1 rather than re-trusting the local suite's own result.

## Terminal audit repair, kept explicitly separate from interrupted recovery

These are two **different** `reconcile-confirmation` code paths, and this round deliberately did not conflate them:

- **Terminal audit repair** (exercised in round 9, C1/C2): the request is **already** `CONFIRMED` or `DECLINED` — a real, final decision already happened. `reconcile-confirmation` in this case only ever touches the journal's *phase label*; it never re-inspects or re-touches any offer/allocation/movement-claim state, because none is at risk. Response shape: `{"resolved":"ALREADY_TERMINAL", "audit_repaired": true}` or `"audit_warning": "..."`.
- **Interrupted recovery** (this round, Check 1): the request is **still `REQUESTED`**, but real resources were left in an inconsistent state by an attempt that never reached a terminal decision. `reconcile-confirmation` here performs genuine resource inspection and compensation (or, on success, a genuine finish-to-`CONFIRMED`). Response shapes: `{"resolved":"RECONCILIATION_FAILED", ...}` (real failure, resources still stuck) or `{"resolved":"ROLLED_BACK_TO_REQUESTED"}` / `{"resolved":"CONFIRMED"}` (real resolution).

Both are correctly distinguished by the code itself (the `request.status !== 'REQUESTED'` branch vs. everything after it — see round 8's `handleAdminReconcileConfirmation`), and this round's evidence confirms that distinction holds on real infrastructure, not just in the local suite.

## Cleanup

All fault-injection triggers were dropped immediately after use; `SELECT name FROM sqlite_master WHERE type='trigger'` against the live database returns zero rows. All five seeded synthetic requests from rounds 9–10 remain on the isolated database in their final, correct states (three `CONFIRMED`, one `DECLINED`, one `REQUESTED`) — left in place as ongoing, inspectable evidence rather than deleted, since this is a preview database with no retention concern.

## Scope preserved

No code changes. No production database touched. No custom domain/DNS change. No live sends. Synthetic data only throughout.
