# HOLD - pricing freeze (James, 2026-10-05)

**Everything in this folder and on branch `ceo/fijidash-pricing-preview-candidate` is on HOLD. No further fare decisions are requested for now.** The candidate and the decision documents are kept available for reference only.

Freeze instruction (recorded verbatim in `docs/AGENT_SYNC.md`):

- Keep all current production prices and pricing rules unchanged.
- Preserve the already-deployed Nadi Momi corrections (Worker `0b961a4` live as `7a32a034`; NAT page `c5ee3b1`). Do not roll them back.
- Do not deploy the held FijiDash pricing candidate.
- No changes to catalogue fares, Worker formulas, discounts, extras, night surcharges, return rounding, commissions or fuel adjustments.
- Do not modify, reprice, replay or cancel existing or incoming bookings.
- Any reliability repair that could alter a quoted or saved amount, booking acceptance or notification behaviour stays preview-only pending separate approval.
- No production deployment under this instruction.

Held artefacts: the FijiDash candidate (`f1bc14a` and the documentation commits after it), `POLICY-DECISION-TABLE.md`, `CATALOGUE-LED-IMPLEMENTATION-PLAN.md`, `DECISION-SHEET.md`, `OWNER-DECISION-SHEET.md`, `RECONCILIATION.md`, `NIGHT.md`, `REVIEW-PACKAGE.md`. Their checkboxes are not selected and no recommendation in them is an approval.
